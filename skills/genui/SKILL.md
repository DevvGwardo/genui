---
name: genui
description: 'Use when asked to render bounded, data-only UI in Hermes Desk — the "genui" skill. Natural triggers: "genui", "render a table of ...", "render a stat card showing ...", "render a bar chart of ...", "render a checklist for ...". Renders stat, table, bar_chart and checklist widgets via the mcp__hermes_desk__render_ui MCP tool.'
version: 1.0.0
author: devgwardo
license: MIT
metadata:
  hermes:
    tags: [ui, widgets, chart, table, checklist, desktop]
    category: desktop-ui
---

# Hermes Desk Generated UI (`render_ui`)

Use this skill to render native, accessible data cards directly inside a Hermes Desk conversation or shared room using the `mcp__hermes_desk__render_ui` MCP tool.

## Prerequisites and Discovery

1. **Profile enablement**: The active Hermes profile must have Hermes Desk MCP enabled in **Settings -> Workspace -> Agent browsing**. If calling `render_ui` returns `not_enabled: Browser control is not enabled for this profile`, `app_unavailable`, or `tool_search` finds no `mcp__hermes_desk__render_ui` tool in the current session, do not retry in a loop and **never** claim `render_ui` is unbuilt or emit `::preview{file="..."}` HTML files as a substitute. Explain that the profile must be enabled in **Settings -> Workspace -> Agent browsing** and its Hermes session restarted (`+ New chat`).
2. **Tool Search discovery**: When `tools.tool_search.enabled: auto` defers MCP schemas, discover and inspect the tool before calling it (note: `hermes_desk_render_ui` was only an early research name; the shipped tool is `render_ui`, exposed to Hermes profiles as `mcp__hermes_desk__render_ui`):
   - Run `tool_search` with `{"queries": ["hermes desk render_ui"], "limit": 10}`.
   - Run `tool_describe` with `{"names": ["mcp__hermes_desk__render_ui"]}`.
   - Invoke `mcp__hermes_desk__render_ui` (or `tool_call` with `name: "mcp__hermes_desk__render_ui"`).

## Strict v1 Schema Contract

Every `render_ui` call must pass an exact `{ "version": 1, "components": [...] }` object. Unknown keys, extra properties, or invalid types are rejected with `bad_args`.

```json
{
  "version": 1,
  "components": [
    {
      "type": "stat",
      "title": "Active tasks",
      "value": "12",
      "detail": "4 due today"
    },
    {
      "type": "table",
      "title": "Queue summary",
      "columns": ["Stage", "Count"],
      "rows": [
        ["Review", 3],
        ["Ready", 9]
      ]
    },
    {
      "type": "bar_chart",
      "title": "Throughput",
      "unit": "items",
      "items": [
        { "label": "Review", "value": 3 },
        { "label": "Ready", "value": 9 }
      ]
    },
    {
      "type": "checklist",
      "title": "Next steps",
      "items": [
        { "id": "verify_scope", "label": "Verify profile scope", "checked": true },
        { "id": "run_checks", "label": "Run focused checks", "checked": false }
      ]
    }
  ]
}
```

## Hard Bounds and Text Restrictions

- **Call and component caps**: Include 1 to 4 components per `render_ui` call, and make at most 4 `render_ui` calls per message or room turn. Total UTF-8 payload size must not exceed **16,384 bytes**.
- **Plain data labels only (no markup or URLs)**: Every string is validated against a strict filter. Strings must **never** contain:
  - Angle brackets (`<` or `>`) or HTML/XML tags.
  - URI schemes (`http:`, `https:`, `file:`, `data:`, `javascript:`, `vbscript:`) or protocol-relative paths (`//domain`). Put URLs in your surrounding Markdown prose, never inside `render_ui` fields.
  - Unicode control, format, bidi, or line/paragraph separator characters.
  - Empty or whitespace-only strings.
- **Per-widget limits**:
  - `title`: 1 to 80 characters on every component.
  - `stat`: `value` (1 to 80 chars, required), `detail` (1 to 160 chars, optional).
  - `table`: `columns` (1 to 6 strings, 1 to 60 chars each), `rows` (0 to 20 rows). Every row must have the **exact same length** as `columns`. Cells may be strings (1 to 160 chars) or finite numbers in `[-1e12, 1e12]`.
  - `bar_chart`: `items` (1 to 12 items), each with `label` (1 to 80 chars) and finite non-negative `value` in `[0, 1e12]`. Optional `unit` (1 to 40 chars).
  - `checklist`: `items` (1 to 20 items), each with a **unique** `id` matching `^[a-zA-Z0-9_-]{1,40}$`, `label` (1 to 160 chars), and optional boolean `checked`.

## Interaction Semantics

- Hermes Desk labels rendered blocks as **Generated UI · Agent-provided data, not verified**.
- Checklist checkboxes are **user-only local notes** stored in the user's local app storage (scoped to the conversation, profile, tool call, server-issued `genuiOccurrence`, and payload revision). Toggling a checkbox never sends a callback or follow-up turn to the agent.
- Do not include `genuiOccurrence` in tool arguments; Hermes Desk mints it on completion.
