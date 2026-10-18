#!/usr/bin/env python3
"""genui - examples suite runner (zero dependencies, Python 3 standard library only).

Runs tools/validate.py (the validator of record) over the committed examples:

    examples/valid/*.json    every file must validate;
    examples/invalid/*.json  every fixture must be rejected with exactly the
                             outcome named in examples/invalid/manifest.json -
                             the expected code when v1 docs name one
                             (bad_args / too_large), or `code=none` plus the
                             exact rejection class when they do not (a code is
                             never guessed; see docs/errors.md) - and the
                             rejection class must equal the manifest's `kind`.
                             The file set is asserted in both directions, so a
                             fixture cannot be added or dropped silently.

Usage:  python3 tools/check-examples.py
Exit status: 0 when the whole suite matches, 1 otherwise.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate.py"
LINE = re.compile(r"^(.*): (valid|invalid code=(\S+) reason=(.+?)(?: at \S.*)?)$")


def run(path):
    proc = subprocess.run(
        [sys.executable, str(VALIDATOR), str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
    )
    lines = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]
    return proc.returncode, (lines[-1] if lines else "")


def parse(path, line):
    m = LINE.match(line)
    if not m or m.group(1) != str(path):
        return None
    if m.group(2) == "valid":
        return {"ok": True}
    return {"ok": False, "code": m.group(3), "reason": m.group(4)}


def main():
    bad = 0

    valid = ROOT / "examples" / "valid"
    files = sorted(valid.glob("*.json"))
    if not files:
        print("FAIL: examples/valid holds no *.json fixtures")
        return 1
    print(f"examples/valid: {len(files)} fixture(s), every one must validate")
    for f in files:
        rc, line = run(f)
        rec = parse(f, line)
        if rc == 0 and rec and rec["ok"]:
            print(f"  {f.name}: valid")
        else:
            bad += 1
            print(f"  FAIL: {f.name}: expected valid, got rc={rc} line={line!r}")

    invalid = ROOT / "examples" / "invalid"
    with open(invalid / "manifest.json", encoding="utf-8") as fh:
        manifest = json.load(fh)
    cases = {case["file"]: case for case in manifest["cases"]}
    disk = sorted(p.name for p in invalid.glob("*.json") if p.name != "manifest.json")
    if sorted(cases) != disk:
        bad += 1
        print("FAIL: examples/invalid file set differs from manifest.json:")
        for name in sorted(set(cases) - set(disk)):
            print(f"  missing on disk: {name}")
        for name in sorted(set(disk) - set(cases)):
            print(f"  not in manifest: {name}")
    print(f"examples/invalid: {len(disk)} fixture(s), each must hit exactly its manifest outcome")
    for name in disk:
        if name not in cases:
            continue
        case = cases[name]
        path = invalid / name
        rc, line = run(path)
        rec = parse(path, line)
        expected = case.get("expectedCode")
        want = expected if expected is not None else "none"
        if rc != 1 or not rec or rec["ok"]:
            bad += 1
            print(f"  FAIL: {name}: expected rejection, got rc={rc} line={line!r}")
            continue
        if rec["code"] != want:
            bad += 1
            print(f"  FAIL: {name}: expected code={want}, got code={rec['code']} ({rec['reason']})")
            continue
        if rec["reason"] != case["kind"]:
            bad += 1
            print(f"  FAIL: {name}: expected reason={case['kind']!r}, got reason={rec['reason']!r}")
            continue
        print(f"  {name}: rejected code={rec['code']} reason={rec['reason']} (expected {want}/{case['kind']})")

    if bad == 0:
        print("PASS: examples suite matches - valid set validates, invalid set rejects exactly as declared.")
        return 0
    print(f"FAIL: {bad} example problem(s).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
