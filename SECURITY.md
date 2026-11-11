# Security policy

## Supported versions

The v1 payload contract is the only supported contract. Security fixes land on the
current 1.x line and ship as patch releases.

| Version | Supported |
|---|---|
| 1.x (v1 contract) | yes |
| anything else | no |

## What counts as a vulnerability here

`genui` is a skill definition plus a data contract; it ships no renderer and no
runtime. The trust boundary it defines is the **v1 payload contract**:

- the text filter in [`schema/v1.json`](schema/v1.json) and
  [`tools/validate.py`](tools/validate.py) — angle brackets, URI schemes,
  protocol-relative paths, and control, format, and bidi characters;
- the byte cap and the table/checklist runtime rules that JSON Schema cannot express;
- the rule that `genuiOccurrence` is minted server-side and must never be accepted
  from tool arguments.

A report is in scope when a payload passes `tools/validate.py` and the schema but can
still make Hermes Desk render something outside that boundary.

Out of scope: bugs in the Hermes Desk renderer or in Hermes Agent, styling
disagreements, and the documented limits themselves (the component, byte, and column
caps) when they behave as specified.

## Reporting

Please use GitHub's private vulnerability reporting on this repository
(**Security -> Report a vulnerability**) rather than a public issue. Include:

- a minimal `render_ui` argument that reproduces the problem;
- the command you ran (`py -3 tools/validate.py <file>` or `python3 ...`) and its output;
- what the desk rendered versus what the contract says should be rejected;
- the version or commit you tested.

Do not include real user data, credentials, or live URLs in the report.

## What to expect

- Acknowledgement within 7 days.
- An initial assessment within 14 days.
- When confirmed: a fix, a regression fixture under `examples/invalid/`, and a
  [`CHANGELOG.md`](CHANGELOG.md) entry. Reporters are credited unless they ask otherwise.

## Hardening notes

The filter is a denylist over Unicode classes, not a sanitizer that rewrites input:
it rejects, it never repairs. Two limits are deliberate and documented — homoglyphs
that are ordinary printable letters are allowed (card fields are plain text, not
identifiers), and emoji glued with zero-width joiners are rejected because the joiner
is a format character. Both behaviors are pinned by fixtures.
