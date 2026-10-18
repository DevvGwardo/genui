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
    examples/boundary/*.json every fixture in examples/boundary/manifest.json
                             must hit its declared outcome - valid, or the
                             declared code + reason - and when the case
                             declares `bytes`, the payload's exact compact
                             UTF-8 size is asserted (the 16,384-byte cap is
                             inclusive; 16,385 must fail with too_large).

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


def compact(path):
    with open(path, "rb") as fh:
        payload = json.loads(fh.read())
    return len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


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

    boundary = ROOT / "examples" / "boundary"
    if not boundary.is_dir():
        bad += 1
        print("FAIL: examples/boundary is missing")
    else:
        with open(boundary / "manifest.json", encoding="utf-8") as fh:
            suite = json.load(fh)
        cases = suite["cases"]
        local = sorted(p.name for p in boundary.glob("*.json") if p.name != "manifest.json")
        referenced = sorted(Path(case["file"]).name for case in cases if not case["file"].startswith("../"))
        if local != referenced:
            bad += 1
            print("FAIL: examples/boundary file set differs from its manifest:")
            print(f"  on disk: {local}")
            print(f"  referenced: {referenced}")
        print(f"examples/boundary: {len(cases)} fixture(s), each must hit exactly its declared boundary outcome")
        for case in cases:
            path = (boundary / case["file"]).resolve()
            rc, line = run(path)
            rec = parse(path, line)
            fail = 0
            if case["expect"] == "valid":
                if rc == 0 and rec and rec["ok"]:
                    detail = f"valid - {case['label']}"
                else:
                    fail += 1
                    detail = f"expected valid, got rc={rc} line={line!r}"
            else:
                want = case.get("code", "none")
                if rc != 1 or not rec or rec["ok"]:
                    fail += 1
                    detail = f"expected rejection, got rc={rc} line={line!r}"
                elif rec["code"] != want or rec["reason"] != case.get("reason"):
                    fail += 1
                    detail = (f"expected code={want} reason={case.get('reason')!r}, "
                              f"got code={rec['code']} reason={rec['reason']!r}")
                else:
                    detail = f"rejected code={rec['code']} reason={rec['reason']} - {case['label']}"
            if "bytes" in case:
                got = compact(path)
                if got != case["bytes"]:
                    fail += 1
                    detail += f" | compact size {got} != declared {case['bytes']}"
                else:
                    detail += f" | compact size {got} as declared"
            if fail:
                bad += fail
                print(f"  FAIL: {case['file']}: {detail}")
            else:
                print(f"  {case['file']}: {detail}")

    if bad == 0:
        print("PASS: examples suites match - valid set validates, invalid set rejects exactly as declared, boundary set hits its declared outcomes.")
        return 0
    print(f"FAIL: {bad} example problem(s).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
