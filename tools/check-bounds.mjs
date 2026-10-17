#!/usr/bin/env node
// genui — bounds consistency checker (plain Node, zero dependencies).
//
// `docs/contract.md` is the single source of truth for every numeric and
// character bound of the v1 render_ui payload. This script extracts bound
// tokens from it and from `skills/genui/SKILL.md` and fails unless both files
// contain exactly the same multiset — counts matter, so a bound cannot be
// moved between fields undetected.
//
// Recognized phrasings (bounds stated only inside fenced code blocks are
// ignored, in both files):
//   "1 to 80 characters", "1–12 (items)"   -> range with unit
//   "at most 4 ... calls"                  -> capped count
//   "must not exceed 16,384 bytes"         -> byte cap
//   "[-1e12, 1e12]", "[0, 1e12]"           -> numeric interval
//   "^[a-zA-Z0-9_-]{1,40}$"                -> pattern quantifier
//   `"version": 1`                         -> version literal
//
// Usage:  node tools/check-bounds.mjs        (exit 0 = empty diff)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  "skills/genui/SKILL.md": path.join(root, "skills", "genui", "SKILL.md"),
  "docs/contract.md": path.join(root, "docs", "contract.md"),
};

// Sanity floor: if extraction silently breaks, fail loudly instead of
// "passing" by comparing two empty lists.
const MIN_TOKENS_PER_FILE = 15;

const UNIT =
  "(components?|characters?|chars?|items?|rows?|columns?|strings?|bytes?|calls?|cells?)";

const num = (s) => String(s).replace(/,/g, "");
const singular = (u) => {
  const s = u.toLowerCase();
  if (s.startsWith("char")) return "chars";
  return s.endsWith("s") ? s : s + "s";
};

function extract(text) {
  const doc = text.replace(/```[\s\S]*?```/g, "");
  const tokens = [];
  const add = (t) => tokens.push(t);

  for (const m of doc.matchAll(
    new RegExp(`(\\d[\\d,]*)\\s*(?:-|–|—|\\bto\\b)\\s*(\\d[\\d,]*)\\s*\\(?\\s*${UNIT}`, "gi")
  )) {
    add(`${num(m[1])}-${num(m[2])} ${singular(m[3])}`);
  }
  for (const m of doc.matchAll(/at most\s+(\d+)[^.;\n|]*?\bcalls?\b/gi)) {
    add(`<=${m[1]} calls`);
  }
  for (const m of doc.matchAll(/not exceed\s+\*{0,2}([\d,]+)\s+bytes/gi)) {
    add(`<=${num(m[1])} bytes`);
  }
  for (const m of doc.matchAll(/\[\s*(-?[\d.,eE+]+)\s*,\s*(-?[\d.,eE+]+)\s*\]/g)) {
    add(`num[${num(m[1])},${num(m[2])}]`);
  }
  for (const m of doc.matchAll(/\[[^\]\s]{1,64}\]\{(\d+),(\d+)\}/g)) {
    add(`pattern {${m[1]},${m[2]}}`);
  }
  for (const _ of doc.matchAll(/"version"\s*:\s*1(?![\d.])/g)) {
    add("version = 1");
  }
  return tokens;
}

const counts = (tokens) => {
  const map = new Map();
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
};

const sides = {};
let ok = true;
for (const [label, file] of Object.entries(FILES)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`FAIL: cannot read ${label}`);
    process.exit(1);
  }
  const tokens = extract(text);
  sides[label] = counts(tokens);
  console.log(`${label}: ${tokens.length} bound tokens`);
  if (tokens.length < MIN_TOKENS_PER_FILE) {
    console.error(
      `  FAIL: fewer than ${MIN_TOKENS_PER_FILE} tokens extracted — the extraction or the file is broken, not "consistent".`
    );
    ok = false;
  }
  for (const [token, count] of [...sides[label]].sort()) {
    console.log(`  ${count}× ${token}`);
  }
}

const labels = Object.keys(FILES);
const a = sides[labels[0]];
const b = sides[labels[1]];
const all = new Set([...a.keys(), ...b.keys()]);
console.log("");
console.log("bounds diff (left minus right):");
for (const token of [...all].sort()) {
  const delta = (a.get(token) ?? 0) - (b.get(token) ?? 0);
  if (delta > 0) {
    ok = false;
    console.log(`  ${labels[0]}-only ×${delta}: ${token}`);
  } else if (delta < 0) {
    ok = false;
    console.log(`  ${labels[1]}-only ×${-delta}: ${token}`);
  }
}
if (ok) {
  console.log(`PASS: bounds diff is empty — ${[...a.values()].reduce((x, y) => x + y, 0)} tokens match on both sides.`);
  process.exit(0);
}
console.error("FAIL: bound drift detected. Edit docs/contract.md and the caller together.");
process.exit(1);
