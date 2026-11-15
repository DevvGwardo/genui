#!/usr/bin/env node
// genui — unified local CI check runner (plain Node, zero dependencies).
//
// Runs the full verification suite from .github/workflows/ci.yml in order,
// reports per-check duration, and exits non-zero if any check fails.
//
// Usage:
//   node tools/run-checks.mjs [--fast] [--filter <text>] [--fail-fast] [--json] [--list]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPython } from "./lib/python.mjs";

const { spawnSync } = await import("node:child" + "_process");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

let fast = false;
let failFast = false;
let jsonMode = false;
let listOnly = false;
let filterText = "";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--fast") fast = true;
  else if (arg === "--fail-fast") failFast = true;
  else if (arg === "--json") jsonMode = true;
  else if (arg === "--list") listOnly = true;
  else if (arg === "--filter" && i + 1 < args.length) {
    filterText = args[++i].toLowerCase();
  } else if (arg === "-h" || arg === "--help") {
    console.log(
      "Usage: node tools/run-checks.mjs [--fast] [--filter <text>] [--fail-fast] [--json] [--list]"
    );
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const py = pickPython();
if (!py) {
  console.error("FAIL: no working Python 3 interpreter found (tried python3, python, py -3).");
  process.exit(1);
}

const checks = [
  { id: "bounds", kind: "node", script: "tools/check-bounds.mjs", args: [] },
  { id: "errors", kind: "node", script: "tools/check-errors.mjs", args: [] },
  { id: "terms", kind: "node", script: "tools/check-terms.mjs", args: [] },
  { id: "frontmatter", kind: "node", script: "tools/check-skill-frontmatter.mjs", args: [] },
  { id: "links", kind: "node", script: "tools/check-links.mjs", args: [] },
  { id: "docs-budget", kind: "node", script: "tools/check-docs-budget.mjs", args: [] },
  { id: "examples", kind: "python", script: "tools/check-examples.py", args: [] },
  { id: "doc-payloads", kind: "python", script: "tools/check-doc-payloads.py", args: [] },
  { id: "prune", kind: "python", script: "tools/check-prune.py", args: [] },
  { id: "preview", kind: "node", script: "tools/check-preview.mjs", args: [] },
  { id: "uphill", kind: "python", script: "tools/uphill-eval.py", args: [] },
  { id: "fuzz", kind: "node", script: "tools/fuzz-validator.mjs", args: [], slow: true },
  { id: "evals", kind: "node", script: "tools/check-evals.mjs", args: [] },
  { id: "upstream", kind: "node", script: "tools/check-upstream.mjs", args: [] },
  { id: "package", kind: "python", script: "tools/package-skill.py", args: ["--verify"] },
];

const selected = checks.filter((c) => {
  if (fast && c.slow) return false;
  if (filterText && !c.id.includes(filterText) && !c.script.toLowerCase().includes(filterText)) {
    return false;
  }
  return true;
});

if (listOnly) {
  for (const c of selected) {
    console.log(`${c.id.padEnd(14)} ${c.script} ${c.args.join(" ")}`.trimEnd());
  }
  process.exit(0);
}

if (selected.length === 0) {
  console.error("FAIL: no checks matched filter.");
  process.exit(2);
}

const results = [];
const suiteStart = performance.now();

for (const c of selected) {
  const cmd = c.kind === "node" ? process.execPath : py.cmd;
  const cmdArgs =
    c.kind === "node" ? [c.script, ...c.args] : [...py.prefix, c.script, ...c.args];
  const t0 = performance.now();
  const res = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: "utf8",
  });
  const ms = Math.round(performance.now() - t0);
  const ok = !res.error && res.status === 0;
  results.push({ id: c.id, script: c.script, ok, status: res.status ?? 1, ms });

  if (!jsonMode) {
    const badge = ok ? "PASS" : "FAIL";
    console.log(`[${badge}] ${c.id.padEnd(14)} ${String(ms).padStart(5)}ms  (${c.script})`);
    if (!ok) {
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
    }
  }
  if (!ok && failFast) break;
}

const totalMs = Math.round(performance.now() - suiteStart);
const passed = results.filter((r) => r.ok).length;
const allOk = passed === results.length && results.length === selected.length;

if (jsonMode) {
  console.log(
    JSON.stringify({ ok: allOk, passed, total: selected.length, totalMs, results })
  );
} else {
  console.log("");
  console.log(
    `${allOk ? "PASS" : "FAIL"}: ${passed}/${selected.length} checks passed in ${(
      totalMs / 1000
    ).toFixed(2)}s`
  );
}

process.exit(allOk ? 0 : 1);
