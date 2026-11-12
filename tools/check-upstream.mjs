#!/usr/bin/env node
// genui — upstream provenance & watch checker (plain Node 20+, zero dependencies).
//
// Default (offline) mode:
//   Validates `upstream/sources.json` schema, 40-hex commit SHAs, watchedPaths,
//   and bidirectional parity with `docs/upstream-sources.md`.
//
// Watch mode (`--watch`):
//   Queries the GitHub REST API (honoring GITHUB_TOKEN when set) to check
//   whether any `watchedPaths` changed ahead of `pinnedSha`. Emits a JSON
//   summary to stdout (and optionally `--out <file>`) and exits:
//     0 — all watched paths are up to date (or error-free with no watched drift)
//     2 — at least one tracked repo has changes in `watchedPaths` (needs human)
//     1 — registry/parity failure or GitHub API error
//
// Usage:
//   node tools/check-upstream.mjs
//   node tools/check-upstream.mjs --watch [--out upstream-plan.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(root, "upstream", "sources.json");
const LEDGER_PATH = path.join(root, "docs", "upstream-sources.md");

const SHA40 = /^[0-9a-f]{40}$/;
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REQUIRED_FIELDS = [
  "repo",
  "license",
  "defaultBranch",
  "pinnedSha",
  "watchedPaths",
  "inheritedPattern",
  "localAdaptations",
  "exclusions",
  "verifyingCheck",
];

function parseArgs(argv) {
  const opts = { watch: false, out: null, timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--watch") opts.watch = true;
    else if (arg === "--out" && i + 1 < argv.length) opts.out = argv[++i];
    else if (arg === "--timeout" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) opts.timeoutMs = n;
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node tools/check-upstream.mjs [--watch] [--out <file>] [--timeout <ms>]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function validateRegistry() {
  const errors = [];
  if (!existsSync(REGISTRY_PATH)) {
    return { errors: ["Missing upstream/sources.json"], sources: [] };
  }
  if (!existsSync(LEDGER_PATH)) {
    return { errors: ["Missing docs/upstream-sources.md"], sources: [] };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    return { errors: [`upstream/sources.json is not valid JSON: ${err.message}`], sources: [] };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push("upstream/sources.json must be a JSON object");
    return { errors, sources: [] };
  }
  if (data.schemaVersion !== 1) {
    errors.push(`upstream/sources.json schemaVersion must be 1 (got ${String(data.schemaVersion)})`);
  }
  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    errors.push("upstream/sources.json sources must be a non-empty array");
    return { errors, sources: [] };
  }

  const seenRepos = new Set();
  for (let idx = 0; idx < data.sources.length; idx++) {
    const entry = data.sources[idx];
    const label = entry?.repo || `sources[${idx}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label}: entry must be an object`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      const val = entry[field];
      if (val === undefined || val === null || val === "") {
        errors.push(`${label}: missing required field "${field}"`);
      }
    }
    if (typeof entry.repo === "string") {
      if (!REPO_SLUG.test(entry.repo)) {
        errors.push(`${label}: invalid repo slug "${entry.repo}"`);
      }
      if (seenRepos.has(entry.repo)) {
        errors.push(`${label}: duplicate repo entry "${entry.repo}"`);
      }
      seenRepos.add(entry.repo);
    }
    if (typeof entry.pinnedSha !== "string" || !SHA40.test(entry.pinnedSha)) {
      errors.push(`${label}: pinnedSha must be a 40-char lowercase hex SHA`);
    }
    if (!Array.isArray(entry.watchedPaths) || entry.watchedPaths.length === 0) {
      errors.push(`${label}: watchedPaths must be a non-empty array`);
    } else {
      for (const wp of entry.watchedPaths) {
        if (typeof wp !== "string" || wp.trim() === "" || wp.startsWith("/") || wp.includes("..")) {
          errors.push(`${label}: invalid watchedPath "${String(wp)}"`);
        }
      }
    }
    if (typeof entry.verifyingCheck === "string") {
      const m = entry.verifyingCheck.match(/^(?:node|python3|py -3)\s+(tools\/\S+)/);
      if (m && !existsSync(path.join(root, m[1]))) {
        errors.push(`${label}: verifyingCheck references missing script "${m[1]}"`);
      }
    }
  }

  const ledger = readFileSync(LEDGER_PATH, "utf8");
  for (const entry of data.sources) {
    if (typeof entry.repo === "string" && !ledger.includes(entry.repo)) {
      errors.push(`docs/upstream-sources.md is missing repo "${entry.repo}"`);
    }
    if (typeof entry.pinnedSha === "string" && !ledger.includes(entry.pinnedSha)) {
      errors.push(`docs/upstream-sources.md is missing pinnedSha "${entry.pinnedSha}" for ${entry.repo}`);
    }
    if (typeof entry.license === "string" && !ledger.includes(entry.license)) {
      errors.push(`docs/upstream-sources.md is missing license "${entry.license}" for ${entry.repo}`);
    }
  }

  // Bidirectional check: every GitHub repo linked in the ledger tables/headings must be in sources.json
  const ledgerMatches = ledger.matchAll(/\[`([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)`\]\(https:\/\/github\.com\/\1\)/g);
  for (const m of ledgerMatches) {
    if (!seenRepos.has(m[1])) {
      errors.push(`docs/upstream-sources.md lists "${m[1]}" which is absent from upstream/sources.json`);
    }
  }

  return { errors, sources: data.sources };
}

async function ghGet(apiPath, timeoutMs) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "genui-upstream-watch/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com${apiPath}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${apiPath}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

function matchesWatchedPath(filename, watchedPath) {
  const clean = watchedPath.replace(/\/+$/, "");
  return filename === clean || filename.startsWith(`${clean}/`);
}

async function latestPathSha(repo, ref, watchedPath, timeoutMs) {
  const q = new URLSearchParams({ sha: ref, path: watchedPath, per_page: "1" });
  const commits = await ghGet(`/repos/${repo}/commits?${q.toString()}`, timeoutMs);
  return Array.isArray(commits) && commits.length > 0 ? commits[0].sha : null;
}

async function checkSourceRemote(entry, timeoutMs) {
  const { repo, defaultBranch, pinnedSha, watchedPaths } = entry;
  const headData = await ghGet(
    `/repos/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
    timeoutMs
  );
  const headSha = headData?.sha;
  if (!headSha) throw new Error(`Missing head SHA for ${repo}@${defaultBranch}`);

  if (headSha === pinnedSha) {
    return {
      repo,
      defaultBranch,
      pinnedSha,
      headSha,
      status: "current",
      changedWatchedPaths: [],
    };
  }

  const compare = await ghGet(`/repos/${repo}/compare/${pinnedSha}...${headSha}`, timeoutMs);
  const files = Array.isArray(compare?.files) ? compare.files : [];
  const complete = (compare?.ahead_by ?? 0) <= 250 && files.length < 300;

  let changedWatchedPaths = [];
  if (complete) {
    const touched = new Set();
    for (const f of files) {
      for (const wp of watchedPaths) {
        if (
          (f.filename && matchesWatchedPath(f.filename, wp)) ||
          (f.previous_filename && matchesWatchedPath(f.previous_filename, wp))
        ) {
          touched.add(wp);
        }
      }
    }
    changedWatchedPaths = [...touched];
  } else {
    for (const wp of watchedPaths) {
      const [pinnedPathSha, headPathSha] = await Promise.all([
        latestPathSha(repo, pinnedSha, wp, timeoutMs),
        latestPathSha(repo, headSha, wp, timeoutMs),
      ]);
      if (pinnedPathSha !== headPathSha) changedWatchedPaths.push(wp);
    }
  }

  return {
    repo,
    defaultBranch,
    pinnedSha,
    headSha,
    aheadBy: compare?.ahead_by ?? null,
    status: changedWatchedPaths.length > 0 ? "drifted" : "ahead-unwatched",
    changedWatchedPaths,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { errors, sources } = validateRegistry();

  if (errors.length > 0) {
    for (const err of errors) console.error(`FAIL: ${err}`);
    process.exit(1);
  }

  if (!opts.watch) {
    console.log(
      `upstream check: ${sources.length} tracked repo(s) in upstream/sources.json match docs/upstream-sources.md`
    );
    for (const s of sources) {
      console.log(`  ${s.repo} @ ${s.pinnedSha.slice(0, 7)} (${s.license}, ${s.watchedPaths.length} watched path(s))`);
    }
    console.log("PASS: upstream registry and provenance ledger are valid and in parity.");
    process.exit(0);
  }

  const results = [];
  let drifted = 0;
  let current = 0;
  let aheadUnwatched = 0;
  let apiErrors = 0;

  for (const entry of sources) {
    try {
      const result = await checkSourceRemote(entry, opts.timeoutMs);
      results.push(result);
      if (result.status === "drifted") drifted++;
      else if (result.status === "current") current++;
      else aheadUnwatched++;
    } catch (err) {
      apiErrors++;
      results.push({
        repo: entry.repo,
        defaultBranch: entry.defaultBranch,
        pinnedSha: entry.pinnedSha,
        headSha: null,
        status: "error",
        changedWatchedPaths: [],
        error: err.message,
      });
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    total: sources.length,
    current,
    aheadUnwatched,
    drifted,
    errors: apiErrors,
    results,
  };

  const json = JSON.stringify(summary, null, 2) + "\n";
  if (opts.out) {
    writeFileSync(path.resolve(opts.out), json, "utf8");
  }
  process.stdout.write(json);

  if (apiErrors > 0) process.exit(1);
  if (drifted > 0) process.exit(2);
  process.exit(0);
}

main();
