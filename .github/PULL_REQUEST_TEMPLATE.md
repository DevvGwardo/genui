## What this changes

<!-- One queue row from LOOPS.md, or a repo-health change. -->
Row: <!-- e.g. G1, or "repo health" -->

## Why

<!-- The problem, in one paragraph. Link the issue or queue row. -->

## Evidence

<!-- Exact commands, exit codes, and the values they printed. Measured numbers, not adjectives. -->

```text
$ ...
```

## Checks

- [ ] All CI checks listed in `CONTRIBUTING.md` pass locally (contract, examples, doc payloads, fuzzer, evals, upstream parity, packager `--verify`)
- [ ] Passes the 4-point bloat and contract filter in `CONTRIBUTING.md` (strict v1 data-only contract, zero runtime dependencies in `tools/`, no unproposed contract change, deterministic verification)
- [ ] If inheriting or updating an upstream pattern, `upstream/sources.json` and `docs/upstream-sources.md` are updated together
- [ ] The `LOOPS.md` row carries status, date, evidence, and commit
- [ ] `CHANGELOG.md` has an entry in the same commit as the change
- [ ] No bound, widget type, or error code changed outside "Proposed contract changes"
