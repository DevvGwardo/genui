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

- [ ] All eight commands listed in `CONTRIBUTING.md` pass locally
- [ ] The `LOOPS.md` row carries status, date, evidence, and commit
- [ ] `CHANGELOG.md` has an entry in the same commit as the change
- [ ] No new runtime dependency
- [ ] No bound, widget type, or error code changed outside "Proposed contract changes"
