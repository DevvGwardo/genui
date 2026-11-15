# genui brand

Identity, palette, and rules for the genui brand kit. Version 1.0.0 (2026-11-15).
Assets live in `docs/`; prompts in `prompts/`; kit index in `branding/README.md`.

## Name and identity

**genui** — always lowercase. The wordmark is `genui` in bold white lowercase
sans-serif, ending with a blue period (`genui.`). No mascot, no character: the
brand subject IS the product — a Bento grid of bounded, dark-mode UI widget
cards. The mark (docs/logo.webp) is a dark squircle containing a 2x2 grid of
widget tiles (stat, progress, table, checklist) with the wordmark beneath.

Reference art: the shipped `docs/logo.webp` (v0, 2026-11-15) was the likeness
reference for this kit's regeneration — `ref-logo.png` copy in the generation
workspace.

## Palette (from the product code)

Source of truth: literal tokens in `tools/preview.mjs` — the product's own
renderer. Never re-palette from imagination; re-grep the tokens.

| Token | Hex | Use |
|---|---|---|
| background | `#09090B` | page / banner background |
| card | `#18181B` | squircle, window cards |
| tile | `#20212B` | inner widget tiles |
| border | `#2A2A2E` | thin tile/card borders (`rgba(255,255,255,0.08)` over card) |
| text | `#FAFAFA` / `#FFFFFF` | headline values, wordmark |
| muted | `#A1A1AA` | secondary text |
| dim | `#71717A` | placeholder bars, captions |
| blue | `#60A5FA` | primary accent: bars, wordmark period, arcs |
| green | `#34D399` | success deltas, checkmarks |
| amber | `#FBBF24` | warning accents, window dots |
| red | `#F87171` | error accents, window dots |

## Rules

- Flat solid colors only. No gradients, no glow, no drop shadows in generated art.
- Dark zinc (#09090B) background always; blue is the single primary accent.
- Text in art: short labels only (`genui.`, widget values like `99%`). No long copy.
- Icons/tiles reuse the Bento 2x2 grid language of the logo.
- Wide assets (banner, illustrations) are composed on a solid #09090B band and
  cropped to the content band before shipping (see `prompts/*.md`).

## Do / don't

- Do keep the wordmark's blue period. Don't capitalize the name (`GenUI` is a
  banned variant — see `docs/terminology.md`).
- Do cite `tools/preview.mjs` as palette source. Don't invent new accent colors.
- Don't substitute SVG/programmatic renders for generated art (user rule,
  2026-11-14: "dont do SVGs i dont like them"). agy image model or nothing.
- Don't regenerate `docs/v2-preview.webp` — it is a real screenshot of
  `tools/preview.mjs --showcase`, not brand art.

## Facts (recounted 2026-11-15, at generation time)

- 119 tracked files; 7,722 LOC of repo tooling (`tools/`)
- v1 payload contract: 4 widget types, shipped via `render_ui`
- v2 component catalog: 22 widget types, 25/25 archetypes, 36 fixtures
- 14 CI checks; 16,384-byte payload cap; MIT license
