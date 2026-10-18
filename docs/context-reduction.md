# Context reduction measurement

This is the repository's committed measurement of record for the "token reduction"
claim that appears in [`why-to-use-it.webp`](why-to-use-it.webp) (tracked as LOOP C5 in
`LOOPS.md`).

## What is measured

One representative dashboard — a stat, an 8-row table, a 6-bar chart, and a 6-item
checklist, all with realistic labels — expressed two ways:

1. **genui payload** — the exact compact-JSON `render_ui` argument (`version: 1`, four
   components), serialized as it would be sent.
2. **HTML artifact** — a self-contained styled HTML page for the same content, at three
   styling levels (minimal, typical, rich), as an agent would emit for the
   webview/iframe approach.

Basis: **UTF-8 bytes** (characters coincide for this ASCII sample). No model tokenizer
is available in this environment, so size is the measurement basis; emitted-token counts
track emitted text size proportionally. Reduction is computed as one minus the payload
size divided by the HTML artifact size, times 100 — i.e. `(1 − genui/HTML) × 100`.

Reproduce with:

```bash
node tools/measure-context-reduction.mjs
```

## Result (captured 2026-10-17, Node v20.18.0)

```
genui context-reduction measurement
basis: UTF-8 bytes; no model tokenizer is available in this environment,
so size is the measurement basis (emitted tokens track emitted text size).

representation                   bytes   chars   reduction of genui vs HTML
genui payload (compact JSON)     949     949     -
HTML artifact — minimal          1024    1024    7.3%
HTML artifact — typical styling  3500    3500    72.9%
HTML artifact — rich styling     4377    4377    78.3%
```

Caveats: these are three representative authorship baselines, not an exhaustive survey;
actual agent output varies. The comparison is for one dashboard of the same content on
both sides.

## Claim status

The graphic's "90% Token Reduction" line predates any measurement and is **not
reproduced here**: the measured reduction is ≈73% for typically styled artifacts and
≈78% for richly styled ones (bare, unstyled HTML is only ≈7% smaller than the payload —
terse markup is cheap, but it is also unthemed and non-interactive). Reaching ≈90% would
require substantially heavier HTML styling than the rich baseline in this tool.

Accordingly, all text surfaces carry the measured figures instead: `README.md`'s
comparison table states the measured values, and the caption below the graphic points
here. The graphic itself remains as a design illustration.
