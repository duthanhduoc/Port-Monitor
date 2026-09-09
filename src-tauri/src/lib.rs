use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Emitter, Manager, State};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);
const HISTORY_LIMIT: i64 = 720;

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorRow {
    id: i64,
    port: u16,
    name: Option<String>,
    pid: Option<u32>,
    process_name: Option<String>,
    status: String,
    cpu_percent: Option<f32>,
    memory_bytes: Option<u64>,
    observed_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricSample {
    observed_at: i64,
    pid: Option<u32>,
    cpu_percent: Option<f32>,
    memory_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppMetrics {
    cpu_percent: Option<f32>,
    memory_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MonitorSnapshot {
    monitors: Vec<MonitorRow>,
    app_metrics: AppMetrics,
}

#[derive(Debug, Serialize)]
struct CommandResult {
    ok: bool,
    message: String,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        Err("Port must be between 1 and 65535".into())
    } else {
        Ok(())
    }
}

fn open_db(path: &PathBuf) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS monitored_ports (
            id INTEGER PRIMARY KEY, port INTEGER NOT NULL UNIQUE, name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS process_samples (
            id INTEGER PRIMARY KEY, monitored_port_id INTEGER NOT NULL REFERENCES monitored_ports(id) ON DELETE CASCADE,
            observed_at INTEGER NOT NULL, pid INTEGER, process_name TEXT, status TEXT NOT NULL,
            cpu_percent REAL, memory_bytes INTEGER
        );
        CREATE INDEX IF NOT EXISTS samples_by_port_time ON process_samples(monitored_port_id, observed_at DESC);"
    ).map_err(|e| e.to_string())?;
    let has_name = connection
        .prepare("SELECT name FROM pragma_table_info('monitored_ports') WHERE name = 'name'")
        .map_err(|e| e.to_string())?
        .exists([])
        .map_err(|e| e.to_string())?;
    if !has_name {
        connection
            .execute("ALTER TABLE monitored_ports ADD COLUMN name TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn listening_processes() -> Result<HashMap<u16, u32>, String> {
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP,
    )
    .map_err(|e| e.to_string())?;
    let mut processes = HashMap::new();
    for socket in sockets {
        if let ProtocolSocketInfo::Tcp(tcp) = socket.protocol_socket_info {
            if tcp.state == TcpState::Listen {
                if let Some(pid) = socket.associated_pids.into_iter().next() {
                    processes.entry(tcp.local_port).or_insert(pid);
                }
            }
        }
    }
    Ok(processes)
}

fn current_process_for_port(port: u16) -> Result<Option<u32>, String> {
    Ok(listening_processes()?.get(&port).copied())
}

fn observation_status(
    lookup_succeeded: bool,
    pid: Option<u32>,
    process_available: bool,
) -> &'static str {
    if !lookup_succeeded || pid.is_some() && !process_available {
        "error"
    } else if process_available {
        "online"
    } else {
        "offline"
    }
}

fn monitor_ports(connection: &mut Connection, system: &mut System) -> Result<(), String> {
    let ports: Vec<(i64, u16)> = {
        let mut statement = connection
            .prepare("SELECT id, port FROM monitored_ports ORDER BY port")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let listening = listening_processes();
    system.refresh_all();
    let observed_at = now();
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    for (id, port) in ports {
        let pid = listening
            .as_ref()
            .ok()
            .and_then(|processes| processes.get(&port).copied());
        let process = pid.and_then(|value| system.process(Pid::from_u32(value)));
        let status = observation_status(listening.is_ok(), pid, process.is_some());
        let process_name = process.map(|p| p.name().to_string_lossy().to_string());
        let cpu_percent = process.map(|p| p.cpu_usage());
        let memory_bytes = process.map(|p| p.memory());
        transaction.execute(
            "INSERT INTO process_samples (monitored_port_id, observed_at, pid, process_name, status, cpu_percent, memory_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, observed_at, pid, process_name, status, cpu_percent, memory_bytes.map(|value| value as i64)],
        ).map_err(|e| e.to_string())?;
        transaction
            .execute(
                "UPDATE monitored_ports SET updated_at = ?1 WHERE id = ?2",
                params![observed_at, id],
            )
            .map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM process_samples WHERE monitored_port_id = ?1 AND id NOT IN
             (SELECT id FROM process_samples WHERE monitored_port_id = ?1 ORDER BY observed_at DESC LIMIT ?2)",
            params![id, HISTORY_LIMIT],
        ).map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}

fn query_rows(connection: &Connection) -> Result<Vec<MonitorRow>, String> {
    let mut statement = connection.prepare(
        "SELECT p.id, p.port, p.name, s.pid, s.process_name, COALESCE(s.status, 'offline'), s.cpu_percent, s.memory_bytes, s.observed_at
         FROM monitored_ports p LEFT JOIN process_samples s ON s.id =
         (SELECT id FROM process_samples WHERE monitored_port_id = p.id ORDER BY observed_at DESC, id DESC LIMIT 1) ORDER BY p.port"
    ).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(MonitorRow {
                id: row.get(0)?,
                port: row.get(1)?,
                name: row.get(2)?,
                pid: row.get(3)?,
                process_name: row.get(4)?,
                status: row.get(5)?,
                cpu_percent: row.get(6)?,
                memory_bytes: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
                observed_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn list_monitored_ports(state: State<'_, AppState>) -> Result<Vec<MonitorRow>, String> {
    query_rows(&open_db(&state.db_path)?)
}

fn insert_monitored_port(
    connection: &Connection,
    port: u16,
    name: Option<String>,
) -> Result<(), String> {
    validate_port(port)?;
    let inserted = connection.execute(
        "INSERT OR IGNORE INTO monitored_ports(port, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![port, name.filter(|value| !value.trim().is_empty()), now()],
    ).map_err(|e| e.to_string())?;
    if inserted == 0 {
        return Err(format!("Port {} is already being monitored", port));
    }
    Ok(())
}

#[tauri::command]
fn add_monitored_port(
    port: u16,
    name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<MonitorRow>, String> {
    let connection = open_db(&state.db_path)?;
    insert_monitored_port(&connection, port, name)?;
    query_rows(&connection)
}

#[tauri::command]
fn rename_monitored_port(
    id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<Vec<MonitorRow>, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Process name cannot be empty".into());
    }
    let connection = open_db(&state.db_path)?;
    let changed = connection
        .execute(
            "UPDATE monitored_ports SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Monitored port not found".into());
    }
    query_rows(&connection)
}

#[tauri::command]
fn remove_monitored_port(id: i64, state: State<'_, AppState>) -> Result<Vec<MonitorRow>, String> {
    let connection = open_db(&state.db_path)?;
    connection
        .execute("DELETE FROM monitored_ports WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    query_rows(&connection)
}

#[tauri::command]
fn get_metric_history(id: i64, state: State<'_, AppState>) -> Result<Vec<MetricSample>, String> {
    let connection = open_db(&state.db_path)?;
    let mut statement = connection.prepare("SELECT observed_at, pid, cpu_percent, memory_bytes FROM process_samples WHERE monitored_port_id = ?1 ORDER BY observed_at ASC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![id], |row| {
            Ok(MetricSample {
                observed_at: row.get(0)?,
                pid: row.get(1)?,
                cpu_percent: row.get(2)?,
                memory_bytes: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn verify_expected_pid(expected_pid: u32, current_pid: Option<u32>) -> Result<u32, String> {
    match current_pid {
        Some(pid) if pid == expected_pid => Ok(pid),
        Some(pid) => Err(format!(
            "The listener changed from PID {} to PID {}. Review it before ending the new process.",
            expected_pid, pid
        )),
        None => Err("No live process is listening on this port".into()),
    }
}

#[tauri::command]
fn end_process(
    id: i64,
    expected_pid: u32,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let connection = open_db(&state.db_path)?;
    let port: Option<u16> = connection
        .query_row(
            "SELECT port FROM monitored_ports WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let port = port.ok_or_else(|| "Monitored port not found".to_string())?;
    let pid = verify_expected_pid(expected_pid, current_process_for_port(port)?)?;
    let mut system = System::new_all();
    system.refresh_all();
    let process = system
        .process(Pid::from_u32(pid))
        .ok_or_else(|| "Process is no longer available".to_string())?;
    if process.kill() {
        Ok(CommandResult {
            ok: true,
            message: format!("Ended process {}", pid),
        })
    } else {
        Err(format!("Could not end process {}. Check permissions.", pid))
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Default)]
struct ProcessCoalitionInfo {
    coalition_id: [u64; 2],
    reserved: [u64; 3],
}

#[cfg(target_os = "macos")]
fn resource_coalition_id(pid: u32) -> Option<u64> {
    const PROC_PIDCOALITIONINFO: i32 = 20;
    let mut info = ProcessCoalitionInfo::default();
    let size = std::mem::size_of::<ProcessCoalitionInfo>() as i32;
    // SAFETY: `info` is a writable C-compatible buffer of exactly `size` bytes.
    let copied = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            PROC_PIDCOALITIONINFO,
            0,
            (&mut info as *mut ProcessCoalitionInfo).cast(),
            size,
        )
    };
    (copied == size && info.coalition_id[0] != 0).then_some(info.coalition_id[0])
}

#[cfg(target_os = "macos")]
fn physical_footprint(pid: u32) -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v0>::uninit();
    // SAFETY: macOS initializes `usage` when `proc_pid_rusage` returns success.
    let result = unsafe {
        libc::proc_pid_rusage(pid as i32, libc::RUSAGE_INFO_V0, usage.as_mut_ptr().cast())
    };
    (result == 0).then(|| unsafe { usage.assume_init().ri_phys_footprint })
}

#[cfg(target_os = "macos")]
fn app_memory(system: &System) -> Option<u64> {
    let app_pid = std::process::id();
    let total = resource_coalition_id(app_pid)
        .map(|coalition_id| {
            system
                .processes()
                .keys()
                .filter(|pid| resource_coalition_id(pid.as_u32()) == Some(coalition_id))
                .filter_map(|pid| physical_footprint(pid.as_u32()))
                .fold(0_u64, u64::saturating_add)
        })
        .unwrap_or(0);
    (total > 0)
        .then_some(total)
        .or_else(|| physical_footprint(app_pid))
        .or_else(|| {
            system
                .process(Pid::from_u32(app_pid))
                .map(|process| process.memory())
        })
}

#[cfg(not(target_os = "macos"))]
fn app_memory(system: &System) -> Option<u64> {
    system
        .process(Pid::from_u32(std::process::id()))
        .map(|process| process.memory())
}

#[cfg(target_os = "macos")]
fn app_cpu(system: &System) -> Option<f32> {
    let app_pid = std::process::id();
    resource_coalition_id(app_pid)
        .and_then(|coalition_id| {
            system
                .processes()
                .iter()
                .filter(|(pid, _)| resource_coalition_id(pid.as_u32()) == Some(coalition_id))
                .map(|(_, process)| process.cpu_usage())
                .reduce(|total, usage| total + usage)
        })
        .or_else(|| {
            system
                .process(Pid::from_u32(app_pid))
                .map(|process| process.cpu_usage())
        })
}

#[cfg(not(target_os = "macos"))]
fn app_cpu(system: &System) -> Option<f32> {
    system
        .process(Pid::from_u32(std::process::id()))
        .map(|process| process.cpu_usage())
}

fn app_metrics(system: &System) -> AppMetrics {
    AppMetrics {
        cpu_percent: app_cpu(system),
        memory_bytes: app_memory(system),
    }
}

fn emit_snapshot(app: &AppHandle, db_path: &PathBuf, system: &mut System) {
    let result = (|| {
        let mut connection = open_db(db_path)?;
        monitor_ports(&mut connection, system)?;
        let rows = query_rows(&connection)?;
        app.emit(
            "monitor:update",
            MonitorSnapshot {
                monitors: rows,
                app_metrics: app_metrics(system),
            },
        )
        .map_err(|e| e.to_string())
    })();
    if let Err(error) = result {
        eprintln!("monitor sampling failed: {error}");
        let _ = app.emit("monitor:error", error);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let db_path = directory.join("monitor.sqlite3");
            migrate(&open_db(&db_path)?)?;
            app.manage(AppState {
                db_path: db_path.clone(),
            });
            let handle = app.handle().clone();
            thread::spawn(move || {
                let mut system = System::new_all();
                loop {
                    emit_snapshot(&handle, &db_path, &mut system);
                    thread::sleep(SAMPLE_INTERVAL);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_monitored_ports,
            add_monitored_port,
            rename_monitored_port,
            remove_monitored_port,
            get_metric_history,
            end_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        insert_monitored_port, migrate, observation_status, validate_port, verify_expected_pid,
    };

    #[test]
    fn validates_tcp_ports() {
        assert!(validate_port(1).is_ok());
        assert!(validate_port(u16::MAX).is_ok());
        assert!(validate_port(0).is_err());
    }

    #[test]
    fn rejects_duplicate_monitored_ports() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        insert_monitored_port(&connection, 3000, None).unwrap();
        let error = insert_monitored_port(&connection, 3000, None).unwrap_err();
        assert_eq!(error, "Port 3000 is already being monitored");
    }

    #[test]
    fn refuses_to_end_a_replacement_process() {
        assert_eq!(verify_expected_pid(10, Some(10)).unwrap(), 10);
        assert!(verify_expected_pid(10, Some(11))
            .unwrap_err()
            .contains("changed"));
        assert!(verify_expected_pid(10, None).is_err());
    }

    #[test]
    fn distinguishes_offline_and_inspection_errors() {
        assert_eq!(observation_status(true, None, false), "offline");
        assert_eq!(observation_status(true, Some(10), true), "online");
        assert_eq!(observation_status(true, Some(10), false), "error");
        assert_eq!(observation_status(false, None, false), "error");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_app_memory_includes_its_resource_coalition() {
        let mut system = sysinfo::System::new_all();
        system.refresh_all();
        let own = super::physical_footprint(std::process::id()).unwrap();
        assert!(super::app_memory(&system).unwrap() >= own);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_app_cpu_includes_its_resource_coalition() {
        let mut system = sysinfo::System::new_all();
        system.refresh_all();
        let own = system
            .process(sysinfo::Pid::from_u32(std::process::id()))
            .unwrap()
            .cpu_usage();
        assert!(super::app_cpu(&system).unwrap() >= own);
    }

    #[test]
    fn deleting_a_monitor_cascades_its_history() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        migrate(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO monitored_ports (port, created_at, updated_at) VALUES (3000, 1, 1)",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO process_samples (monitored_port_id, observed_at, status) VALUES (1, 1, 'offline')", []).unwrap();
        connection
            .execute("DELETE FROM monitored_ports WHERE id = 1", [])
            .unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM process_samples", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
