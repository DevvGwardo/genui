#!/usr/bin/env python3
"""genui - reproducible skill packager (zero dependencies, Python 3 stdlib only).

Builds a deterministic `dist/genui-skill.zip` and `dist/genui-skill.zip.sha256`
from `skills/genui/`, using fixed timestamps, normalized Unix permissions, and
sorted archive paths while excluding `__pycache__`, `*.pyc`, `.DS_Store`, and
`evals/`.

Usage:
  python3 tools/package-skill.py
  python3 tools/package-skill.py --verify
"""
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "skills" / "genui"
DIST = ROOT / "dist"
ZIPNAME = "genui-skill.zip"
SHANAME = "genui-skill.zip.sha256"
FIXEDTIME = (2020, 1, 1, 0, 0, 0)
EXCLUDED_PARTS = {"__pycache__", ".DS_Store", "evals", ".git", "node_modules"}


def excluded(rel):
    for part in rel.parts:
        if part in EXCLUDED_PARTS:
            return True
    return rel.name.endswith(".pyc")


def collect(srcdir):
    if not srcdir.is_dir():
        raise FileNotFoundError(f"Missing skill directory: {srcdir}")
    items = []
    for dirpath, dirnames, filenames in os.walk(srcdir):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_PARTS)
        for name in sorted(filenames):
            full = Path(dirpath) / name
            rel = full.relative_to(srcdir)
            if not excluded(rel):
                items.append((rel, full))
    items.sort(key=lambda pair: pair[0].as_posix())
    return items


def build(items, target):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, full in items:
            arcname = f"genui/{rel.as_posix()}"
            zi = zipfile.ZipInfo(arcname, FIXEDTIME)
            zi.create_system = 3
            zi.external_attr = 0o644 << 16
            with open(full, "rb") as fh:
                data = fh.read()
            zf.writestr(zi, data, zipfile.ZIP_DEFLATED)


def sha256of(raw):
    return hashlib.sha256(raw).hexdigest()


def verify(items, zippath, shapath):
    with open(zippath, "rb") as fh:
        zipbytes = fh.read()
    digest = sha256of(zipbytes)

    with open(shapath, "r", encoding="utf-8") as fh:
        shatext = fh.read().strip()
    expected = f"{digest}  {zippath.name}"
    if shatext != expected:
        raise AssertionError(f"SHA-256 mismatch: expected {expected!r}, got {shatext!r}")

    buf = io.BytesIO()
    build(items, buf)
    if sha256of(buf.getvalue()) != digest:
        raise AssertionError("Reproducibility check failed: second build produced a different digest")

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        with zipfile.ZipFile(zippath, "r") as zf:
            for name in zf.namelist():
                if any(part in EXCLUDED_PARTS for part in Path(name).parts) or name.endswith(".pyc"):
                    raise AssertionError(f"Excluded artifact present in zip: {name}")
            zf.extractall(tmpdir)

        skillmd = tmpdir / "genui" / "SKILL.md"
        if not skillmd.is_file():
            raise AssertionError("Extracted zip is missing genui/SKILL.md")

        with open(SOURCE / "SKILL.md", "rb") as fh:
            srcbytes = fh.read()
        with open(skillmd, "rb") as fh:
            outbytes = fh.read()
        if srcbytes != outbytes:
            raise AssertionError("Extracted genui/SKILL.md does not match skills/genui/SKILL.md")

        for rel, full in items:
            extracted = tmpdir / "genui" / rel
            if not extracted.is_file():
                raise AssertionError(f"Extracted zip is missing genui/{rel.as_posix()}")
            with open(full, "rb") as fh1, open(extracted, "rb") as fh2:
                if fh1.read() != fh2.read():
                    raise AssertionError(f"Content mismatch for genui/{rel.as_posix()}")

    return digest, len(zipbytes), len(items)


def main():
    args = sys.argv[1:]
    verifyFlag = False
    outdir = DIST
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--verify":
            verifyFlag = True
        elif arg == "--outdir" and i + 1 < len(args):
            i += 1
            outdir = Path(args[i])
        elif arg in ("-h", "--help"):
            print("Usage: python3 tools/package-skill.py [--verify] [--outdir <dir>]")
            return 0
        else:
            print(f"Unknown argument: {arg}", file=sys.stderr)
            return 1
        i += 1

    items = collect(SOURCE)
    if not any(rel.as_posix() == "SKILL.md" for rel, _ in items):
        print("FAIL: skills/genui/SKILL.md not found", file=sys.stderr)
        return 1

    outdir.mkdir(parents=True, exist_ok=True)
    zippath = outdir / ZIPNAME
    shapath = outdir / SHANAME

    build(items, zippath)
    with open(zippath, "rb") as fh:
        digest = sha256of(fh.read())
    with open(shapath, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(f"{digest}  {ZIPNAME}\n")

    print(f"packaged {len(items)} file(s) -> {zippath} ({digest[:12]}...)")

    if verifyFlag:
        verified, size, count = verify(items, zippath, shapath)
        print(f"PASS: verified {count} file(s), {size} bytes, sha256={verified}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
