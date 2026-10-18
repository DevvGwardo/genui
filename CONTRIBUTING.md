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

## Committed checks

Run the full set from the repository root (Node and a `python3` are required):

```bash
node tools/check-bounds.mjs
node tools/check-errors.mjs
node tools/check-terms.mjs
node tools/check-skill-frontmatter.mjs
node tools/check-links.mjs
node tools/check-docs-budget.mjs
python3 tools/check-examples.py
```

CI (`.github/workflows/ci.yml`) runs these on every push and pull request — the
workflow is the canonical list. A change that leaves any check red is not ready.
When a check has real gaps, extend it — do not add a parallel one-off gate.

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
