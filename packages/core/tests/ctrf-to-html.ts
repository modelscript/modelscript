// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Converts a CTRF JSON test report into a self-contained HTML report.
 *
 * Can be used standalone:
 *   npx tsx tests/ctrf-to-html.ts [input.json] [output.html]
 *
 * Or imported and called programmatically:
 *   import { generateHtmlReport } from "./ctrf-to-html.js";
 *   generateHtmlReport("ctrf/report.json", "ctrf/report.html");
 */

import fs from "node:fs";

interface CtrfTest {
  name: string;
  duration?: number;
  cpuTime?: number;
  status: string;
  suite?: string;
  message?: string;
}

interface CtrfReport {
  results: {
    summary: {
      tests: number;
      passed: number;
      failed: number;
      pending: number;
      start: number;
      stop: number;
      cpuTime?: number;
    };
    tests: CtrfTest[];
  };
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateHtmlReport(inputPath: string, outputPath: string): void {
  const report: CtrfReport = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  const { summary, tests } = report.results;

  // Group tests by suite
  const suites = new Map<string, CtrfTest[]>();
  for (const t of tests) {
    const s = t.suite || "unknown";
    const list = suites.get(s) ?? [];
    list.push(t);
    suites.set(s, list);
  }

  const passRate = ((summary.passed / summary.tests) * 100).toFixed(1);
  const dur = ((summary.stop - summary.start) / 1000).toFixed(1);
  const cpuTime = ((summary.cpuTime ?? 0) / 1000).toFixed(1);

  let suiteRows = "";
  for (const [name, items] of [...suites.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const passed = items.filter((t) => t.status === "passed").length;
    const failed = items.filter((t) => t.status === "failed").length;
    const skipped = items.filter((t) => t.status === "pending").length;
    const total = items.length;
    const pct = ((passed / total) * 100).toFixed(0);
    const barColor = Number(pct) > 80 ? "#4caf50" : Number(pct) > 50 ? "#ff9800" : "#f44336";

    let testRows = "";
    for (const t of items) {
      const cls = t.status === "passed" ? "pass" : t.status === "pending" ? "skip" : "fail";
      const icon = t.status === "passed" ? "✓" : t.status === "pending" ? "⊘" : "✗";
      const msg = t.message ? `<details><summary>Details</summary><pre>${esc(t.message)}</pre></details>` : "";
      testRows += `<tr class="${cls}"><td>${icon}</td><td>${esc(t.name)}</td><td>${t.status}</td><td>${t.duration ?? 0}ms</td><td>${t.cpuTime ?? 0}ms</td><td class="msg">${msg}</td></tr>\n`;
    }

    suiteRows += `
  <details class="suite">
    <summary>
      <span class="suite-name">${esc(name)}</span>
      <span class="suite-stats">
        <span class="chip pass-chip">${passed} passed</span>
        <span class="chip fail-chip">${failed} failed</span>
        <span class="chip skip-chip">${skipped} skipped</span>
        <span class="bar-wrap"><span class="bar" style="width:${pct}%;background:${barColor}"></span></span>
        ${pct}%
      </span>
    </summary>
    <table><thead><tr><th></th><th>Test</th><th>Status</th><th>Duration</th><th>CPU</th><th>Message</th></tr></thead><tbody>
    ${testRows}
    </tbody></table>
  </details>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>CTRF Test Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px;line-height:1.5}
h1{font-size:1.8rem;margin-bottom:8px;color:#f0f6fc}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0 24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px 24px;min-width:140px;text-align:center}
.card .num{font-size:2rem;font-weight:700}
.card .label{font-size:.8rem;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.card.pass .num{color:#3fb950}
.card.fail .num{color:#f85149}
.card.skip .num{color:#d29922}
.card.total .num{color:#58a6ff}
.card.rate .num{color:#bc8cff}
.card.time .num{color:#79c0ff;font-size:1.4rem}
.suite{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:8px}
.suite summary{padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;list-style:none}
.suite summary::-webkit-details-marker{display:none}
.suite summary::before{content:'▶';margin-right:8px;font-size:.7rem;transition:transform .2s}
.suite[open] summary::before{transform:rotate(90deg)}
.suite-name{flex:1}
.suite-stats{display:flex;gap:8px;align-items:center;font-weight:400;font-size:.85rem}
.chip{padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
.pass-chip{background:#0d3320;color:#3fb950}
.fail-chip{background:#3d1214;color:#f85149}
.skip-chip{background:#3d2e00;color:#d29922}
.bar-wrap{width:80px;height:6px;background:#21262d;border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle}
.bar{height:100%;border-radius:3px;transition:width .3s}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;padding:8px 12px;border-bottom:1px solid #30363d;color:#8b949e;font-weight:500}
td{padding:6px 12px;border-bottom:1px solid #21262d}
tr.pass td:first-child{color:#3fb950}
tr.fail td:first-child{color:#f85149}
tr.skip td:first-child{color:#d29922}
tr.fail{background:#1a0e0e}
details pre{background:#0d1117;padding:12px;border-radius:6px;overflow-x:auto;font-size:.8rem;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin-top:8px;border:1px solid #30363d}
.msg{max-width:500px}
.footer{text-align:center;color:#484f58;font-size:.75rem;margin-top:24px}
</style></head><body>
<h1>ModelScript Test Report</h1>
<p style="color:#8b949e">Generated ${new Date().toISOString()}</p>
<div class="summary">
  <div class="card total"><div class="num">${summary.tests}</div><div class="label">Total</div></div>
  <div class="card pass"><div class="num">${summary.passed}</div><div class="label">Passed</div></div>
  <div class="card fail"><div class="num">${summary.failed}</div><div class="label">Failed</div></div>
  <div class="card skip"><div class="num">${summary.pending}</div><div class="label">Skipped</div></div>
  <div class="card rate"><div class="num">${passRate}%</div><div class="label">Pass Rate</div></div>
  <div class="card time"><div class="num">${dur}s / ${cpuTime}s cpu</div><div class="label">Duration</div></div>
</div>
<div id="suites">${suiteRows}</div>
<div class="footer">CTRF HTML Report · modelscript-testsuite</div>
</body></html>`;

  fs.writeFileSync(outputPath, html);
  const sizeKb = (html.length / 1024).toFixed(0);
  console.log(`HTML report written to ${outputPath} (${sizeKb} KB)`);
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith("ctrf-to-html.ts") || process.argv[1].endsWith("ctrf-to-html.js"))) {
  const input = process.argv[2] || "ctrf/ctrf-testsuite-report.json";
  const output = process.argv[3] || "ctrf/ctrf-testsuite-report.html";
  generateHtmlReport(input, output);
}
