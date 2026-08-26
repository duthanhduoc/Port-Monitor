## Project context

This repository is a desktop process/port monitor built with Tauri, React, Vite, TypeScript, Tailwind CSS and HeroUI. The product requirements, architecture decisions, data model and implementation rules are documented in `docs/`.

Before changing behavior, read:

1. `docs/PROJECT_CONTEXT.md` for the current implementation status and product scope.
2. `docs/ARCHITECTURE.md` for the frontend/backend/database boundaries.
3. `docs/DOMAIN_RULES.md` for the rules that must not regress, especially dead-port persistence and reconnecting by port.

These files are tool-agnostic and apply to any human or AI coding agent. Keep them updated when an architectural decision changes.
