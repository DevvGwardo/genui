# genui — Security Threat Model and Trust Boundaries

This document defines the threat model for the `genui` v1 payload contract (`mcp__hermes_desk__render_ui`), the runtime text filter, parser safety limits, and the trust boundary between **Hermes Agent** callers and **Hermes Desk**. For vulnerability reporting and supported versions, see [`SECURITY.md`](../SECURITY.md).

## Trust boundary (`hermes-desk` vs agent arguments)

`genui` enforces a strict data-only UI contract: agents emit bounded JSON data (`version: 1` and 1–4 components from `stat`, `table`, `bar_chart`, `checklist`), and **Hermes Desk** owns all rendering, native styling, and local checklist storage.

- **Untrusted input**: Everything in the `render_ui` tool argument (`title`, `value`, `detail`, `columns`, `rows`, `label`, `unit`, `id`, `checked`) originates from model output or user-derived tool context and is treated as untrusted data.
- **No executable surface**: Payloads carry zero HTML, CSS, JavaScript, iframes, clickable URLs, or agent callbacks. Rendered cards are labeled **Generated UI · Agent-provided data, not verified** in **Hermes Desk**.
- **Server-minted occurrence identity (`genuiOccurrence`)**: **Hermes Desk** mints `genuiOccurrence` server-side upon accepting a call and uses it to scope local checklist state in desktop storage. Tool arguments must never supply `genuiOccurrence`; the schema's `additionalProperties: false` rule rejects it with `bad_args` (`extra property`). Fixture: [`genui-occurrence-spoof.json`](../examples/invalid/genui-occurrence-spoof.json).

## Text-filter threat model

Every string field (`plainText` in [`schema/v1.json`](../schema/v1.json), mirrored by [`tools/validate.py`](../tools/validate.py)) is checked against a strict denylist. Offending payloads fail validation (`string filter` in [`docs/errors.md`](errors.md)); strings are **never** silently sanitized or rewritten.

| Threat class | Blocked construct / range | Rationale | Adversarial fixture |
|---|---|---|---|
| Markup & tag injection | Angle brackets `<` or `>` | Prevents HTML/XML tag smuggling and parser confusion if text is ever bridged near markup sinks. | See [`contract.md`](contract.md#string-filter-applies-to-every-string-field-above) |
| Case-insensitive URI schemes | `(?:https?\|file\|data\|javascript\|vbscript):` (matched case-insensitively per RFC 3986 §3.1) | Prevents mixed-case `JaVaScRiPt:` or `HtTpS:` URI smuggling inside card strings. | [`mixed-case-scheme.json`](../examples/invalid/mixed-case-scheme.json) |
| Protocol-relative URLs | `//` | Blocks scheme-relative host references (`//example.com/path`) that evade scheme prefixes. | See [`contract.md`](contract.md#string-filter-applies-to-every-string-field-above) |
| BMP control & format characters | C0 (`U+0000`–`U+001F`), DEL/C1 (`U+007F`–`U+009F`), `U+00AD`, `U+0600`–`U+0605`, `U+061C`, `U+06DD`, `U+070F`, `U+0890`–`U+0891`, `U+08E2`, `U+180E`, `U+200B`–`U+200F`, `U+2060`–`U+2064`, `U+2066`–`U+206F`, `U+FEFF`, `U+FFF9`–`U+FFFB` | Blocks invisible zero-width joiners/spaces, interlinear annotations, and control characters that hide payload text or spoof visual length. | [`zwj-emoji.json`](../examples/invalid/zwj-emoji.json) |
| Bidi overrides & line/paragraph separators | `U+2028`–`U+202E` (including RLO `U+202E`) and bidi isolates `U+2066`–`U+2069` | Prevents Trojan-Source-style visual reordering (e.g., disguising displayed extensions or values). | [`bidi-override.json`](../examples/invalid/bidi-override.json) |
| Astral-plane `Cf` format characters | `U+110BD`, `U+110CD`, `U+13430`–`U+1343F`, `U+1BCA0`–`U+1BCA3`, `U+1D173`–`U+1D17A`, `U+E0001`, `U+E0020`–`U+E007F` | Blocks invisible Unicode tag smuggling (`U+E0020`–`U+E007F`) and astral format controls that portable non-`u` ECMA-262 regexes cannot express in JSON Schema. | [`astral-format-char.json`](../examples/invalid/astral-format-char.json) |
| Empty or whitespace-only strings | `minLength: 1` and `pattern: "\\S"` | Prevents blank titles, cells, or labels from rendering deceptive empty cards. | See [`contract.md`](contract.md#string-filter-applies-to-every-string-field-above) |

## Known boundaries and deliberate limits

Two behaviors are intentional design boundaries (also noted in [`SECURITY.md`](../SECURITY.md#hardening-notes)):

1. **Homoglyphs and NFKC confusables are allowed as plain text.**
   Ordinary printable non-ASCII characters (accented Latin, CJK, Cyrillic, standalone emoji) are permitted in display strings. Because **Hermes Desk** renders card fields strictly as plain text inside a labeled **Generated UI · Agent-provided data, not verified** card—never as clickable links, domain names, or executable identifiers—NFKC normalization or confusable blocking is not applied to prose fields. Machine-consumed `checklist.items[].id` values are already constrained to ASCII `^[a-zA-Z0-9_-]{1,40}$`.
2. **ZWJ emoji sequences (`U+200D`) are blocked.**
   Zero-Width Joiner (`U+200D`) is Unicode general category `Cf` (format) inside the blocked `U+200B`–`U+200F` range. Multi-codepoint ZWJ emoji sequences (such as family or profession ligatures) are therefore rejected under `string filter`, whereas standalone printable emoji without `U+200D` are accepted. Fixture: [`zwj-emoji.json`](../examples/invalid/zwj-emoji.json).
3. **Rejection over silent sanitization.**
   Neither `schema/v1.json` nor `tools/validate.py` strips or normalizes banned characters. Rejecting invalid payloads preserves exact byte-cap accounting and ensures the caller knows what failed.

## Parser and validator hardening limits

Beyond string content, validators and host consumers enforce structural and parser invariants against malformed or adversarial JSON:

- **Non-finite numbers (`NaN`, `Infinity`, `-Infinity`)**: Standard RFC 8259 JSON forbids non-finite number literals, and naive `NaN < min` / `NaN > max` checks evaluate to `false`, which would bypass numeric bounds (`[-1e12, 1e12]` and `[0, 1e12]`). `tools/validate.py` rejects non-finite constants at parse time (`unparseable JSON`, `code=none`) and enforces finite-only serialization. Fixture: [`non-finite-number.json`](../examples/invalid/non-finite-number.json).
- **Lone UTF-16 surrogates**: Unpaired surrogate escapes (such as `\uD800`) cannot be encoded as valid UTF-8. During byte-cap measurement, a `UnicodeEncodeError` is caught and mapped cleanly to `string filter` (`code=none`) instead of crashing the validator.
- **Unhashable `type` discriminator**: Supplying a JSON array or object as `components[n].type` (e.g., `["stat"]`) must not raise an unhandled `TypeError` in dictionary/set discriminator lookups. Non-string or unhashable `type` values are rejected with `bad_args` (`invalid type`), while unknown string types are rejected with `bad_args` (`unknown widget type`). Fixtures: [`unhashable-type.json`](../examples/invalid/unhashable-type.json), [`unknown-widget-type.json`](../examples/invalid/unknown-widget-type.json).
- **Deep nesting / recursion depth cap**: Valid v1 payloads have a maximum JSON nesting depth of 4 (`root -> components -> component -> items/rows -> item/cell`). Validators cap recursion depth (depth > 32) and reject excessively nested inputs with `bad_args` (`invalid type`) to prevent stack exhaustion.
- **Prototype-pollution keys (`__proto__`, `constructor`, `prototype`)**: Root and widget schemas set `additionalProperties: false`, rejecting unknown keys with `bad_args` (`extra property`). JavaScript validators and **Hermes Desk** MCP handlers must inspect only own enumerable keys (`Object.keys` / `Object.hasOwn`) so keys named `__proto__`, `constructor`, or `prototype` are treated as unexpected own properties rather than mutating or reading `Object.prototype`. Fixtures: [`proto-key.json`](../examples/invalid/proto-key.json), [`extra-property.json`](../examples/invalid/extra-property.json).

## Complete invalid fixture index

All adversarial and contract-violation fixtures live under `examples/invalid/`, are registered in [`manifest.json`](../examples/invalid/manifest.json), and are verified by `tools/check-examples.py` via `tools/validate.py`:

| Fixture | Rejection class | Expected code |
|---|---|---|
| [`extra-property.json`](../examples/invalid/extra-property.json) | `extra property` | `bad_args` |
| [`unknown-widget-type.json`](../examples/invalid/unknown-widget-type.json) | `unknown widget type` | `bad_args` |
| [`wrong-type.json`](../examples/invalid/wrong-type.json) | `invalid type` | `bad_args` |
| [`too-large-payload.json`](../examples/invalid/too-large-payload.json) | `over byte cap` | `too_large` |
| [`bound-violation.json`](../examples/invalid/bound-violation.json) | `bound violation` | `none` (unnamed in v1 docs) |
| [`unknown-version.json`](../examples/invalid/unknown-version.json) | `unknown version` | `none` (unnamed in v1 docs) |
| [`duplicate-checklist-id.json`](../examples/invalid/duplicate-checklist-id.json) | `duplicate id` | `none` (unnamed in v1 docs) |
| [`astral-format-char.json`](../examples/invalid/astral-format-char.json) | `string filter` | `none` (unnamed in v1 docs) |
| [`mixed-case-scheme.json`](../examples/invalid/mixed-case-scheme.json) | `string filter` | `none` (unnamed in v1 docs) |
| [`bidi-override.json`](../examples/invalid/bidi-override.json) | `string filter` | `none` (unnamed in v1 docs) |
| [`zwj-emoji.json`](../examples/invalid/zwj-emoji.json) | `string filter` | `none` (unnamed in v1 docs) |
| [`unhashable-type.json`](../examples/invalid/unhashable-type.json) | `invalid type` | `bad_args` |
| [`non-finite-number.json`](../examples/invalid/non-finite-number.json) | `unparseable JSON` | `none` (unnamed in v1 docs) |
| [`genui-occurrence-spoof.json`](../examples/invalid/genui-occurrence-spoof.json) | `extra property` | `bad_args` |
| [`proto-key.json`](../examples/invalid/proto-key.json) | `extra property` | `bad_args` |
