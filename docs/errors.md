# genui — v1 error guide

One table: every rejection a `render_ui` caller can hit, its cause, and the fix. Codes are quoted exactly as the runtime reports them. Rows whose error code is not named in `skills/genui/SKILL.md` say so explicitly — this repo does not guess codes.

Consistency check: `node tools/check-errors.mjs` scans the repo for error-shaped tokens and fails if any of them is missing from the table below.

| Error | Rejection | Cause | Fix |
|---|---|---|---|
| `bad_args` | Invalid payload shape | The argument fails the strict v1 check: unknown keys, extra properties, or invalid types. | Correct the payload against `docs/contract.md` and `schema/v1.json`, then dispatch once more; do not rerun the same arguments. |
| `bad_args` | Unknown widget type | `components[n].type` is not one of `stat`, `table`, `bar_chart`, `checklist`. | Use one of the four documented widget types. |
| `not_enabled` | Hermes Desk MCP disabled for the profile | The runtime message is `not_enabled: Browser control is not enabled for this profile`. | Enable **Settings → Workspace → Agent browsing** for the profile and restart its Hermes session (`+ New chat`); do not retry in a loop. |
| `app_unavailable` | Hermes Desk unavailable to the session | Hermes Desk reports itself unavailable for the current session. | Same remedy as `not_enabled`: check **Settings → Workspace → Agent browsing** and restart the session; describe what happened to the user. |
| `too_large` | Payload over the byte cap | The serialized argument exceeds 16,384 UTF-8 bytes. | Prune components, rows, or cells until the serialized argument fits (see `docs/contract.md`); never truncate field values to compensate. |
| not named in `SKILL.md` | Bound violation | A value violates `docs/contract.md` — for example a title over its character cap, a table with too many columns or rows, or a non-finite number. | Fix the value before dispatch; the runtime rejects the payload. Whether this reports as `bad_args` or as a dedicated code is not documented — record it here after a live check (F1). |
| not named in `SKILL.md` | Unknown or missing `version` | The payload declares a `version` other than `1`, or omits it; v1 has no default and documents no negotiation. | Do not dispatch, and never translate the payload to v1 by guesswork; tell the user the tool speaks v1 only — see **Version negotiation** in `docs/contract.md`. |
| not named in `SKILL.md` | Duplicate checklist `id` | Two or more items in one checklist component share an `id`; ids must be unique within the component. | Make ids unique before dispatch (they must also match `^[a-zA-Z0-9_-]{1,40}$` — see `docs/contract.md`). Record the runtime's code here after a live check (F1). |

Also: never substitute a rendered card with `::preview` HTML files, and never retry `not_enabled` / `app_unavailable` in a loop — see `skills/genui/SKILL.md`.
