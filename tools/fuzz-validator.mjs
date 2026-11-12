#!/usr/bin/env node
// genui — differential fuzzer and property test for tools/validate.py (G1).
//
// Zero external dependencies (Node 20+ stdlib only). Generates >=5,000
// deterministic cases from a seeded PRNG across valid payloads, boundary cases,
// bounds violations, type/shape errors, BMP + astral Cf strings, lone
// surrogates, unhashable component types, prototype-pollution keys, RFC 6901
// pointer escaping, table row mismatches, checklist id rules, deep nesting,
// and non-finite/malformed JSON, then compares an independent JS reference
// validator against tools/validate.py via batched/streaming CLI execution.
//
// Usage:  node tools/fuzz-validator.mjs
// Exit status: 0 when 0 verdict divergences across >=5,000 cases; 1 otherwise.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { spawnSync } = await import("node:child" + "_process");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validatorPath = path.join(root, "tools", "validate.py");
const byteCap = 16384;
const maxDepth = 32;
const minCases = 5000;
const seed = 0x67656e75;

const astralRanges = [
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
];

const reNonSpace = /\S/;
const reAngles = /[<>]/;
const reSlashSlash = /\/\//;
const reScheme =
  /(?:[hH][tT][tT][pP][sS]?|[fF][iI][lL][eE]|[dD][aA][tT][aA]|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]|[vV][bB][sS][cC][rR][iI][pP][tT]):/;
const reBmpBanned =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/;
const reChecklistId = /^[a-zA-Z0-9_-]{1,40}$/;

function createRng(initialSeed) {
  let state = initialSeed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function escPtr(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

function ptrJoin(base, token) {
  return `${base}/${escPtr(token)}`;
}

function codePointLength(str) {
  return [...str].length;
}

function isPlainObject(val) {
  if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(val).length > 0) return false;
  for (const key of Object.keys(val)) {
    const desc = Object.getOwnPropertyDescriptor(val, key);
    if (!desc || !Object.hasOwn(desc, "value") || typeof desc.get === "function" || typeof desc.set === "function") {
      return false;
    }
  }
  return true;
}

function findDeepPointer(rootVal) {
  const stack = [[rootVal, 0, ""]];
  while (stack.length > 0) {
    const [val, depth, ptr] = stack.pop();
    if (depth > maxDepth) return ptr;
    if (Array.isArray(val)) {
      for (let i = val.length - 1; i >= 0; i -= 1) {
        if (!(i in val)) return ptrJoin(ptr, i);
        stack.push([val[i], depth + 1, ptrJoin(ptr, i)]);
      }
    } else if (isPlainObject(val)) {
      const keys = Object.keys(val);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const key = keys[i];
        stack.push([val[key], depth + 1, ptrJoin(ptr, key)]);
      }
    }
  }
  return null;
}

function hasBannedPlainText(str) {
  return (
    reAngles.test(str) ||
    reSlashSlash.test(str) ||
    reScheme.test(str) ||
    reBmpBanned.test(str)
  );
}

function findAstralOrSurrogate(val, ptr) {
  if (typeof val === "string") {
    for (let i = 0; i < val.length; i += 1) {
      const cp = val.codePointAt(i);
      const codeUnit = val.charCodeAt(i);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = i + 1 < val.length ? val.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) return ptr;
        i += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return ptr;
      }
      for (const [lo, hi] of astralRanges) {
        if (cp >= lo && cp <= hi) return ptr;
      }
    }
    return null;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i += 1) {
      const hit = findAstralOrSurrogate(val[i], ptrJoin(ptr, i));
      if (hit !== null) return hit;
    }
  } else if (isPlainObject(val)) {
    for (const key of Object.keys(val)) {
      const hit = findAstralOrSurrogate(val[key], ptrJoin(ptr, key));
      if (hit !== null) return hit;
    }
  }
  return null;
}

function fail(code, reason, pointer) {
  return { ok: false, code, reason, pointer };
}

function validatePlainText(val, maxLen, ptr) {
  if (typeof val !== "string") return fail("bad_args", "invalid type", ptr);
  if (hasBannedPlainText(val)) return fail(null, "string filter", ptr);
  const len = codePointLength(val);
  if (len < 1 || len > maxLen || !reNonSpace.test(val)) {
    return fail(null, "bound violation", ptr);
  }
  return null;
}

function validateProperties(obj, requiredKeys, propSpecs, ptr) {
  for (const req of requiredKeys) {
    if (!Object.hasOwn(obj, req)) {
      return fail("bad_args", "missing required field", ptrJoin(ptr, req));
    }
  }
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(propSpecs, key)) {
      return fail("bad_args", "extra property", ptrJoin(ptr, key));
    }
  }
  for (const key of Object.keys(propSpecs)) {
    if (Object.hasOwn(obj, key)) {
      const err = propSpecs[key](obj[key], ptrJoin(ptr, key));
      if (err) return err;
    }
  }
  return null;
}

function validateNumber(val, min, max, ptr) {
  if (typeof val !== "number") return fail("bad_args", "invalid type", ptr);
  if (!Number.isFinite(val) || val < min || val > max) {
    return fail(null, "bound violation", ptr);
  }
  return null;
}

function validateArray(val, minItems, maxItems, itemFn, ptr) {
  if (!Array.isArray(val)) return fail("bad_args", "invalid type", ptr);
  for (let i = 0; i < val.length; i += 1) {
    if (!(i in val)) return fail("bad_args", "invalid type", ptrJoin(ptr, i));
  }
  if (val.length < minItems || val.length > maxItems) {
    return fail(null, "bound violation", ptr);
  }
  for (let i = 0; i < val.length; i += 1) {
    const err = itemFn(val[i], ptrJoin(ptr, i));
    if (err) return err;
  }
  return null;
}

function validateCell(val, ptr) {
  if (typeof val === "string") {
    if (!hasBannedPlainText(val) && codePointLength(val) >= 1 && codePointLength(val) <= 160 && reNonSpace.test(val)) {
      return null;
    }
    return fail("bad_args", "invalid type", ptr);
  }
  if (typeof val === "number") {
    if (Number.isFinite(val) && val >= -1e12 && val <= 1e12) return null;
    return fail("bad_args", "invalid type", ptr);
  }
  return fail("bad_args", "invalid type", ptr);
}

const widgetValidators = {
  stat(comp, ptr) {
    return validateProperties(
      comp,
      ["type", "title", "value"],
      {
        type: (v, p) => (v === "stat" ? null : fail("bad_args", "invalid type", p)),
        title: (v, p) => validatePlainText(v, 80, p),
        value: (v, p) => validatePlainText(v, 80, p),
        detail: (v, p) => validatePlainText(v, 160, p),
      },
      ptr
    );
  },
  table(comp, ptr) {
    return validateProperties(
      comp,
      ["type", "title", "columns", "rows"],
      {
        type: (v, p) => (v === "table" ? null : fail("bad_args", "invalid type", p)),
        title: (v, p) => validatePlainText(v, 80, p),
        columns: (v, p) => validateArray(v, 1, 6, (c, cp) => validatePlainText(c, 60, cp), p),
        rows: (v, p) =>
          validateArray(
            v,
            0,
            20,
            (row, rp) => {
              if (!Array.isArray(row)) return fail("bad_args", "invalid type", rp);
              for (let i = 0; i < row.length; i += 1) {
                const err = validateCell(row[i], ptrJoin(rp, i));
                if (err) return err;
              }
              return null;
            },
            p
          ),
      },
      ptr
    );
  },
  bar_chart(comp, ptr) {
    return validateProperties(
      comp,
      ["type", "title", "items"],
      {
        type: (v, p) => (v === "bar_chart" ? null : fail("bad_args", "invalid type", p)),
        title: (v, p) => validatePlainText(v, 80, p),
        unit: (v, p) => validatePlainText(v, 40, p),
        items: (v, p) =>
          validateArray(
            v,
            1,
            12,
            (item, ip) => {
              if (!isPlainObject(item)) return fail("bad_args", "invalid type", ip);
              return validateProperties(
                item,
                ["label", "value"],
                {
                  label: (lv, lp) => validatePlainText(lv, 80, lp),
                  value: (vv, vp) => validateNumber(vv, 0, 1e12, vp),
                },
                ip
              );
            },
            p
          ),
      },
      ptr
    );
  },
  checklist(comp, ptr) {
    return validateProperties(
      comp,
      ["type", "title", "items"],
      {
        type: (v, p) => (v === "checklist" ? null : fail("bad_args", "invalid type", p)),
        title: (v, p) => validatePlainText(v, 80, p),
        items: (v, p) =>
          validateArray(
            v,
            1,
            20,
            (item, ip) => {
              if (!isPlainObject(item)) return fail("bad_args", "invalid type", ip);
              return validateProperties(
                item,
                ["id", "label"],
                {
                  id: (iv, ip2) => {
                    if (typeof iv !== "string") return fail("bad_args", "invalid type", ip2);
                    return reChecklistId.test(iv) ? null : fail(null, "bound violation", ip2);
                  },
                  label: (lv, lp) => validatePlainText(lv, 160, lp),
                  checked: (cv, cp) => (typeof cv === "boolean" ? null : fail("bad_args", "invalid type", cp)),
                },
                ip
              );
            },
            p
          ),
      },
      ptr
    );
  },
};

function validateComponent(comp, ptr) {
  if (!isPlainObject(comp)) return fail("bad_args", "invalid type", ptr);
  if (!Object.hasOwn(comp, "type")) return fail("bad_args", "missing required field", ptrJoin(ptr, "type"));
  const tag = comp.type;
  if (typeof tag !== "string") return fail("bad_args", "invalid type", ptrJoin(ptr, "type"));
  if (!Object.hasOwn(widgetValidators, tag)) return fail("bad_args", "unknown widget type", ptr);
  return widgetValidators[tag](comp, ptr);
}

function referenceValidateRaw(rawText) {
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return fail(null, "unparseable JSON", "");
  }

  const deepPtr = findDeepPointer(payload);
  if (deepPtr !== null) return fail("bad_args", "invalid type", deepPtr);

  if (!isPlainObject(payload)) return fail("bad_args", "invalid type", "");

  const rootErr = validateProperties(
    payload,
    ["version", "components"],
    {
      version: (v, p) => (v === 1 ? null : fail(null, "unknown version", p)),
      components: (v, p) => validateArray(v, 1, 4, validateComponent, p),
    },
    ""
  );
  if (rootErr) return rootErr;

  const astralPtr = findAstralOrSurrogate(payload, "");
  if (astralPtr !== null) return fail(null, "string filter", astralPtr);

  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > byteCap) return fail("too_large", "over byte cap", "");

  for (let i = 0; i < payload.components.length; i += 1) {
    const comp = payload.components[i];
    if (comp.type === "table") {
      const width = comp.columns.length;
      for (let ri = 0; ri < comp.rows.length; ri += 1) {
        if (comp.rows[ri].length !== width) {
          return fail(null, "row length mismatch", `/components/${i}/rows/${ri}`);
        }
      }
    } else if (comp.type === "checklist") {
      const seen = new Set();
      for (const item of comp.items) {
        if (seen.has(item.id)) return fail(null, "duplicate id", `/components/${i}`);
        seen.add(item.id);
      }
    }
  }

  return { ok: true, code: null, reason: null, pointer: "" };
}

const printableWords = [
  "Queue depth",
  "Café Münster",
  "任务完成",
  "✅ Done",
  "p95 latency",
  "3m 42s",
  "ok",
  "degraded",
  "throughput",
  "Node 20",
  "v1.1",
  "ops/sec",
  "stage~1/a",
];

function randWord(rng, maxLen = 40) {
  const base = pick(rng, printableWords);
  if (codePointLength(base) <= maxLen) return base;
  return [...base].slice(0, maxLen).join("");
}

function randAscii(rng, len) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-";
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[randInt(rng, 0, alphabet.length - 1)];
  return out.trim() ? out : `x${out.slice(1)}`;
}

function randId(rng, idx) {
  const choices = [`step_${idx}`, `id-${idx}`, `A${idx}_ok`, randAscii(rng, randInt(rng, 1, 16)).replace(/ /g, "_")];
  return pick(rng, choices).slice(0, 40);
}

function genStat(rng) {
  const out = { type: "stat", title: randWord(rng, 60), value: randWord(rng, 60) };
  if (rng() < 0.6) out.detail = randWord(rng, 120);
  return out;
}

function genTable(rng, forceEmptyRows = false) {
  const cols = randInt(rng, 1, 6);
  const columns = Array.from({ length: cols }, (_, i) => `Col ${i + 1} ${randWord(rng, 20)}`.slice(0, 60));
  const rowCount = forceEmptyRows ? 0 : randInt(rng, 0, 6);
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      if (rng() < 0.45) {
        row.push(pick(rng, [0, -1, 42, 999999, -1e12, 1e12, randInt(rng, -5000, 5000)]));
      } else {
        row.push(randWord(rng, 80));
      }
    }
    rows.push(row);
  }
  return { type: "table", title: randWord(rng, 60), columns, rows };
}

function genBarChart(rng) {
  const count = randInt(rng, 1, 8);
  const items = Array.from({ length: count }, (_, i) => ({
    label: `item-${i} ${randWord(rng, 30)}`.slice(0, 80),
    value: pick(rng, [0, 1, 42, 1e12, randInt(rng, 0, 100000)]),
  }));
  const out = { type: "bar_chart", title: randWord(rng, 60), items };
  if (rng() < 0.5) out.unit = randWord(rng, 30);
  return out;
}

function genChecklist(rng) {
  const count = randInt(rng, 1, 8);
  const items = Array.from({ length: count }, (_, i) => {
    const item = { id: randId(rng, i), label: randWord(rng, 100) };
    if (rng() < 0.6) item.checked = rng() < 0.5;
    return item;
  });
  return { type: "checklist", title: randWord(rng, 60), items };
}

function genValidPayload(rng) {
  const count = randInt(rng, 1, 4);
  const gens = [genStat, genTable, genBarChart, genChecklist];
  const components = Array.from({ length: count }, () => pick(rng, gens)(rng));
  return { version: 1, components };
}

function mutateStringFilter(rng) {
  const astralCps = [0x110bd, 0x110cd, 0x13430, 0x1343f, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0001, 0xe0020, 0xe007f];
  const bmpBanned = [0x00, 0x07, 0x09, 0x0a, 0x1f, 0x7f, 0x85, 0x9f, 0xad, 0x600, 0x61c, 0x6dd, 0x70f, 0x890, 0x8e2, 0x180e, 0x200b, 0x200d, 0x200e, 0x2028, 0x202e, 0x2060, 0x2066, 0xfeff, 0xfffb];
  const choice = randInt(rng, 0, 6);
  if (choice === 0) return pick(rng, ["<b>bold</b>", "a < b", "x > y", "<script>"]);
  if (choice === 1) return pick(rng, ["http://a", "HTTPS://a", "File://x", "dAtA:text/plain", "JavaScript:1", "vbscript:x"]);
  if (choice === 2) return pick(rng, ["//example.com", "foo//bar"]);
  if (choice === 3) return `a${String.fromCharCode(pick(rng, bmpBanned))}b`;
  if (choice === 4) return "👨‍👩‍👧";
  if (choice === 5) return `x${String.fromCodePoint(pick(rng, astralCps))}y`;
  return `a${String.fromCharCode(pick(rng, [0xd800, 0xdbff, 0xdc00, 0xdfff]))}b`;
}

function buildDeep(depth, leaf) {
  let cur = leaf;
  for (let i = 0; i < depth; i += 1) {
    cur = i % 2 === 0 ? [cur] : { "k~1/a": cur };
  }
  return cur;
}

function buildCases() {
  const rng = createRng(seed);
  const cases = [];
  const pushRaw = (category, raw) => cases.push({ category, raw });
  const pushObj = (category, obj) => cases.push({ category, raw: JSON.stringify(obj) });

  // 1. Valid payloads (~1,300)
  for (let i = 0; i < 1300; i += 1) {
    const p = genValidPayload(rng);
    if (Buffer.byteLength(JSON.stringify(p), "utf8") <= byteCap) {
      pushObj("valid", p);
    } else {
      pushObj("valid", { version: 1, components: [genStat(rng)] });
    }
  }

  // 2. Boundary cases (~450)
  for (let i = 0; i < 450; i += 1) {
    const kind = i % 9;
    if (kind === 0) {
      pushObj("boundary", {
        version: 1,
        components: [{ type: "stat", title: "A".repeat(80), value: "B".repeat(80), detail: "C".repeat(160) }],
      });
    } else if (kind === 1) {
      pushObj("boundary", {
        version: 1,
        components: [{ type: "table", title: "T", columns: Array(6).fill("C".repeat(60)), rows: [] }],
      });
    } else if (kind === 2) {
      pushObj("boundary", {
        version: 1,
        components: [{
          type: "table",
          title: "Max",
          columns: Array.from({ length: 6 }, (_, c) => `C${c}`),
          rows: Array.from({ length: 20 }, () => ["x", -1e12, 1e12, 0, "y".repeat(20), 1]),
        }],
      });
    } else if (kind === 3) {
      pushObj("boundary", {
        version: 1,
        components: [{
          type: "bar_chart",
          title: "Max",
          unit: "U".repeat(40),
          items: Array.from({ length: 12 }, (_, k) => ({ label: "L".repeat(80), value: k === 0 ? 0 : 1e12 })),
        }],
      });
    } else if (kind === 4) {
      pushObj("boundary", {
        version: 1,
        components: [{
          type: "checklist",
          title: "Max",
          items: Array.from({ length: 20 }, (_, k) => ({ id: `${"i".repeat(37)}_${String(k).padStart(2, "0")}`, label: "L".repeat(160), checked: k % 2 === 0 })),
        }],
      });
    } else if (kind === 5) {
      // Exact 16,384 bytes vs 16,385 bytes
      const base = { version: 1, components: [] };
      for (let c = 0; c < 4; c += 1) {
        base.components.push({
          type: "table",
          title: `T${c}`,
          columns: ["A", "B", "C", "D", "E", "F"],
          rows: Array.from({ length: 18 }, () => Array(6).fill("x".repeat(32))),
        });
      }
      const curBytes = Buffer.byteLength(JSON.stringify(base), "utf8");
      const diff = byteCap - curBytes;
      if (diff >= 5) {
        const targetLen = 32 + diff + (i % 2 === 0 ? 0 : 1);
        if (targetLen <= 160) {
          base.components[3].rows[0][0] = "x".repeat(targetLen);
        }
      }
      pushObj("boundary", base);
    } else if (kind === 6) {
      // Astral printable emoji counts as 1 code point for maxLength 80
      pushObj("boundary", {
        version: 1,
        components: [{ type: "stat", title: "✅".repeat(80), value: "😀".repeat(80) }],
      });
    } else if (kind === 7) {
      // Exact 32 depth (allowed if inside valid structure -> max valid depth is 5, so test exact 32 invalid vs 33 invalid!)
      pushObj("boundary", buildDeep(32, 1));
    } else {
      pushObj("boundary", { version: 1, components: [genStat(rng), genTable(rng, true), genBarChart(rng), genChecklist(rng)] });
    }
  }

  // 3. Bounds violations (~750)
  for (let i = 0; i < 750; i += 1) {
    const p = genValidPayload(rng);
    const mode = i % 15;
    if (mode === 0) p.components = [];
    else if (mode === 1) p.components.push(genStat(rng), genStat(rng), genStat(rng), genStat(rng));
    else if (mode === 2) p.components[0].title = "";
    else if (mode === 3) p.components[0].title = pick(rng, ["   ", "\t", " \u00A0 "]);
    else if (mode === 4) p.components[0].title = "T".repeat(81);
    else if (mode === 5) p.components[0] = { type: "stat", title: "S", value: "V".repeat(81) };
    else if (mode === 6) p.components[0] = { type: "stat", title: "S", value: "V", detail: "D".repeat(161) };
    else if (mode === 7) p.components[0] = { type: "table", title: "T", columns: ["A", "B", "C", "D", "E", "F", "G"], rows: [] };
    else if (mode === 8) p.components[0] = { type: "table", title: "T", columns: ["C".repeat(61)], rows: [] };
    else if (mode === 9) p.components[0] = { type: "table", title: "T", columns: ["A"], rows: Array(21).fill(["x"]) };
    else if (mode === 10) p.components[0] = { type: "bar_chart", title: "B", unit: "U".repeat(41), items: [{ label: "a", value: 1 }] };
    else if (mode === 11) p.components[0] = { type: "bar_chart", title: "B", items: Array.from({ length: 13 }, (_, k) => ({ label: `L${k}`, value: k })) };
    else if (mode === 12) p.components[0] = { type: "bar_chart", title: "B", items: [{ label: "a", value: pick(rng, [-1, -0.01, 1e12 + 1]) }] };
    else if (mode === 13) p.components[0] = { type: "checklist", title: "C", items: Array.from({ length: 21 }, (_, k) => ({ id: `i${k}`, label: "L" })) };
    else p.components[0] = { type: "checklist", title: "C", items: [{ id: "id_1", label: "L".repeat(161) }] };
    pushObj("bounds", p);
  }

  // 4. Wrong types, missing/extra keys, version errors, __proto__, RFC 6901 keys (~800)
  for (let i = 0; i < 800; i += 1) {
    const mode = i % 16;
    if (mode === 0) pushObj("types", pick(rng, [null, true, false, 1, "stat", [], ["a"]]));
    else if (mode === 1) pushObj("types", { components: [genStat(rng)] });
    else if (mode === 2) pushObj("types", { version: pick(rng, [0, 2, "1", null, true, 1.5]), components: [genStat(rng)] });
    else if (mode === 3) pushObj("types", { version: 1 });
    else if (mode === 4) pushObj("types", { version: 1, components: pick(rng, [null, {}, "x", 1]) });
    else if (mode === 5) pushObj("types", { version: 1, components: [genStat(rng)], extra: 1 });
    else if (mode === 6) pushRaw("types", `{"version":1,"components":[{"type":"stat","title":"t","value":"v"}],"__proto__":1}`);
    else if (mode === 7) pushRaw("types", `{"version":1,"components":[{"type":"stat","title":"t","value":"v","__proto__":1}]}`);
    else if (mode === 8) pushObj("types", { version: 1, components: [genStat(rng)], "a~b/c": 1 });
    else if (mode === 9) pushObj("types", { version: 1, components: [{ type: "stat", title: "t", value: "v", "x/y~z": true }] });
    else if (mode === 10) pushObj("types", { version: 1, components: [{ type: "stat", title: "t", value: 123 }] });
    else if (mode === 11) pushObj("types", { version: 1, components: [{ type: "stat", value: "v" }] });
    else if (mode === 12) pushObj("types", { version: 1, components: [{ type: "bar_chart", title: "b", items: [{ label: "a", value: "5" }] }] });
    else if (mode === 13) pushObj("types", { version: 1, components: [{ type: "bar_chart", title: "b", items: [{ label: "a", value: true }] }] });
    else if (mode === 14) pushObj("types", { version: 1, components: [{ type: "checklist", title: "c", items: [{ id: "a", label: "l", checked: "yes" }] }] });
    else pushObj("types", { version: 1, components: [{ type: "stat", title: "toString", value: "constructor", prototype: 1 }] });
  }

  // 5. BMP + astral Cf + lone surrogates (~750)
  for (let i = 0; i < 750; i += 1) {
    const bad = mutateStringFilter(rng);
    const target = i % 6;
    if (target === 0) {
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"stat","title":${JSON.stringify(bad)},"value":"ok"}]}`);
    } else if (target === 1) {
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"stat","title":"ok","value":"ok","detail":${JSON.stringify(bad)}}]}`);
    } else if (target === 2) {
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"table","title":"t","columns":[${JSON.stringify(bad)}],"rows":[]}]}`);
    } else if (target === 3) {
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"bar_chart","title":"b","unit":${JSON.stringify(bad)},"items":[{"label":"ok","value":1}]}]}`);
    } else if (target === 4) {
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"checklist","title":"c","items":[{"id":"ok_1","label":${JSON.stringify(bad)}}]}]}`);
    } else {
      // Explicit raw \uD800 lone surrogate escape (survives JSON.stringify vs raw)
      const esc = pick(rng, ["\\uD800", "a\\uDBFFb", "\\uDC00", "z\\uDFFF"]);
      pushRaw("stringFilter", `{"version":1,"components":[{"type":"stat","title":"${esc}","value":"ok"}]}`);
    }
  }

  // 6. Unhashable type, unknown type, missing type, non-object component (~350)
  for (let i = 0; i < 350; i += 1) {
    const mode = i % 8;
    if (mode === 0) pushObj("widgetType", { version: 1, components: [{ type: ["stat"], title: "t", value: "v" }] });
    else if (mode === 1) pushObj("widgetType", { version: 1, components: [{ type: { k: 1 }, title: "t", value: "v" }] });
    else if (mode === 2) pushObj("widgetType", { version: 1, components: [{ type: 1, title: "t", value: "v" }] });
    else if (mode === 3) pushObj("widgetType", { version: 1, components: [{ type: null, title: "t", value: "v" }] });
    else if (mode === 4) pushObj("widgetType", { version: 1, components: [{ type: true, title: "t", value: "v" }] });
    else if (mode === 5) pushObj("widgetType", { version: 1, components: [{ title: "t", value: "v" }] });
    else if (mode === 6) pushObj("widgetType", { version: 1, components: [{ type: pick(rng, ["gauge", "handbook", "card", ""]), title: "t", value: "v" }] });
    else pushObj("widgetType", { version: 1, components: [pick(rng, [null, [], "stat", 42, false])] });
  }

  // 7. Table row mismatches & bad table cells (~350)
  for (let i = 0; i < 350; i += 1) {
    const mode = i % 5;
    if (mode === 0) {
      pushObj("tableRow", { version: 1, components: [{ type: "table", title: "T", columns: ["A", "B"], rows: [["1"]] }] });
    } else if (mode === 1) {
      pushObj("tableRow", { version: 1, components: [{ type: "table", title: "T", columns: ["A", "B"], rows: [["1", "2", "3"]] }] });
    } else if (mode === 2) {
      pushObj("tableRow", { version: 1, components: [{ type: "table", title: "T", columns: ["A"], rows: [[]] }] });
    } else if (mode === 3) {
      pushObj("tableRow", { version: 1, components: [{ type: "table", title: "T", columns: ["A"], rows: [[pick(rng, [true, null, {}, [], 1e13, -1e13])]] }] });
    } else {
      pushObj("tableRow", { version: 1, components: [{ type: "table", title: "T", columns: ["A"], rows: [[pick(rng, ["", "   ", "<b>", "x".repeat(161)])]] }] });
    }
  }

  // 8. Checklist duplicate & bad IDs (~300)
  for (let i = 0; i < 300; i += 1) {
    const mode = i % 5;
    if (mode === 0) {
      pushObj("checklistId", {
        version: 1,
        components: [{ type: "checklist", title: "C", items: [{ id: "dup", label: "a" }, { id: "dup", label: "b" }] }],
      });
    } else if (mode === 1) {
      // Same id across TWO different checklists is allowed!
      pushObj("checklistId", {
        version: 1,
        components: [
          { type: "checklist", title: "C1", items: [{ id: "same", label: "a" }] },
          { type: "checklist", title: "C2", items: [{ id: "same", label: "b" }] },
        ],
      });
    } else if (mode === 2) {
      pushObj("checklistId", { version: 1, components: [{ type: "checklist", title: "C", items: [{ id: "bad\n", label: "a" }] }] });
    } else if (mode === 3) {
      pushObj("checklistId", { version: 1, components: [{ type: "checklist", title: "C", items: [{ id: pick(rng, ["", "a b", "a/b", "a.b", "A".repeat(41)]), label: "a" }] }] });
    } else {
      pushObj("checklistId", { version: 1, components: [{ type: "checklist", title: "C", items: [{ id: 123, label: "a" }] }] });
    }
  }

  // 9. Deep nesting (>32) (~250)
  for (let i = 0; i < 250; i += 1) {
    const depth = randInt(rng, 33, 45);
    const mode = i % 3;
    if (mode === 0) {
      pushObj("deepNesting", buildDeep(depth, "leaf"));
    } else if (mode === 1) {
      pushObj("deepNesting", { version: 1, components: [{ type: "stat", title: "t", value: "v", extra: buildDeep(depth, 1) }] });
    } else {
      pushObj("deepNesting", { version: 1, components: [buildDeep(depth, { type: "stat" })] });
    }
  }

  // 10. Malformed JSON & non-finite numbers (~250)
  for (let i = 0; i < 250; i += 1) {
    const mode = i % 6;
    if (mode === 0) pushRaw("malformedJson", '{"version":1,"components":[{"type":"bar_chart","title":"b","items":[{"label":"a","value":NaN}]}]}');
    else if (mode === 1) pushRaw("malformedJson", '{"version":1,"components":[{"type":"bar_chart","title":"b","items":[{"label":"a","value":Infinity}]}]}');
    else if (mode === 2) pushRaw("malformedJson", '{"version":1,"components":[{"type":"table","title":"t","columns":["a"],"rows":[[-Infinity]]}]}');
    else if (mode === 3) pushRaw("malformedJson", '{"version":1,"components":[');
    else if (mode === 4) pushRaw("malformedJson", '{"version":1,"components":[{"type":"stat","title":"a","value":"b",}]}');
    else pushRaw("malformedJson", "");
  }

  // 11. Committed examples corpus
  for (const dir of ["examples/valid", "examples/invalid", "examples/boundary"]) {
    const fullDir = path.join(root, dir);
    for (const file of readdirSync(fullDir).sort()) {
      if (!file.endsWith(".json") || file === "manifest.json") continue;
      pushRaw(`fixture:${dir}`, readFileSync(path.join(fullDir, file), "utf8"));
    }
  }

  return cases;
}

function detectPython() {
  const candidates =
    process.platform === "win32"
      ? [
          ["py", ["-3"]],
          ["python", []],
          ["python3", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];
  for (const [cmd, prefix] of candidates) {
    const res = spawnSync(cmd, [...prefix, "-c", "import sys; assert sys.hexversion >= 0x03000000"], {
      encoding: "utf8",
    });
    if (res.status === 0) return { cmd, prefix };
  }
  throw new Error("Could not locate a working Python 3 interpreter (tried py -3 / python3 / python)");
}

function runPythonStream(py, cases) {
  const input = `${cases.map((c) => JSON.stringify(c.raw)).join("\n")}\n`;
  const res = spawnSync(py.cmd, [...py.prefix, validatorPath, "--jsonl"], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`validate.py --jsonl failed with status ${res.status}: ${res.stderr}`);
  }
  const lines = res.stdout.split(/\r?\n/).filter((ln) => ln.length > 0);
  if (lines.length !== cases.length) {
    throw new Error(`validate.py --jsonl returned ${lines.length} lines for ${cases.length} cases`);
  }
  return lines.map((ln) => JSON.parse(ln));
}

function runPythonFileBatch(py, cases) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "genui-fuzz-"));
  try {
    const files = cases.map((c, idx) => {
      const filePath = path.join(tmpDir, `case-${idx}.json`);
      writeFileSync(filePath, c.raw, "utf8");
      return filePath;
    });
    const res = spawnSync(py.cmd, [...py.prefix, validatorPath, "--json", ...files], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.status !== 0 && res.status !== 1) {
      throw new Error(`validate.py --json failed with status ${res.status}: ${res.stderr}`);
    }
    const lines = res.stdout.split(/\r?\n/).filter((ln) => ln.length > 0);
    if (lines.length !== files.length) {
      throw new Error(`validate.py --json returned ${lines.length} lines for ${files.length} files`);
    }
    return lines.map((ln) => JSON.parse(ln));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function verdictsMatch(expected, actual) {
  return (
    expected.ok === actual.ok &&
    expected.code === actual.code &&
    expected.reason === actual.reason &&
    expected.pointer === actual.pointer
  );
}

function main() {
  const start = Date.now();
  const py = detectPython();
  const cases = buildCases();
  if (cases.length < minCases) {
    console.error(`FAIL: generated ${cases.length} cases, need at least ${minCases}`);
    process.exit(1);
  }

  const pyStreamResults = runPythonStream(py, cases);
  const sampleIndices = [];
  for (let i = 0; i < cases.length && sampleIndices.length < 120; i += Math.floor(cases.length / 120)) {
    sampleIndices.push(i);
  }
  const sampleCases = sampleIndices.map((idx) => cases[idx]);
  const pyBatchResults = runPythonFileBatch(py, sampleCases);

  const categoryCounts = new Map();
  let divergences = 0;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
    const ref = referenceValidateRaw(c.raw);
    const pyRes = pyStreamResults[i];
    if (!verdictsMatch(ref, pyRes)) {
      divergences += 1;
      if (divergences <= 10) {
        console.error(
          `DIVERGENCE #${divergences} [${c.category}] case=${i}: ref=${JSON.stringify(ref)} py=${JSON.stringify(pyRes)} raw=${c.raw.slice(0, 180)}`
        );
      }
    }
  }

  for (let j = 0; j < sampleCases.length; j += 1) {
    const idx = sampleIndices[j];
    const ref = referenceValidateRaw(sampleCases[j].raw);
    const pyBatch = pyBatchResults[j];
    if (!verdictsMatch(ref, pyBatch)) {
      divergences += 1;
      if (divergences <= 10) {
        console.error(
          `BATCH DIVERGENCE #${divergences} [${sampleCases[j].category}] case=${idx}: ref=${JSON.stringify(ref)} pyBatch=${JSON.stringify(pyBatch)}`
        );
      }
    }
  }

  const elapsedMs = Date.now() - start;
  const summary = [...categoryCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
  console.log(`fuzz-validator: ${cases.length} cases (${summary}); batchChecked=${sampleCases.length}; ${elapsedMs}ms`);
  if (divergences > 0) {
    console.error(`FAIL: ${divergences} verdict divergence(s) between JS reference validator and tools/validate.py.`);
    process.exit(1);
  }
  console.log(`PASS: 0 verdict divergences across ${cases.length} cases (>=${minCases} required).`);
  process.exit(0);
}

main();
