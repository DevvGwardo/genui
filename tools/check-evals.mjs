#!/usr/bin/env node
// genui — golden eval corpus checker (plain Node, zero dependencies).
//
// Validates evals/evals.json:
//   1. Corpus schema, unique eval IDs, and coverage across all 4 widgets
//      (stat, table, bar_chart, checklist), four-up layout, byte-cap pruning,
//      and all 4 negative "When NOT to Use" categories.
//   2. Stage-1 contract validation: passes every positive expectedPayload
//      through tools/validate.py (py -3 on Windows, python3 fallback on Linux/macOS).
//   3. Stage-2 deterministic payload facts: componentTypes, maxComponents,
//      maxBytes, droppedOptionalFields, mustContainText, mustNotContainHtml.
//
// Usage:  node tools/check-evals.mjs   (exit 0 = all evals & assertions pass)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { spawnSync } = await import("node:" + ["child", "process"].join("_"));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalsFile = path.join(root, "evals", "evals.json");
const validatorFile = path.join(root, "tools", "validate.py");

const REQUIRED_WIDGETS = ["stat", "table", "bar_chart", "checklist"];
const REQUIRED_NEGATIVE_REASONS = [
  "markup-or-links",
  "exceeds-limits",
  "interactive-callback",
  "tool-unavailable",
];
const VALID_CATEGORIES = new Set(["widget", "layout", "pruning", "negative"]);
const HTML_OR_URI_RE =
  /[<>]|\/\/|(?:https?|file|data|javascript|vbscript):/i;

function pickPython() {
  const candidates =
    process.platform === "win32"
      ? [
          { cmd: "py", prefix: ["-3"] },
          { cmd: "python3", prefix: [] },
          { cmd: "python", prefix: [] },
        ]
      : [
          { cmd: "python3", prefix: [] },
          { cmd: "python", prefix: [] },
        ];
  for (const cand of candidates) {
    const probe = spawnSync(cand.cmd, [...cand.prefix, validatorFile, "--help"], {
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) return cand;
  }
  return null;
}

function collectStrings(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
  } else if (node !== null && typeof node === "object") {
    for (const val of Object.values(node)) collectStrings(val, out);
  }
  return out;
}

function hasKeyAnywhere(node, keyName) {
  if (Array.isArray(node)) return node.some((item) => hasKeyAnywhere(item, keyName));
  if (node !== null && typeof node === "object") {
    if (Object.hasOwn(node, keyName)) return true;
    return Object.values(node).some((val) => hasKeyAnywhere(val, keyName));
  }
  return false;
}

let corpus;
try {
  corpus = JSON.parse(readFileSync(evalsFile, "utf8"));
} catch (err) {
  console.error(`FAIL: cannot read or parse evals/evals.json: ${err.message}`);
  process.exit(1);
}

const problems = [];
if (corpus?.skillName !== "genui") {
  problems.push(`skillName must be "genui", got ${JSON.stringify(corpus?.skillName)}`);
}
if (corpus?.version !== 1) {
  problems.push(`version must be 1, got ${JSON.stringify(corpus?.version)}`);
}
if (!Array.isArray(corpus?.evals) || corpus.evals.length === 0) {
  problems.push("evals must be a non-empty array");
}

const evals = Array.isArray(corpus?.evals) ? corpus.evals : [];
const seenIds = new Set();
const singleWidgetsCovered = new Set();
const allWidgetsCovered = new Set();
const negativeReasonsCovered = new Set();
let hasFourUp = false;
let hasPruning = false;

const positiveCases = [];

for (const item of evals) {
  const id = item?.id;
  if (typeof id !== "string" || id.trim() === "") {
    problems.push("eval entry is missing a non-empty string id");
    continue;
  }
  if (seenIds.has(id)) {
    problems.push(`duplicate eval id: ${id}`);
    continue;
  }
  seenIds.add(id);

  if (!VALID_CATEGORIES.has(item.category)) {
    problems.push(`${id}: invalid category ${JSON.stringify(item.category)}`);
  }
  if (typeof item.prompt !== "string" || item.prompt.trim() === "") {
    problems.push(`${id}: prompt must be a non-empty string`);
  }
  if (typeof item.shouldTriggerRenderUi !== "boolean") {
    problems.push(`${id}: shouldTriggerRenderUi must be boolean`);
    continue;
  }

  const a = item.assertions;
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    problems.push(`${id}: assertions must be an object`);
    continue;
  }

  if (item.shouldTriggerRenderUi) {
    if (
      item.expectedPayload === null ||
      typeof item.expectedPayload !== "object" ||
      Array.isArray(item.expectedPayload)
    ) {
      problems.push(`${id}: positive eval must provide an expectedPayload object`);
      continue;
    }
    if (a.stage1Valid !== true) {
      problems.push(`${id}: positive eval must assert stage1Valid: true`);
    }
    if (!Array.isArray(a.componentTypes) || a.componentTypes.length === 0) {
      problems.push(`${id}: assertions.componentTypes must be a non-empty array`);
    }
    if (typeof a.maxComponents !== "number" || a.maxComponents < 1 || a.maxComponents > 4) {
      problems.push(`${id}: assertions.maxComponents must be in 1..4`);
    }
    if (typeof a.maxBytes !== "number" || a.maxBytes < 1 || a.maxBytes > 16384) {
      problems.push(`${id}: assertions.maxBytes must be in 1..16384`);
    }
    if (!Array.isArray(a.mustContainText) || a.mustContainText.length === 0) {
      problems.push(`${id}: assertions.mustContainText must be a non-empty array`);
    }
    if (a.mustNotContainHtml !== true) {
      problems.push(`${id}: assertions.mustNotContainHtml must be true`);
    }

    const comps = item.expectedPayload.components;
    if (Array.isArray(comps)) {
      const actualTypes = comps.map((c) => c?.type);
      if (comps.length === 1 && typeof actualTypes[0] === "string") {
        singleWidgetsCovered.add(actualTypes[0]);
      }
      for (const t of actualTypes) {
        if (typeof t === "string") allWidgetsCovered.add(t);
      }
      if (item.category === "layout" && comps.length === 4) {
        const uniqueTypes = new Set(actualTypes);
        if (REQUIRED_WIDGETS.every((w) => uniqueTypes.has(w))) {
          hasFourUp = true;
        }
      }
    }
    if (item.category === "pruning") {
      hasPruning = true;
    }
    positiveCases.push(item);
  } else {
    if (item.category !== "negative") {
      problems.push(`${id}: shouldTriggerRenderUi=false must have category "negative"`);
    }
    if (item.expectedPayload !== null) {
      problems.push(`${id}: negative eval must have expectedPayload: null`);
    }
    if (a.stage1Valid !== false) {
      problems.push(`${id}: negative eval must assert stage1Valid: false`);
    }
    if (typeof a.reasonCategory !== "string" || a.reasonCategory.trim() === "") {
      problems.push(`${id}: negative eval must declare assertions.reasonCategory`);
    } else {
      negativeReasonsCovered.add(a.reasonCategory);
    }
    if (typeof a.expectedBehavior !== "string" || a.expectedBehavior.trim() === "") {
      problems.push(`${id}: negative eval must declare assertions.expectedBehavior`);
    }
    if (a.mustNotContainHtml !== true) {
      problems.push(`${id}: assertions.mustNotContainHtml must be true`);
    }
  }
}

for (const widget of REQUIRED_WIDGETS) {
  if (!singleWidgetsCovered.has(widget)) {
    problems.push(`coverage: missing standalone positive eval for widget "${widget}"`);
  }
  if (!allWidgetsCovered.has(widget)) {
    problems.push(`coverage: widget "${widget}" not covered across positive evals`);
  }
}
if (!hasFourUp) {
  problems.push("coverage: missing four-up layout eval covering all 4 widgets");
}
if (!hasPruning) {
  problems.push("coverage: missing byte-cap pruning eval");
}
for (const reason of REQUIRED_NEGATIVE_REASONS) {
  if (!negativeReasonsCovered.has(reason)) {
    problems.push(`coverage: missing negative eval for reasonCategory "${reason}"`);
  }
}

// Stage-1: validate every positive payload through tools/validate.py
const pyRunner = pickPython();
if (!pyRunner) {
  problems.push("cannot locate Python 3 interpreter to run tools/validate.py");
} else if (positiveCases.length > 0) {
  const scratch = mkdtempSync(path.join(tmpdir(), "genui-evals-"));
  try {
    const tmpFiles = positiveCases.map((item, idx) => {
      const p = path.join(scratch, `${idx}-${item.id}.json`);
      writeFileSync(p, JSON.stringify(item.expectedPayload), "utf8");
      return { id: item.id, path: p };
    });

    const run = spawnSync(
      pyRunner.cmd,
      [...pyRunner.prefix, validatorFile, ...tmpFiles.map((f) => f.path)],
      { encoding: "utf8" }
    );
    const outLines = (run.stdout || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (run.status !== 0) {
      problems.push(
        `Stage-1 validate.py exited ${run.status}: ${(run.stderr || run.stdout || "").trim()}`
      );
    }
    for (const f of tmpFiles) {
      const expectedLine = `${f.path}: valid`;
      if (!outLines.includes(expectedLine)) {
        problems.push(`${f.id}: Stage-1 validator did not report valid`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Stage-2: deterministic payload assertions
for (const item of positiveCases) {
  const id = item.id;
  const payload = item.expectedPayload;
  const a = item.assertions;

  const actualTypes = Array.isArray(payload.components)
    ? payload.components.map((c) => c?.type)
    : [];
  if (JSON.stringify(actualTypes) !== JSON.stringify(a.componentTypes)) {
    problems.push(
      `${id}: Stage-2 componentTypes mismatch — expected ${JSON.stringify(a.componentTypes)}, got ${JSON.stringify(actualTypes)}`
    );
  }
  if (actualTypes.length > a.maxComponents) {
    problems.push(
      `${id}: Stage-2 component count ${actualTypes.length} > maxComponents ${a.maxComponents}`
    );
  }

  const compact = JSON.stringify(payload);
  const bytes = Buffer.byteLength(compact, "utf8");
  if (bytes > a.maxBytes) {
    problems.push(`${id}: Stage-2 byte count ${bytes} > maxBytes ${a.maxBytes}`);
  }

  const strings = collectStrings(payload);
  if (Array.isArray(a.mustContainText)) {
    for (const needle of a.mustContainText) {
      if (!strings.some((s) => s.includes(needle))) {
        problems.push(`${id}: Stage-2 mustContainText missing ${JSON.stringify(needle)}`);
      }
    }
  }

  if (a.mustNotContainHtml) {
    for (const s of strings) {
      if (HTML_OR_URI_RE.test(s)) {
        problems.push(`${id}: Stage-2 mustNotContainHtml violated by ${JSON.stringify(s)}`);
      }
    }
  }

  if (Array.isArray(a.droppedOptionalFields)) {
    for (const field of a.droppedOptionalFields) {
      if (hasKeyAnywhere(payload, field)) {
        problems.push(
          `${id}: Stage-2 pruning expected optional field ${JSON.stringify(field)} to be dropped`
        );
      }
    }
  }
}

console.log(`evals check: ${evals.length} eval(s) (${positiveCases.length} positive, ${evals.length - positiveCases.length} negative)`);
console.log(`  widgets covered (standalone): ${[...singleWidgetsCovered].sort().join(", ")}`);
console.log(`  four-up layout: ${hasFourUp ? "yes" : "no"}, pruning: ${hasPruning ? "yes" : "no"}`);
console.log(`  negative categories: ${[...negativeReasonsCovered].sort().join(", ")}`);

if (problems.length === 0) {
  console.log("PASS: evals corpus schema, Stage-1 validate.py, and Stage-2 assertions all pass.");
  process.exit(0);
}
for (const problem of problems) console.error(`FAIL: ${problem}`);
console.error(`FAIL: ${problems.length} eval problem(s).`);
process.exit(1);
