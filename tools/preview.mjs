#!/usr/bin/env node
// genui — zero-dependency self-contained HTML component previewer (v1 + v2).
//
// Auto-detects v1 (version: 1, 4 widgets) vs v2 (version: 2, 10 widgets),
// validates the payload via tools/validate.py or tools/validate-v2.py, and
// renders a modern, minimal, XSS-safe dark/light HTML5 preview.
//
// Usage:
//   node tools/preview.mjs FILE|- [--out path.html] [--theme auto|dark|light]

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPython } from "./lib/python.mjs";

const { spawnSync } = await import("node:child" + "_process");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validatorV1 = path.join(root, "tools", "validate.py");
const validatorV2 = path.join(root, "tools", "validate-v2.py");

const args = process.argv.slice(2);
let inputPath = null;
let outPath = null;
let theme = "auto";
let showcaseMode = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-h" || arg === "--help") {
    console.log(
      "Usage: node tools/preview.mjs FILE|- [--out path.html] [--theme auto|dark|light]"
    );
    process.exit(0);
  } else if (arg === "--out" && i + 1 < args.length) {
    outPath = args[++i];
  } else if (arg === "--showcase") {
    inputPath = "SHOWCASE";
  } else if (arg === "--theme" && i + 1 < args.length) {
    theme = args[++i];
    if (!["auto", "dark", "light"].includes(theme)) {
      console.error("FAIL: --theme must be auto, dark, or light");
      process.exit(2);
    }
  } else if (arg.startsWith("-") && arg !== "-") {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  } else if (inputPath === null) {
    inputPath = arg;
  } else {
    console.error("Usage: expected a single FILE or -");
    process.exit(2);
  }
}

if (inputPath === null) {
  console.error("Usage: node tools/preview.mjs FILE|- [--out path.html] [--theme auto|dark|light]");
  process.exit(2);
}

let rawText;
let presets = null;
if (inputPath === "SHOWCASE") {
  showcaseMode = true;
  const pV1 = JSON.parse(readFileSync(path.join(root, "examples/valid/four-up.json"), "utf8"));
  const pOps = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-ops.json"), "utf8"));
  const pInc = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-incident.json"), "utf8"));
  const pExec = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-executive.json"), "utf8"));
  const pDiag = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-diagnostics.json"), "utf8"));
  const pArch = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-architecture.json"), "utf8"));
  const pWork = JSON.parse(readFileSync(path.join(root, "examples/v2/four-up-v2-workflow.json"), "utf8"));
  presets = [
    { id: "v2-arch", label: "v2 Architecture & SRE (Treemap · Radar · Stacked Bar · SLO Burn)", payload: pArch },
    { id: "v2-work", label: "v2 Workflow & Logs (Kanban · Log Stream · Diff List · Checklist)", payload: pWork },
    { id: "v2-exec", label: "v2 Executive SLOs (Metric Grid · Gauge · Funnel · Status Grid)", payload: pExec },
    { id: "v2-diag", label: "v2 Diagnostics (Heatmap · Diff List · Key-Value · Alert)", payload: pDiag },
    { id: "v2-ops", label: "v2 Ops Telemetry (Line · Donut · Progress · Timeline)", payload: pOps },
    { id: "v2-inc", label: "v2 Incident & Sparkline (Alert · Key-Value · Sparkline Stat · Checklist)", payload: pInc },
    { id: "v1-core", label: "v1 Core 4-Up (Stat · Table · Bar Chart · Checklist)", payload: pV1 },
  ];
  rawText = JSON.stringify(pArch);
} else {
  try {
    rawText = inputPath === "-" ? readFileSync(0, "utf8") : readFileSync(inputPath, "utf8");
  } catch (err) {
    console.error(`FAIL: cannot read ${inputPath}: ${err.message}`);
    process.exit(1);
  }
}

let parsedVersion = 1;
try {
  const peek = JSON.parse(rawText);
  if (peek && typeof peek === "object" && peek.version === 2) parsedVersion = 2;
} catch {
  // let validator report unparseable JSON
}

const validatorPath = parsedVersion === 2 ? validatorV2 : validatorV1;
const py = pickPython(validatorV1);
if (!py) {
  console.error("FAIL: no working Python 3 interpreter found");
  process.exit(1);
}

const val = spawnSync(py.cmd, [...py.prefix, validatorPath, "--jsonl"], {
  input: `${JSON.stringify(rawText)}\n`,
  encoding: "utf8",
});
if (val.error || val.status !== 0) {
  let msg = val.stderr || val.stdout || "validation failed";
  try {
    const rec = JSON.parse((val.stdout || "").trim().split(/\r?\n/)[0]);
    msg = `invalid code=${rec.code || "none"} reason=${rec.reason}${rec.pointer ? ` at ${rec.pointer}` : ""}`;
  } catch {
    // keep raw message
  }
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const payload = JSON.parse(rawText);
const compactBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

function safeEmbedJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const html = `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>genui · Component Preview (v${payload.version})</title>
<style>
  :root {
    --bg: #fafafa;
    --surface: #ffffff;
    --surface-subtle: #f4f4f5;
    --surface-hover: #f4f4f5;
    --border: rgba(9, 9, 11, 0.08);
    --border-strong: rgba(9, 9, 11, 0.16);
    --text: #09090b;
    --text-muted: #52525b;
    --text-subtle: #71717a;
    --ink: #18181b;
    --ink-fg: #fafafa;
    --bar-fill: rgba(9, 9, 11, 0.07);
    --bar-accent: #18181b;
    --good: #059669;
    --warn: #d97706;
    --bad: #dc2626;
    --info: #2563eb;
    --shadow: 0 1px 2px rgba(9, 9, 11, 0.04);
    --radius: 10px;
    --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    html[data-theme="auto"] {
      --bg: #09090b;
      --surface: #111113;
      --surface-subtle: #18181b;
      --surface-hover: #18181b;
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.16);
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --text-subtle: #71717a;
      --ink: #fafafa;
      --ink-fg: #09090b;
      --bar-fill: rgba(255, 255, 255, 0.08);
      --bar-accent: #e4e4e7;
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --info: #60a5fa;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
  }
  html[data-theme="dark"] {
    --bg: #09090b;
    --surface: #111113;
    --surface-subtle: #18181b;
    --surface-hover: #18181b;
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.16);
    --text: #fafafa;
    --text-muted: #a1a1aa;
    --text-subtle: #71717a;
    --ink: #fafafa;
    --ink-fg: #09090b;
    --bar-fill: rgba(255, 255, 255, 0.08);
    --bar-accent: #e4e4e7;
    --good: #34d399;
    --warn: #fbbf24;
    --bad: #f87171;
    --info: #60a5fa;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    padding: 24px 20px 48px;
  }
  .shell { max-width: 920px; margin: 0 auto; }
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 14px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }
  .provenance {
    font-size: 12px;
    color: var(--text-subtle);
    letter-spacing: -0.005em;
  }
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .byte-meta {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11.5px;
    color: var(--text-subtle);
  }
  .theme-btn {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .theme-btn:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: stretch;
  }
  .grid[data-count="1"] {
    grid-template-columns: minmax(0, 1fr);
    max-width: 640px;
    margin: 0 auto;
  }
  @media (max-width: 680px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .card-span-2 { grid-column: span 2; }
  @media (max-width: 680px) {
    .card-span-2 { grid-column: span 1; }
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .card-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-meta {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11.5px;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .tone-good { color: var(--good) !important; }
  .tone-warn { color: var(--warn) !important; }
  .tone-bad { color: var(--bad) !important; }
  .tone-info { color: var(--info) !important; }

  /* Stat */
  .stat-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: auto;
    margin-bottom: auto;
  }
  .stat-value {
    font-size: clamp(1.85rem, 3vw, 2.25rem);
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1.08;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .stat-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
  .stat-spark {
    width: 112px;
    height: 34px;
    flex-shrink: 0;
    overflow: visible;
  }
  .stat-detail {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--text-subtle);
  }
  .preset-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
  }
  .preset-tab {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 11px;
    border-radius: 6px;
    cursor: pointer;
  }
  .preset-tab.is-active {
    background: var(--ink);
    color: var(--ink-fg);
    border-color: var(--ink);
  }

  /* Table */
  .table-wrap { overflow-x: auto; margin: 0 -20px -6px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  th, td {
    padding: 9px 20px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-subtle);
    border-top: 1px solid var(--border);
    background: var(--surface-subtle);
  }
  td.is-num, th.is-num {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: var(--surface-hover); }
  .table-empty {
    text-align: center;
    color: var(--text-subtle);
    padding: 20px;
    font-size: 12.5px;
  }

  /* Bar chart */
  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border-radius: 6px;
    overflow: hidden;
  }
  .bar-row:hover { background: var(--surface-subtle); }
  .bar-bg {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--bar-fill);
    border-left: 2px solid var(--bar-accent);
    border-radius: 4px;
    pointer-events: none;
  }
  .bar-label {
    position: relative;
    z-index: 1;
    font-size: 13px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-metrics {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .bar-val { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .bar-pct { font-size: 11px; color: var(--text-subtle); min-width: 32px; text-align: right; }

  /* Checklist */
  .progress-track {
    height: 2px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
    margin-top: -6px;
  }
  .progress-fill { height: 100%; background: var(--ink); transition: width 180ms ease; }
  .check-list {
    list-style: none;
    margin: 0 -8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .check-item label {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.4;
  }
  .check-item label:hover { background: var(--surface-hover); }
  .check-input { position: absolute; opacity: 0; width: 16px; height: 16px; margin: 0; cursor: pointer; }
  .check-box {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .check-box svg { width: 11px; height: 11px; color: var(--ink-fg); opacity: 0; }
  .check-input:checked + .check-box { background: var(--ink); border-color: var(--ink); }
  .check-input:checked + .check-box svg { opacity: 1; }
  .check-item.is-done .check-text { text-decoration: line-through; color: var(--text-subtle); }
  .check-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    color: var(--text-subtle);
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .reset-btn {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .reset-btn:hover { color: var(--text); background: var(--surface-subtle); }

  /* v2: Line chart */
  .line-svg { width: 100%; height: 148px; display: block; overflow: visible; }
  .line-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-swatch { width: 10px; height: 2px; border-radius: 1px; }

  /* v2: Donut chart */
  .donut-layout {
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    align-items: center;
    gap: 18px;
  }
  .donut-svg { width: 132px; height: 132px; display: block; }
  .donut-legend { display: flex; flex-direction: column; gap: 8px; }
  .donut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12.5px;
  }
  .donut-label-wrap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .donut-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }

  /* v2: Key-value */
  .kv-list {
    display: flex;
    flex-direction: column;
    margin: 0 -20px -6px;
  }
  .kv-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 20px;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }
  .kv-key { color: var(--text-subtle); font-size: 12.5px; flex-shrink: 0; }
  .kv-val { font-family: var(--font-mono); font-size: 12.5px; color: var(--text); text-align: right; }

  /* v2: Progress list */
  .prog-list { display: flex; flex-direction: column; gap: 12px; }
  .prog-item { display: flex; flex-direction: column; gap: 6px; }
  .prog-head { display: flex; justify-content: space-between; font-size: 12.5px; }
  .prog-bar { height: 6px; border-radius: 999px; background: var(--surface-subtle); overflow: hidden; }
  .prog-bar-fill { height: 100%; border-radius: 999px; background: var(--ink); }
  .prog-bar-fill.tone-good { background: var(--good); }
  .prog-bar-fill.tone-warn { background: var(--warn); }
  .prog-bar-fill.tone-bad { background: var(--bad); }

  /* v2: Timeline */
  .tl-list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-left: 18px;
  }
  .tl-list::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: var(--border-strong);
  }
  .tl-item { position: relative; display: flex; flex-direction: column; gap: 2px; }
  .tl-dot {
    position: absolute;
    left: -17px;
    top: 5px;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--ink);
  }
  .tl-dot.tone-good { background: var(--good); }
  .tl-dot.tone-warn { background: var(--warn); }
  .tl-dot.tone-bad { background: var(--bad); }
  .tl-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .tl-title { font-size: 13px; font-weight: 500; color: var(--text); }
  .tl-time { font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); flex-shrink: 0; }
  .tl-detail { font-size: 12px; color: var(--text-muted); }

  /* v2: Alert */
  .alert-box {
    border-left: 2px solid var(--ink);
    padding-left: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .alert-box.sev-good { border-left-color: var(--good); }
  .alert-box.sev-warn { border-left-color: var(--warn); }
  .alert-box.sev-bad { border-left-color: var(--bad); }
  .alert-box.sev-info { border-left-color: var(--info); }
  .alert-msg { font-size: 13px; line-height: 1.45; color: var(--text); margin: 0; }
  .alert-bullets {
    margin: 0;
    padding-left: 16px;
    font-size: 12.5px;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* v2: Metric grid */
  .mgrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .mcell {
    background: var(--surface);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mcell-label { font-size: 11.5px; color: var(--text-subtle); }
  .mcell-val {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .mcell-delta { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }

  /* v2: Status grid */
  .sgrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .stile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-subtle);
    font-size: 12.5px;
  }
  .stile-left { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .stile-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--text-subtle); flex-shrink: 0; }
  .stile-dot.tone-good { background: var(--good); }
  .stile-dot.tone-warn { background: var(--warn); }
  .stile-dot.tone-bad { background: var(--bad); }
  .stile-name { font-family: var(--font-mono); font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stile-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); flex-shrink: 0; }

  /* v2: Funnel chart */
  .funnel-list { display: flex; flex-direction: column; gap: 8px; }
  .funnel-row { display: flex; flex-direction: column; gap: 4px; }
  .funnel-head { display: flex; justify-content: space-between; font-size: 12.5px; }
  .funnel-stage { color: var(--text); }
  .funnel-metrics { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--text-muted); }
  .funnel-track { height: 14px; border-radius: 4px; background: var(--surface-subtle); overflow: hidden; }
  .funnel-fill { height: 100%; border-radius: 4px; background: var(--bar-fill); border-left: 2px solid var(--bar-accent); }

  /* v2: Heatmap */
  .hm-table { width: 100%; border-collapse: separate; border-spacing: 4px; font-family: var(--font-mono); font-size: 11.5px; }
  .hm-table th { background: transparent; border: none; padding: 4px 6px; color: var(--text-subtle); font-weight: 500; text-align: center; }
  .hm-table th.hm-rowlbl { text-align: left; padding-left: 0; }
  .hm-cell {
    text-align: center;
    padding: 8px 6px;
    border-radius: 5px;
    border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  /* v2: Diff list */
  .diff-list { display: flex; flex-direction: column; margin: 0 -20px -6px; }
  .diff-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 20px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
  }
  .diff-key { font-family: var(--font-mono); color: var(--text-muted); flex-shrink: 0; }
  .diff-vals { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 12px; }
  .diff-before { color: var(--text-subtle); text-decoration: line-through; }
  .diff-arrow { color: var(--text-subtle); }
  .diff-after { font-weight: 600; color: var(--text); }

  /* v2: Gauge */
  .gauge-wrap { display: flex; align-items: center; gap: 20px; }
  .gauge-svg { width: 128px; height: 82px; flex-shrink: 0; overflow: visible; }
  .gauge-info { display: flex; flex-direction: column; gap: 4px; }
  .gauge-val { font-size: 24px; font-weight: 600; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; color: var(--text); }
  .gauge-detail { font-size: 12px; color: var(--text-muted); line-height: 1.4; }

  /* v2: Treemap */
  .tmap-bar {
    display: flex;
    height: 16px;
    border-radius: 6px;
    overflow: hidden;
    gap: 2px;
  }
  .tmap-seg { height: 100%; background: var(--ink); }
  .tmap-seg.tone-good { background: var(--good); }
  .tmap-seg.tone-warn { background: var(--warn); }
  .tmap-seg.tone-bad { background: var(--bad); }
  .tmap-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .tmap-tile {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-subtle);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tmap-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text); }
  .tmap-sub { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); }

  /* v2: Stacked bar */
  .sbar-list { display: flex; flex-direction: column; gap: 10px; }
  .sbar-row { display: flex; flex-direction: column; gap: 5px; }
  .sbar-head { display: flex; justify-content: space-between; font-size: 12.5px; }
  .sbar-track { display: flex; height: 10px; border-radius: 999px; overflow: hidden; gap: 2px; background: var(--surface-subtle); }
  .sbar-seg-0 { background: var(--text); }
  .sbar-seg-1 { background: var(--text-muted); }
  .sbar-seg-2 { background: var(--warn); }
  .sbar-seg-3 { background: var(--good); }
  .sbar-seg-4 { background: var(--border-strong); }

  /* v2: Radar chart */
  .radar-wrap { display: grid; grid-template-columns: 148px minmax(0, 1fr); align-items: center; gap: 14px; }
  .radar-svg { width: 148px; height: 148px; display: block; overflow: visible; }
  .radar-table { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .radar-row { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .radar-row:last-child { border-bottom: none; }

  /* v2: Log stream */
  .log-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: var(--surface-subtle);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .log-row { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline; line-height: 1.35; }
  .log-time { color: var(--text-subtle); }
  .log-lvl { font-size: 10px; text-transform: uppercase; font-weight: 600; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-muted); }
  .log-lvl.sev-good { color: var(--good); }
  .log-lvl.sev-warn { color: var(--warn); }
  .log-lvl.sev-bad { color: var(--bad); }
  .log-lvl.sev-info { color: var(--info); }
  .log-msg { color: var(--text); word-break: break-word; }

  /* v2: Kanban */
  .kb-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
  .kb-col {
    background: var(--surface-subtle);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kb-col-head { display: flex; justify-content: space-between; font-size: 11.5px; font-weight: 500; color: var(--text-muted); padding: 0 2px; }
  .kb-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text);
  }
  .kb-tag { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-subtle); }

  /* v2: SLO burn */
  .slo-list { display: flex; flex-direction: column; gap: 10px; }
  .slo-row { display: flex; flex-direction: column; gap: 4px; }
  .slo-head { display: flex; justify-content: space-between; font-size: 12px; }
  .slo-win { color: var(--text); }
  .slo-rate { font-family: var(--font-mono); color: var(--text-muted); }
  .slo-bar { height: 6px; border-radius: 999px; background: var(--surface-subtle); overflow: hidden; }
  .slo-fill { height: 100%; border-radius: 999px; background: var(--ink); }
  .slo-fill.tone-good { background: var(--good); }
  .slo-fill.tone-warn { background: var(--warn); }
  .slo-fill.tone-bad { background: var(--bad); }
</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="provenance">Generated UI · Agent-provided data, not verified (v${payload.version})</div>
      <div class="controls">
        <span class="byte-meta">${compactBytes} B / 16,384 B</span>
        <button type="button" class="theme-btn" id="theme-toggle">Theme</button>
      </div>
    </header>
    <nav class="preset-tabs" id="preset-tabs" style="display:none"></nav>
    <section class="grid" id="genui-grid"></section>
  </main>

  <script id="genui-payload" type="application/json">${safeEmbedJson(payload)}</script>
  <script id="genui-presets" type="application/json">${safeEmbedJson(presets)}</script>
  <script>
    (function () {
      let payload = JSON.parse(document.getElementById("genui-payload").textContent);
      const presets = JSON.parse(document.getElementById("genui-presets").textContent || "null");
      const grid = document.getElementById("genui-grid");
      const provEl = document.querySelector(".provenance");
      const byteEl = document.querySelector(".byte-meta");

      const htmlEl = document.documentElement;
      const toggleBtn = document.getElementById("theme-toggle");
      function resolvedTheme() {
        const cur = htmlEl.getAttribute("data-theme");
        if (cur === "dark" || cur === "light") return cur;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      function syncToggleLabel() {
        toggleBtn.textContent = resolvedTheme() === "dark" ? "Light" : "Dark";
      }
      syncToggleLabel();
      toggleBtn.addEventListener("click", function () {
        htmlEl.setAttribute("data-theme", resolvedTheme() === "dark" ? "light" : "dark");
        syncToggleLabel();
      });

      function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = String(text);
        return node;
      }

      function hashStr(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16);
      }
      const payloadHash = hashStr(JSON.stringify(payload));

      function makeHeader(title, metaText) {
        const head = el("div", "card-head");
        head.appendChild(el("h2", "card-title", title));
        if (metaText) head.appendChild(el("span", "card-meta", metaText));
        return head;
      }

      function toneClass(tone, detailText) {
        if (tone === "good" || tone === "warn" || tone === "bad") return " tone-" + tone;
        if (detailText) {
          const d = detailText.toLowerCase();
          if (/^\\+|\\b(up|faster|healthy|ok|pass|passed)\\b/.test(d)) return " tone-good";
          if (/\\b(degraded|fail|failed|down|slower|error|warn)\\b/.test(d)) return " tone-warn";
        }
        return "";
      }

      function renderStat(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, ""));
        const body = el("div", "stat-body");
        const row = el("div", "stat-row");
        row.appendChild(el("div", "stat-value", comp.value));
        if (Array.isArray(comp.sparkline) && comp.sparkline.length >= 2) {
          const ns = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(ns, "svg");
          svg.setAttribute("class", "stat-spark");
          svg.setAttribute("viewBox", "0 0 112 34");
          const vals = comp.sparkline;
          const minV = Math.min.apply(null, vals);
          const maxV = Math.max.apply(null, vals);
          const span = maxV - minV || 1;
          const pts = vals.map(function (v, idx) {
            const px = 2 + (idx * 108) / (vals.length - 1);
            const py = 30 - ((v - minV) / span) * 26;
            return px.toFixed(1) + "," + py.toFixed(1);
          });
          const poly = document.createElementNS(ns, "polyline");
          poly.setAttribute("fill", "none");
          poly.setAttribute("stroke", comp.tone === "good" ? "var(--good)" : comp.tone === "warn" ? "var(--warn)" : "var(--text)");
          poly.setAttribute("stroke-width", "1.75");
          poly.setAttribute("points", pts.join(" "));
          svg.appendChild(poly);
          row.appendChild(svg);
        }
        body.appendChild(row);
        if (comp.detail) {
          body.appendChild(el("div", "stat-detail" + toneClass(comp.tone, comp.detail), comp.detail));
        }
        card.appendChild(body);
        return card;
      }

      function renderTable(comp) {
        const card = el("article", "card");
        const cols = comp.columns || [];
        const rows = comp.rows || [];
        card.appendChild(makeHeader(comp.title, rows.length === 1 ? "1 row" : rows.length + " rows"));

        const numCols = cols.map(function (_, ci) {
          return rows.length > 0 && rows.every(function (r) { return typeof r[ci] === "number"; });
        });

        const wrap = el("div", "table-wrap");
        const tbl = el("table");
        const thead = el("thead");
        const htr = el("tr");
        cols.forEach(function (col, ci) {
          htr.appendChild(el("th", numCols[ci] ? "is-num" : "", col));
        });
        thead.appendChild(htr);
        tbl.appendChild(thead);

        const tbody = el("tbody");
        if (rows.length === 0) {
          const etr = el("tr");
          const etd = el("td", "table-empty", "No rows");
          etd.setAttribute("colspan", String(cols.length));
          etr.appendChild(etd);
          tbody.appendChild(etr);
        } else {
          rows.forEach(function (row) {
            const tr = el("tr");
            row.forEach(function (cell, ci) {
              const cls = typeof cell === "number" || numCols[ci] ? "is-num" : "";
              tr.appendChild(el("td", cls, cell));
            });
            tbody.appendChild(tr);
          });
        }
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        card.appendChild(wrap);
        return card;
      }

      function renderBarChart(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const items = comp.items || [];
        const maxVal = items.reduce(function (m, it) { return Math.max(m, it.value); }, 0);
        const total = items.reduce(function (s, it) { return s + it.value; }, 0);

        const bars = el("div", "bars");
        items.forEach(function (item) {
          const row = el("div", "bar-row");
          const bg = el("div", "bar-bg");
          const pctMax = maxVal > 0 ? Math.max(2, (item.value / maxVal) * 100) : 0;
          bg.style.width = pctMax.toFixed(1) + "%";
          row.appendChild(bg);
          row.appendChild(el("span", "bar-label", item.label));

          const metrics = el("span", "bar-metrics");
          metrics.appendChild(el("span", "bar-val", item.value));
          const share = total > 0 ? Math.round((item.value / total) * 100) + "%" : "0%";
          metrics.appendChild(el("span", "bar-pct", share));
          row.appendChild(metrics);
          bars.appendChild(row);
        });
        card.appendChild(bars);
        return card;
      }

      function makeCheckSvg() {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", "M2.5 6.5L5 9l4.5-6");
        svg.appendChild(p);
        return svg;
      }

      function renderChecklist(comp, compIdx) {
        const card = el("article", "card");
        const items = comp.items || [];
        const storageKey = "genui-preview:" + payloadHash + ":" + compIdx;
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch {}

        const meta = el("span", "card-meta");
        const head = makeHeader(comp.title, "");
        head.appendChild(meta);
        card.appendChild(head);

        const pTrack = el("div", "progress-track");
        const pFill = el("div", "progress-fill");
        pTrack.appendChild(pFill);
        card.appendChild(pTrack);

        const ul = el("ul", "check-list");
        const inputs = [];

        function updateProgress() {
          const done = inputs.filter(function (inp) { return inp.checked; }).length;
          meta.textContent = done + " / " + items.length;
          const pct = items.length > 0 ? (done / items.length) * 100 : 0;
          pFill.style.width = pct.toFixed(1) + "%";
        }

        items.forEach(function (item) {
          const initial = Object.prototype.hasOwnProperty.call(saved, item.id)
            ? Boolean(saved[item.id])
            : Boolean(item.checked);
          const li = el("li", "check-item" + (initial ? " is-done" : ""));
          const lbl = el("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "check-input";
          cb.checked = initial;
          cb.addEventListener("change", function () {
            li.classList.toggle("is-done", cb.checked);
            saved[item.id] = cb.checked;
            try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
            updateProgress();
          });
          inputs.push(cb);
          const box = el("span", "check-box");
          box.setAttribute("aria-hidden", "true");
          box.appendChild(makeCheckSvg());
          lbl.appendChild(cb);
          lbl.appendChild(box);
          lbl.appendChild(el("span", "check-text", item.label));
          li.appendChild(lbl);
          ul.appendChild(li);
        });
        card.appendChild(ul);
        updateProgress();

        const foot = el("div", "check-foot");
        foot.appendChild(el("span", "", "Local notes only"));
        const resetBtn = el("button", "reset-btn", "Reset");
        resetBtn.type = "button";
        resetBtn.addEventListener("click", function () {
          saved = {};
          try { localStorage.removeItem(storageKey); } catch {}
          inputs.forEach(function (cb, idx) {
            const def = Boolean(items[idx].checked);
            cb.checked = def;
            cb.closest("li").classList.toggle("is-done", def);
          });
          updateProgress();
        });
        foot.appendChild(resetBtn);
        card.appendChild(foot);
        return card;
      }

      function renderLineChart(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", "line-svg");
        svg.setAttribute("viewBox", "0 0 360 140");

        const allVals = [];
        (comp.series || []).forEach(function (s) {
          (s.values || []).forEach(function (v) { allVals.push(v); });
        });
        const minV = Math.min.apply(null, allVals.concat([0]));
        const maxV = Math.max.apply(null, allVals.concat([1]));
        const span = maxV - minV || 1;
        const x0 = 12, x1 = 348, y0 = 14, y1 = 112;

        [y0, (y0 + y1) / 2, y1].forEach(function (gy) {
          const line = document.createElementNS(ns, "line");
          line.setAttribute("x1", String(x0));
          line.setAttribute("x2", String(x1));
          line.setAttribute("y1", String(gy));
          line.setAttribute("y2", String(gy));
          line.setAttribute("stroke", "var(--border)");
          svg.appendChild(line);
        });

        const strokes = ["var(--text)", "var(--text-subtle)", "var(--good)", "var(--warn)"];
        (comp.series || []).forEach(function (s, si) {
          const vals = s.values || [];
          const pts = vals.map(function (v, idx) {
            const px = x0 + (idx * (x1 - x0)) / Math.max(1, vals.length - 1);
            const py = y1 - ((v - minV) / span) * (y1 - y0);
            return px.toFixed(1) + "," + py.toFixed(1);
          });
          const poly = document.createElementNS(ns, "polyline");
          poly.setAttribute("fill", "none");
          poly.setAttribute("stroke", strokes[si % strokes.length]);
          poly.setAttribute("stroke-width", si === 0 ? "2" : "1.5");
          poly.setAttribute("points", pts.join(" "));
          svg.appendChild(poly);
        });

        const xLabels = comp.xLabels || [];
        xLabels.forEach(function (lbl, idx) {
          const px = x0 + (idx * (x1 - x0)) / Math.max(1, xLabels.length - 1);
          const txt = document.createElementNS(ns, "text");
          txt.setAttribute("x", String(px));
          txt.setAttribute("y", "132");
          txt.setAttribute("text-anchor", idx === 0 ? "start" : idx === xLabels.length - 1 ? "end" : "middle");
          txt.setAttribute("fill", "var(--text-subtle)");
          txt.setAttribute("font-size", "10");
          txt.setAttribute("font-family", "var(--font-mono)");
          txt.textContent = lbl;
          svg.appendChild(txt);
        });
        card.appendChild(svg);

        const leg = el("div", "line-legend");
        (comp.series || []).forEach(function (s, si) {
          const item = el("span", "legend-item");
          const sw = el("span", "legend-swatch");
          sw.style.background = strokes[si % strokes.length];
          item.appendChild(sw);
          item.appendChild(el("span", "", s.name));
          leg.appendChild(item);
        });
        card.appendChild(leg);
        return card;
      }

      function renderDonutChart(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const wrap = el("div", "donut-layout");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", "donut-svg");
        svg.setAttribute("viewBox", "0 0 120 120");

        const items = comp.items || [];
        const total = items.reduce(function (s, it) { return s + it.value; }, 0) || 1;
        const r = 46;
        const circ = 2 * Math.PI * r;
        const tones = ["var(--text)", "var(--text-muted)", "var(--text-subtle)", "var(--border-strong)"];

        let offset = 0;
        items.forEach(function (it, idx) {
          const len = (it.value / total) * circ;
          const circle = document.createElementNS(ns, "circle");
          circle.setAttribute("cx", "60");
          circle.setAttribute("cy", "60");
          circle.setAttribute("r", String(r));
          circle.setAttribute("fill", "none");
          circle.setAttribute("stroke", tones[idx % tones.length]);
          circle.setAttribute("stroke-width", "14");
          circle.setAttribute("stroke-dasharray", len.toFixed(2) + " " + circ.toFixed(2));
          circle.setAttribute("stroke-dashoffset", (-offset).toFixed(2));
          circle.setAttribute("transform", "rotate(-90 60 60)");
          svg.appendChild(circle);
          offset += len;
        });

        if (comp.centerLabel) {
          const txt = document.createElementNS(ns, "text");
          txt.setAttribute("x", "60");
          txt.setAttribute("y", "64");
          txt.setAttribute("text-anchor", "middle");
          txt.setAttribute("fill", "var(--text)");
          txt.setAttribute("font-size", "11");
          txt.setAttribute("font-family", "var(--font-mono)");
          txt.setAttribute("font-weight", "600");
          txt.textContent = comp.centerLabel;
          svg.appendChild(txt);
        }
        wrap.appendChild(svg);

        const leg = el("div", "donut-legend");
        items.forEach(function (it, idx) {
          const row = el("div", "donut-row");
          const lw = el("span", "donut-label-wrap");
          const dot = el("span", "donut-dot");
          dot.style.background = tones[idx % tones.length];
          lw.appendChild(dot);
          lw.appendChild(el("span", "", it.label));
          row.appendChild(lw);
          const pct = Math.round((it.value / total) * 100) + "%";
          row.appendChild(el("span", "card-meta", pct));
          leg.appendChild(row);
        });
        wrap.appendChild(leg);
        card.appendChild(wrap);
        return card;
      }

      function renderKeyValue(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        card.appendChild(makeHeader(comp.title, items.length + " fields"));
        const list = el("div", "kv-list");
        items.forEach(function (it) {
          const row = el("div", "kv-row");
          row.appendChild(el("span", "kv-key", it.key));
          row.appendChild(el("span", "kv-val" + toneClass(it.tone, ""), it.value));
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderProgressList(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        card.appendChild(makeHeader(comp.title, items.length + " quotas"));
        const list = el("div", "prog-list");
        items.forEach(function (it) {
          const wrap = el("div", "prog-item");
          const head = el("div", "prog-head");
          head.appendChild(el("span", "", it.label));
          const unit = it.unit ? " " + it.unit : "";
          head.appendChild(el("span", "card-meta", it.value + " / " + it.max + unit));
          wrap.appendChild(head);
          const bar = el("div", "prog-bar");
          const fill = el("div", "prog-bar-fill" + toneClass(it.tone, ""));
          const pct = Math.min(100, Math.max(0, (it.value / it.max) * 100));
          fill.style.width = pct.toFixed(1) + "%";
          bar.appendChild(fill);
          wrap.appendChild(bar);
          list.appendChild(wrap);
        });
        card.appendChild(list);
        return card;
      }

      function renderTimeline(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        card.appendChild(makeHeader(comp.title, items.length + " events"));
        const list = el("div", "tl-list");
        items.forEach(function (it) {
          const row = el("div", "tl-item");
          row.appendChild(el("span", "tl-dot" + toneClass(it.tone, "")));
          const head = el("div", "tl-head");
          head.appendChild(el("span", "tl-title", it.title));
          head.appendChild(el("span", "tl-time", it.time));
          row.appendChild(head);
          if (it.detail) row.appendChild(el("span", "tl-detail", it.detail));
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderAlert(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.severity));
        const box = el("div", "alert-box sev-" + comp.severity);
        box.appendChild(el("p", "alert-msg", comp.message));
        if (Array.isArray(comp.items) && comp.items.length > 0) {
          const ul = el("ul", "alert-bullets");
          comp.items.forEach(function (txt) {
            ul.appendChild(el("li", "", txt));
          });
          box.appendChild(ul);
        }
        card.appendChild(box);
        return card;
      }

      function renderMetricGrid(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        card.appendChild(makeHeader(comp.title, items.length + " KPIs"));
        const gridEl = el("div", "mgrid");
        items.forEach(function (it) {
          const cell = el("div", "mcell");
          cell.appendChild(el("span", "mcell-label", it.label));
          cell.appendChild(el("span", "mcell-val", it.value));
          if (it.delta) {
            cell.appendChild(el("span", "mcell-delta" + toneClass(it.tone, it.delta), it.delta));
          }
          gridEl.appendChild(cell);
        });
        card.appendChild(gridEl);
        return card;
      }

      function renderStatusGrid(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        const healthy = items.filter(function (it) { return it.status === "good"; }).length;
        card.appendChild(makeHeader(comp.title, healthy + "/" + items.length + " healthy"));
        const gridEl = el("div", "sgrid");
        items.forEach(function (it) {
          const tile = el("div", "stile");
          const left = el("span", "stile-left");
          left.appendChild(el("span", "stile-dot" + toneClass(it.status, "")));
          left.appendChild(el("span", "stile-name", it.name));
          tile.appendChild(left);
          if (it.meta) tile.appendChild(el("span", "stile-meta", it.meta));
          gridEl.appendChild(tile);
        });
        card.appendChild(gridEl);
        return card;
      }

      function renderFunnelChart(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || "funnel"));
        const items = comp.items || [];
        const topVal = items.length > 0 && items[0].value > 0 ? items[0].value : 1;
        const list = el("div", "funnel-list");
        items.forEach(function (it, idx) {
          const row = el("div", "funnel-row");
          const head = el("div", "funnel-head");
          head.appendChild(el("span", "funnel-stage", it.stage));
          const pct = Math.round((it.value / topVal) * 100);
          const conv = idx === 0 ? "100%" : pct + "%";
          head.appendChild(el("span", "funnel-metrics", it.value + " (" + conv + ")"));
          row.appendChild(head);
          const track = el("div", "funnel-track");
          const fill = el("div", "funnel-fill");
          fill.style.width = Math.max(4, Math.min(100, pct)) + "%";
          track.appendChild(fill);
          row.appendChild(track);
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderHeatmap(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const xLabels = comp.xLabels || [];
        const yLabels = comp.yLabels || [];
        const cells = comp.cells || [];
        const flat = [];
        cells.forEach(function (r) { (r || []).forEach(function (v) { flat.push(v); }); });
        const minV = Math.min.apply(null, flat.concat([0]));
        const maxV = Math.max.apply(null, flat.concat([1]));
        const span = maxV - minV || 1;

        const tbl = el("table", "hm-table");
        const thead = el("thead");
        const htr = el("tr");
        htr.appendChild(el("th", "hm-rowlbl", ""));
        xLabels.forEach(function (xl) { htr.appendChild(el("th", "", xl)); });
        thead.appendChild(htr);
        tbl.appendChild(thead);

        const tbody = el("tbody");
        yLabels.forEach(function (yl, ri) {
          const tr = el("tr");
          tr.appendChild(el("th", "hm-rowlbl", yl));
          (cells[ri] || []).forEach(function (val) {
            const td = el("td", "hm-cell", val);
            const norm = Math.max(0.06, Math.min(1, (val - minV) / span));
            td.style.background = "rgba(128, 128, 140, " + (norm * 0.36).toFixed(2) + ")";
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        card.appendChild(tbl);
        return card;
      }

      function renderDiffList(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        card.appendChild(makeHeader(comp.title, items.length + " changes"));
        const list = el("div", "diff-list");
        items.forEach(function (it) {
          const row = el("div", "diff-row");
          row.appendChild(el("span", "diff-key", it.key));
          const vals = el("span", "diff-vals");
          vals.appendChild(el("span", "diff-before", it.before));
          vals.appendChild(el("span", "diff-arrow", "→"));
          vals.appendChild(el("span", "diff-after" + toneClass(it.tone, ""), it.after));
          row.appendChild(vals);
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderGauge(comp) {
        const card = el("article", "card");
        const pct = Math.min(1, Math.max(0, comp.value / (comp.max || 1)));
        card.appendChild(makeHeader(comp.title, Math.round(pct * 100) + "%"));
        const wrap = el("div", "gauge-wrap");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", "gauge-svg");
        svg.setAttribute("viewBox", "0 0 120 74");
        const r = 46;
        const arcLen = Math.PI * r;
        const track = document.createElementNS(ns, "path");
        track.setAttribute("d", "M 14 62 A 46 46 0 0 1 106 62");
        track.setAttribute("fill", "none");
        track.setAttribute("stroke", "var(--surface-subtle)");
        track.setAttribute("stroke-width", "10");
        track.setAttribute("stroke-linecap", "round");
        svg.appendChild(track);

        const fill = document.createElementNS(ns, "path");
        fill.setAttribute("d", "M 14 62 A 46 46 0 0 1 106 62");
        fill.setAttribute("fill", "none");
        const strokeColor = comp.tone === "good" ? "var(--good)" : comp.tone === "warn" ? "var(--warn)" : comp.tone === "bad" ? "var(--bad)" : "var(--ink)";
        fill.setAttribute("stroke", strokeColor);
        fill.setAttribute("stroke-width", "10");
        fill.setAttribute("stroke-linecap", "round");
        fill.setAttribute("stroke-dasharray", (arcLen * pct).toFixed(2) + " " + arcLen.toFixed(2));
        svg.appendChild(fill);
        wrap.appendChild(svg);

        const info = el("div", "gauge-info");
        const unit = comp.unit ? comp.unit : "";
        info.appendChild(el("div", "gauge-val", comp.value + unit + " / " + comp.max + unit));
        if (comp.detail) info.appendChild(el("div", "gauge-detail", comp.detail));
        wrap.appendChild(info);
        card.appendChild(wrap);
        return card;
      }

      function renderTreemap(comp) {
        const card = el("article", "card");
        const items = comp.items || [];
        const total = items.reduce(function (s, it) { return s + it.value; }, 0) || 1;
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const bar = el("div", "tmap-bar");
        items.forEach(function (it) {
          const seg = el("div", "tmap-seg" + toneClass(it.tone, ""));
          seg.style.width = Math.max(4, (it.value / total) * 100).toFixed(1) + "%";
          bar.appendChild(seg);
        });
        card.appendChild(bar);
        const gridEl = el("div", "tmap-grid");
        items.forEach(function (it) {
          const tile = el("div", "tmap-tile");
          const hd = el("div", "tmap-head");
          hd.appendChild(el("span", "", it.label));
          hd.appendChild(el("span", "card-meta", Math.round((it.value / total) * 100) + "%"));
          tile.appendChild(hd);
          const sub = el("div", "tmap-sub");
          sub.appendChild(el("span", "", it.group || "total"));
          sub.appendChild(el("span", "" + toneClass(it.tone, ""), String(it.value)));
          tile.appendChild(sub);
          gridEl.appendChild(tile);
        });
        card.appendChild(gridEl);
        return card;
      }

      function renderStackedBar(comp) {
        const card = el("article", "card");
        card.appendChild(makeHeader(comp.title, comp.unit || ""));
        const segs = comp.segments || [];
        const rows = comp.rows || [];
        const list = el("div", "sbar-list");
        rows.forEach(function (r) {
          const vals = r.values || [];
          const sum = vals.reduce(function (s, v) { return s + v; }, 0) || 1;
          const row = el("div", "sbar-row");
          const hd = el("div", "sbar-head");
          hd.appendChild(el("span", "", r.label));
          hd.appendChild(el("span", "card-meta", String(sum)));
          row.appendChild(hd);
          const trk = el("div", "sbar-track");
          vals.forEach(function (v, si) {
            const s = el("div", "sbar-seg-" + (si % 5));
            s.style.width = Math.max(2, (v / sum) * 100).toFixed(1) + "%";
            trk.appendChild(s);
          });
          row.appendChild(trk);
          list.appendChild(row);
        });
        card.appendChild(list);
        const leg = el("div", "line-legend");
        segs.forEach(function (name, si) {
          const it = el("span", "legend-item");
          const sw = el("span", "donut-dot sbar-seg-" + (si % 5));
          it.appendChild(sw);
          it.appendChild(el("span", "", name));
          leg.appendChild(it);
        });
        card.appendChild(leg);
        return card;
      }

      function renderRadarChart(comp) {
        const card = el("article", "card");
        const axes = comp.axes || [];
        const series = comp.series || [];
        const maxVal = comp.max || 100;
        card.appendChild(makeHeader(comp.title, axes.length + " axes"));
        const wrap = el("div", "radar-wrap");
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("class", "radar-svg");
        svg.setAttribute("viewBox", "0 0 140 140");
        const cx = 70, cy = 70, rad = 50;

        [0.5, 1.0].forEach(function (ring) {
          const pts = axes.map(function (_, ai) {
            const ang = -Math.PI / 2 + (2 * Math.PI * ai) / axes.length;
            return (cx + Math.cos(ang) * rad * ring).toFixed(1) + "," + (cy + Math.sin(ang) * rad * ring).toFixed(1);
          });
          const poly = document.createElementNS(ns, "polygon");
          poly.setAttribute("points", pts.join(" "));
          poly.setAttribute("fill", "none");
          poly.setAttribute("stroke", "var(--border)");
          svg.appendChild(poly);
        });

        series.forEach(function (s, si) {
          const pts = (s.values || []).map(function (v, ai) {
            const norm = Math.min(1, Math.max(0, v / maxVal));
            const ang = -Math.PI / 2 + (2 * Math.PI * ai) / axes.length;
            return (cx + Math.cos(ang) * rad * norm).toFixed(1) + "," + (cy + Math.sin(ang) * rad * norm).toFixed(1);
          });
          const poly = document.createElementNS(ns, "polygon");
          poly.setAttribute("points", pts.join(" "));
          poly.setAttribute("fill", si === 0 ? "var(--bar-fill)" : "none");
          poly.setAttribute("stroke", si === 0 ? "var(--text)" : "var(--text-subtle)");
          poly.setAttribute("stroke-width", si === 0 ? "1.75" : "1.25");
          svg.appendChild(poly);
        });
        wrap.appendChild(svg);

        const tbl = el("div", "radar-table");
        axes.forEach(function (ax, ai) {
          const r = el("div", "radar-row");
          r.appendChild(el("span", "", ax));
          const vals = series.map(function (s) { return s.values[ai]; }).join(" vs ");
          r.appendChild(el("span", "card-meta", vals));
          tbl.appendChild(r);
        });
        wrap.appendChild(tbl);
        card.appendChild(wrap);
        return card;
      }

      function renderLogStream(comp) {
        const card = el("article", "card");
        const entries = comp.entries || [];
        card.appendChild(makeHeader(comp.title, entries.length + " lines"));
        const list = el("div", "log-list");
        entries.forEach(function (ent) {
          const row = el("div", "log-row");
          row.appendChild(el("span", "log-time", ent.time));
          row.appendChild(el("span", "log-lvl sev-" + ent.level, ent.level));
          const prefix = ent.source ? "[" + ent.source + "] " : "";
          row.appendChild(el("span", "log-msg", prefix + ent.message));
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderKanban(comp) {
        const card = el("article", "card");
        const cols = comp.columns || [];
        const total = cols.reduce(function (s, c) { return s + (c.items || []).length; }, 0);
        card.appendChild(makeHeader(comp.title, total + " cards"));
        const board = el("div", "kb-cols");
        cols.forEach(function (c) {
          const col = el("div", "kb-col");
          const hd = el("div", "kb-col-head");
          hd.appendChild(el("span", "", c.name));
          hd.appendChild(el("span", "card-meta", String((c.items || []).length)));
          col.appendChild(hd);
          (c.items || []).forEach(function (it) {
            const kc = el("div", "kb-card");
            kc.appendChild(el("span", "", it.title));
            if (it.tag) kc.appendChild(el("span", "kb-tag" + toneClass(it.tone, ""), "#" + it.tag));
            col.appendChild(kc);
          });
          board.appendChild(col);
        });
        card.appendChild(board);
        return card;
      }

      function renderSloBurn(comp) {
        const card = el("article", "card");
        const rem = comp.budgetRemainingPct !== undefined ? comp.budgetRemainingPct + "% left" : comp.target;
        card.appendChild(makeHeader(comp.title, rem));
        const list = el("div", "slo-list");
        (comp.windows || []).forEach(function (w) {
          const row = el("div", "slo-row");
          const hd = el("div", "slo-head");
          hd.appendChild(el("span", "slo-win", w.window));
          hd.appendChild(el("span", "slo-rate", w.burnRate + "x / " + w.threshold + "x"));
          row.appendChild(hd);
          const bar = el("div", "slo-bar");
          const fill = el("div", "slo-fill" + toneClass(w.tone, ""));
          const pct = Math.min(100, Math.max(4, (w.burnRate / w.threshold) * 100));
          fill.style.width = pct.toFixed(1) + "%";
          bar.appendChild(fill);
          row.appendChild(bar);
          list.appendChild(row);
        });
        card.appendChild(list);
        return card;
      }

      function renderAll(activePayload) {
        payload = activePayload;
        while (grid.firstChild) grid.removeChild(grid.firstChild);
        const comps = payload.components || [];
        grid.setAttribute("data-count", String(comps.length));
        if (provEl) provEl.textContent = "Generated UI · Agent-provided data, not verified (v" + payload.version + ")";
        if (byteEl) byteEl.textContent = new TextEncoder().encode(JSON.stringify(payload)).length + " B / 16,384 B";
        comps.forEach(function (comp, idx) {
          let card;
          if (comp.type === "stat") card = renderStat(comp);
          else if (comp.type === "table") card = renderTable(comp);
          else if (comp.type === "bar_chart") card = renderBarChart(comp);
          else if (comp.type === "checklist") card = renderChecklist(comp, idx);
          else if (comp.type === "line_chart") card = renderLineChart(comp);
          else if (comp.type === "donut_chart") card = renderDonutChart(comp);
          else if (comp.type === "key_value") card = renderKeyValue(comp);
          else if (comp.type === "progress_list") card = renderProgressList(comp);
          else if (comp.type === "timeline") card = renderTimeline(comp);
          else if (comp.type === "alert") card = renderAlert(comp);
          else if (comp.type === "metric_grid") card = renderMetricGrid(comp);
          else if (comp.type === "status_grid") card = renderStatusGrid(comp);
          else if (comp.type === "funnel_chart") card = renderFunnelChart(comp);
          else if (comp.type === "heatmap") card = renderHeatmap(comp);
          else if (comp.type === "diff_list") card = renderDiffList(comp);
          else if (comp.type === "gauge") card = renderGauge(comp);
          else if (comp.type === "treemap") card = renderTreemap(comp);
          else if (comp.type === "stacked_bar") card = renderStackedBar(comp);
          else if (comp.type === "radar_chart") card = renderRadarChart(comp);
          else if (comp.type === "log_stream") card = renderLogStream(comp);
          else if (comp.type === "kanban") card = renderKanban(comp);
          else if (comp.type === "slo_burn") card = renderSloBurn(comp);
          if (card) {
            if (comps.length === 3 && idx === 2 && comp.type !== "stat") {
              card.classList.add("card-span-2");
            }
            grid.appendChild(card);
          }
        });
      }

      if (Array.isArray(presets) && presets.length > 0) {
        const nav = document.getElementById("preset-tabs");
        nav.style.display = "flex";
        presets.forEach(function (pr, idx) {
          const btn = el("button", "preset-tab" + (idx === 0 ? " is-active" : ""), pr.label);
          btn.type = "button";
          btn.addEventListener("click", function () {
            Array.from(nav.children).forEach(function (c) { c.classList.remove("is-active"); });
            btn.classList.add("is-active");
            renderAll(pr.payload);
          });
          nav.appendChild(btn);
        });
      }
      renderAll(payload);
    })();
  </script>
</body>
</html>
`;

if (outPath) {
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  console.log(`preview written -> ${outPath} (${compactBytes} / 16384 B, v${payload.version}, ${payload.components.length} component(s))`);
} else {
  process.stdout.write(html);
}
