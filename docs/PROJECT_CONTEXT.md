# Project context

## Purpose

Monitor local processes by TCP port in a Tauri desktop application. A user adds a port and sees the process currently associated with it, including PID, RAM, CPU and status. The user can end a running process and inspect RAM/CPU history in charts.

## Required behavior

- Port entries are user-managed records and are persisted in SQLite.
- Each port can have an optional user-facing name that persists when the listener PID changes.
- Monitoring is realtime; the UI receives periodic snapshots rather than relying on stale values.
- A port record is never deleted merely because its process is unavailable.
- When a monitored process dies, its record remains with an offline/dead status.
- When a process later listens on the same port, the existing record reconnects automatically and displays the new PID and metrics.
- Ending a process is an explicit destructive action and must require a clear confirmation or equivalent safety affordance.
- Removing a monitored port intentionally removes its associated metric history through SQLite cascade deletion.
- Historical samples must remain associated with the monitored port record, not only with a transient PID. PIDs can be reused after a process exits.
- The header shows the monitor application's own CPU and RAM usage. On macOS, both metrics cover the app's resource coalition, including its WebKit WebContent, GPU and networking processes; RAM is their summed physical footprint.

## Current implementation status

The first working implementation is now in the repository:

- `src-tauri/src/lib.rs` owns SQLite migrations, port lookup, process metrics, sampling and Tauri commands.
- `src/routes/+page.svelte` renders the port table, realtime updates, actions and inline SVG charts.
- History is retained per monitored port for the latest 720 samples (about 24 minutes at a 2-second interval).
- Each sampling cycle reads the socket table once, records inspection failures explicitly and commits its database updates in one transaction.
- Process termination is guarded by the PID the user confirmed, so a replacement listener is never ended accidentally.
- Windows builds are validated by a native Windows CI job in addition to local macOS validation.
- `cargo check`, `cargo test`, `npm run check` and `npm run build` are the baseline validations.

Platform-specific socket visibility and process permissions can still affect whether a PID or metric is available; those cases must stay visible as offline/error states.

## Non-goals for the first version

- Remote-host monitoring.
- Starting, restarting or otherwise managing arbitrary services.
- Assuming a PID is a stable identity.
- Deleting history automatically when a process goes offline.
