# genui — terminology

Canonical terms for this repo. Everything else is drift. `tools/check-terms.mjs` enforces the banned-variants table below across `README.md`, `skills/genui/SKILL.md` and `docs/`.

| Term | Meaning |
|---|---|
| **Hermes Agent** | The agent runtime this skill is installed into (upstream: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)). Skills are copied into its profile skill directories — see the install section in `README.md`. |
| **Hermes Desk** | The desktop app that hosts conversations, executes `mcp__hermes_desk__render_ui`, and labels rendered blocks **Generated UI · Agent-provided data, not verified**. |
| **genui** | This skill. Always lowercase (`name: genui` in the frontmatter; directory `skills/genui/`). |
| **Generated UI** | The label Hermes Desk puts on rendered cards. A label, not a product or protocol name. |
| **widget / component** | One rendered card. `widget` names the rendered result; `component` is the payload-level name under the `components` key. The four widget types: `stat`, `table`, `bar_chart`, `checklist`. |
| **v1 payload contract** | The strict schema in `schema/v1.json` plus the bounds table in `docs/contract.md`. There is no separate protocol name; do not invent one. |

## Banned variants

| Never write | Write instead | Why |
|---|---|---|
| `GenUI` | `genui` (the skill) or **Generated UI** (the label) | Capitalized, it reads as a separate product name. |
| `GenUI Protocol` | "the v1 payload contract" | No protocol by that name is defined in this repo or referenced by the runtime docs. |
| `Hermes Desk profile` | **Hermes profile** | Profiles belong to Hermes Agent; Hermes Desk is the app that consumes them. |
| `hermes_desk_render_ui` | `mcp__hermes_desk__render_ui` (or `render_ui`) | An early research name; allowed in exactly one place — the historical note in `SKILL.md` that says so. |

Run `node tools/check-terms.mjs` after any change to README, SKILL or docs.
