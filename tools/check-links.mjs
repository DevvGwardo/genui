#!/usr/bin/env node
// genui — relative link and anchor checker (plain Node, zero dependencies).
//
// Scans the committed product docs — every *.md file in the repo except the
// LOOPS.md process queue, which is working state rather than a product surface
// — for markdown links/images and HTML href/src attributes:
//
//   - external targets (a URI scheme such as https:, or a protocol-relative
//     //host path) are skipped: the check is offline by design;
//   - every relative path target must exist relative to the file that links
//     it (file or directory);
//   - every `#anchor` target must resolve to a heading in its target file
//     under GitHub slug rules — lowercase, drop everything except letters,
//     numbers, marks, spaces, `-` and `_`, then spaces to `-`; repeated
//     headings get `-1`, `-2`, ... suffixes (anchors are compared lowercase).
//
// Fenced code blocks and inline code spans are stripped before extraction, so
// examples of link syntax inside docs are not checked; anchors on non-Markdown
// targets are not resolved (nothing to resolve against).
//
// Usage:  node tools/check-links.mjs   (exit 0 = every relative link resolves)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules"]);
const CANDIDATE = /!?\[[^\]]*\]\(([^)]+)\)|(?:href|src)\s*=\s*["']([^"']+)["']/gi;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function clean(raw) {
  let t = raw.trim();
  if (t.startsWith("<") && t.endsWith(">")) return t.slice(1, -1);
  return t.split(/\s+/)[0];
}

function candidates(text) {
  const out = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const codeLess = line.replace(/`[^`]*`/g, "");
    for (const m of codeLess.matchAll(CANDIDATE)) {
      const raw = m[1] ?? m[2];
      if (raw !== undefined && raw !== "") out.push({ target: clean(raw), line: i + 1 });
    }
  });
  return out;
}

const slugCache = new Map();
function slugsFor(absFile) {
  if (!slugCache.has(absFile)) {
    const set = new Set();
    const counts = new Map();
    let fence = false;
    for (const line of readFileSync(absFile, "utf8").split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (!m) continue;
      const title = m[1]
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/[*_~]/g, "")
        .trim();
      const base = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, "").replace(/ /g, "-");
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      set.add(n === 0 ? base : `${base}-${n}`);
    }
    slugCache.set(absFile, set);
  }
  return slugCache.get(absFile);
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const files = walk(root)
  .map((f) => path.relative(root, f).split(path.sep).join("/"))
  .filter((f) => f !== "LOOPS.md")
  .sort();

let relative = 0;
let anchors = 0;
let external = 0;
let violations = 0;

for (const relFile of files) {
  const absFile = path.join(root, relFile);
  for (const c of candidates(readFileSync(absFile, "utf8"))) {
    const target = c.target;
    if (target === "") {
      violations++;
      console.error(`FAIL: ${relFile}:${c.line} -> empty link target`);
      continue;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith("//")) {
      external++;
      continue;
    }

    let frag = "";
    let dest = target;
    const hash = target.indexOf("#");
    if (hash !== -1) {
      frag = target.slice(hash + 1);
      dest = target.slice(0, hash);
    }

    let relDest = relFile;
    if (dest !== "") {
      const abs = path.resolve(path.dirname(absFile), decode(dest));
      const shown = path.relative(root, abs).split(path.sep).join("/");
      if (!existsSync(abs)) {
        violations++;
        console.error(`FAIL: ${relFile}:${c.line} -> ${target} — no such path (${shown})`);
        continue;
      }
      relDest = shown;
      relative++;
      if (frag !== "" && (statSync(abs).isDirectory() || !relDest.endsWith(".md"))) continue;
    }

    if (frag !== "") {
      anchors++;
      if (!slugsFor(path.join(root, relDest)).has(decode(frag).toLowerCase())) {
        violations++;
        console.error(`FAIL: ${relFile}:${c.line} -> ${target} — no heading in ${relDest} has anchor #${frag}`);
      }
    }
  }
}

console.log(`link check: ${files.length} markdown file(s) scanned`);
console.log(`  relative targets: ${relative} checked, ${external} external skipped`);
console.log(`  anchors: ${anchors} checked`);
if (violations === 0) {
  console.log("PASS: every relative link and anchor resolves (offline check; external URLs skipped).");
  process.exit(0);
}
console.error(`FAIL: ${violations} broken link(s).`);
process.exit(1);
