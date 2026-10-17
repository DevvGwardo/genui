# genui — v1 bounds contract

Single source of truth for every numeric and character bound of the `mcp__hermes_desk__render_ui` v1 payload. The runtime behavior of Hermes Desk is the product contract; `schema/v1.json`, `skills/genui/SKILL.md` and `README.md` are consumers of this table. If any artifact disagrees with this table, the artifact is the bug — fix it in the same change, never "update the table to match the bug".

Consistency check: `node tools/check-bounds.mjs` extracts the bound tokens below and diffs them against `skills/genui/SKILL.md`, exiting non-zero on any drift (counts matter, so a bound cannot be moved between fields undetected).

## Bounds

| Field | Bound | Notes |
|---|---|---|
| `version` | exactly `1` | Payload root literal: `{"version": 1, "components": [...]}` (const in `schema/v1.json`). |
| `components` | 1–4 (components per `render_ui` call) | Required array. |
| `render_ui` calls | at most 4 (calls per message or room turn) | Conversation-level cap, not payload content. |
| payload size | must not exceed 16,384 bytes (UTF-8) | Measured on the serialized tool argument. |
| `components[].type` | one of `stat`, `table`, `bar_chart`, `checklist` | Required discriminator; unknown types are rejected. |
| `components[].title` | 1–80 characters | Required on every component; no per-widget override. |
| `stat.value` | 1–80 characters | Required. |
| `stat.detail` | 1–160 characters | Optional. |
| `table.columns` | 1–6 strings | Required; may not be empty. |
| `table.columns[]` | 1–60 characters each | Per column name. |
| `table.rows` | 0–20 (rows) | Required; an empty array is valid. |
| `table.rows[]` string cell | 1–160 characters | Per cell. |
| `table.rows[]` number cell | [-1e12, 1e12] | Finite; JSON has no NaN or Infinity literals. |
| `table.rows[]` width | exactly `columns.length` cells | Runtime-enforced; JSON Schema cannot express it (called out in `schema/v1.json` `$comment`). |
| `bar_chart.items` | 1–12 (items) | Required; may not be empty. |
| `bar_chart.items[].label` | 1–80 characters | Required. |
| `bar_chart.items[].value` | [0, 1e12] | Finite, non-negative. |
| `bar_chart.unit` | 1–40 characters | Optional. |
| `checklist.items` | 1–20 (items) | Required; may not be empty. |
| `checklist.items[].id` | pattern `^[a-zA-Z0-9_-]{1,40}$`, unique | Required. Uniqueness is runtime-enforced; JSON Schema cannot express it. |
| `checklist.items[].label` | 1–160 characters | Required. |
| `checklist.items[].checked` | boolean | Optional. |

## String filter (applies to every string field above)

All strings must pass the runtime text filter. A string is rejected when it contains:

| Rejected content | Example |
|---|---|
| angle brackets or markup | `<b>done</b>` |
| a URI scheme (`http:`, `https:`, `file:`, `data:`, `javascript:`, `vbscript:`) | `https://example.com` |
| a protocol-relative path | `//example.com/x` |
| a Unicode control, format, bidi, or line/paragraph separator character | a string containing U+0007 or U+202E |
| nothing (empty or whitespace-only string) | `"   "` |

## Keeping this table honest

Run `node tools/check-bounds.mjs` before committing any change to a bound. The checker covers this table and `skills/genui/SKILL.md`; `README.md` and `schema/v1.json` must be updated in the same commit by hand. Bounds stated only inside fenced code blocks are ignored by the checker — always state bounds in the table above.
