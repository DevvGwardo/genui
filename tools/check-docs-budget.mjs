#!/usr/bin/env node
// genui — docs/ image byte budget (plain Node, zero dependencies).
//
// Sums the byte sizes of every image committed under docs/ and fails when the
// total exceeds MAX_DOCS_IMAGE_BYTES.
//
// The budget is deliberately explicit (row D4): on 2026-10-17 the five docs/
// PNG originals measured 3,120,794 bytes, so the interim budget is 3,200,000
// bytes — under 3% of headroom, enough for an ordinary re-save, tight enough
// that any new full-size asset fails. E1 converts these PNGs to WebP and takes
// docs/ under ~800 KB; E1 must tighten this constant in its own change. This
// number must never be raised without a recorded justification in LOOPS.md.
//
// Usage:  node tools/check-docs-budget.mjs   (exit 0 = within budget)

import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");

const MAX_DOCS_IMAGE_BYTES = 3_200_000;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const MIN_IMAGES = 1; // sanity floor: an empty image set fails instead of passing vacuously

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sizes = walk(docs)
  .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
  .map((f) => ({ rel: path.relative(root, f).split(path.sep).join("/"), size: statSync(f).size }))
  .sort((a, b) => a.rel.localeCompare(b.rel));
const total = sizes.reduce((sum, f) => sum + f.size, 0);

console.log(`docs/ image budget: ${MAX_DOCS_IMAGE_BYTES.toLocaleString("en-US")} bytes`);
for (const f of sizes) console.log(`  ${f.rel}: ${f.size.toLocaleString("en-US")}`);
console.log(`  total: ${total.toLocaleString("en-US")} bytes (${((total / MAX_DOCS_IMAGE_BYTES) * 100).toFixed(1)}% of budget)`);

const problems = [];
if (sizes.length < MIN_IMAGES) {
  problems.push(`only ${sizes.length} image(s) under docs/ — expected at least ${MIN_IMAGES}`);
}
if (total > MAX_DOCS_IMAGE_BYTES) {
  problems.push(`docs/ images total ${total.toLocaleString("en-US")} bytes — over the ${MAX_DOCS_IMAGE_BYTES.toLocaleString("en-US")}-byte budget`);
}

if (problems.length === 0) {
  console.log(`PASS: docs/ images are within budget (${(MAX_DOCS_IMAGE_BYTES - total).toLocaleString("en-US")} bytes of headroom).`);
  process.exit(0);
}
for (const problem of problems) console.error(`FAIL: ${problem}`);
process.exit(1);
