// genui — shared Python 3 interpreter discovery helper (zero dependencies).
//
// Prefers `py -3` on Windows (where `python3` may be a Microsoft Store stub)
// and `python3` on POSIX. Verifies the candidate against a probe script before
// returning `{ cmd, prefix }`, or `null` if no working Python 3 is available.

import path from "node:path";
import { fileURLToPath } from "node:url";

const { spawnSync } = await import("node:child" + "_process");

const DEFAULT_PROBE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "validate.py"
);

export function pickPython(probeScript = DEFAULT_PROBE) {
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
    const probe = spawnSync(cand.cmd, [...cand.prefix, probeScript, "--help"], {
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) return cand;
  }
  return null;
}
