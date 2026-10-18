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
// Third side: `schema/v1.json` is also diffed against `docs/contract.md`, so a
// bound can no longer drift into the schema unnoticed (the two-way table check
// below covers contract.md <-> SKILL.md only). The schema comparison is
// set-based, because the contract table deliberately collapses repeated bounds
// (one "every component title" row covers four schema properties); multiplicity
// stays covered by the SKILL.md multiset diff. Two contract tokens are excluded
// by CONTRACT_ONLY because they are not payload-content constraints.
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
const SCHEMA_FILE = path.join(root, "schema", "v1.json");

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

// --- schema/v1.json side ---------------------------------------------------
// Map a schema key that carries an items bound to the unit word the contract
// table uses for it. Keys absent from this map contribute no items bound.
const ITEM_UNIT = { components: "components", columns: "strings", rows: "rows", items: "items" };

// Bounds stated in docs/contract.md that are deliberately NOT in the schema:
// the byte cap and the per-turn call cap are runtime/conversation rules, not
// payload-content constraints (the schema $comment says so for the byte cap;
// the call cap is not part of a single payload at all).
const CONTRACT_ONLY = new Set(["<=16384 bytes", "<=4 calls"]);

const numToken = (value) => {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1e12) return `${value / 1e12}e12`;
  return String(value);
};

function extractSchema(node, name, out) {
  if (Array.isArray(node)) {
    for (const item of node) extractSchema(item, name, out);
    return out;
  }
  if (node === null || typeof node !== "object") return out;

  if (typeof node.minItems === "number" && typeof node.maxItems === "number" && ITEM_UNIT[name]) {
    out.push(`${node.minItems}-${node.maxItems} ${ITEM_UNIT[name]}`);
  }
  if (typeof node.maxLength === "number") {
    out.push(`1-${node.maxLength} chars`);
  }
  if (typeof node.minimum === "number" && typeof node.maximum === "number") {
    out.push(`num[${numToken(node.minimum)},${numToken(node.maximum)}]`);
  }
  if (name === "version" && node.const === 1) {
    out.push("version = 1");
  }
  if (typeof node.pattern === "string") {
    const m = node.pattern.match(/\[[^\]\s]{1,64}\]\{(\d+),(\d+)\}/);
    if (m) out.push(`pattern {${m[1]},${m[2]}}`);
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(node[key])) extractSchema(node[key], name, out);
  }
  if (node.items !== undefined) extractSchema(node.items, name, out);
  for (const bag of ["properties", "$defs"]) {
    if (node[bag] && typeof node[bag] === "object") {
      for (const [key, sub] of Object.entries(node[bag])) extractSchema(sub, key, out);
    }
  }
  return out;
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
} else {
  console.error("FAIL: bound drift detected. Edit docs/contract.md and the caller together.");
}

// --- third side: schema/v1.json vs docs/contract.md -------------------------
let schema;
try {
  schema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
} catch (err) {
  console.error(`FAIL: cannot read or parse schema/v1.json: ${err.message}`);
  process.exit(1);
}

const schemaTokens = [...new Set(extractSchema(schema, undefined, []))].sort();
const contractTokens = new Set([...sides["docs/contract.md"].keys()].filter((t) => !CONTRACT_ONLY.has(t)));
const schemaSet = new Set(schemaTokens);

console.log("");
console.log(`schema/v1.json: ${schemaTokens.length} distinct bound token(s)`);
const contractOnly = [...contractTokens].filter((t) => !schemaSet.has(t)).sort();
const schemaOnly = [...schemaSet].filter((t) => !contractTokens.has(t)).sort();
if (contractOnly.length > 0) {
  ok = false;
  console.error("  in docs/contract.md but not in schema/v1.json:");
  for (const t of contractOnly) console.error(`    ${t}`);
}
if (schemaOnly.length > 0) {
  ok = false;
  console.error("  in schema/v1.json but not in docs/contract.md:");
  for (const t of schemaOnly) console.error(`    ${t}`);
}
if (contractOnly.length === 0 && schemaOnly.length === 0) {
  console.log(
    `PASS: schema/v1.json agrees with docs/contract.md on all ${schemaTokens.length} bounds ` +
      `(${CONTRACT_ONLY.size} contract-only tokens excluded: ${[...CONTRACT_ONLY].join(", ")}).`
  );
} else {
  console.error("FAIL: schema/contract bound drift. Fix schema/v1.json or the contract table — never silently widen a bound.");
}

process.exit(ok ? 0 : 1);
