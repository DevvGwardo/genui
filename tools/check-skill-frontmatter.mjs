#!/usr/bin/env node
// genui — SKILL.md frontmatter & Hermes authoring/security lint (plain Node, zero dependencies).
//
// Lints skills/genui/:
//   1. SKILL.md opens and closes YAML frontmatter with `---`;
//   2. every top-level line in frontmatter is a `key: value` entry;
//   3. `name` is present, uses consistent quoting, and equals the skill
//      directory name (`genui`);
//   4. `description` is present, single-line, <= 60 chars (Hermes index cap),
//      ends with `.`, contains no `<` or `>`, and matches /genui/i;
//   5. `platforms` is present and lists valid OS names (macos, linux, windows);
//   6. SKILL.md body is < 24,000 chars;
//   7. no machine-local paths (/home/<user>/, /Users/<user>/, C:\Users\...);
//   8. no paste-unsafe shell fences (\\\s+#);
//   9. no dangling references/|templates/|assets/ links inside skills/genui/;
//  10. static security-guard scan passes across skills/genui/.
//
// Usage:  node tools/check-skill-frontmatter.mjs   (exit 0 = lint clean)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "genui");
const file = path.join(skillDir, "SKILL.md");
const rel = "skills/genui/SKILL.md";

const MAX_DESC_CHARS = 60;
const MAX_BODY_CHARS = 24000;
const VALID_PLATFORMS = new Set(["macos", "linux", "windows"]);

const problems = [];
let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`FAIL: cannot read ${rel}`);
  process.exit(1);
}
const lines = text.split(/\r?\n/);

console.log(`skill frontmatter & authoring lint: ${rel}`);

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

function unquoteString(raw, lineNo) {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const quote = trimmed[0];
  if (quote === "'" || quote === '"') {
    if (trimmed.length < 2 || trimmed[trimmed.length - 1] !== quote) {
      problems.push(`line ${lineNo}: value opens with ${quote} but does not close with it`);
      return trimmed.slice(1);
    }
    const inner = trimmed.slice(1, -1);
    return quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  return trimmed;
}

function unquote(entry) {
  return unquoteString(entry.value, entry.line);
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
  } else {
    if (!/genui/i.test(value)) {
      problems.push("description does not match /genui/i (the B1 trigger word)");
    }
    if (value.length > MAX_DESC_CHARS) {
      problems.push(`description length ${value.length} exceeds ${MAX_DESC_CHARS} chars (Hermes index cap)`);
    }
    if (!value.endsWith(".")) {
      problems.push("description must end with `.`");
    }
    if (/[<>]/.test(value)) {
      problems.push("description must not contain `<` or `>`");
    }
    console.log(`  description: ${value.length}/${MAX_DESC_CHARS} chars, ends with '.', no <>, matches /genui/i`);
  }
}

if (!entries.has("platforms")) {
  problems.push("no `platforms` key in the frontmatter");
} else {
  const entry = entries.get("platforms");
  const raw = entry.value.trim();
  const parsed = [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner !== "") {
      for (const part of inner.split(",")) {
        parsed.push(unquoteString(part, entry.line));
      }
    }
  } else if (raw === "" && close !== -1) {
    for (let i = entry.line; i < close; i++) {
      const sub = lines[i];
      if (sub.trim() === "") continue;
      if (!/^\s+/.test(sub)) break;
      const m = sub.match(/^\s+-\s+(.+?)\s*$/);
      if (!m) {
        problems.push(`line ${i + 1}: invalid list item under \`platforms\`: ${JSON.stringify(sub)}`);
        break;
      }
      parsed.push(unquoteString(m[1], i + 1));
    }
  } else {
    problems.push(`line ${entry.line}: \`platforms\` must be a YAML array (e.g. [macos, linux, windows])`);
  }

  if (parsed.length === 0) {
    problems.push("`platforms` must list at least one platform");
  } else {
    const seen = new Set();
    for (const p of parsed) {
      if (!VALID_PLATFORMS.has(p)) {
        problems.push(`invalid platform ${JSON.stringify(p)} (allowed: ${[...VALID_PLATFORMS].join(", ")})`);
      } else if (seen.has(p)) {
        problems.push(`duplicate platform ${JSON.stringify(p)}`);
      }
      seen.add(p);
    }
    console.log(`  platforms: [${parsed.join(", ")}]`);
  }
}

if (close !== -1) {
  const body = lines.slice(close + 1).join("\n");
  if (body.length >= MAX_BODY_CHARS) {
    problems.push(`SKILL.md body is ${body.length} chars — must be < ${MAX_BODY_CHARS}`);
  } else {
    console.log(`  body size: ${body.length}/${MAX_BODY_CHARS} chars`);
  }
}

function walkFiles(dirPath) {
  const out = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out.sort();
}

const LOCAL_PATH_PATTERNS = [
  { name: "Unix /home/<user>/ path", re: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "macOS /Users/<user>/ path", re: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: "Windows drive Users path", re: /[A-Za-z]:(?:\\|\/)Users(?:\\|\/)/ },
];

const SECURITY_PATTERNS = [
  {
    name: "pipe-to-shell download",
    re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|python3?)\b/i,
  },
  {
    name: "base64-decode-to-shell",
    re: /\bbase64\s+(?:-d|--decode)\b[^\n|]*\|\s*(?:sh|bash|zsh|python3?)\b/i,
  },
  {
    name: "suspicious network exfiltration",
    re: /\b(?:curl|wget|nc|ncat)\b[^\n]*(?:-d\s+@|--data[^\n]*@|\$\{?(?:ENV|API_KEY|TOKEN|SECRET|PASSWORD|AWS_|GITHUB_TOKEN|HERMES_))/i,
  },
  {
    name: "environment dump",
    re: /\b(?:printenv|export\s+-p|cat\s+\/proc\/self\/environ|process\.env|os\.environ)\b|\benv\s*\|/,
  },
  {
    name: "sensitive credential file access",
    re: /(?:~|\$HOME|%USERPROFILE%)\/\.(?:ssh|aws|gnupg|kube)\b|\/etc\/(?:shadow|passwd)\b/i,
  },
  {
    name: "prompt injection override phrase",
    re: /\b(?:ignore\s+(?:all\s+)?previous\s+instructions|disregard\s+(?:the\s+)?system\s+prompt|override\s+safety)\b/i,
  },
  {
    name: "hidden bidi or zero-width control character",
    re: /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/,
  },
];

const skillFiles = walkFiles(skillDir);
let danglingChecked = 0;

for (const absFile of skillFiles) {
  const relFile = path.relative(root, absFile).split(path.sep).join("/");
  const content = readFileSync(absFile, "utf8");
  const fileLines = content.split(/\r?\n/);

  fileLines.forEach((line, idx) => {
    for (const pat of LOCAL_PATH_PATTERNS) {
      if (pat.re.test(line)) {
        problems.push(`${relFile}:${idx + 1}: machine-local path (${pat.name})`);
      }
    }
    for (const sec of SECURITY_PATTERNS) {
      if (sec.re.test(line)) {
        problems.push(`${relFile}:${idx + 1}: security guard triggered (${sec.name})`);
      }
    }
  });

  if (absFile.endsWith(".md")) {
    // Check paste-unsafe shell fences (\\\s+#) inside fenced code blocks
    const fenceRe = /^```[^\n]*\n([\s\S]*?)^```/gm;
    for (const match of content.matchAll(fenceRe)) {
      const fenceText = match[1];
      if (/\\\s+#/.test(fenceText)) {
        const lineOffset = content.slice(0, match.index).split(/\r?\n/).length;
        problems.push(`${relFile}:${lineOffset}: paste-unsafe shell fence containing \`\\ #\` continuation comment`);
      }
    }

    // Check dangling references/|templates/|assets/ links outside fenced code blocks
    const withoutFences = content.replace(/```[\s\S]*?```/g, "");
    const refRe = /(?:^|[\s(\[`"'])((?:references|templates|assets)\/[A-Za-z0-9._/@-]+)(?=$|[\s)\]`"',.;:!?])/gm;
    for (const m of withoutFences.matchAll(refRe)) {
      const target = m[1].split("#")[0];
      danglingChecked++;
      const resolved = path.resolve(path.dirname(absFile), target);
      const insideSkill =
        resolved === skillDir || resolved.startsWith(skillDir + path.sep);
      if (!insideSkill || !existsSync(resolved)) {
        problems.push(`${relFile}: dangling skill resource reference \`${target}\``);
      }
    }
  }
}

console.log(`  hygiene & security scan: ${skillFiles.length} file(s) under skills/genui/, ${danglingChecked} resource ref(s) checked`);

if (problems.length === 0) {
  console.log("PASS: frontmatter, authoring standards, and security checks are clean.");
  process.exit(0);
}
for (const problem of problems) console.error(`FAIL: ${problem}`);
console.error(`FAIL: ${problems.length} problem(s).`);
process.exit(1);
