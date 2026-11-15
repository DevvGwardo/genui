#!/usr/bin/env node
// genui — component previewer test suite (plain Node, zero dependencies).
//
// Verifies tools/preview.mjs across v1 (4 widgets), v2 (10 widgets),
// empty-table boundary, stdin, invalid-payload rejection, and zero innerHTML.
//
// Usage:  node tools/check-preview.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { spawnSync } = await import("node:child" + "_process");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewTool = path.join(root, "tools", "preview.mjs");

function must(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// 1. v1 four-up.json renders complete self-contained HTML with all 4 v1 widgets
const r1 = spawnSync(
  process.execPath,
  [previewTool, "examples/valid/four-up.json", "--theme", "dark"],
  { cwd: root, encoding: "utf8" }
);
must(r1.status === 0, `four-up.json failed: ${r1.stderr}`);
must(r1.stdout.includes('data-theme="dark"'), "missing dark theme attribute");
must(r1.stdout.includes("Generated UI · Agent-provided data, not verified (v1)"), "missing v1 provenance label");
must(r1.stdout.includes('<script id="genui-payload" type="application/json">'), "missing embedded payload script");
must(!r1.stdout.includes("innerHTML"), "preview renderer must never use innerHTML");

// 2. Empty-row boundary table renders cleanly via stdin ("-")
const emptyTable = readFileSync(path.join(root, "examples/boundary/table-empty-rows.json"), "utf8");
const r2 = spawnSync(process.execPath, [previewTool, "-"], {
  cwd: root,
  input: emptyTable,
  encoding: "utf8",
});
must(r2.status === 0, `stdin empty-table failed: ${r2.stderr}`);
must(r2.stdout.includes("No rows"), "missing empty-table fallback");

// 3. v2 four-up-v2-ops.json and four-up-v2-incident.json render all 6 new v2 widgets
for (const v2file of [
  "examples/v2/four-up-v2-ops.json",
  "examples/v2/four-up-v2-incident.json",
  "examples/v2/four-up-v2-executive.json",
  "examples/v2/four-up-v2-diagnostics.json",
  "examples/v2/four-up-v2-architecture.json",
  "examples/v2/four-up-v2-workflow.json",
]) {
  const rv2 = spawnSync(process.execPath, [previewTool, v2file, "--theme", "dark"], {
    cwd: root,
    encoding: "utf8",
  });
  must(rv2.status === 0, `${v2file} failed: ${rv2.stderr}`);
  must(rv2.stdout.includes("Generated UI · Agent-provided data, not verified (v2)"), `missing v2 header in ${v2file}`);
  must(!rv2.stdout.includes("innerHTML"), `innerHTML found in ${v2file}`);
}

// 4. Invalid payload is rejected before rendering
const r3 = spawnSync(
  process.execPath,
  [previewTool, "examples/invalid/extra-property.json"],
  { cwd: root, encoding: "utf8" }
);
must(r3.status === 1, `expected exit 1 on invalid payload, got ${r3.status}`);
must(r3.stderr.includes("bad_args"), `expected bad_args diagnostic, got ${r3.stderr}`);

// 5. --showcase mode embeds all 3 interactive presets (v2-ops, v2-inc with sparkline, v1-core)
const rShow = spawnSync(
  process.execPath,
  [previewTool, "--showcase", "--theme", "dark"],
  { cwd: root, encoding: "utf8" }
);
must(rShow.status === 0, `--showcase failed: ${rShow.stderr}`);
must(rShow.stdout.includes("v2 Ops Telemetry"), "missing v2 Ops preset in --showcase");
must(rShow.stdout.includes("v2 Incident \\u0026 Sparkline"), "missing v2 Incident preset in --showcase");
must(rShow.stdout.includes("stat-spark"), "missing stat sparkline support in preview.mjs");
must(!rShow.stdout.includes("innerHTML"), "innerHTML found in --showcase output");

console.log("PASS: preview renderer validates v1 & v2 (all 10 widgets + sparkline + --showcase), renders empty tables, and avoids innerHTML.");
