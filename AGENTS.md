## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Project context

This repository is a desktop process/port monitor built with Tauri, SvelteKit, TypeScript and Tailwind CSS. The product requirements, architecture decisions, data model and implementation rules are documented in `docs/`.

Before changing behavior, read:

1. `docs/PROJECT_CONTEXT.md` for the current implementation status and product scope.
2. `docs/ARCHITECTURE.md` for the frontend/backend/database boundaries.
3. `docs/DOMAIN_RULES.md` for the rules that must not regress, especially dead-port persistence and reconnecting by port.

These files are tool-agnostic and apply to any human or AI coding agent. Keep them updated when an architectural decision changes.
