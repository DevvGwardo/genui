# genui brand kit

Version 1.0.0 (2026-11-15). First full kit, generated with agy
(gemini-3.1-flash-image) from the shipped v0 logo as likeness reference and the
`tools/preview.mjs` palette.

## Contents

| Asset | File | Prompt | Size |
|---|---|---|---|
| App mark | `docs/logo.webp` | `prompts/logo.md` | 512x512 |
| README banner | `docs/repo-banner.webp` | `prompts/repo-banner.md` | 1600x427 |
| Why-data-only comparison | `docs/why-to-use-it.webp` | `prompts/why-to-use-it.md` | 1600x658 |
| Payload-to-UI example | `docs/example.webp` | `prompts/example.md` | 1600x509 |
| How-it-works pipeline | `docs/how-it-works.webp` | `prompts/how-it-works.md` | 1600x266 |

`docs/v2-preview.webp` is a real screenshot of `tools/preview.mjs --showcase`,
not kit art — never regenerate it as brand art.

All kit images are webp (flat art compresses hard: the whole set is ~67 KB,
15.5% of the 650,000-byte docs budget enforced by `tools/check-docs-budget.mjs`).

## Regenerating

Each prompt file carries the exact prompt as its last line:

```bash
agy --dangerously-skip-permissions --add-dir <workdir> --print-timeout 480s \
  -p "$(tail -1 prompts/<asset>.md)"
```

Restore `ref-logo.png` (from the current logo) into the workdir as the likeness
reference before regenerating the set. Wide assets are generated with empty
margins above/below and must be cropped to the measured content band
(brightness row-scan, ~25px pad) before converting to webp.

## Known defects (ledger)

- **logo**: subtle radial gradient on the main container (spec bans gradients) —
  subtle, shipped.
- **repo-banner**: subtle gradient fill under the line chart; micro-label blur —
  subtle, shipped.
- **example**: subtle gradient — subtle, shipped.
- **how-it-works**: none.
- **why-to-use-it**: the strings "LEFT HALF" / "RIGHT HALF" rendered as literal
  labels (prompt phrasing leaked into the art). One targeted regen was attempted
  2026-11-15 with those words banned; it was blocked by hard quota
  (`429 RESOURCE_EXHAUSTED` on gemini-3.1-flash-image, ~154h reset). agy's
  offered programmatic/vector fallback was rejected per the standing user rule.
  Shipped v1 with the defect; regenerate post-reset using the regen prompt below
  and ship the better of the two.

Regen prompt for why-to-use-it (post-quota): see `prompts/why-to-use-it.md`
trailing note.

## Process notes

- Vision checks run through the surplus API (gemini-4-argon) with
  none|subtle|strong defect ratings; checker phrasing mirrors each prompt's
  actual spec to avoid false violations.
- agy leaves scaffolding side files (`*.py`, `*.html`) in the workdir and, on
  quota exhaustion, silently falls back to code-drawn images — always confirm
  the run reports the image model, and never ship a fallback render.
