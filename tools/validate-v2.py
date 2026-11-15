#!/usr/bin/env python3
"""genui v2 payload validator (zero dependencies, Python 3 stdlib only).

Validates a v2 render_ui argument against schema/v2.json (10 widget types:
stat, table, bar_chart, checklist, line_chart, donut_chart, key_value,
progress_list, timeline, alert), plus all v2 runtime rules:
  1. Compact UTF-8 size <= 16,384 bytes (too_large)
  2. Table row length == columns.length
  3. Checklist item ids unique within component
  4. Line chart series[].values.length == xLabels.length
  5. Progress list item max > 0
  6. Astral-plane format characters rejected

Usage:
    python3 tools/validate-v2.py [--json] FILE|- [FILE ...]
    python3 tools/validate-v2.py --jsonl < input.jsonl
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402

SCHEMA2 = Path(__file__).resolve().parent.parent / "schema" / "v2.json"
with open(SCHEMA2, encoding="utf-8") as fh:
    ROOT2 = json.loads(fh.read())


def run2(value, sch, root, pointer, out):
    if "$ref" in sch:
        return run2(value, validate.resolve(sch["$ref"], root), root, pointer, out)
    if "enum" in sch and not any(validate.same(value, item) for item in sch["enum"]):
        validate.add(out, pointer, "enum", "must be one of " + json.dumps(sch["enum"]))
        return out
    if "const" in sch and not validate.same(value, sch["const"]):
        validate.add(out, pointer, "const", "must equal " + json.dumps(sch["const"]))
        return out
    if "type" in sch and validate.kindof(value) != sch["type"]:
        validate.add(out, pointer, "type", "expected " + sch["type"] + ", found " + validate.kindof(value))
        return out
    if "allOf" in sch:
        for sub in sch["allOf"]:
            run2(value, sub, root, pointer, out)
    if "anyOf" in sch:
        if not any( not run2(value, sub, root, "", []) for sub in sch["anyOf"]):
            validate.add(out, pointer, "anyOf", "does not match any allowed form")
    if "oneOf" in sch:
        subs = sch["oneOf"]
        disc = {}
        for sub in subs:
            tgt = validate.resolve(sub["$ref"], root) if "$ref" in sub else sub
            want = tgt.get("properties", {}).get("type", {}).get("const")
            if want is not None:
                disc[want] = tgt
        if disc and len(disc) == len(subs):
            if not isinstance(value, dict):
                validate.add(out, pointer, "type", "expected object, found " + validate.kindof(value))
            elif "type" not in value:
                validate.add(out, validate.ptrjoin(pointer, "type"), "required", "missing type")
            else:
                tag = value["type"]
                if not isinstance(tag, str):
                    validate.add(out, validate.ptrjoin(pointer, "type"), "type", "expected string, found " + validate.kindof(tag))
                elif tag in disc:
                    run2(value, disc[tag], root, pointer, out)
                else:
                    validate.add(
                        out,
                        pointer,
                        "discriminator",
                        "component type " + json.dumps(tag) + " is not one of " + ", ".join(disc),
                    )
    if "not" in sch:
        if not run2(value, sch["not"], root, "", []):
            validate.add(out, pointer, "not", "matches a banned pattern")
    if isinstance(value, dict):
        props = sch.get("properties", {})
        for name in sch.get("required", []):
            if name not in value:
                validate.add(out, validate.ptrjoin(pointer, name), "required", "missing " + name)
        if sch.get("additionalProperties") is False:
            for name in value:
                if name not in props:
                    validate.add(out, validate.ptrjoin(pointer, name), "additionalProperties", "unexpected property " + name)
        for name, sub in props.items():
            if name in value:
                run2(value[name], sub, root, validate.ptrjoin(pointer, name), out)
    if isinstance(value, list):
        if "minItems" in sch and len(value) < sch["minItems"]:
            validate.add(out, pointer, "minItems", "needs at least " + str(sch["minItems"]) + " items")
        if "maxItems" in sch and len(value) > sch["maxItems"]:
            validate.add(out, pointer, "maxItems", "allows at most " + str(sch["maxItems"]) + " items")
        if "items" in sch:
            for i, item in enumerate(value):
                run2(item, sch["items"], root, validate.ptrjoin(pointer, i), out)
    if isinstance(value, str):
        if "minLength" in sch and len(value) < sch["minLength"]:
            validate.add(out, pointer, "minLength", "needs at least " + str(sch["minLength"]) + " characters")
        if "maxLength" in sch and len(value) > sch["maxLength"]:
            validate.add(out, pointer, "maxLength", "allows at most " + str(sch["maxLength"]) + " characters")
        if "pattern" in sch and not validate.matches(sch["pattern"], value):
            validate.add(out, pointer, "pattern", "does not match the required pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not validate.math.isfinite(value):
            validate.add(out, pointer, "notFinite", "must be finite")
            return out
        if "minimum" in sch and value < sch["minimum"]:
            validate.add(out, pointer, "minimum", "must be at least " + str(sch["minimum"]))
        if "maximum" in sch and value > sch["maximum"]:
            validate.add(out, pointer, "maximum", "must be at most " + str(sch["maximum"]))
    return out


def checkv2(payload):
    deep = validate.depthcheck(payload)
    if deep is not None:
        return {"ok": False, "code": "bad_args", "reason": "invalid type", "pointer": deep}
    out = []
    run2(payload, ROOT2, ROOT2, "", out)
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
    try:
        size = validate.compactbytes(payload)
    except UnicodeEncodeError:
        return {"ok": False, "code": None, "reason": "string filter", "pointer": ""}
    except ValueError:
        return {"ok": False, "code": None, "reason": "bound violation", "pointer": ""}
    if size > validate.CAP:
        return {"ok": False, "code": "too_large", "reason": "over byte cap", "pointer": ""}

    for i, comp in enumerate(payload["components"]):
        ctype = comp["type"]
        if ctype == "table":
            width = len(comp["columns"])
            for ri, row in enumerate(comp["rows"]):
                if len(row) != width:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "row length mismatch",
                        "pointer": f"/components/{i}/rows/{ri}",
                    }
        elif ctype == "checklist":
            ids = [item["id"] for item in comp["items"]]
            if len(set(ids)) != len(ids):
                return {"ok": False, "code": None, "reason": "duplicate id", "pointer": f"/components/{i}"}
        elif ctype == "line_chart":
            xlen = len(comp["xLabels"])
            for si, s in enumerate(comp["series"]):
                if len(s["values"]) != xlen:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "series length mismatch",
                        "pointer": f"/components/{i}/series/{si}/values",
                    }
        elif ctype == "progress_list":
            for pi, item in enumerate(comp["items"]):
                if item["max"] <= 0:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "bound violation",
                        "pointer": f"/components/{i}/items/{pi}/max",
                    }
        elif ctype == "gauge":
            if comp["max"] <= 0:
                return {
                    "ok": False,
                    "code": None,
                    "reason": "bound violation",
                    "pointer": f"/components/{i}/max",
                }
        elif ctype == "heatmap":
            ylen = len(comp["yLabels"])
            xlen = len(comp["xLabels"])
            if len(comp["cells"]) != ylen:
                return {
                    "ok": False,
                    "code": None,
                    "reason": "heatmap dimension mismatch",
                    "pointer": f"/components/{i}/cells",
                }
            for ri, row in enumerate(comp["cells"]):
                if len(row) != xlen:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "heatmap dimension mismatch",
                        "pointer": f"/components/{i}/cells/{ri}",
                    }
        elif ctype == "stacked_bar":
            seglen = len(comp["segments"])
            for ri, row in enumerate(comp["rows"]):
                if len(row["values"]) != seglen:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "stacked bar segment mismatch",
                        "pointer": f"/components/{i}/rows/{ri}/values",
                    }
        elif ctype == "radar_chart":
            axlen = len(comp["axes"])
            for si, s in enumerate(comp["series"]):
                if len(s["values"]) != axlen:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "radar axis mismatch",
                        "pointer": f"/components/{i}/series/{si}/values",
                    }
        elif ctype == "slo_burn":
            for wi, w in enumerate(comp["windows"]):
                if w["threshold"] <= 0:
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "bound violation",
                        "pointer": f"/components/{i}/windows/{wi}/threshold",
                    }
    return {"ok": True, "code": None, "reason": None, "pointer": ""}


def checkrawv2(rawbytes):
    try:
        payload = json.loads(rawbytes, parse_constant=validate.rejectconst)
    except (UnicodeDecodeError, ValueError):
        return {"ok": False, "code": None, "reason": "unparseable JSON", "pointer": ""}
    return checkv2(payload)


def main(args):
    jsonmode = False
    jsonlmode = False
    files = []
    for arg in args:
        if arg in ("-h", "--help"):
            print("usage: python3 tools/validate-v2.py [--json|--jsonl] FILE|- [FILE ...]")
            return 0
        if arg == "--json":
            jsonmode = True
        elif arg == "--jsonl":
            jsonlmode = True
        else:
            files.append(arg)
    if jsonlmode:
        bad = 0
        for line in sys.stdin.buffer:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                rawtext = json.loads(stripped)
                rawbytes = rawtext.encode("utf-8", errors="surrogatepass") if isinstance(rawtext, str) else stripped
            except (UnicodeDecodeError, ValueError):
                rawbytes = stripped
            got = checkrawv2(rawbytes)
            if not got["ok"]:
                bad += 1
            print(json.dumps(got, separators=(",", ":"), ensure_ascii=True))
        return 1 if bad else 0
    if not files:
        print("usage: python3 tools/validate-v2.py [--json|--jsonl] FILE|- [FILE ...]", file=sys.stderr)
        return 2
    bad = 0
    for path in files:
        rawbytes = sys.stdin.buffer.read() if path == "-" else open(path, "rb").read()
        got = checkrawv2(rawbytes)
        if not got["ok"]:
            bad += 1
        if jsonmode:
            rec = {"file": path}
            rec.update(got)
            print(json.dumps(rec, separators=(",", ":"), ensure_ascii=True))
        else:
            if got["ok"]:
                print(path + ": valid (v2)")
            else:
                tail = " at " + got["pointer"] if got["pointer"] else ""
                print(path + ": invalid code=" + (got["code"] or "none") + " reason=" + str(got["reason"]) + tail)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
