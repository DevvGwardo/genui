#!/usr/bin/env python3
"""genui v1 deterministic byte-cap pruner (zero dependencies, Python 3 stdlib only).

Implements the exact 6-step Pruning Under the Byte Cap algorithm from
skills/genui/SKILL.md:
  1. Measure exact compact UTF-8 bytes (no pretty-printing).
  2. Drop optional fields in fixed order, re-measuring after each group:
     detail (stat) -> unit (bar_chart) -> checked (checklist items).
  3. Drop trailing rows from the table with the most rows (tie: later component),
     down to 0 rows.
  4. Drop trailing items from the longest bar_chart/checklist item list
     (tie: later component), down to 1 item.
  5. Drop trailing components from components, down to 1 component.
  6. Stop and fail cleanly if a single minimal component still exceeds the cap.

Usage:
    python3 tools/prune.py [--cap N] [--json] [--check] [--in-place] FILE|-
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402

validatev2 = type(sys)("validatev2")
validatev2.__file__ = str(Path(__file__).resolve().parent / "validate-v2.py")
exec(compile(open(validatev2.__file__, encoding="utf-8").read(), validatev2.__file__, "exec"), validatev2.__dict__)


def rejectwith(message, code=None, jsonmode=False, extra=None):
    if jsonmode:
        rec = {"ok": False, "code": code, "reason": message}
        if extra:
            rec.update(extra)
        print(json.dumps(rec, separators=(",", ":"), ensure_ascii=True))
    else:
        print("FAIL: " + message, file=sys.stderr)
    return 1


def precheck(payload):
    """Validate structural/string/runtime rules ignoring the byte cap (v1 and v2)."""
    if isinstance(payload, dict) and payload.get("version") == 2:
        deep = validate.depthcheck(payload)
        if deep is not None:
            return {"ok": False, "code": "bad_args", "reason": "invalid type", "pointer": deep}
        out = []
        validatev2.run2(payload, validatev2.ROOT2, validatev2.ROOT2, "", out)
        if out:
            rec = out[0]
            if rec["keyword"] == "enum":
                return {"ok": False, "code": "bad_args", "reason": "invalid enum", "pointer": rec["pointer"]}
            code, reason = validate.verdict(rec)
            return {"ok": False, "code": code, "reason": reason, "pointer": rec["pointer"]}
        astral = []
        validate.scan_astral(payload, "", astral)
        if astral:
            return {"ok": False, "code": None, "reason": "string filter", "pointer": astral[0]["pointer"]}
        for i, comp in enumerate(payload["components"]):
            ctype = comp["type"]
            if ctype == "table":
                width = len(comp["columns"])
                for ri, row in enumerate(comp["rows"]):
                    if len(row) != width:
                        return {"ok": False, "code": None, "reason": "row length mismatch", "pointer": f"/components/{i}/rows/{ri}"}
            elif ctype == "checklist":
                ids = [item["id"] for item in comp["items"]]
                if len(set(ids)) != len(ids):
                    return {"ok": False, "code": None, "reason": "duplicate id", "pointer": f"/components/{i}"}
            elif ctype == "line_chart":
                xlen = len(comp["xLabels"])
                for si, s in enumerate(comp["series"]):
                    if len(s["values"]) != xlen:
                        return {"ok": False, "code": None, "reason": "series length mismatch", "pointer": f"/components/{i}/series/{si}/values"}
            elif ctype == "progress_list":
                for pi, item in enumerate(comp["items"]):
                    if item["max"] <= 0:
                        return {"ok": False, "code": None, "reason": "bound violation", "pointer": f"/components/{i}/items/{pi}/max"}
            elif ctype == "gauge":
                if comp["max"] <= 0:
                    return {"ok": False, "code": None, "reason": "bound violation", "pointer": f"/components/{i}/max"}
            elif ctype == "heatmap":
                ylen = len(comp["yLabels"])
                xlen = len(comp["xLabels"])
                if len(comp["cells"]) != ylen:
                    return {"ok": False, "code": None, "reason": "heatmap dimension mismatch", "pointer": f"/components/{i}/cells"}
                for ri, row in enumerate(comp["cells"]):
                    if len(row) != xlen:
                        return {"ok": False, "code": None, "reason": "heatmap dimension mismatch", "pointer": f"/components/{i}/cells/{ri}"}
            elif ctype == "stacked_bar":
                seglen = len(comp["segments"])
                for ri, row in enumerate(comp["rows"]):
                    if len(row["values"]) != seglen:
                        return {"ok": False, "code": None, "reason": "stacked bar segment mismatch", "pointer": f"/components/{i}/rows/{ri}/values"}
            elif ctype == "radar_chart":
                axlen = len(comp["axes"])
                for si, s in enumerate(comp["series"]):
                    if len(s["values"]) != axlen:
                        return {"ok": False, "code": None, "reason": "radar axis mismatch", "pointer": f"/components/{i}/series/{si}/values"}
            elif ctype == "slo_burn":
                for wi, w in enumerate(comp["windows"]):
                    if w["threshold"] <= 0:
                        return {"ok": False, "code": None, "reason": "bound violation", "pointer": f"/components/{i}/windows/{wi}/threshold"}
        return {"ok": True}
    deep = validate.depthcheck(payload)
    if deep is not None:
        return {"ok": False, "code": "bad_args", "reason": "invalid type", "pointer": deep}
    out = []
    validate.run(payload, validate.ROOT, validate.ROOT, "", out)
    if out:
        code, reason = validate.verdict(out[0])
        return {"ok": False, "code": code, "reason": reason, "pointer": out[0]["pointer"]}
    astral = []
    validate.scan_astral(payload, "", astral)
    if astral:
        return {"ok": False, "code": None, "reason": "string filter", "pointer": astral[0]["pointer"]}
    for i, comp in enumerate(payload["components"]):
        if comp["type"] == "table":
            width = len(comp["columns"])
            for ri, row in enumerate(comp["rows"]):
                if len(row) != width:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "row length mismatch",
                        "pointer": "/components/" + str(i) + "/rows/" + str(ri),
                    }
        if comp["type"] == "checklist":
            ids = [item["id"] for item in comp["items"]]
            if len(set(ids)) != len(ids):
                return {
                    "ok": False,
                    "code": None,
                    "reason": "duplicate id",
                    "pointer": "/components/" + str(i),
                }
    return {"ok": True}


def prune(payload, cap=validate.CAP):
    """Return (ok, result dict) using the deterministic 6-step pruning algorithm."""
    work = copy.deepcopy(payload)
    try:
        initial = validate.compactbytes(work)
    except (UnicodeEncodeError, ValueError) as err:
        return False, {"reason": "cannot serialize payload: " + str(err), "steps": []}

    steps = []
    size = initial
    if size <= cap:
        return True, {
            "initialBytes": initial,
            "finalBytes": size,
            "pruned": False,
            "steps": steps,
            "payload": work,
        }

    # Step 2a: drop all detail fields (stat and v2 timeline items)
    changed = False
    for comp in work["components"]:
        if comp.get("type") in ("stat", "gauge") and "detail" in comp:
            del comp["detail"]
            changed = True
        elif comp.get("type") == "timeline":
            for item in comp.get("items", []):
                if "detail" in item:
                    del item["detail"]
                    changed = True
    if changed:
        size = validate.compactbytes(work)
        steps.append({"action": "drop-detail", "bytes": size})
        if size <= cap:
            return True, {
                "initialBytes": initial,
                "finalBytes": size,
                "pruned": True,
                "steps": steps,
                "payload": work,
            }

    # Step 2b: drop all unit fields (bar_chart, line_chart, donut_chart, progress_list items)
    changed = False
    for comp in work["components"]:
        if comp.get("type") in ("bar_chart", "line_chart", "donut_chart", "funnel_chart", "heatmap", "gauge", "treemap", "stacked_bar") and "unit" in comp:
            del comp["unit"]
            changed = True
        elif comp.get("type") == "progress_list":
            for item in comp.get("items", []):
                if "unit" in item:
                    del item["unit"]
                    changed = True
    if changed:
        size = validate.compactbytes(work)
        steps.append({"action": "drop-unit", "bytes": size})
        if size <= cap:
            return True, {
                "initialBytes": initial,
                "finalBytes": size,
                "pruned": True,
                "steps": steps,
                "payload": work,
            }

    # Step 2c: drop all checked fields (checklist items)
    changed = False
    for comp in work["components"]:
        if comp.get("type") == "checklist":
            for item in comp.get("items", []):
                if "checked" in item:
                    del item["checked"]
                    changed = True
    if changed:
        size = validate.compactbytes(work)
        steps.append({"action": "drop-checked", "bytes": size})
        if size <= cap:
            return True, {
                "initialBytes": initial,
                "finalBytes": size,
                "pruned": True,
                "steps": steps,
                "payload": work,
            }

    # Step 2d (v2 only): drop optional v2 embellishments (sparkline, centerLabel, tone, alert.items)
    if work.get("version") == 2:
        changed = False
        for comp in work["components"]:
            for k in ("sparkline", "centerLabel", "tone", "budgetRemainingPct"):
                if k in comp:
                    del comp[k]
                    changed = True
            if comp.get("type") == "radar_chart" and "max" in comp:
                del comp["max"]
                changed = True
            if comp.get("type") == "alert" and "items" in comp:
                del comp["items"]
                changed = True
            for item in comp.get("items", []):
                if isinstance(item, dict):
                    for optk in ("tone", "delta", "meta", "group"):
                        if optk in item:
                            del item[optk]
                            changed = True
            for ent in comp.get("entries", []):
                if isinstance(ent, dict) and "source" in ent:
                    del ent["source"]
                    changed = True
            for win in comp.get("windows", []):
                if isinstance(win, dict) and "tone" in win:
                    del win["tone"]
                    changed = True
            if comp.get("type") == "kanban":
                for col in comp.get("columns", []):
                    for carditem in col.get("items", []):
                        for optk in ("tag", "tone"):
                            if optk in carditem:
                                del carditem[optk]
                                changed = True
        if changed:
            size = validate.compactbytes(work)
            steps.append({"action": "drop-v2-optional", "bytes": size})
            if size <= cap:
                return True, {
                    "initialBytes": initial,
                    "finalBytes": size,
                    "pruned": True,
                    "steps": steps,
                    "payload": work,
                }

    # Step 3: drop trailing rows from the table with the most rows (tie: later component)
    while size > cap:
        bestidx = -1
        bestlen = 0
        for idx, comp in enumerate(work["components"]):
            if comp.get("type") == "table":
                n = len(comp["rows"])
                if n > 0 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
        if bestidx == -1:
            break
        work["components"][bestidx]["rows"].pop()
        size = validate.compactbytes(work)
        steps.append({"action": "drop-row", "component": bestidx, "bytes": size})

    if size <= cap:
        return True, {
            "initialBytes": initial,
            "finalBytes": size,
            "pruned": True,
            "steps": steps,
            "payload": work,
        }

    # Step 4: drop trailing items from the longest item/series list (tie: later component)
    while size > cap:
        bestidx = -1
        bestlen = 1
        for idx, comp in enumerate(work["components"]):
            ctype = comp.get("type")
            if ctype in ("bar_chart", "checklist", "donut_chart", "key_value", "progress_list", "timeline", "status_grid", "diff_list"):
                n = len(comp["items"])
                if n > 1 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype in ("metric_grid", "funnel_chart"):
                n = len(comp["items"])
                if n > 2 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "line_chart":
                n = len(comp["xLabels"])
                if n > 2 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "heatmap":
                n = len(comp["yLabels"])
                if n > 2 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "treemap":
                n = len(comp["items"])
                if n > 2 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "stacked_bar":
                n = len(comp["rows"])
                if n > 1 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "log_stream":
                n = len(comp["entries"])
                if n > 1 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
            elif ctype == "slo_burn":
                n = len(comp["windows"])
                if n > 2 and n >= bestlen:
                    bestlen = n
                    bestidx = idx
        if bestidx == -1:
            break
        targetcomp = work["components"][bestidx]
        if targetcomp.get("type") == "line_chart":
            targetcomp["xLabels"].pop()
            for s in targetcomp["series"]:
                s["values"].pop()
        elif targetcomp.get("type") == "heatmap":
            targetcomp["yLabels"].pop()
            targetcomp["cells"].pop()
        elif targetcomp.get("type") == "stacked_bar":
            targetcomp["rows"].pop()
        elif targetcomp.get("type") == "log_stream":
            targetcomp["entries"].pop()
        elif targetcomp.get("type") == "slo_burn":
            targetcomp["windows"].pop()
        else:
            targetcomp["items"].pop()
        size = validate.compactbytes(work)
        steps.append({"action": "drop-item", "component": bestidx, "bytes": size})

    if size <= cap:
        return True, {
            "initialBytes": initial,
            "finalBytes": size,
            "pruned": True,
            "steps": steps,
            "payload": work,
        }

    # Step 5: drop whole components from the end, keeping at least 1
    while size > cap and len(work["components"]) > 1:
        idx = len(work["components"]) - 1
        work["components"].pop()
        size = validate.compactbytes(work)
        steps.append({"action": "drop-component", "component": idx, "bytes": size})

    if size <= cap:
        return True, {
            "initialBytes": initial,
            "finalBytes": size,
            "pruned": True,
            "steps": steps,
            "payload": work,
        }

    # Step 6: single minimal component still exceeds cap
    return False, {
        "initialBytes": initial,
        "finalBytes": size,
        "pruned": True,
        "steps": steps,
        "reason": "cannot fit within " + str(cap) + " bytes without truncating values",
    }


def main(args):
    cap = validate.CAP
    jsonmode = False
    checkonly = False
    inplace = False
    target = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-h", "--help"):
            print("usage: python3 tools/prune.py [--cap N] [--json] [--check] [--in-place] FILE|-")
            return 0
        if arg == "--json":
            jsonmode = True
        elif arg == "--check":
            checkonly = True
        elif arg == "--in-place":
            inplace = True
        elif arg == "--cap" and i + 1 < len(args):
            i += 1
            try:
                cap = int(args[i])
                if cap <= 0:
                    raise ValueError("cap must be positive")
            except ValueError:
                print("usage: --cap requires a positive integer", file=sys.stderr)
                return 2
        elif arg.startswith("-") and arg != "-":
            print("unknown option: " + arg, file=sys.stderr)
            return 2
        elif target is None:
            target = arg
        else:
            print("usage: expected a single FILE or -", file=sys.stderr)
            return 2
        i += 1

    if target is None:
        print("usage: python3 tools/prune.py [--cap N] [--json] [--check] [--in-place] FILE|-", file=sys.stderr)
        return 2
    if inplace and target == "-":
        print("cannot use --in-place with stdin (-)", file=sys.stderr)
        return 2

    try:
        rawbytes = sys.stdin.buffer.read() if target == "-" else open(target, "rb").read()
    except OSError as err:
        return rejectwith("cannot read " + target + ": " + str(err), jsonmode=jsonmode)

    try:
        payload = json.loads(rawbytes, parse_constant=validate.rejectconst)
    except (UnicodeDecodeError, ValueError) as err:
        return rejectwith("unparseable JSON: " + str(err), jsonmode=jsonmode)

    pre = precheck(payload)
    if not pre["ok"]:
        return rejectwith(pre["reason"], code=pre.get("code"), jsonmode=jsonmode, extra={"pointer": pre.get("pointer", "")})

    ok, res = prune(payload, cap=cap)
    if checkonly:
        if ok and not res["pruned"]:
            if jsonmode:
                print(json.dumps({"ok": True, "bytes": res["finalBytes"], "cap": cap}, separators=(",", ":"), ensure_ascii=True))
            else:
                print(target + ": fits (" + str(res["finalBytes"]) + "/" + str(cap) + " bytes)")
            return 0
        msg = "exceeds cap (" + str(res["initialBytes"]) + "/" + str(cap) + " bytes)"
        return rejectwith(msg, code="too_large", jsonmode=jsonmode, extra={"bytes": res["initialBytes"], "cap": cap})

    if not ok:
        return rejectwith(
            res["reason"],
            code="too_large",
            jsonmode=jsonmode,
            extra={"initialBytes": res["initialBytes"], "finalBytes": res["finalBytes"], "steps": res["steps"]},
        )

    post = validatev2.checkv2(res["payload"]) if res["payload"].get("version") == 2 else validate.check(res["payload"])
    if not post["ok"] and cap <= validate.CAP:
        return rejectwith("pruned payload failed post-validation: " + post["reason"], code=post["code"], jsonmode=jsonmode)

    compact = json.dumps(res["payload"], separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if inplace:
        open(target, "w", encoding="utf-8", newline="\n").write(compact + "\n")

    if jsonmode:
        out = {
            "ok": True,
            "initialBytes": res["initialBytes"],
            "finalBytes": res["finalBytes"],
            "pruned": res["pruned"],
            "steps": res["steps"],
            "payload": res["payload"],
        }
        print(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    else:
        print(compact)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
