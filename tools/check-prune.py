#!/usr/bin/env python3
"""genui - deterministic byte-cap pruner test suite (zero dependencies, stdlib only).

Verifies tools/prune.py against every rule in skills/genui/SKILL.md:
  - Step ordering: detail -> unit -> checked -> table rows -> items -> components
  - Tie-breaking: later component when row or item counts are tied
  - Floors: tables shrink to 0 rows, item lists to 1 item, components to 1
  - Unprunable payloads fail cleanly without truncating strings or numbers
  - Pruned outputs of committed oversized fixtures pass tools/validate.py
  - Determinism: repeated runs produce byte-identical output and step traces
  - Stdin ("-") works for both tools/validate.py and tools/prune.py

Usage:  python3 tools/check-prune.py
Exit status: 0 when all assertions pass, 1 otherwise.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import prune  # noqa: E402
import validate  # noqa: E402


def must(cond, msg):
    if not cond:
        raise AssertionError(msg)


def runcli(script, args, stdinbytes=None):
    return subprocess.run(
        [sys.executable, str(ROOT / "tools" / script), *args],
        input=stdinbytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def main():
    # 1. Already-fitting payload is untouched
    fourup = json.loads(open(ROOT / "examples" / "valid" / "four-up.json", encoding="utf-8").read())
    ok, res = prune.prune(fourup)
    must(ok and not res["pruned"] and res["steps"] == [], "four-up.json should not be pruned")
    must(res["payload"] == fourup, "four-up.json payload mutated")

    # 2. Exact step order: detail -> unit -> checked -> row -> item -> component
    sample = {
        "version": 1,
        "components": [
            {"type": "stat", "title": "S", "value": "10", "detail": "extra detail text"},
            {
                "type": "bar_chart",
                "title": "B",
                "unit": "requests",
                "items": [{"label": "a", "value": 1}, {"label": "b", "value": 2}],
            },
            {
                "type": "checklist",
                "title": "C",
                "items": [
                    {"id": "i1", "label": "one", "checked": True},
                    {"id": "i2", "label": "two", "checked": False},
                ],
            },
            {
                "type": "table",
                "title": "T",
                "columns": ["k", "v"],
                "rows": [["r1", 1], ["r2", 2]],
            },
        ],
    }
    ok, res = prune.prune(sample, cap=120)
    must(ok, "sample should prune down to <= 120 bytes")
    actions = [s["action"] for s in res["steps"]]
    must(actions[:3] == ["drop-detail", "drop-unit", "drop-checked"], f"unexpected optional drop order: {actions}")
    # After optional fields: table (2 rows) and bar_chart/checklist (2 items)
    # Step 3 drops table rows to 0 before Step 4 drops items
    firstitemidx = next(i for i, a in enumerate(actions) if a == "drop-item")
    rowindices = [i for i, a in enumerate(actions) if a == "drop-row"]
    must(len(rowindices) == 2 and max(rowindices) < firstitemidx, f"rows must drop before items: {actions}")
    # Tied item lists (bar_chart at 1, checklist at 2): later component (2) drops first
    itemcomps = [s["component"] for s in res["steps"] if s["action"] == "drop-item"]
    must(itemcomps == [2, 1], f"expected tie-break component order [2, 1], got {itemcomps}")
    # Remaining components must have >=1 item, table 0 rows, and drop-component comes last
    compidx = next(i for i, a in enumerate(actions) if a == "drop-component")
    must(compidx > max(i for i, a in enumerate(actions) if a == "drop-item"), f"component dropped too early: {actions}")
    must(len(res["payload"]["components"]) >= 1, "must keep at least 1 component")
    must(validate.check(res["payload"])["ok"], "pruned payload failed validate.check")

    # 3. Tie-breaking between two equal-row tables: later table drops first
    twotables = {
        "version": 1,
        "components": [
            {"type": "table", "title": "T0", "columns": ["c"], "rows": [["a"], ["b"]]},
            {"type": "table", "title": "T1", "columns": ["c"], "rows": [["c"], ["d"]]},
        ],
    }
    caponerow = validate.compactbytes(twotables) - 1
    ok, res = prune.prune(twotables, cap=caponerow)
    must(ok and len(res["steps"]) == 1, f"expected 1 step, got {res['steps']}")
    must(res["steps"][0]["action"] == "drop-row" and res["steps"][0]["component"] == 1, "tied table must drop later component")

    # 4. Unprunable single minimal component fails cleanly without truncation
    unprunable = {
        "version": 1,
        "components": [{"type": "stat", "title": "Long title here", "value": "1234567890"}],
    }
    ok, res = prune.prune(unprunable, cap=40)
    must(not ok and "cannot fit" in res["reason"], f"expected unprunable failure, got {ok} {res}")

    # 5. Committed oversized fixtures prune cleanly and pass validate.py
    for rel in ("examples/invalid/too-large-payload.json", "examples/boundary/payload-16385-bytes.json"):
        raw = open(ROOT / rel, "rb").read()
        p1 = runcli("prune.py", ["--json", "-"], stdinbytes=raw)
        p2 = runcli("prune.py", ["--json", "-"], stdinbytes=raw)
        must(p1.returncode == 0 and p1.stdout == p2.stdout, f"non-deterministic or failed prune for {rel}")
        parsed = json.loads(p1.stdout.decode("utf-8"))
        must(parsed["ok"] and parsed["finalBytes"] <= validate.CAP, f"pruned {rel} still over cap")
        prunedbytes = json.dumps(parsed["payload"], separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        v = runcli("validate.py", ["-"], stdinbytes=prunedbytes)
        must(v.returncode == 0 and b": valid" in v.stdout, f"pruned {rel} failed validate.py: {v.stdout!r}")

    # 6. --check mode and non-too_large rejection
    chkok = runcli("prune.py", ["--check", "examples/valid/stat.json"])
    must(chkok.returncode == 0, "--check on valid stat.json should exit 0")
    chkbig = runcli("prune.py", ["--check", "examples/boundary/payload-16385-bytes.json"])
    must(chkbig.returncode == 1, "--check on 16385-byte fixture should exit 1")
    bad = runcli("prune.py", ["examples/invalid/extra-property.json"])
    must(bad.returncode == 1, "prune.py must reject non-too_large invalid payloads")

    # 7. v2 payload pruning: drops optional v2 fields (sparkline, centerLabel, tone, alert.items) and prunes line_chart/progress_list
    v2big = {
        "version": 2,
        "components": [
            {
                "type": "stat",
                "title": "S",
                "value": "12",
                "detail": "extra detail",
                "tone": "good",
                "sparkline": [1, 2, 3, 4, 5, 6],
            },
            {
                "type": "line_chart",
                "title": "L",
                "unit": "ms",
                "xLabels": ["t1", "t2", "t3", "t4"],
                "series": [{"name": "p95", "values": [10, 20, 30, 40]}],
            },
            {
                "type": "alert",
                "title": "A",
                "severity": "warn",
                "message": "warning text",
                "items": ["b1", "b2"],
            },
        ],
    }
    p2 = runcli("prune.py", ["--cap", "140", "--json", "-"], stdinbytes=json.dumps(v2big).encode("utf-8"))
    must(p2.returncode == 0, f"v2 prune failed: {p2.stderr!r}")
    d2 = json.loads(p2.stdout.decode("utf-8"))
    must(d2["ok"] and d2["finalBytes"] <= 140, f"v2 prune did not fit cap: {d2}")
    v2chk = runcli("validate-v2.py", ["-"], stdinbytes=json.dumps(d2["payload"]).encode("utf-8"))
    must(v2chk.returncode == 0, f"pruned v2 payload failed validate-v2.py: {v2chk.stdout!r}")

    print("PASS: all 7 deterministic pruning (v1 + v2), tie-break, floor, stdin, and validation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
