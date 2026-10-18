#!/usr/bin/env node
// genui — terminology checker (plain Node, zero dependencies).
//
// `docs/terminology.md` is the decision record. This script enforces it:
//   1. the decision record must name every banned variant listed below;
//   2. none of the banned variants may appear in README.md,
//      skills/genui/SKILL.md or docs/**.md — except the decision record
//      itself and explicitly allowed historical contexts (see `allowLine`);
//   3. canonical anchors must stay present where they matter.
//
// Usage:  node tools/check-terms.mjs        (exit 0 = no terminology drift)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DECISION_DOC = "docs/terminology.md";

const RULES = [
  { term: "GenUI", pattern: /GenUI/g, why: "product-name drift; use `genui` or Generated UI" },
  { term: "GenUI Protocol", pattern: /GenUI Protocol/gi, why: "no such protocol is defined" },
  {
    term: "Hermes Desk profile",
    pattern: /Hermes Desk profiles?/gi,
    why: "profiles belong to Hermes Agent",
  },
  {
    term: "hermes_desk_render_ui",
    pattern: /hermes_desk_render_ui/g,
    why: "early research name; allowed only in the historical note",
    allowLine: /early research name/,
  },
];

const ANCHORS = [
  {
    file: "README.md",
    must: ["Hermes Agent", "Hermes Desk", "Generated UI · Agent-provided data, not verified"],
  },
  {
    file: "skills/genui/SKILL.md",
    must: ["Hermes Desk", "Generated UI · Agent-provided data, not verified"],
  },
];

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const scanFiles = [
  path.join(root, "README.md"),
  path.join(root, "skills", "genui", "SKILL.md"),
  ...mdFilesUnder(path.join(root, "docs")),
].filter((f) => rel(f) !== DECISION_DOC);

let failed = false;

let decisionText;
try {
  decisionText = readFileSync(path.join(root, DECISION_DOC), "utf8");
} catch {
  console.error(`FAIL: ${DECISION_DOC} is missing — there is no decision record to enforce.`);
  process.exit(1);
}
for (const rule of RULES) {
  if (!decisionText.includes(rule.term)) {
    console.error(`FAIL: ${DECISION_DOC} does not document banned variant "${rule.term}".`);
    failed = true;
  }
}

console.log(`decision record: ${DECISION_DOC} (${RULES.length} banned variants documented)`);
console.log(`scan surface: ${scanFiles.map(rel).join(", ")}`);

const scanText = new Map(scanFiles.map((f) => [f, readFileSync(f, "utf8")]));

for (const rule of RULES) {
  let violations = 0;
  let allowed = 0;
  for (const [file, text] of scanText) {
    text.split(/\r?\n/).forEach((line, i) => {
      const matches = line.match(rule.pattern);
      if (!matches) return;
      if (rule.allowLine && rule.allowLine.test(line)) {
        allowed += matches.length;
        return;
      }
      violations += matches.length;
      console.error(`FAIL: ${rel(file)}:${i + 1} uses "${rule.term}" (${rule.why})`);
    });
  }
  console.log(
    `  banned "${rule.term}": ${violations} violation(s)` +
      (allowed ? `, ${allowed} allowed historical occurrence(s)` : "")
  );
  if (violations > 0) failed = true;
}

for (const anchor of ANCHORS) {
  const text = scanText.get(path.join(root, anchor.file)) ?? "";
  const missing = anchor.must.filter((s) => !text.includes(s));
  if (missing.length > 0) {
    console.error(
      `FAIL: ${anchor.file} is missing canonical anchor(s): ${missing.map((s) => `"${s}"`).join(", ")}.`
    );
    failed = true;
  } else {
    console.log(`  anchors ok: ${anchor.file} (${anchor.must.length}/${anchor.must.length})`);
  }
}

if (!failed) {
  console.log("PASS: no terminology drift — banned variants absent, canonical anchors present.");
  process.exit(0);
}
process.exit(1);
