#!/usr/bin/env python3
"""genui v1 payload validator (zero dependencies, Python 3 standard library only).

Validates a render_ui argument exactly against schema/v1.json: the JSON Schema
subset that file uses, the four widget types, and the three runtime-only rules
recorded in the schema $comment - the 16,384-byte cap, table row lengths equal
to the column count, and unique checklist ids within a component.

Usage:
    python3 tools/validate.py FILE [FILE ...]

Exit status: 0 when every file is valid; 1 when any file is invalid or cannot
be read; 2 on a usage error.

Output: one line per file -
    <file>: valid
    <file>: invalid code=<code> reason=<reason> at <pointer>
code is bad_args, too_large, or none. none means "rejected, but v1 docs name no
code for this rejection" (see docs/errors.md) - a code is never guessed.
"""
import json
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "v1.json"
CAP = 16384  # the byte cap from docs/contract.md; the schema $comment notes it too
CACHE = {}

with open(SCHEMA, encoding="utf-8") as fh:
    ROOT = json.loads(fh.read())


def kindof(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "null"


def same(left, right):
    if kindof(left) != kindof(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(same(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(same(left[k], right[k]) for k in left)
    return left == right


def matches(pattern, text):
    prog = CACHE.get(pattern)
    if prog is None:
        prog = re.compile(pattern)
        CACHE[pattern] = prog
    return prog.search(text) is not None


def resolve(ref, root):
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def add(out, pointer, keyword, text):
    out.append({"pointer": pointer, "keyword": keyword, "text": text})


def ok(value, sch, root):
    return not run(value, sch, root, "", [])


def run(value, sch, root, pointer, out):
    if "$ref" in sch:
        return run(value, resolve(sch["$ref"], root), root, pointer, out)
    if "const" in sch and not same(value, sch["const"]):
        add(out, pointer, "const", "must equal " + json.dumps(sch["const"]))
        return out
    if "type" in sch and kindof(value) != sch["type"]:
        add(out, pointer, "type", "expected " + sch["type"] + ", found " + kindof(value))
        return out
    if "allOf" in sch:
        for sub in sch["allOf"]:
            run(value, sub, root, pointer, out)
    if "anyOf" in sch:
        if not any(ok(value, sub, root) for sub in sch["anyOf"]):
            add(out, pointer, "anyOf", "does not match any allowed form")
    if "oneOf" in sch:
        subs = sch["oneOf"]
        disc = {}
        for sub in subs:
            tgt = resolve(sub["$ref"], root) if "$ref" in sub else sub
            want = tgt.get("properties", {}).get("type", {}).get("const")
            if want is not None:
                disc[want] = tgt
        if disc and len(disc) == len(subs):
            tag = value.get("type") if isinstance(value, dict) else None
            if tag in disc:
                run(value, disc[tag], root, pointer, out)
            else:
                add(
                    out,
                    pointer,
                    "discriminator",
                    "component type " + json.dumps(tag) + " is not one of " + ", ".join(disc),
                )
        else:
            hits = [sub for sub in subs if ok(value, sub, root)]
            if len(hits) != 1:
                add(out, pointer, "oneOf", "matched " + str(len(hits)) + " branches, expected exactly 1")
    if "not" in sch:
        if ok(value, sch["not"], root):
            add(out, pointer, "not", "matches a banned pattern")
    if isinstance(value, dict):
        props = sch.get("properties", {})
        for name in sch.get("required", []):
            if name not in value:
                add(out, pointer + "/" + name, "required", "missing " + name)
        if sch.get("additionalProperties") is False:
            for name in value:
                if name not in props:
                    add(out, pointer + "/" + name, "additionalProperties", "unexpected property " + name)
        for name, sub in props.items():
            if name in value:
                run(value[name], sub, root, pointer + "/" + name, out)
    if isinstance(value, list):
        if "minItems" in sch and len(value) < sch["minItems"]:
            add(out, pointer, "minItems", "needs at least " + str(sch["minItems"]) + " items")
        if "maxItems" in sch and len(value) > sch["maxItems"]:
            add(out, pointer, "maxItems", "allows at most " + str(sch["maxItems"]) + " items")
        if "items" in sch:
            for i, item in enumerate(value):
                run(item, sch["items"], root, pointer + "/" + str(i), out)
    if isinstance(value, str):
        if "minLength" in sch and len(value) < sch["minLength"]:
            add(out, pointer, "minLength", "needs at least " + str(sch["minLength"]) + " characters")
        if "maxLength" in sch and len(value) > sch["maxLength"]:
            add(out, pointer, "maxLength", "allows at most " + str(sch["maxLength"]) + " characters")
        if "pattern" in sch and not matches(sch["pattern"], value):
            add(out, pointer, "pattern", "does not match the required pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in sch and value < sch["minimum"]:
            add(out, pointer, "minimum", "must be at least " + str(sch["minimum"]))
        if "maximum" in sch and value > sch["maximum"]:
            add(out, pointer, "maximum", "must be at most " + str(sch["maximum"]))
    return out


def verdict(rec):
    kw = rec["keyword"]
    if kw == "const":
        if rec["pointer"] == "/version":
            return None, "unknown version"
        return "bad_args", "invalid type"
    table = {
        "discriminator": ("bad_args", "unknown widget type"),
        "additionalProperties": ("bad_args", "extra property"),
        "required": ("bad_args", "missing required field"),
        "type": ("bad_args", "invalid type"),
        "anyOf": ("bad_args", "invalid type"),
        "oneOf": ("bad_args", "invalid type"),
        "not": (None, "string filter"),
        "pattern": (None, "bound violation"),
        "minItems": (None, "bound violation"),
        "maxItems": (None, "bound violation"),
        "minLength": (None, "bound violation"),
        "maxLength": (None, "bound violation"),
        "minimum": (None, "bound violation"),
        "maximum": (None, "bound violation"),
    }
    return table.get(kw, (None, "unclassified keyword " + kw))


def check(payload):
    out = []
    run(payload, ROOT, ROOT, "", out)
    if out:
        rec = out[0]
        code, reason = verdict(rec)
        return {"ok": False, "code": code, "reason": reason, "pointer": rec["pointer"]}
    size = len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    if size > CAP:
        return {"ok": False, "code": "too_large", "reason": "over byte cap", "pointer": ""}
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
                return {"ok": False, "code": None, "reason": "duplicate id", "pointer": "/components/" + str(i)}
    return {"ok": True, "code": None, "reason": None, "pointer": ""}


def main(args):
    if args in ([], ["-h"], ["--help"]):
        print("usage: python3 tools/validate.py FILE [FILE ...]")
        return 2 if not args else 0
    bad = 0
    for path in args:
        try:
            with open(path, "rb") as fh:
                payload = json.loads(fh.read())
        except OSError as err:
            print(path + ": error: cannot read: " + str(err), file=sys.stderr)
            bad += 1
            continue
        except (UnicodeDecodeError, ValueError):
            print(path + ": invalid code=none reason=unparseable JSON")
            bad += 1
            continue
        got = check(payload)
        if got["ok"]:
            print(path + ": valid")
        else:
            tail = " at " + got["pointer"] if got["pointer"] else ""
            print(path + ": invalid code=" + (got["code"] or "none") + " reason=" + got["reason"] + tail)
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
