#!/usr/bin/env python3
"""genui - examples suite runner (zero dependencies, Python 3 standard library only).

Runs tools/validate.py (the validator of record, batched via --jsonl) over the
committed examples:

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
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "tools" / "validate.py"


def batchvalidate(paths):
    """Validate all paths in a single tools/validate.py --jsonl subprocess."""
    if not paths:
        return {}
    lines = []
    for p in paths:
        raw = open(p, "rb").read()
        lines.append(json.dumps(raw.decode("utf-8", errors="surrogatepass"), ensure_ascii=True))
    proc = subprocess.run(
        [sys.executable, str(VALIDATOR), "--jsonl"],
        input=("\n".join(lines) + "\n").encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    outlines = [ln for ln in proc.stdout.decode("utf-8").splitlines() if ln.strip()]
    if len(outlines) != len(paths):
        raise RuntimeError(
            f"validator --jsonl returned {len(outlines)} lines for {len(paths)} paths: {proc.stderr.decode('utf-8', errors='replace')}"
        )
    results = {}
    for p, ln in zip(paths, outlines):
        rec = json.loads(ln)
        results[p] = {
            "ok": bool(rec["ok"]),
            "code": rec["code"] or "none",
            "reason": rec["reason"],
            "pointer": rec.get("pointer", ""),
        }
    return results


def compact(path):
    with open(path, "rb") as fh:
        payload = json.loads(fh.read())
    return len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def main():
    bad = 0

    valid = ROOT / "examples" / "valid"
    validfiles = sorted(valid.glob("*.json"))
    if not validfiles:
        print("FAIL: examples/valid holds no *.json fixtures")
        return 1

    invalid = ROOT / "examples" / "invalid"
    with open(invalid / "manifest.json", encoding="utf-8") as fh:
        manifest = json.load(fh)
    invcases = {case["file"]: case for case in manifest["cases"]}
    invdisk = sorted(p.name for p in invalid.glob("*.json") if p.name != "manifest.json")
    invpaths = [invalid / name for name in invdisk if name in invcases]

    boundary = ROOT / "examples" / "boundary"
    bndcases = []
    bndpaths = []
    if boundary.is_dir():
        with open(boundary / "manifest.json", encoding="utf-8") as fh:
            suite = json.load(fh)
        bndcases = suite["cases"]
        bndpaths = [(boundary / case["file"]).resolve() for case in bndcases]

    allpaths = list(dict.fromkeys(validfiles + invpaths + bndpaths))
    verdicts = batchvalidate(allpaths)

    print(f"examples/valid: {len(validfiles)} fixture(s), every one must validate")
    for f in validfiles:
        rec = verdicts[f]
        if rec["ok"]:
            print(f"  {f.name}: valid")
        else:
            bad += 1
            print(f"  FAIL: {f.name}: expected valid, got code={rec['code']} reason={rec['reason']}")

    if sorted(invcases) != invdisk:
        bad += 1
        print("FAIL: examples/invalid file set differs from manifest.json:")
        for name in sorted(set(invcases) - set(invdisk)):
            print(f"  missing on disk: {name}")
        for name in sorted(set(invdisk) - set(invcases)):
            print(f"  not in manifest: {name}")
    print(f"examples/invalid: {len(invdisk)} fixture(s), each must hit exactly its manifest outcome")
    for name in invdisk:
        if name not in invcases:
            continue
        case = invcases[name]
        rec = verdicts[invalid / name]
        expected = case.get("expectedCode")
        want = expected if expected is not None else "none"
        if rec["ok"]:
            bad += 1
            print(f"  FAIL: {name}: expected rejection, got valid")
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

    if not boundary.is_dir():
        bad += 1
        print("FAIL: examples/boundary is missing")
    else:
        local = sorted(p.name for p in boundary.glob("*.json") if p.name != "manifest.json")
        referenced = sorted(Path(case["file"]).name for case in bndcases if not case["file"].startswith("../"))
        if local != referenced:
            bad += 1
            print("FAIL: examples/boundary file set differs from its manifest:")
            print(f"  on disk: {local}")
            print(f"  referenced: {referenced}")
        print(f"examples/boundary: {len(bndcases)} fixture(s), each must hit exactly its declared boundary outcome")
        for case, path in zip(bndcases, bndpaths):
            rec = verdicts[path]
            fail = 0
            if case["expect"] == "valid":
                if rec["ok"]:
                    detail = f"valid - {case['label']}"
                else:
                    fail += 1
                    detail = f"expected valid, got code={rec['code']} reason={rec['reason']}"
            else:
                want = case.get("code", "none")
                if rec["ok"]:
                    fail += 1
                    detail = "expected rejection, got valid"
                elif rec["code"] != want or rec["reason"] != case.get("reason"):
                    fail += 1
                    detail = (
                        f"expected code={want} reason={case.get('reason')!r}, "
                        f"got code={rec['code']} reason={rec['reason']!r}"
                    )
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
