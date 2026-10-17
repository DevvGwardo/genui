#!/usr/bin/env node
// genui C5 measurement tool (committed, zero-dependency, plain Node).
//
// Purpose: measure the emitted-context size of one representative dashboard
// rendered two ways:
//   (a) the genui v1 render_ui payload (compact JSON, exactly as it is sent), and
//   (b) the equivalent single-file HTML artifact an agent would emit for the
//       webview/iframe approach — at three levels of styling: minimal,
//       typical, and richly styled.
//
// It reports UTF-8 bytes and characters for each representation and the
// reduction of (a) relative to each HTML baseline. No model tokenizer is
// available in this environment, so size (UTF-8 bytes) is the measurement
// basis; emitted-token counts track emitted text size proportionally.
//
// Run from the repository root: node tools/measure-context-reduction.mjs

const bytes = (s) => Buffer.byteLength(s, "utf8");
const chars = (s) => [...s].length;

// --- (a) the genui payload, exactly as it would be sent --------------------
const genuiPayload = JSON.stringify({
  version: 1,
  components: [
    { type: "stat", title: "Sprint velocity", value: "42 points", detail: "Average of the last 6 sprints" },
    {
      type: "table",
      title: "Open work by owner",
      columns: ["Owner", "Open", "Blocked"],
      rows: [
        ["Ana", 7, 1],
        ["Ben", 5, 2],
        ["Chen", 9, 0],
        ["Dia", 4, 3],
        ["Eli", 6, 1],
        ["Fay", 8, 0],
        ["Gus", 3, 2],
        ["Hana", 7, 1],
      ],
    },
    {
      type: "bar_chart",
      title: "Tickets closed per day",
      items: [
        { label: "Mon", value: 12 },
        { label: "Tue", value: 15 },
        { label: "Wed", value: 9 },
        { label: "Thu", value: 17 },
        { label: "Fri", value: 14 },
        { label: "Sat", value: 4 },
      ],
    },
    {
      type: "checklist",
      title: "Release steps",
      items: [
        { id: "tag", label: "Tag the release", checked: true },
        { id: "notes", label: "Write release notes", checked: true },
        { id: "build", label: "Build artifacts", checked: false },
        { id: "deploy", label: "Deploy to staging", checked: false },
        { id: "smoke", label: "Run smoke tests", checked: false },
        { id: "prod", label: "Deploy to production", checked: false },
      ],
    },
  ],
});

// --- (b) HTML baselines for the same content -------------------------------

const htmlMinimal = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Weekly project status</title></head>
<body>
<h1>Weekly project status</h1>
<h2>Sprint velocity</h2><p>42 points</p><p>Average of the last 6 sprints</p>
<h2>Open work by owner</h2>
<table><thead><tr><th>Owner</th><th>Open</th><th>Blocked</th></tr></thead><tbody>
<tr><td>Ana</td><td>7</td><td>1</td></tr>
<tr><td>Ben</td><td>5</td><td>2</td></tr>
<tr><td>Chen</td><td>9</td><td>0</td></tr>
<tr><td>Dia</td><td>4</td><td>3</td></tr>
<tr><td>Eli</td><td>6</td><td>1</td></tr>
<tr><td>Fay</td><td>8</td><td>0</td></tr>
<tr><td>Gus</td><td>3</td><td>2</td></tr>
<tr><td>Hana</td><td>7</td><td>1</td></tr>
</tbody></table>
<h2>Tickets closed per day</h2>
<ul><li>Mon: 12</li><li>Tue: 15</li><li>Wed: 9</li><li>Thu: 17</li><li>Fri: 14</li><li>Sat: 4</li></ul>
<h2>Release steps</h2>
<ul><li>Tag the release</li><li>Write release notes</li><li>Build artifacts</li><li>Deploy to staging</li><li>Run smoke tests</li><li>Deploy to production</li></ul>
</body>
</html>`;

const htmlTypical = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly project status</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--text:#e6e8ee;--muted:#9aa3b2;--border:#262b36;--accent:#5b8def}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{display:grid;gap:16px;max-width:720px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
h1{margin:0;font-size:20px}
h2{margin:0 0 12px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.stat .value{margin:0;font-size:32px;font-weight:700}
.stat .detail{margin:4px 0 0;color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--border)}
tbody tr:nth-child(odd){background:rgba(255,255,255,.02)}
.bar{display:grid;grid-template-columns:48px 1fr 40px;gap:8px;align-items:center;margin:6px 0;font-size:13px}
.track{height:10px;background:var(--border);border-radius:5px;overflow:hidden}
.fill{height:100%;background:var(--accent)}
.check{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:14px}
.check input{accent-color:var(--accent)}
@media (prefers-color-scheme:light){:root{--bg:#f6f7fb;--card:#ffffff;--text:#1c2230;--muted:#5b6472;--border:#e3e7ef}}
</style>
</head>
<body>
<main>
<h1>Weekly project status</h1>
<section class="card stat"><h2>Sprint velocity</h2><p class="value">42 points</p><p class="detail">Average of the last 6 sprints</p></section>
<section class="card"><h2>Open work by owner</h2><table><thead><tr><th>Owner</th><th>Open</th><th>Blocked</th></tr></thead><tbody><tr><td>Ana</td><td>7</td><td>1</td></tr><tr><td>Ben</td><td>5</td><td>2</td></tr><tr><td>Chen</td><td>9</td><td>0</td></tr><tr><td>Dia</td><td>4</td><td>3</td></tr><tr><td>Eli</td><td>6</td><td>1</td></tr><tr><td>Fay</td><td>8</td><td>0</td></tr><tr><td>Gus</td><td>3</td><td>2</td></tr><tr><td>Hana</td><td>7</td><td>1</td></tr></tbody></table></section>
<section class="card"><h2>Tickets closed per day</h2><div class="bar"><span>Mon</span><div class="track"><div class="fill" style="width:71%"></div></div><span>12</span></div><div class="bar"><span>Tue</span><div class="track"><div class="fill" style="width:88%"></div></div><span>15</span></div><div class="bar"><span>Wed</span><div class="track"><div class="fill" style="width:53%"></div></div><span>9</span></div><div class="bar"><span>Thu</span><div class="track"><div class="fill" style="width:100%"></div></div><span>17</span></div><div class="bar"><span>Fri</span><div class="track"><div class="fill" style="width:82%"></div></div><span>14</span></div><div class="bar"><span>Sat</span><div class="track"><div class="fill" style="width:24%"></div></div><span>4</span></div></section>
<section class="card"><h2>Release steps</h2><label class="check"><input type="checkbox" checked> Tag the release</label><label class="check"><input type="checkbox" checked> Write release notes</label><label class="check"><input type="checkbox"> Build artifacts</label><label class="check"><input type="checkbox"> Deploy to staging</label><label class="check"><input type="checkbox"> Run smoke tests</label><label class="check"><input type="checkbox"> Deploy to production</label></section>
</main>
</body>
</html>`;

const htmlRich = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly project status</title>
<style>
:root{--bg:#0f1115;--bg-elev:#171a21;--text:#e6e8ee;--muted:#9aa3b2;--border:#262b36;--accent:#5b8def;--accent-2:#7c5bef;--ok:#2fbf71}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;background:radial-gradient(1200px 600px at 50% -10%,rgba(91,141,239,.14),transparent),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.45}
main{display:grid;gap:18px;max-width:760px;margin:0 auto}
.card{background:var(--bg-elev);border:1px solid var(--border);border-radius:14px;padding:18px 20px;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:border-color .15s ease}
.card:hover{border-color:rgba(91,141,239,.45)}
h1{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}
h2{margin:0 0 14px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.stat .value{margin:0;font-size:36px;font-weight:800;background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat .detail{margin:6px 0 0;color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
tbody tr:nth-child(odd){background:rgba(255,255,255,.025)}
tbody tr:hover{background:rgba(91,141,239,.08)}
.chart{display:grid;grid-template-columns:44px 1fr 36px;gap:10px;align-items:center;margin:8px 0;font-size:13px}
.track{height:12px;background:var(--border);border-radius:6px;overflow:hidden}
.fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:6px}
.check{display:flex;gap:10px;align-items:center;padding:7px 0;font-size:14px}
.check input{width:16px;height:16px;accent-color:var(--accent)}
.check.done{color:var(--muted);text-decoration:line-through}
</style>
</head>
<body>
<main>
<h1>Weekly project status</h1>
<section class="card stat" aria-label="Sprint velocity summary"><h2>Sprint velocity</h2><p class="value">42 points</p><p class="detail">Average of the last 6 sprints</p></section>
<section class="card" aria-label="Open work by owner"><h2>Open work by owner</h2><table><thead><tr><th scope="col">Owner</th><th scope="col">Open</th><th scope="col">Blocked</th></tr></thead><tbody><tr><td>Ana</td><td>7</td><td>1</td></tr><tr><td>Ben</td><td>5</td><td>2</td></tr><tr><td>Chen</td><td>9</td><td>0</td></tr><tr><td>Dia</td><td>4</td><td>3</td></tr><tr><td>Eli</td><td>6</td><td>1</td></tr><tr><td>Fay</td><td>8</td><td>0</td></tr><tr><td>Gus</td><td>3</td><td>2</td></tr><tr><td>Hana</td><td>7</td><td>1</td></tr></tbody></table></section>
<section class="card" aria-label="Tickets closed per day"><h2>Tickets closed per day</h2><div class="chart" role="img" aria-label="Bar chart: Mon 12, Tue 15, Wed 9, Thu 17, Fri 14, Sat 4"><span>Mon</span><div class="track"><div class="fill" style="width:71%"></div></div><span>12</span></div><div class="chart"><span>Tue</span><div class="track"><div class="fill" style="width:88%"></div></div><span>15</span></div><div class="chart"><span>Wed</span><div class="track"><div class="fill" style="width:53%"></div></div><span>9</span></div><div class="chart"><span>Thu</span><div class="track"><div class="fill" style="width:100%"></div></div><span>17</span></div><div class="chart"><span>Fri</span><div class="track"><div class="fill" style="width:82%"></div></div><span>14</span></div><div class="chart"><span>Sat</span><div class="track"><div class="fill" style="width:24%"></div></div><span>4</span></div></section>
<section class="card" aria-label="Release steps"><h2>Release steps</h2><label class="check done"><input type="checkbox" checked> Tag the release</label><label class="check done"><input type="checkbox" checked> Write release notes</label><label class="check"><input type="checkbox"> Build artifacts</label><label class="check"><input type="checkbox"> Deploy to staging</label><label class="check"><input type="checkbox"> Run smoke tests</label><label class="check"><input type="checkbox"> Deploy to production</label></section>
</main>
</body>
</html>`;

// --- report ---------------------------------------------------------------

const rowJson = { name: "genui payload (compact JSON)", size: bytes(genuiPayload), chars: chars(genuiPayload) };
const baselines = [
  { name: "HTML artifact — minimal", size: bytes(htmlMinimal), chars: chars(htmlMinimal) },
  { name: "HTML artifact — typical styling", size: bytes(htmlTypical), chars: chars(htmlTypical) },
  { name: "HTML artifact — rich styling", size: bytes(htmlRich), chars: chars(htmlRich) },
];

console.log("genui context-reduction measurement");
console.log("basis: UTF-8 bytes; no model tokenizer is available in this environment,");
console.log("so size is the measurement basis (emitted tokens track emitted text size).");
console.log("");
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
console.log(`${pad("representation", 32)} ${pad("bytes", 7)} ${pad("chars", 7)} reduction of genui vs HTML`);
console.log(`${pad("genui payload (compact JSON)", 32)} ${pad(String(rowJson.size), 7)} ${pad(String(rowJson.chars), 7)} -`);
for (const b of baselines) {
  const reduction = (1 - rowJson.size / b.size) * 100;
  console.log(`${pad(b.name, 32)} ${pad(String(b.size), 7)} ${pad(String(b.chars), 7)} ${reduction.toFixed(1)}%`);
}
