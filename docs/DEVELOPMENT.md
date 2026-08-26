# Development guide for agents

## Safe workflow

1. Read `PROJECT_CONTEXT.md`, `ARCHITECTURE.md` and `DOMAIN_RULES.md` before implementing monitor behavior.
2. Inspect the existing code before introducing dependencies or abstractions.
3. Keep OS-facing logic in Rust and keep React components focused on UI.
4. Make the smallest change that satisfies the requirement; avoid speculative plugin systems or generic frameworks.
5. Add or update tests for lifecycle transitions, persistence and command validation.
6. Run the relevant checks before handing off:

```sh
bun run check
bun run lint
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Use Bun consistently for dependency installation and validation; the Tauri config also calls `bun run` for dev/build.

## Change notes

- Update the docs when a command contract, schema, status vocabulary or sampling policy changes.
- Do not commit generated directories such as `target/` or `dist/`.
- Do not add a chart or system-process dependency without checking its licensing, platform support and bundle impact.
- If a platform-specific metric is unavailable, preserve the monitor record and explain the limitation in the UI.

## Definition of done

A feature is not done when it only renders mock data. It is done when the backend behavior, persistence, realtime update path, error behavior and relevant tests agree with the documented domain rules.
