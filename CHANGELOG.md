# Changelog

All notable changes to this project are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)-style sections, one entry per loop ID from [LOOPS.md](LOOPS.md), SemVer release headings (`## Unreleased` until v1.0.0 is tagged).

## Unreleased

- docs: add `LOOPS.md`, the 30-loop improvement queue (LOOP 0 scaffolding), plus `CHANGELOG.md`.
- feat(A1): add `schema/v1.json` — exact JSON Schema 2020-12 mirror of the v1 `render_ui` payload contract (4 widget types, every documented bound, `additionalProperties: false`); runtime-only rules that JSON Schema cannot express (16,384-byte cap, table row length, checklist id uniqueness) are called out in `$comment`s. Verified against ajv 8.17.1: 34/34 cases, accepts a 4-component payload, rejects an unknown key.
- docs(A2): add `docs/contract.md` — single source of truth for every v1 bound — and `tools/check-bounds.mjs`, a zero-dependency plain-Node checker that multiset-diffs the table against `skills/genui/SKILL.md` (19/19 bound tokens match; a mutated bound makes it exit 1).
- docs(A3): add `docs/errors.md` — error → cause → fix register for `bad_args` (incl. unknown widget type), `not_enabled`, `app_unavailable`, `too_large`, plus bound violations and duplicate checklist ids whose codes SKILL.md does not name (explicitly marked, not guessed) — and `tools/check-errors.mjs`, which fails if any error-shaped token in the repo is missing from the register (negative-tested). Also aligned an over-broad `bad_args` claim in `schema/v1.json` with SKILL.md's exact wording.
