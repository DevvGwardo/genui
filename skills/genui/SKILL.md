---
name: genui
description: 'Render bounded data-only UI cards via genui.'
version: 1.1.0
author: devgwardo
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [ui, widgets, chart, table, checklist, desktop]
    category: desktop-ui
---

# Hermes Desk Generated UI (`render_ui`)

Use this skill to render native, accessible data cards directly inside a Hermes Desk conversation or shared room using the `mcp__hermes_desk__render_ui` MCP tool.

## When to Use

- The user explicitly invokes **genui**, or asks to render a card (natural triggers: `"render a table of ..."`, `"render a stat card showing ..."`, `"render a bar chart of ..."`, `"render a checklist for ..."`): e.g., queue bursts, today's build time, ranked throughput, or release steps.
- The user wants a compact, scannable summary that fits the card limits: a handful of headline numbers, a small comparison matrix, a few ranked bars, a short runbook checklist.
- The user wants a checklist they can tick off locally while reading; toggles are user-local notes and never call back to you.
- Every value can be written as a short plain string or a finite number, and the whole argument fits the v1 payload contract in `docs/contract.md`.

## When NOT to Use

- The content needs markup or links **inside the card** (badges, `<code>`, `https://...`): card strings reject angle brackets, URI schemes and protocol-relative paths — put links and formatting in your Markdown prose instead.
- The content exceeds the card limits (a 40-row incident table, a 7-column comparison, a full report): write Markdown, or pre-aggregate into a smaller card.
- The interaction must call back to you (a form, a button that triggers work, live-updating values): the only interactive element is the user-local checklist toggle; if that is not enough, say what you cannot do instead of faking it.
- Hermes Desk is not available for the profile — the tool is missing from `tool_search` results, or the call returns `not_enabled` / `app_unavailable`: fix the profile first (see `docs/errors.md`), and never fake a rendered card.

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

## Minimal Examples (one per widget type)

Each payload below is a complete, valid `render_ui` argument, isolated to a single component. Copy and adapt one; validate against `schema/v1.json` before dispatch.

**stat**

```json
{
  "version": 1,
  "components": [
    {
      "type": "stat",
      "title": "Build time",
      "value": "3m 42s",
      "detail": "p50 over the last 20 runs"
    }
  ]
}
```

**table**

```json
{
  "version": 1,
  "components": [
    {
      "type": "table",
      "title": "Service status",
      "columns": ["Service", "State"],
      "rows": [
        ["api", "ok"],
        ["worker", "degraded"]
      ]
    }
  ]
}
```

**bar_chart**

```json
{
  "version": 1,
  "components": [
    {
      "type": "bar_chart",
      "title": "Queue depth by stage",
      "unit": "jobs",
      "items": [
        { "label": "queued", "value": 12 },
        { "label": "running", "value": 3 },
        { "label": "failed", "value": 1 }
      ]
    }
  ]
}
```

**checklist**

```json
{
  "version": 1,
  "components": [
    {
      "type": "checklist",
      "title": "Release checklist",
      "items": [
        { "id": "run_tests", "label": "Run the focused test suite", "checked": true },
        { "id": "tag_release", "label": "Tag the release", "checked": false }
      ]
    }
  ]
}
```

## Quick Reference

One table; the full bound set is defined once in `docs/contract.md` (single source of truth) and enforced by `schema/v1.json`.

| Widget | Required fields | Caps |
|---|---|---|
| *(every component)* | `type`, `title` | `title`: 1–80 characters |
| *(every call)* | `version`, `components` | 1–4 components per `render_ui` call; at most 4 calls per message or room turn; serialized payload must not exceed 16,384 bytes |
| `stat` | `type`, `title`, `value` | `value`: 1–80 characters; optional `detail`: 1–160 characters |
| `table` | `type`, `title`, `columns`, `rows` | `columns`: 1–6 strings of 1–60 characters; `rows`: 0–20 rows, each with exactly `columns.length` cells; each cell is 1–160 characters or a finite number in [-1e12, 1e12] |
| `bar_chart` | `type`, `title`, `items` | `items`: 1–12 items; `label`: 1–80 characters; `value`: a finite non-negative number in [0, 1e12]; optional `unit`: 1–40 characters |
| `checklist` | `type`, `title`, `items` | `items`: 1–20 items; `label`: 1–160 characters; `id` must be unique and match `^[a-zA-Z0-9_-]{1,40}$`; optional boolean `checked` |

## Text Restrictions (every string)

Every string in every field is validated against a strict filter. Strings must **never** contain:

- Angle brackets (`<` or `>`) or HTML/XML tags.
- URI schemes (`http:`, `https:`, `file:`, `data:`, `javascript:`, `vbscript:`) or protocol-relative paths (`//domain`). Put URLs in your surrounding Markdown prose, never inside `render_ui` fields.
- Unicode control, format, bidi, or line/paragraph separator characters.
- Empty or whitespace-only strings.

Printable non-ASCII is **allowed**: accented Latin, CJK, and standalone emoji all pass — the banned character classes above are the only Unicode exclusions. Each example below is a JSON string literal:

| JSON string literal | Allowed? | Why |
|---|---|---|
| `"Café Münster"` | allowed | accented Latin is printable |
| `"任务完成"` | allowed | CJK is printable |
| `"✅ Done"` | allowed | standalone emoji are printable (not control/format characters) |
| `"<b>bold</b>"` | blocked | angle brackets are markup |
| `"https://example.com"` | blocked | URI scheme |
| `"//example.com"` | blocked | protocol-relative path |
| `"Tab\there"` | blocked | tab is a control character (U+0009) |
| `"a\u200Bb"` | blocked | zero-width space is a format character (U+200B) |
| `"a\u202Eb"` | blocked | right-to-left override is a bidi character (U+202E) |
| `"👨‍👩‍👧"` | blocked | this emoji is glued with zero-width joiners (U+200D, a format character) |
| `"   "` | blocked | no visible character |

## Pruning Under the Byte Cap

When your serialized argument exceeds the byte cap in `docs/contract.md`, apply these steps in order. Re-measure after each step and stop as soon as it fits. No step involves judgement; do not skip, reorder, or improvise steps.

1. **Measure.** Serialize the exact argument you intend to send (compact UTF-8, no pretty-printing) and count its bytes; never estimate from the source text. If it already fits, send it.
2. **Drop optional fields.** Remove every non-required field, in this order, re-measuring after each: all `detail` fields, then all `unit` fields, then all `checked` fields.
3. **Drop trailing rows.** While still over, remove the last row of the table with the most rows (tied: the table appearing later in `components`). Tables may shrink to zero rows.
4. **Drop trailing items.** While still over, remove the last item of the longest item list (`bar_chart` or `checklist`; tied: the component appearing later in `components`). Item lists may shrink to a single item, never fewer.
5. **Drop whole components.** While still over, remove the last component in `components`. Keep at least one component; order components by importance before dispatch, most important first.
6. **Stop and report.** If a single minimal component is still over the cap, send nothing; tell the user the data does not fit one card call, and suggest sending it across several messages (each call within the cap) or narrowing the data.

Never truncate a string or a number, and never silently change a value, to make room — dropping is the only pruning move.

## Pitfalls

- **Markup or links inside card strings.** Failure: strings such as `<b>` and `https://...` are rejected by the text filter, so the call fails and the turn is wasted. Fix: keep card strings plain; put links and formatting in your surrounding Markdown prose.
- **Row/column mismatch in a table.** Failure: a row whose cell count differs from `columns` is rejected by the runtime — the schema cannot express this rule (see `docs/contract.md`) — after you have already spent the call. Fix: count cells per row before dispatch, and keep tables small enough to eyeball.
- **Retry storm on `not_enabled` / `app_unavailable`.** Failure: the profile has Hermes Desk MCP disabled, the call keeps failing, and retrying burns turns; faking a card with `::preview` HTML is explicitly forbidden. Fix: enable **Settings -> Workspace -> Agent browsing**, restart the Hermes session (`+ New chat`), and tell the user; do not retry in a loop.
- **Duplicate checklist `id`s.** Failure: ids must be unique within a component; duplicates are rejected, and the runtime does not document a code for this rejection (see `docs/errors.md`), so it is easy to miss. Fix: derive each id from its label and check uniqueness before dispatch.
- **Payload over the byte cap.** Failure: `too_large` when the serialized argument outgrows the cap in `docs/contract.md` — usually caused by stacking large tables into one call. Fix: apply the ordered drop rules in **Pruning Under the Byte Cap** and re-measure after each step.
- **Treating the card as verified data.** Failure: the block is labeled **Generated UI · Agent-provided data, not verified**; quoting it as evidence — or assuming the user's checklist toggles notify you — is wrong, because toggles are user-local and never call back. Fix: keep verification in your own tool work, present cards as summaries, and never wait for a toggle.
- **Wrong or omitted `version`.** Failure: the payload is rejected, and mangling a newer-version payload into v1 is explicitly forbidden (see Version negotiation in `docs/contract.md`). Fix: send exactly the v1 shape; if the payload's version is unknown, stop and say so.
- **Spoofing `genuiOccurrence`.** Failure: including it in tool arguments does nothing except taint the call — Hermes Desk mints it server-side on completion. Fix: never send it; if you need to reference a rendered block, describe it in prose.

## Pre-flight Self-check

Run this list against the exact JSON you are about to send. Each line names the rejection it prevents.

- [ ] `version` is exactly 1 — rejected otherwise by: `const` and `required`.
- [ ] Root keys are only `version` and `components` — rejected otherwise by: `additionalProperties`.
- [ ] Component count is within the call cap — rejected otherwise by: `minItems` / `maxItems`.
- [ ] Every component has `type` and `title`, plus its widget's required fields — rejected otherwise by: `required`.
- [ ] Every `type` is one of `stat`, `table`, `bar_chart`, `checklist` — rejected otherwise by: `oneOf` / `const`.
- [ ] Every string is non-empty, not whitespace-only, and within its length cap — rejected otherwise by: `minLength` / `maxLength` / `pattern` (`\S`).
- [ ] No string contains angle brackets, URI schemes, protocol-relative paths, or control/format/bidi/line characters — rejected otherwise by: `not` + `pattern`.
- [ ] Numbers are finite and within their ranges — rejected otherwise by: `minimum` / `maximum` / `anyOf`.
- [ ] Every table row has exactly as many cells as `columns` — rejected otherwise by: runtime rule (schema cannot express it; see `docs/contract.md`).
- [ ] Checklist `id`s match the id pattern and are unique within their component — rejected otherwise by: `pattern` plus a runtime uniqueness rule (see `docs/errors.md`).
- [ ] The serialized payload is within the byte cap — rejected otherwise by: runtime rule (`too_large`; see `docs/contract.md`).

## Deterministic Repair Loop (`bad_args`)

If `render_ui` returns `bad_args` (or pre-dispatch validation against `schema/v1.json` fails), apply this deterministic mapping **at most 1 retry** before reporting cleanly in prose — never retry in a loop and never guess a different `version` or field semantics:

| Rejection symptom | Mapped **Pre-flight Self-check** line | Deterministic fix |
|---|---|---|
| Missing or non-`1` `version` | "`version` is exactly 1" | Stop if the source data declares another version (see `docs/contract.md`); otherwise set `version` to `1` when constructing a v1 payload yourself. |
| Unknown root key or extra property (including `genuiOccurrence`) | "Root keys are only `version` and `components`" | Remove only the undeclared key(s); never rename unknown keys by guesswork. |
| Empty or oversized `components` array | "Component count is within the call cap" | If empty, skip `render_ui` and answer in prose; if over the cap, keep the most important components first and drop trailing ones. |
| Missing `type`, `title`, or widget required field | "Every component has `type` and `title`, plus its widget's required fields" | Populate the missing required field from already-verified data; if unavailable, abort the card and report in prose. |
| Unknown or non-string `type` | "Every `type` is one of `stat`, `table`, `bar_chart`, `checklist`" | Pick the matching widget among those four; if none fits, abort and render Markdown prose. |
| Empty, whitespace-only, over-length, or non-string text field | "Every string is non-empty, not whitespace-only, and within its length cap" | Rewrite to concise plain text within the cap, or drop the optional field (`detail`, `unit`); never truncate values silently. |
| Angle brackets, URI scheme, `//`, or control/format/bidi/line char | "No string contains angle brackets, URI schemes, protocol-relative paths, or control/format/bidi/line characters" | Strip markup/control characters from card fields and move URLs into surrounding Markdown prose. |
| Non-finite, negative (on `bar_chart`), or out-of-range number | "Numbers are finite and within their ranges" | Use verified finite numbers in range, or drop the card and report in prose. |
| Table row cell count differs from `columns` | "Every table row has exactly as many cells as `columns`" | Align cells to `columns` using verified data only; never fabricate values. |
| Invalid or duplicate checklist `id` | "Checklist `id`s match the id pattern and are unique within their component" | Normalize each `id` to `[a-zA-Z0-9_-]` and deduplicate deterministically (e.g., `-2`, `-3`). |
| Payload exceeds byte cap (`too_large`) | "The serialized payload is within the byte cap" | Apply **Pruning Under the Byte Cap** steps in order. |

**Retry cap:** Re-run the full **Pre-flight Self-check** on the repaired payload and re-issue `render_ui` **at most 1 retry** after the initial `bad_args` rejection. If the single retry is still rejected (or if `not_enabled` / `app_unavailable` occurs, which takes zero retries), stop calling `render_ui`, explain the rejection cleanly in Markdown prose, and present the verified data as plain text.

## Interaction Semantics

- Hermes Desk labels rendered blocks as **Generated UI · Agent-provided data, not verified**.
- Checklist checkboxes are **user-only local notes** stored in the user's local app storage (scoped to the conversation, profile, tool call, server-issued `genuiOccurrence`, and payload revision). Toggling a checkbox never sends a callback or follow-up turn to the agent.
- Do not include `genuiOccurrence` in tool arguments; Hermes Desk mints it on completion.
