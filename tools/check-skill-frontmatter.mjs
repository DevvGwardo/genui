#!/usr/bin/env node
// genui — SKILL.md frontmatter lint (plain Node, zero dependencies).
//
// Lints the YAML frontmatter of skills/genui/SKILL.md:
//   1. the file opens with a `---` delimiter and the block closes with one;
//   2. every top-level line in the block is a `key: value` entry (indented
//      lines belong to nested blocks and are not linted);
//   3. `name` is present, uses consistent quoting, and equals the skill
//      directory name (`skills/genui` must declare `name: genui`);
//   4. `description` is present, non-empty, a single-line value that uses
//      consistent quoting, and matches /genui/i — the B1 trigger-word
//      acceptance, now enforced mechanically.
//
// Usage:  node tools/check-skill-frontmatter.mjs   (exit 0 = lint clean)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "skills", "genui", "SKILL.md");
const rel = "skills/genui/SKILL.md";

const problems = [];
let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`FAIL: cannot read ${rel}`);
  process.exit(1);
}
const lines = text.split(/\r?\n/);

console.log(`skill frontmatter lint: ${rel}`);

let close = -1;
if (lines[0]?.trim() !== "---") {
  problems.push("frontmatter does not open with `---` on line 1");
} else {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) problems.push("frontmatter block never closes with a `---` line");
}

const entries = new Map(); // key -> { value, line }
if (close !== -1) {
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (/^\s/.test(line)) continue; // nested block line (e.g. metadata)
    const m = line.match(/^([A-Za-z0-9_-]+):(?:[ \t](.*))?$/);
    if (!m) {
      problems.push(`line ${i + 1}: not a top-level \`key: value\` entry: ${JSON.stringify(line)}`);
      continue;
    }
    if (entries.has(m[1])) {
      problems.push(`line ${i + 1}: duplicate top-level key \`${m[1]}\``);
      continue;
    }
    entries.set(m[1], { value: m[2] ?? "", line: i + 1 });
  }
  console.log(`  structure: ${close - 1} frontmatter lines, ${entries.size} top-level keys, closed at line ${close + 1}`);
}

function unquote(entry) {
  const raw = entry.value.trim();
  if (raw === "") return "";
  const quote = raw[0];
  if (quote === "'" || quote === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== quote) {
      problems.push(`line ${entry.line}: value opens with ${quote} but does not close with it`);
      return raw.slice(1);
    }
    const inner = raw.slice(1, -1);
    return quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  return raw;
}

const dir = path.basename(path.dirname(file));
if (!entries.has("name")) {
  problems.push("no `name` key in the frontmatter");
} else {
  const value = unquote(entries.get("name"));
  if (value !== dir) {
    problems.push(`name is ${JSON.stringify(value)} — must equal the skill directory ${JSON.stringify(dir)}`);
  } else {
    console.log(`  name: ${JSON.stringify(value)} matches directory ${JSON.stringify(dir)}`);
  }
}

if (!entries.has("description")) {
  problems.push("no `description` key in the frontmatter");
} else {
  const entry = entries.get("description");
  if (/^[>|][+-]?\d*$/.test(entry.value.trim())) {
    problems.push(`line ${entry.line}: description must be a single-line value, not a block scalar`);
  }
  const value = unquote(entry);
  if (value.trim() === "") {
    problems.push("description is empty");
  } else if (!/genui/i.test(value)) {
    problems.push("description does not match /genui/i (the B1 trigger word)");
  } else {
    console.log("  description: non-empty single-line value matching /genui/i");
  }
}

if (problems.length === 0) {
  console.log("PASS: frontmatter is well-formed.");
  process.exit(0);
}
for (const problem of problems) console.error(`FAIL: ${problem}`);
console.error(`FAIL: ${problems.length} frontmatter problem(s).`);
process.exit(1);
