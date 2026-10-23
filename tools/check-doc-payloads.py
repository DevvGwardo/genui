#!/usr/bin/env python3
"""genui - doc payload checker (zero dependencies, Python 3 standard library only).

Every fenced ```json payload in the docs is a claim that it is a valid
`render_ui` argument. This tool extracts those payloads from the two files that
show them to users - `README.md` and `skills/genui/SKILL.md` - and puts each one
through `tools/validate.py`, the validator of record. A doc example that drifts
away from `schema/v1.json` therefore fails CI instead of shipping.

The per-file payload counts are asserted in both directions, the same way
`tools/check-examples.py` asserts its fixture set: a payload cannot be added or
dropped from the docs without this list being updated, so the check can never
pass vacuously after an edit.

Usage:  python3 tools/check-doc-payloads.py
Exit status: 0 when every embedded payload validates, 1 otherwise.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate.py"

# file (relative to the repo root) -> exact number of ```json payloads it embeds
DOCS = {
    "README.md": 1,
    "skills/genui/SKILL.md": 5,
}

FENCE = re.compile(r"^```json[ \t]*\n(.*?)^```", re.DOTALL | re.MULTILINE)


def payloads(text):
    """Return (lineno, source) for each fenced json block, in document order."""
    out = []
    for match in FENCE.finditer(text):
        out.append((text.count("\n", 0, match.start()) + 1, match.group(1)))
    return out


def validate(source, label):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        fh.write(source)
        tmp = Path(fh.name)
    try:
        run = subprocess.run(
            [sys.executable, str(VALIDATOR), str(tmp)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass
    line = (run.stdout or run.stderr or "").strip().splitlines()
    detail = line[-1].replace(str(tmp), label) if line else "validator produced no output"
    return run.returncode == 0, detail


def main():
    failures = []
    checked = 0
    for rel, expected in DOCS.items():
        path = ROOT / rel
        if not path.exists():
            failures.append(rel + ": missing")
            continue
        with open(path, encoding="utf-8") as fh:
            found = payloads(fh.read())
        if len(found) != expected:
            failures.append(
                rel + ": expected " + str(expected) + " ```json payload(s), found "
                + str(len(found)) + " - update DOCS in tools/check-doc-payloads.py if the change was intended"
            )
        for index, (lineno, source) in enumerate(found, start=1):
            label = rel + ":" + str(lineno)
            try:
                json.loads(source)
            except ValueError as err:
                failures.append(label + ": unparseable JSON: " + str(err))
                continue
            ok, detail = validate(source, label)
            checked += 1
            print(("  ok   " if ok else "  FAIL ") + label + " (payload " + str(index) + ") -> " + detail)
            if not ok:
                failures.append(label + ": " + detail)

    print()
    if failures:
        for line in failures:
            print("FAIL " + line, file=sys.stderr)
        print(str(checked) + " doc payload(s) checked, " + str(len(failures)) + " problem(s)", file=sys.stderr)
        return 1
    print(str(checked) + " doc payload(s) checked, all valid against schema/v1.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())