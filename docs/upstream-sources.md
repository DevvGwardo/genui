# genui — upstream sources and provenance ledger

This ledger records every public upstream and peer repository from which `genui` inherits engineering patterns. The machine-readable source of truth is [`upstream/sources.json`](../upstream/sources.json); `node tools/check-upstream.mjs` checks schema validity and parity between that JSON registry and this document on every CI run.

Only public repositories are pinned so automated watch runs (`.github/workflows/upstream-watch.yml`) work in unauthenticated or standard `GITHUB_TOKEN` CI environments without private access dependencies.

## 4-stage inheritance pipeline

1. **Automated non-mutating watch:** Weekly `.github/workflows/upstream-watch.yml` (and manual `workflow_dispatch`) runs `node tools/check-upstream.mjs --watch`, compares each `watchedPaths` entry against `pinnedSha`, uploads `upstream-plan.json`, and flags drift with exit code `2` without altering repository files.
2. **Curated adaptation:** A contributor opens a [`LOOPS.md`](../LOOPS.md) row, screens the candidate pattern against the 4-point bloat and contract filter in [`CONTRIBUTING.md`](../CONTRIBUTING.md#4-point-bloat-and-contract-filter), adapts only the minimal pattern, and updates both `upstream/sources.json` and this file.
3. **Conformance, fuzz, adversarial, and eval gates:** `.github/workflows/ci.yml` runs all contract checkers, `tools/fuzz-validator.mjs`, `tools/check-evals.mjs`, `tools/check-upstream.mjs`, and `tools/package-skill.py --verify`.
4. **Reproducible release integrity:** Pushing a `v*` tag triggers `.github/workflows/release.yml`, verifying tag parity with `skills/genui/SKILL.md` `version`, running full CI, and attaching deterministic `dist/genui-skill.zip` and `dist/genui-skill.zip.sha256`.

## Tracked repositories

| Repository | License | Branch | Pinned SHA | Verifying check |
|---|---|---|---|---|
| [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) | MIT | `main` | `67664e236ddcc45824b871d575677287599af152` | `node tools/check-skill-frontmatter.mjs` |
| [`DevvGwardo/hermes-desk`](https://github.com/DevvGwardo/hermes-desk) | MIT | `main` | `ab3d420d85b4f19c390526d1f0416b5255f61b48` | `node tools/fuzz-validator.mjs` |
| [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui) | Apache-2.0 | `main` | `8bf644a37d680a227296b8c0849a7f4b328b8b73` | `node tools/check-evals.mjs` |
| [`anthropics/skills`](https://github.com/anthropics/skills) | Apache-2.0 | `main` | `2c5958ecac7cee2b583967a2c4981d0f4a75c579` | `python3 tools/package-skill.py --verify` |
| [`vercel-labs/json-render`](https://github.com/vercel-labs/json-render) | Apache-2.0 | `main` | `18194121c8f087afacd9a8ef65fbda18374ee039` | `python3 tools/check-examples.py` |
| [`omdsh-dev/dsh-genui`](https://github.com/omdsh-dev/dsh-genui) | MIT | `main` | `3cc1f153716b0ff710f1dcc9c46bab83b3911c4a` | `node tools/check-upstream.mjs` |
| [`DevvGwardo/hermes-patterns`](https://github.com/DevvGwardo/hermes-patterns) | MIT | `main` | `07842a399cfc783cf9790788fd6234ee58286e71` | `python3 tools/check-examples.py` |
| [`DevvGwardo/fork-sync`](https://github.com/DevvGwardo/fork-sync) | Unspecified | `main` | `acdfa6ded17693a7ae291a3f5ad22e9458f16f08` | `node tools/check-upstream.mjs` |

## Per-source provenance details

### `NousResearch/hermes-agent`

- **License:** MIT
- **Pinned SHA:** `67664e236ddcc45824b871d575677287599af152` (`main`)
- **Watched paths:** `agent/skill_utils.py`, `tools/skill_linter.py`, `tools/skills_guard.py`, `tests/skills/test_authoring_standards.py`
- **Inherited pattern:** Hermes Agent skill discovery limits (60-char description ending in a period, `platforms` list) and authoring/security lint rules.
- **Local adaptations:** Tightened `skills/genui/SKILL.md` frontmatter `description` and added `platforms: [macos, linux, windows]`; ported frontmatter, path-hygiene, and static security-guard checks into zero-dep Node [`tools/check-skill-frontmatter.mjs`](../tools/check-skill-frontmatter.mjs).
- **Exclusions:** Python runtime dependencies, skill-hub installers, and multi-skill sync machinery.
- **Verifying check:** `node tools/check-skill-frontmatter.mjs`

### `DevvGwardo/hermes-desk`

- **License:** MIT
- **Pinned SHA:** `ab3d420d85b4f19c390526d1f0416b5255f61b48` (`main`)
- **Watched paths:** `electron/local/mcp/genui.mjs`, `electron/local/mcp/genui.test.mjs`, `electron/local/mcp/tools.cjs`, `electron/local/mcp/dispatch.cjs`
- **Inherited pattern:** MCP host runtime validator guards (prototype, descriptor, sparse-array, and recursion-depth protection; Unicode `Cc`/`Cf`/`Zl`/`Zp` filtering) and server-minted `genuiOccurrence` trust boundary.
- **Local adaptations:** Added prototype-key, unhashable-type, depth, and lone-surrogate guards in [`tools/validate.py`](../tools/validate.py) and [`tools/fuzz-validator.mjs`](../tools/fuzz-validator.mjs); documented the `genuiOccurrence` boundary in [`docs/security.md`](security.md).
- **Exclusions:** Electron host UI, IPC socket server, and experimental fifth-widget proposals outside v1 (deferred to [`LOOPS.md`](../LOOPS.md)).
- **Verifying check:** `node tools/fuzz-validator.mjs`

### `a2ui-project/a2ui`

- **License:** Apache-2.0
- **Pinned SHA:** `8bf644a37d680a227296b8c0849a7f4b328b8b73` (`main`)
- **Watched paths:** `specification/scripts/validate.py`, `eval/DESIGN.md`
- **Inherited pattern:** Cross-validator conformance testing and deterministic Stage-1/Stage-2 evaluation funnel prior to LLM judging.
- **Local adaptations:** Built zero-dep differential fuzzer ([`tools/fuzz-validator.mjs`](../tools/fuzz-validator.mjs)) and deterministic Stage-1/Stage-2 skill eval corpus ([`evals/evals.json`](../evals/evals.json) + [`tools/check-evals.mjs`](../tools/check-evals.mjs)).
- **Exclusions:** Interactive action callbacks (`updateDataModel`/`functionCall`), npm `ajv` dependency, and Inspect AI runtime.
- **Verifying check:** `node tools/check-evals.mjs`

### `anthropics/skills`

- **License:** Apache-2.0 (see `skills/skill-creator/LICENSE.txt`)
- **Pinned SHA:** `2c5958ecac7cee2b583967a2c4981d0f4a75c579` (`main`)
- **Watched paths:** `skills/skill-creator/scripts/package_skill.py`, `skills/skill-creator/scripts/quick_validate.py`, `skills/skill-creator/references/schemas.md`
- **Inherited pattern:** Deterministic skill zip packaging excluding dev/eval artifacts and golden `evals.json` schema with programmatic dataset audit checks.
- **Local adaptations:** Implemented zero-dep reproducible packager ([`tools/package-skill.py`](../tools/package-skill.py)) emitting fixed-timestamp `dist/genui-skill.zip` plus SHA-256, and golden [`evals/evals.json`](../evals/evals.json) checked by [`tools/check-evals.mjs`](../tools/check-evals.mjs).
- **Exclusions:** PyYAML dependency, interactive eval-viewer HTML server, and Anthropic API-specific workflows.
- **Verifying check:** `python3 tools/package-skill.py --verify`

### `vercel-labs/json-render`

- **License:** Apache-2.0
- **Pinned SHA:** `18194121c8f087afacd9a8ef65fbda18374ee039` (`main`)
- **Watched paths:** `packages/core/src/spec-validator.ts`, `packages/core/src/spec-validator.test.ts`
- **Inherited pattern:** Structured machine-readable validation diagnostics mapped to actionable repair hints for bounded single-retry self-correction.
- **Local adaptations:** Added `--json` diagnostic output in [`tools/validate.py`](../tools/validate.py) emitting `{ ok, code, reason, pointer, preflightRule }` and documented the single-retry `bad_args` repair loop in [`skills/genui/SKILL.md`](../skills/genui/SKILL.md).
- **Exclusions:** Reactive state/visibility expression runtime, streaming patches, and React/Vue renderers.
- **Verifying check:** `python3 tools/check-examples.py`

### `omdsh-dev/dsh-genui`

- **License:** MIT
- **Pinned SHA:** `3cc1f153716b0ff710f1dcc9c46bab83b3911c4a` (`main`)
- **Watched paths:** `THIRD_PARTY_NOTICES.md`, `.github/workflows/release.yml`
- **Inherited pattern:** Pinned-SHA third-party provenance ledger and release tag-to-version verification gate.
- **Local adaptations:** Adopted pinned-SHA provenance tracking in [`upstream/sources.json`](../upstream/sources.json) plus this ledger and tag-vs-`SKILL.md` version verification in [`.github/workflows/release.yml`](../.github/workflows/release.yml).
- **Exclusions:** ECharts/Three.js/Mermaid renderers, interactive form widgets, and npm/pnpm build toolchain.
- **Verifying check:** `node tools/check-upstream.mjs`

### `DevvGwardo/hermes-patterns`

- **License:** MIT
- **Pinned SHA:** `07842a399cfc783cf9790788fd6234ee58286e71` (`main`)
- **Watched paths:** `skills/adversarial-verify`
- **Inherited pattern:** Adversarial boundary verification checklist (empty strings, non-finite numbers, extreme bounds, Unicode edge cases) with command-evidenced verdicts.
- **Local adaptations:** Codified the text/parser threat model in [`docs/security.md`](security.md) backed by deterministic invalid fixtures in [`examples/invalid/`](../examples/invalid/).
- **Exclusions:** Unrelated orchestration, memory, and cron skills.
- **Verifying check:** `python3 tools/check-examples.py`

### `DevvGwardo/fork-sync`

- **License:** Unspecified
- **Pinned SHA:** `acdfa6ded17693a7ae291a3f5ad22e9458f16f08` (`main`)
- **Watched paths:** `sync.py`, `.github/workflows/sync.yml`
- **Inherited pattern:** Non-mutating scheduled upstream watch workflow emitting a JSON plan artifact and exit code `2` when human triage is needed.
- **Local adaptations:** Implemented [`tools/check-upstream.mjs`](../tools/check-upstream.mjs) `--watch` and [`.github/workflows/upstream-watch.yml`](../.github/workflows/upstream-watch.yml) for read-only drift reporting with zero auto-merging.
- **Exclusions:** Automated git fast-forward/merge-upstream mutations and PAT-based multi-repo writes.
- **Verifying check:** `node tools/check-upstream.mjs`
