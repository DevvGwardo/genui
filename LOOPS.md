# genui — improvement loops

Run exactly ONE loop per session, following the loop contract:
READ (pick the highest-ranked `todo`/`retry` row) → PLAN → SCOPE → BUILD → VERIFY → RECORD → COMMIT → REPORT.

Ranks are the backlog order. Status values: `todo` | `done` | `blocked-verify` | `blocked-input` | `failed`.

| ID | Rank | Area | Task | Acceptance | Status | Date | Evidence | Commit |
|---|---|---|---|---|---|---|---|---|
| A1 | 1 | Contract | Author `schema/v1.json` (JSON Schema 2020-12): all 4 widget types, every bound, `additionalProperties: false`. | Schema accepts a 4-component payload; rejects an unknown key. | done | 2026-10-17 | `node check-v1.mjs schema/v1.json` → 34/34 cases; accepts 4-component payload = true; rejects unknown key = true (ajv 8.17.1, draft 2020-12) | 738bd72 |
| A2 | 2 | Contract | Single source of truth for all numeric/char bounds (`docs/contract.md`). | Diff of SKILL.md bounds vs table is empty. | done | 2026-10-17 | `node tools/check-bounds.mjs` → 19 tokens on both sides; "bounds diff is empty" (exit 0); negative test: mutated one bound → exit 1, drift named | |
| A3 | 3 | Contract | Error → cause → fix table for `bad_args`, `not_enabled`, `app_unavailable`, `too_large`, unknown type, duplicate checklist id. | Every error named anywhere in the repo appears in the table. | todo | | | |
| A4 | 4 | Contract | Version negotiation: v1 semantics + unknown-version fallback. | Section exists; no ambiguity remains about v2 behavior. | todo | | | |
| A5 | 5 | Contract | Resolve terminology drift (Hermes Agent vs Hermes Desk vs GenUI Protocol). | Grep for conflicting terms returns zero across README/SKILL/docs. | todo | | | |
| B1 | 6 | Skill | Add `genui` + natural-language triggers to the frontmatter description. | Frontmatter description matches `/genui/i`. | todo | | | |
| B2 | 7 | Skill | Add "When to Use" and "When NOT to Use" sections. | Both present with concrete, non-generic examples. | todo | | | |
| B3 | 8 | Skill | Minimal isolated example per widget type (4 separate payloads). | Each validates against `schema/v1.json` independently. | todo | | | |
| B4 | 9 | Skill | Quick Reference table: widget | required fields | caps. | One table, no duplicated prose bounds. | todo | | | |
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
