# Architecture

## Runtime boundary

The application has two layers:

```text
SvelteKit/Tailwind UI
        │ Tauri invoke/events
Rust monitor service
        │
SQLite + operating-system process/network APIs
```

The Rust side owns OS inspection, sampling, persistence and process termination. The Svelte side owns presentation, user input, chart rendering and display state. Do not access OS process APIs from browser code.

## Recommended Rust responsibilities

- Validate and normalize port numbers.
- Resolve the process listening on a port.
- Read PID, process name, CPU and memory metrics using a maintained Rust system-process library or platform APIs.
- Run one shared sampling loop at a configurable interval; do not create one unbounded timer per UI component.
- Upsert the current observation for each monitored port.
- Mark a port offline when lookup fails, while retaining the port record and history.
- Re-resolve by port on every sampling cycle so a replacement process can reconnect with a new PID.
- Expose small, serializable commands such as list ports, add port, remove port, end process and load history.
- Emit a single realtime update event after a sampling cycle, or provide an equivalent subscription mechanism.
- Include the monitor application's own process metrics in the realtime snapshot.
- On macOS, calculate app CPU by summing `sysinfo` CPU usage and app RAM with `proc_pid_rusage` physical footprint across every PID sharing the main process's resource coalition, falling back to the main process if grouping is unavailable; use main-process metrics on other platforms.

## Recommended frontend responsibilities

- Load persisted monitored ports on startup.
- Subscribe once to monitor updates and clean up the listener on teardown.
- Render `online`, `offline`, `permission_denied` and `error` as distinct states where useful.
- Keep chart data keyed by `port_record_id`; update the current point without replacing the identity of the monitored port.
- Disable or hide “end process” when no live PID is available.
- Display errors from commands without silently dropping the port record.

## Suggested command/event contract

Names are suggestions, not a requirement. Preserve the semantics if names change.

| Operation               | Input                        | Result                                           |
| ----------------------- | ---------------------------- | ------------------------------------------------ |
| `list_monitored_ports`  | none                         | persisted port records with latest observation   |
| `add_monitored_port`    | `port`, optional `name`      | created record; duplicate port returns an error  |
| `remove_monitored_port` | `port_record_id`             | deleted record and intentionally deleted history |
| `end_process`           | `port_record_id` or live PID | success/error; never deletes the port record     |
| `get_metric_history`    | `port_record_id`, time range | ordered samples                                  |
| `monitor:update` event  | snapshot list                | latest state for all monitored ports             |

The exact serialization format should be documented in code beside the command definitions and covered by tests.

## SQLite shape

Prefer a stable port identity and a separate sample table:

```text
monitored_ports
  id                primary key
  port              unique, indexed
  name              nullable user-facing label
  created_at
  updated_at

process_samples
  id                primary key
  monitored_port_id foreign key
  observed_at
  pid               nullable
  process_name      nullable
  status
  cpu_percent       nullable
  memory_bytes      nullable
```

Use a migration mechanism from the beginning. Add an index on `(monitored_port_id, observed_at)` and prune samples only through an explicit retention policy, never as a side effect of a process dying.
