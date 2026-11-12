#!/usr/bin/env python3
"""genui v1 payload validator (zero dependencies, Python 3 standard library only).

Validates a render_ui argument exactly against schema/v1.json: the JSON Schema
subset that file uses, the four widget types, and the runtime-only rules
recorded in the schema $comment - the astral-plane format characters that JSON
Schema cannot express portably, the 16,384-byte cap, table row lengths equal to
the column count, and unique checklist ids within a component.

Usage:
    python3 tools/validate.py [--json] FILE [FILE ...]
    python3 tools/validate.py --jsonl < input.jsonl

Exit status: 0 when every file is valid; 1 when any file is invalid or cannot
be read; 2 on a usage error.

Output: one line per file -
    <file>: valid
    <file>: invalid code=<code> reason=<reason> at <pointer>
code is bad_args, too_large, or none. none means "rejected, but v1 docs name no
code for this rejection" (see docs/errors.md) - a code is never guessed.
With --json, prints one JSON object per line with ok, code, reason, pointer,
and preflightRule mapped to SKILL.md's Pre-flight Self-check rules.
"""
import json
import math
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "v1.json"
CAP = 16384  # the byte cap from docs/contract.md; the schema $comment notes it too
MAXDEPTH = 32
CACHE = {}

# Astral-plane (above U+FFFF) format characters, rejected by the runtime text
# filter and by this validator. The schema's BMP character class cannot express
# them and ECMA-262 patterns without the u flag cannot match them portably, so
# schema/v1.json lists the ranges in a $comment and they are enforced here.
# Every range below is Unicode general category Cf (format) except where noted.
ASTRAL_FORMAT_RANGES = (
    (0x110BD, 0x110BD),  # KAITHI NUMBER SIGN
    (0x110CD, 0x110CD),  # KAITHI NUMBER SIGN ABOVE
    (0x13430, 0x1343F),  # EGYPTIAN HIEROGLYPH format controls
    (0x1BCA0, 0x1BCA3),  # SHORTHAND FORMAT controls
    (0x1D173, 0x1D17A),  # MUSICAL SYMBOL format controls
    (0xE0001, 0xE0001),  # LANGUAGE TAG
    (0xE0020, 0xE007F),  # TAG characters (U+E0020-U+E007E tags, U+E007F cancel)
)

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


def escptr(token):
    return str(token).replace("~", "~0").replace("/", "~1")


def ptrjoin(base, token):
    return base + "/" + escptr(token)


def rejectconst(token):
    raise ValueError("non-finite JSON constant: " + token)


def depthcheck(rootval):
    stack = [(rootval, 0, "")]
    while stack:
        val, depth, ptr = stack.pop()
        if depth > MAXDEPTH:
            return ptr
        if isinstance(val, dict):
            for k in reversed(list(val.keys())):
                stack.append((val[k], depth + 1, ptrjoin(ptr, k)))
        elif isinstance(val, list):
            for i in range(len(val) - 1, -1, -1):
                stack.append((val[i], depth + 1, ptrjoin(ptr, i)))
    return None


def matches(pattern, text):
    prog = CACHE.get(pattern)
    if prog is None:
        if pattern.startswith("^") and pattern.endswith("$"):
            prog = re.compile(r"\A" + pattern[1:-1] + r"\Z")
        else:
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
            if not isinstance(value, dict):
                add(out, pointer, "type", "expected object, found " + kindof(value))
            elif "type" not in value:
                add(out, ptrjoin(pointer, "type"), "required", "missing type")
            else:
                tag = value["type"]
                if not isinstance(tag, str):
                    add(out, ptrjoin(pointer, "type"), "type", "expected string, found " + kindof(tag))
                elif tag in disc:
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
                add(out, ptrjoin(pointer, name), "required", "missing " + name)
        if sch.get("additionalProperties") is False:
            for name in value:
                if name not in props:
                    add(out, ptrjoin(pointer, name), "additionalProperties", "unexpected property " + name)
        for name, sub in props.items():
            if name in value:
                run(value[name], sub, root, ptrjoin(pointer, name), out)
    if isinstance(value, list):
        if "minItems" in sch and len(value) < sch["minItems"]:
            add(out, pointer, "minItems", "needs at least " + str(sch["minItems"]) + " items")
        if "maxItems" in sch and len(value) > sch["maxItems"]:
            add(out, pointer, "maxItems", "allows at most " + str(sch["maxItems"]) + " items")
        if "items" in sch:
            for i, item in enumerate(value):
                run(item, sch["items"], root, ptrjoin(pointer, i), out)
    if isinstance(value, str):
        if "minLength" in sch and len(value) < sch["minLength"]:
            add(out, pointer, "minLength", "needs at least " + str(sch["minLength"]) + " characters")
        if "maxLength" in sch and len(value) > sch["maxLength"]:
            add(out, pointer, "maxLength", "allows at most " + str(sch["maxLength"]) + " characters")
        if "pattern" in sch and not matches(sch["pattern"], value):
            add(out, pointer, "pattern", "does not match the required pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not math.isfinite(value):
            add(out, pointer, "notFinite", "must be finite")
        else:
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
        "notFinite": (None, "bound violation"),
        "pattern": (None, "bound violation"),
        "minItems": (None, "bound violation"),
        "maxItems": (None, "bound violation"),
        "minLength": (None, "bound violation"),
        "maxLength": (None, "bound violation"),
        "minimum": (None, "bound violation"),
        "maximum": (None, "bound violation"),
    }
    return table.get(kw, (None, "unclassified keyword " + kw))


def preflight(kw, reason, pointer):
    if reason == "unparseable JSON":
        return None
    if reason == "over byte cap":
        return "The serialized payload is within the byte cap"
    if reason == "row length mismatch":
        return "Every table row has exactly as many cells as columns"
    if reason == "duplicate id":
        return "Checklist ids match the id pattern and are unique within their component"
    if reason == "string filter" or kw == "not":
        return "No string contains angle brackets, URI schemes, protocol-relative paths, or control/format/bidi/line characters"
    if reason == "unknown version" or pointer == "/version":
        return "version is exactly 1"
    if pointer.endswith("/id") and pointer.startswith("/components/"):
        return "Checklist ids match the id pattern and are unique within their component"
    if kw == "discriminator" or (kw == "type" and pointer.endswith("/type")):
        return "Every type is one of stat, table, bar_chart, checklist"
    if kw == "additionalProperties":
        if pointer.count("/") == 1:
            return "Root keys are only version and components"
        return "Every component has type and title, plus its widget's required fields"
    if kw == "required":
        if pointer == "/version":
            return "version is exactly 1"
        if pointer == "/components":
            return "Component count is within the call cap"
        return "Every component has type and title, plus its widget's required fields"
    if pointer == "/components" and kw in ("minItems", "maxItems", "type"):
        return "Component count is within the call cap"
    if kw in ("minLength", "maxLength", "pattern"):
        return "Every string is non-empty, not whitespace-only, and within its length cap"
    if kw in ("minimum", "maximum", "notFinite"):
        return "Numbers are finite and within their ranges"
    if pointer == "" and kw == "type":
        return "Root keys are only version and components"
    return "Every component has type and title, plus its widget's required fields"


def astral_offender(text):
    """Return the first astral-plane format character or lone surrogate in text, or None."""
    for ch in text:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            return cp
        if cp < 0x10000:
            continue
        for lo, hi in ASTRAL_FORMAT_RANGES:
            if lo <= cp <= hi:
                return cp
    return None


def scan_astral(value, pointer, out):
    """Collect astral-plane format-character and lone-surrogate violations with JSON pointers."""
    if isinstance(value, str):
        cp = astral_offender(value)
        if cp is not None:
            add(out, pointer, "not", "astral or surrogate character U+%04X" % cp)
    elif isinstance(value, dict):
        for name, sub in value.items():
            scan_astral(sub, ptrjoin(pointer, name), out)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            scan_astral(item, ptrjoin(pointer, i), out)


def check(payload):
    deep = depthcheck(payload)
    if deep is not None:
        return {
            "ok": False,
            "code": "bad_args",
            "reason": "invalid type",
            "pointer": deep,
            "preflightRule": preflight("type", "invalid type", deep),
        }
    out = []
    run(payload, ROOT, ROOT, "", out)
    if out:
        rec = out[0]
        code, reason = verdict(rec)
        return {
            "ok": False,
            "code": code,
            "reason": reason,
            "pointer": rec["pointer"],
            "preflightRule": preflight(rec["keyword"], reason, rec["pointer"]),
        }
    astral = []
    scan_astral(payload, "", astral)
    if astral:
        # Same rejection class as the schema's BMP filter: documented in
        # docs/contract.md, no code named in v1 docs, so code=none.
        return {
            "ok": False,
            "code": None,
            "reason": "string filter",
            "pointer": astral[0]["pointer"],
            "preflightRule": preflight("not", "string filter", astral[0]["pointer"]),
        }
    try:
        size = len(
            json.dumps(
                payload,
                separators=(",", ":"),
                ensure_ascii=False,
                allow_nan=False,
            ).encode("utf-8")
        )
    except UnicodeEncodeError:
        return {
            "ok": False,
            "code": None,
            "reason": "string filter",
            "pointer": "",
            "preflightRule": preflight("not", "string filter", ""),
        }
    except ValueError:
        return {
            "ok": False,
            "code": None,
            "reason": "bound violation",
            "pointer": "",
            "preflightRule": preflight("notFinite", "bound violation", ""),
        }
    if size > CAP:
        return {
            "ok": False,
            "code": "too_large",
            "reason": "over byte cap",
            "pointer": "",
            "preflightRule": preflight(None, "over byte cap", ""),
        }
    for i, comp in enumerate(payload["components"]):
        if comp["type"] == "table":
            width = len(comp["columns"])
            for ri, row in enumerate(comp["rows"]):
                if len(row) != width:
                    ptr = "/components/" + str(i) + "/rows/" + str(ri)
                    return {
                        "ok": False,
                        "code": None,
                        "reason": "row length mismatch",
                        "pointer": ptr,
                        "preflightRule": preflight(None, "row length mismatch", ptr),
                    }
        if comp["type"] == "checklist":
            ids = [item["id"] for item in comp["items"]]
            if len(set(ids)) != len(ids):
                ptr = "/components/" + str(i)
                return {
                    "ok": False,
                    "code": None,
                    "reason": "duplicate id",
                    "pointer": ptr,
                    "preflightRule": preflight(None, "duplicate id", ptr),
                }
    return {"ok": True, "code": None, "reason": None, "pointer": "", "preflightRule": None}


def checkraw(rawbytes):
    try:
        payload = json.loads(rawbytes, parse_constant=rejectconst)
    except RecursionError:
        return {
            "ok": False,
            "code": "bad_args",
            "reason": "invalid type",
            "pointer": "",
            "preflightRule": preflight("type", "invalid type", ""),
        }
    except (UnicodeDecodeError, ValueError):
        return {
            "ok": False,
            "code": None,
            "reason": "unparseable JSON",
            "pointer": "",
            "preflightRule": None,
        }
    return check(payload)


def main(args):
    jsonmode = False
    jsonlmode = False
    files = []
    for arg in args:
        if arg in ("-h", "--help") and not files and not jsonmode and not jsonlmode:
            print("usage: python3 tools/validate.py [--json] FILE [FILE ...]")
            return 0
        if arg == "--json" and not files and not jsonlmode:
            jsonmode = True
        elif arg == "--jsonl" and not files and not jsonmode:
            jsonlmode = True
        elif arg.startswith("-") and arg != "-":
            print("usage: python3 tools/validate.py [--json] FILE [FILE ...]", file=sys.stderr)
            return 2
        else:
            files.append(arg)
    if jsonlmode:
        if files:
            print("usage: python3 tools/validate.py --jsonl", file=sys.stderr)
            return 2
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
            got = checkraw(rawbytes)
            if not got["ok"]:
                bad += 1
            print(json.dumps(got, separators=(",", ":"), ensure_ascii=True))
        return 1 if bad else 0
    if not files:
        print("usage: python3 tools/validate.py FILE [FILE ...]")
        return 2
    bad = 0
    for path in files:
        try:
            with open(path, "rb") as fh:
                rawbytes = fh.read()
        except OSError as err:
            if jsonmode:
                rec = {
                    "file": path,
                    "ok": False,
                    "code": None,
                    "reason": "cannot read: " + str(err),
                    "pointer": "",
                    "preflightRule": None,
                }
                print(json.dumps(rec, separators=(",", ":"), ensure_ascii=True))
            else:
                print(path + ": error: cannot read: " + str(err), file=sys.stderr)
            bad += 1
            continue
        got = checkraw(rawbytes)
        if not got["ok"]:
            bad += 1
        if jsonmode:
            rec = {"file": path}
            rec.update(got)
            print(json.dumps(rec, separators=(",", ":"), ensure_ascii=True))
        else:
            if got["ok"]:
                print(path + ": valid")
            else:
                tail = " at " + got["pointer"] if got["pointer"] else ""
                print(path + ": invalid code=" + (got["code"] or "none") + " reason=" + got["reason"] + tail)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
