# Development guide for agents

## Safe workflow

1. Read `PROJECT_CONTEXT.md`, `ARCHITECTURE.md` and `DOMAIN_RULES.md` before implementing monitor behavior.
2. Inspect the existing code before introducing dependencies or abstractions.
3. Keep OS-facing logic in Rust and keep Svelte components focused on UI.
4. Make the smallest change that satisfies the requirement; avoid speculative plugin systems or generic frameworks.
5. Add or update tests for lifecycle transitions, persistence and command validation.
6. Run the relevant checks before handing off:

```sh
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Use the repository's package manager consistently; the Tauri config currently calls `bun run` for dev/build, while `npm` scripts are available for validation.

## Windows validation

Native Windows development requires Bun, Rust with the MSVC toolchain, Microsoft C++ Build Tools with “Desktop development with C++”, and WebView2. Run `bun tauri build --debug --no-bundle` to validate the executable without requiring MSI/NSIS packaging. The `windows.yml` workflow performs this check on every pull request and push to `main`.

Cargo build output contains absolute paths. If the repository is moved, run `cargo clean --manifest-path src-tauri/Cargo.toml` once before rebuilding.

## Change notes

- Update the docs when a command contract, schema, status vocabulary or sampling policy changes.
- Do not commit generated directories such as `target/` or `.svelte-kit/`.
- Do not add a chart or system-process dependency without checking its licensing, platform support and bundle impact.
- If a platform-specific metric is unavailable, preserve the monitor record and explain the limitation in the UI.

## Definition of done

A feature is not done when it only renders mock data. It is done when the backend behavior, persistence, realtime update path, error behavior and relevant tests agree with the documented domain rules.
