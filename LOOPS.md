# genui — improvement loops

Run exactly ONE loop per session, following the loop contract:
READ (pick the highest-ranked `todo`/`retry` row) → PLAN → SCOPE → BUILD → VERIFY → RECORD → COMMIT → REPORT.

Ranks are the backlog order. Status values: `todo` | `done` | `blocked-verify` | `blocked-input` | `failed`.

| ID | Rank | Area | Task | Acceptance | Status | Date | Evidence | Commit |
|---|---|---|---|---|---|---|---|---|
| A1 | 1 | Contract | Author `schema/v1.json` (JSON Schema 2020-12): all 4 widget types, every bound, `additionalProperties: false`. | Schema accepts a 4-component payload; rejects an unknown key. | done | 2026-10-17 | `node check-v1.mjs schema/v1.json` → 34/34 cases; accepts 4-component payload = true; rejects unknown key = true (ajv 8.17.1, draft 2020-12) | 738bd72 |
| A2 | 2 | Contract | Single source of truth for all numeric/char bounds (`docs/contract.md`). | Diff of SKILL.md bounds vs table is empty. | done | 2026-10-17 | `node tools/check-bounds.mjs` → 19 tokens on both sides; "bounds diff is empty" (exit 0); negative test: mutated one bound → exit 1, drift named | 6bb484e |
| A3 | 3 | Contract | Error → cause → fix table for `bad_args`, `not_enabled`, `app_unavailable`, `too_large`, unknown type, duplicate checklist id. | Every error named anywhere in the repo appears in the table. | done | 2026-10-17 | `node tools/check-errors.mjs` → 4 codes declared; every error-shaped token in 7 files declared; exit 0; negative test (injected fake code) → exit 1 naming file+token; also aligned an over-broad `bad_args` claim in schema/v1.json with SKILL.md | 8af90b8 |
| A4 | 4 | Contract | Version negotiation: v1 semantics + unknown-version fallback. | Section exists; no ambiguity remains about v2 behavior. | done | 2026-10-17 | `docs/contract.md` "## Version negotiation" at line 34 (v1 = `version: 1` only, no default; never dispatch/translate unknown versions; no v2 — future v2 arrives as new `schema/v2.json` + section update). Schema harness: `version: 2`, `"1"` string, missing → all rejected (37/37 cases, exit 0). `check-bounds` + `check-errors` exit 0 | 8fda924 |
| A5 | 5 | Contract | Resolve terminology drift (Hermes Agent vs Hermes Desk vs GenUI Protocol). | Grep for conflicting terms returns zero across README/SKILL/docs. | done | 2026-10-17 | `node tools/check-terms.mjs` → 4 banned variants, 0 violations (1 allowed historical occurrence), anchors 3/3 + 2/2, exit 0; raw greps: `GenUI` 0, `Hermes Desk profile` 0, `desktop dispatch` 0, `hermes_desk_render_ui` 1 (SKILL.md:20 allowed note); negative test → exit 1. Decision: `docs/terminology.md` | b66149e |
| B1 | 6 | Skill | Add `genui` + natural-language triggers to the frontmatter description. | Frontmatter description matches `/genui/i`. | done | 2026-10-17 | `node check-description.mjs` → "matches /genui/i: true; yaml-safe quoting: true", exit 0. New description carries 5 triggers: "genui", "render a table of ...", "render a stat card showing ...", "render a bar chart of ...", "render a checklist for ...". check-terms/check-bounds/check-errors exit 0 | bdd2abe |
| B2 | 7 | Skill | Add "When to Use" and "When NOT to Use" sections. | Both present with concrete, non-generic examples. | done | 2026-10-17 | `Select-String "^## When"` → SKILL.md:17 "## When to Use", SKILL.md:24 "## When NOT to Use". Concrete cases named: queue-bursts table, build-time stat, release checklist; NOT-use: 40-row incident table, 7-column comparison, form/button/live values, `not_enabled`/`app_unavailable`. check-bounds still 19/19, check-terms + check-errors exit 0 | 785ce1c |
| B3 | 8 | Skill | Minimal isolated example per widget type (4 separate payloads). | Each validates against `schema/v1.json` independently. | done | 2026-10-17 | `node check-skill-examples.mjs` → extracts all fenced JSON in SKILL.md, validates each: 5/5 (4 new single-widget payloads + existing 4-up), exit 0; negative test (bar value -12) → block 4 FAIL, exit 1; check-bounds/check-terms/check-errors exit 0 | 928a4e1 |
| B4 | 9 | Skill | Quick Reference table: widget | required fields | caps. | One table, no duplicated prose bounds. | done | 2026-10-17 | `Select-String "| Widget | Required fields |"` → exactly 1 table; per-widget prose bullets removed (bounds now only in the table + `docs/contract.md`); check-bounds multiset 19/19 (equality is the anti-duplication guard); negative test (re-added a `columns` bound in prose) → "SKILL.md-only ×1: 1-6 strings", exit 1; check-terms/check-errors exit 0; SKILL examples still 5/5 | f448e5a |
| B5 | 10 | Skill | Pitfalls: ≥ 6 concrete anti-patterns. | Each pitfall names the failure mode and the fix. | todo | | | |
| B6 | 11 | Skill | Verification: pre-flight self-check before dispatch. | Every checklist line maps to a schema rejection reason. | todo | | | |
| B7 | 12 | Skill | Over-budget pruning strategy at the 16 KB cap. | Ordered, deterministic drop rules; no "use judgement". | todo | | | |
| B8 | 13 | Skill | String policy: state whether emoji/CJK/non-ASCII are allowed. | Allowed/blocked example table exists. | todo | | | |
| C1 | 14 | Readme | Transcribe how-it-works + why-to-use-it into text sections. | Every claim that exists only as pixels now exists as text. | todo | | | |
| C2 | 15 | Readme | Badges (license, version, last commit) + table of contents. | Badges render; every TOC anchor resolves. | todo | | | |
| C3 | 16 | Readme | Verify-install, uninstall, troubleshooting sections. | Each has copy-pasteable commands. | todo | | | |
| C4 | 17 | Readme | Install matrix: bash AND PowerShell, correct skill directory name. | Both command sets actually executed on this machine. | todo | | | |
| C5 | 18 | Readme | Evidence or remove the "90% token reduction" claim. | Either a committed measurement or the claim is gone. | todo | | | |
| D1 | 19 | Artifacts | `examples/valid/*.json` — one per widget, one 4-up, one boundary case. | All pass `tools/validate.py`. | todo | | | |
| D2 | 20 | Artifacts | `examples/invalid/*.json` — expected error code per file. | Each fails with the EXPECTED code, not just any failure. | todo | | | |
| D3 | 21 | Artifacts | `tools/validate.py` — zero-dependency, stdlib only. | Runs via `python3` with no install step. | todo | | | |
| D4 | 22 | CI | Workflow: validate examples, image budget, frontmatter lint, link check. | Green on a deliberately bad fixture (negative test proves it bites). | todo | | | |
| D5 | 23 | CI | Boundary fixtures: 0 rows, 6x20 table, 12 bars, 20 checklist items, payload of exactly 16,384 bytes. | Each fixture's expected result asserted in CI. | todo | | | |
| E1 | 24 | Hygiene | Convert docs PNGs to WebP; total `docs/` under ~800 KB. | Measured byte total recorded in the loop evidence. | todo | | | |
| E2 | 25 | Hygiene | Remove `docs/logo.png` or reference it. | Zero unreferenced files in `docs/`. | todo | | | |
| E3 | 26 | Hygiene | Add `CHANGELOG.md`, `CONTRIBUTING.md`, `.gitignore`. | Files exist; changelog is SemVer-shaped. | todo | | | |
| E4 | 27 | Hygiene | Tag v1.0.0, cut a release, set social preview from the banner. | Tag and release visible on GitHub (ASK FIRST). | todo | | | |
| E5 | 28 | Hygiene | Cross-link hermes-agent and hermes-desk; align repo description. | Both links present; description matches terminology decision. | todo | | | |
| F1 | 29 | Verify | End-to-end render in a live Hermes Desk chat + screenshot. | Real screenshot committed, or the row is `blocked-verify`. | todo | | | |
| F2 | 30 | Verify | Validate every payload embedded in README and SKILL.md (depends on A1, D3). | All doc examples pass `schema/v1.json`; enforced by CI. | todo | | | |

## Proposed contract changes

None yet. Breaking contract changes (new widget type, changed bound, changed error code) are recorded here for a decision and are never implemented inside a normal loop.

## Environment notes

- This machine has Node.js v20 but **no Python 3** (`python`/`python3` are absent). Loops whose acceptance requires `python3` (D3, and CI runs of D4/D5/F2) become `blocked-verify` unless Python is installed first.
- A1 verification used a locally installed ajv v8.17.1 (bundled inside a global npm package) — draft 2020-12 checking with zero network installs.
