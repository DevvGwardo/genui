# Contributing to genui

Thanks for looking. This repository is intentionally small and stays that way: the
skill, the contract, and a handful of zero-dependency checkers.

## Ground rules

- **The documents are the single source of truth.** Rendering limits live in
  [`docs/contract.md`](docs/contract.md) only; the skill text restates them solely
  where `tools/check-bounds.mjs` compares both sides. Never invent, widen, or
  round a limit, add a widget type, or guess an error code — unnamed rejections
  are reported as `code=none` plus the exact rejection class (see
  [`docs/errors.md`](docs/errors.md)).
- **Contract changes are proposed, not slipped in.** Any change to a bound, a
  widget type, a limit, or an error code goes under "Proposed contract changes"
  in [`LOOPS.md`](LOOPS.md) before it lands.
- **No new runtime dependencies.** The checkers are plain Node plus Python 3
  standard library; keep it that way, and keep every committed checker green.

## 4-point bloat and contract filter

Every proposed improvement — local or inherited from an upstream repository — must pass all four intake gates before implementation:

1. **Strict v1 data-only contract:** Preserve `version: 1`, the four documented widgets (`stat`, `table`, `bar_chart`, `checklist`), and zero HTML, CSS, JS, iframes, URLs, or interactive callbacks.
2. **Zero runtime dependencies:** Checkers and tools under `tools/` use plain Node 20+ and Python 3 standard library only.
3. **Contract changes proposed first:** Any change to a bound, widget type, or error code must be proposed under "Proposed contract changes" in [`LOOPS.md`](LOOPS.md) before it lands (for example, additional host widget types stay deferred there).
4. **Deterministic verification required:** Every inherited pattern or fix must be pinned by a deterministic check, differential fuzz rule, or fixture.

## 4-stage upstream inheritance workflow

Tracked peer and upstream sources live in [`upstream/sources.json`](upstream/sources.json) and [`docs/upstream-sources.md`](docs/upstream-sources.md):

1. **Stage 1 — Automated non-mutating watch:** Weekly `.github/workflows/upstream-watch.yml` (and manual dispatch) runs `node tools/check-upstream.mjs --watch`, emits `upstream-plan.json`, and flags changes in `watchedPaths` with exit code `2` for human triage without auto-merging.
2. **Stage 2 — Curated adaptation:** Open a [`LOOPS.md`](LOOPS.md) row, screen the candidate change against the 4-point filter above, adapt only the minimal pattern, and update both `upstream/sources.json` and `docs/upstream-sources.md`.
3. **Stage 3 — Conformance, fuzz, adversarial, and eval gates:** Pass the full suite in `.github/workflows/ci.yml`, including differential fuzzing, adversarial security fixtures, frontmatter/security lint, deterministic skill evals, and offline upstream parity.
4. **Stage 4 — Reproducible release integrity:** Tagging `v<version>` matching `skills/genui/SKILL.md` triggers `.github/workflows/release.yml`, which verifies tag parity, runs full CI, and attaches deterministic `dist/genui-skill.zip` and `dist/genui-skill.zip.sha256`.

## Committed checks

Run the full set from the repository root (Node 20+ and `python3` are required; on Windows use `py -3` for Python commands):

```bash
node tools/check-bounds.mjs
node tools/check-errors.mjs
node tools/check-terms.mjs
node tools/check-skill-frontmatter.mjs
node tools/check-links.mjs
node tools/check-docs-budget.mjs
python3 tools/check-examples.py
python3 tools/check-doc-payloads.py
node tools/fuzz-validator.mjs
node tools/check-evals.mjs
node tools/check-upstream.mjs
python3 tools/package-skill.py --verify
```

For live external URL verification (run weekly in `.github/workflows/links-external.yml`), run `node tools/check-links.mjs --external`.

CI (`.github/workflows/ci.yml`) runs the twelve checks above on every push and pull request — the workflow is the canonical list. A change that leaves any check red is not ready. When a check has real gaps, extend it — do not add a parallel one-off gate.

## Commit and PR style

- Conventional-style commits, scoped when the work maps to a queue row:
  `<type>(<ROW-ID>): summary`, where the row ID is the ID in `LOOPS.md`
  (`A1`–`F2`). Types in use: `docs`, `feat`, `fix`, `test`, `ci`, `chore`.
- One loop = one behavior change plus its evidence. Record measured numbers, not
  adjectives: exact commands, exit codes, and the values they printed.
- Keep the [`LOOPS.md`](LOOPS.md) row and the [`CHANGELOG.md`](CHANGELOG.md)
  entry in the same commit as the change they describe.

## Licensing

By contributing you agree that your contributions are licensed under the MIT
license, the same as the rest of this repository (see [`LICENSE`](LICENSE)).
