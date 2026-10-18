#!/usr/bin/env node
// genui — error-registry checker (plain Node, zero dependencies).
//
// `docs/errors.md` is the register of every error code this repo names. This
// script walks the repo's text files, extracts error-shaped tokens
// (lowercase underscore-separated identifiers, e.g. `bad_args`), and fails if
// any token is neither declared in a `docs/errors.md` table row nor a known
// interface identifier.
//
// Usage:  node tools/check-errors.mjs        (exit 0 = register is complete)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER = path.join(root, "docs", "errors.md");

const TOKEN = /\b[a-z]{3,}_[a-z]{3,}\b/g;
const TEXT_EXTENSIONS = new Set([".md", ".json", ".mjs", ".js", ".py", ".yml", ".yaml"]);
const SKIP_DIRS = new Set([".git", "node_modules"]);

// Identifiers that are not error codes: interface names, standard-library
// keywords, and well-known filesystem names. Keep this list short and boring;
// growing it should be a deliberate, reviewed act.
const NON_ERROR_TOKENS = new Set([
  "tool_search",
  "tool_describe",
  "tool_call",
  "bar_chart",
  "node_modules",
  // stdlib JSON keyword used by tools/validate.py for exact byte sizing
  "ensure_ascii",
  // internal function names in tools/validate.py (the astral-plane text filter)
  "astral_offender",
  "scan_astral",
  // GitHub Actions event keyword used by .github/workflows/ci.yml
  "pull_request",
]);

const MIN_DECLARED = 4; // sanity floor: the four canonical codes

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const tokensIn = (text) => [...text.matchAll(TOKEN)].map((m) => m[0]);

// Declared codes: tokens inside markdown table rows of the register.
const declared = new Set(
  readFileSync(REGISTER, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"))
    .flatMap(tokensIn)
);
for (const t of NON_ERROR_TOKENS) declared.delete(t);
if (declared.size < MIN_DECLARED) {
  console.error(
    `FAIL: ${rel(REGISTER)} declares only ${declared.size} codes — the register (or its table) is broken.`
  );
  process.exit(1);
}

let offenders = 0;
const seen = new Map();
for (const file of walk(root)) {
  let text = readFileSync(file, "utf8");
  if (file.endsWith(".md")) text = text.replace(/```[\s\S]*?```/g, "");
  const tokens = [...new Set(tokensIn(text))].sort();
  if (tokens.length === 0) continue;
  seen.set(rel(file), tokens);
  const undeclared = tokens.filter((t) => !declared.has(t) && !NON_ERROR_TOKENS.has(t));
  if (undeclared.length > 0) {
    offenders += undeclared.length;
    console.error(
      `FAIL: ${rel(file)} names ${undeclared.map((t) => `\`${t}\``).join(", ")} — not in ${rel(REGISTER)}.`
    );
  }
}

console.log(
  `register: ${declared.size} codes declared in ${rel(REGISTER)}: ${[...declared].sort().join(", ")}`
);
for (const [file, tokens] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${file}: ${tokens.join(", ")}`);
}
if (offenders === 0) {
  console.log(
    "PASS: every error-shaped token in the repo is declared in the register table (interface identifiers excepted)."
  );
  process.exit(0);
}
process.exit(1);
