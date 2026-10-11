// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Converts a CTRF JSON test report into a self-contained HTML report.
 * Supports side-by-side multi-backend matrix visualization (WASM, JS/TS, and OMC)
 * with per-engine Status, CPU Time, and Peak Memory (RSS) columns.
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
  memoryMb?: number;
  status: string;
  suite?: string;
  filePath?: string;
  message?: string;
  extra?: {
    backend?: string;
    baseName?: string;
    baseSuite?: string;
    xfail?: boolean | string;
    memoryMb?: number;
    [key: string]: unknown;
  };
}

interface CtrfReport {
  results: {
    tool?: { name: string };
    environment?: Record<string, unknown>;
    summary: {
      tests: number;
      passed: number;
      failed: number;
      pending: number;
      start: number;
      stop: number;
      cpuTime?: number;
      extra?: {
        peakMemoryMb?: number;
        [key: string]: unknown;
      };
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

  // Detect backends present
  const getBackend = (t: CtrfTest): string => {
    if (t.extra?.backend) {
      const b = String(t.extra.backend);
      return b === "ts" ? "js" : b;
    }
    if (t.name.includes("[wasm]")) return "wasm";
    if (t.name.includes("[js]") || t.name.includes("[ts]")) return "js";
    if (t.name.includes("[omc]")) return "omc";
    return "";
  };

  const getBaseName = (t: CtrfTest): string => {
    if (t.extra?.baseName) return String(t.extra.baseName);
    return t.name.replace(/\s+\[(wasm|js|ts|omc)\]$/, "");
  };

  const getBaseSuite = (t: CtrfTest): string => {
    if (t.extra?.baseSuite) return String(t.extra.baseSuite);
    if (t.filePath) {
      const parts = t.filePath.replace(/\\/g, "/").split("/");
      return parts[parts.length - 2] || t.suite || "unknown";
    }
    return (t.suite || "unknown").replace(/\s+\((wasm|js|ts|omc)\)$/, "");
  };

  const knownBackends = ["wasm", "js", "omc"] as const;
  const presentBackends = knownBackends.filter((b) => tests.some((t) => getBackend(t) === b));
  const isMultiBackend = presentBackends.length > 1;

  const backendStats = presentBackends.map((b) => {
    const bTests = tests.filter((t) => getBackend(t) === b);
    const bPassed = bTests.filter((t) => t.status === "passed").length;
    const bRate = bTests.length > 0 ? ((bPassed / bTests.length) * 100).toFixed(1) : "0.0";
    const bCpu = (bTests.reduce((sum, t) => sum + (t.cpuTime ?? 0), 0) / 1000).toFixed(2);
    const bMem = Math.max(0, ...bTests.map((t) => t.memoryMb ?? (t.extra?.memoryMb as number) ?? 0)).toFixed(1);
    const label = b === "wasm" ? "WASM" : b === "js" ? "JS/TS" : "OMC";
    return {
      backend: b,
      label,
      tests: bTests,
      passed: bPassed,
      total: bTests.length,
      rate: bRate,
      cpu: bCpu,
      mem: bMem,
    };
  });

  const passRate = summary.tests > 0 ? ((summary.passed / summary.tests) * 100).toFixed(1) : "0.0";
  const dur = ((summary.stop - summary.start) / 1000).toFixed(1);
  const cpuTime = ((summary.cpuTime ?? 0) / 1000).toFixed(1);
  const summaryPeakMem = Math.max(
    0,
    (summary.extra?.peakMemoryMb as number) ?? 0,
    ...tests.map((t) => t.memoryMb ?? (t.extra?.memoryMb as number) ?? 0),
  ).toFixed(1);

  const multiBackendCards = isMultiBackend
    ? backendStats
        .map(
          (s) => `
  <div class="card ${s.backend}-card">
    <div class="num">${s.rate}%</div>
    <div class="label">${s.label} Pass (${s.passed}/${s.total})</div>
    <div class="sub-label">${s.cpu}s cpu · ${s.mem} MB peak</div>
  </div>`,
        )
        .join("")
    : "";

  const bailBadge = (t: CtrfTest): string => {
    const bail = t.extra?.wasmBail as { reason?: string; description?: string; location?: string } | undefined;
    if (!bail?.reason) return "";
    const title = `${bail.description ?? ""}${bail.location ? ` @ ${bail.location}` : ""}`;
    return ` <span class="chip bail-chip" title="${esc(title)}">bail: ${esc(bail.reason)}</span>`;
  };

  const bailHistogram = new Map<string, number>();
  for (const t of tests) {
    const reason = (t.extra?.wasmBail as { reason?: string } | undefined)?.reason;
    if (reason) bailHistogram.set(reason, (bailHistogram.get(reason) ?? 0) + 1);
  }
  const bailCard =
    bailHistogram.size > 0
      ? `
  <div class="card bail-card">
    <div class="num">${[...bailHistogram.values()].reduce((s, n) => s + n, 0)}</div>
    <div class="label">WASM Kernel Bail-outs</div>
    <div class="sub-label">${[...bailHistogram.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([r, n]) => `${esc(r)}: ${n}`)
      .join("<br>")}</div>
  </div>`
      : "";

  let suiteRows = "";
  let filterControls: string;

  if (isMultiBackend) {
    // Multi-backend mode: group by baseSuite and baseTestName
    const multiSuites = new Map<string, Map<string, Record<string, CtrfTest>>>();
    for (const t of tests) {
      const s = getBaseSuite(t);
      const testName = getBaseName(t);
      const b = getBackend(t);
      let suiteMap = multiSuites.get(s);
      if (!suiteMap) {
        suiteMap = new Map();
        multiSuites.set(s, suiteMap);
      }
      let row = suiteMap.get(testName);
      if (!row) {
        row = {};
        suiteMap.set(testName, row);
      }
      if (b) {
        row[b] = t;
      }
    }

    let totalDistinctTests = 0;
    let totalMismatches = 0;
    let totalWithFailures = 0;
    let totalAllPassed = 0;
    const backendFailCounts: Record<string, number> = {};
    for (const b of presentBackends) backendFailCounts[b] = 0;

    for (const [, testMap] of multiSuites) {
      for (const [, row] of testMap) {
        totalDistinctTests++;
        const statuses = presentBackends.map((b) => row[b]?.status).filter(Boolean);
        const isMismatch = new Set(statuses).size > 1;
        const hasFail = presentBackends.some((b) => row[b]?.status === "failed");
        const allPass = presentBackends.every((b) => row[b]?.status === "passed");
        if (isMismatch) totalMismatches++;
        if (hasFail) totalWithFailures++;
        if (allPass) totalAllPassed++;
        for (const b of presentBackends) {
          if (row[b]?.status === "failed") {
            backendFailCounts[b] = (backendFailCounts[b] ?? 0) + 1;
          }
        }
      }
    }

    for (const [suiteName, testMap] of [...multiSuites.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      let suiteMismatches = 0;
      const suitePassed: Record<string, number> = {};
      for (const b of presentBackends) suitePassed[b] = 0;

      let testRows = "";
      for (const [testName, row] of [...testMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const statuses = presentBackends.map((b) => row[b]?.status).filter(Boolean);
        const isMismatch = new Set(statuses).size > 1;
        const hasFail = presentBackends.some((b) => row[b]?.status === "failed");
        const allPass = presentBackends.every((b) => row[b]?.status === "passed");
        if (isMismatch) suiteMismatches++;

        for (const b of presentBackends) {
          if (row[b]?.status === "passed") {
            suitePassed[b] = (suitePassed[b] ?? 0) + 1;
          }
        }

        let cells = "";
        for (const b of presentBackends) {
          const t = row[b];
          if (!t) {
            cells += `<td class="cell-empty">-</td><td class="cell-empty">-</td><td class="cell-empty">-</td>`;
          } else {
            const icon = t.status === "passed" ? "✓" : t.status === "pending" ? "⊘" : "✗";
            const cellCls = t.status === "passed" ? "pass-cell" : t.status === "pending" ? "skip-cell" : "fail-cell";
            const cpuStr = `${t.cpuTime ?? 0}ms`;
            const memVal = t.memoryMb ?? (t.extra?.memoryMb as number | undefined);
            const memStr = memVal !== undefined && memVal > 0 ? `${memVal.toFixed(1)} MB` : "-";
            cells += `<td class="${cellCls}">${icon} ${t.status}${bailBadge(t)}</td><td class="num-cell">${cpuStr}</td><td class="num-cell">${memStr}</td>`;
          }
        }

        const diagBlocks = presentBackends
          .map((b) => {
            const t = row[b];
            if (!t?.message) return "";
            const chipCls = b === "wasm" ? "wasm-chip" : b === "omc" ? "omc-chip" : "js-chip";
            return `<div class="diag-block"><span class="chip ${chipCls}">${b.toUpperCase()}</span><pre>${esc(t.message)}</pre></div>`;
          })
          .filter(Boolean)
          .join("");

        const msgCell = diagBlocks
          ? `<details><summary class="diag-summary">${hasFail ? "View Error / Diff" : "Details"}</summary>${diagBlocks}</details>`
          : "-";

        const rowCls = hasFail ? "fail-row" : "pass-row";
        const statusAttrs = presentBackends.map((b) => `data-${b}-status="${row[b]?.status ?? "none"}"`).join(" ");

        testRows += `<tr class="${rowCls} matrix-row" data-mismatch="${isMismatch}" data-has-fail="${hasFail}" data-all-pass="${allPass}" ${statusAttrs}>
          <td class="test-name-cell"><strong>${esc(testName)}</strong></td>
          ${cells}
          <td class="msg">${msgCell}</td>
        </tr>\n`;
      }

      const suiteTotal = testMap.size;
      const chipsHtml = presentBackends
        .map((b) => {
          const chipCls = b === "wasm" ? "wasm-chip" : b === "omc" ? "omc-chip" : "js-chip";
          const label = b === "wasm" ? "WASM" : b === "js" ? "JS/TS" : "OMC";
          return `<span class="chip ${chipCls}">${label}: ${suitePassed[b]}/${suiteTotal}</span>`;
        })
        .join(" ");

      const mismatchChip =
        suiteMismatches > 0
          ? `<span class="chip fail-chip">${suiteMismatches} parity diff${suiteMismatches > 1 ? "s" : ""}</span>`
          : `<span class="chip pass-chip">100% parity</span>`;

      const theadCols = presentBackends
        .map((b) => {
          const label =
            b === "wasm" ? "WebAssembly (WASM)" : b === "js" ? "JavaScript / TypeScript" : "OpenModelica (omc)";
          return `<th colspan="3" class="th-backend th-${b}">${label}</th>`;
        })
        .join("");

      const theadSubCols = presentBackends
        .map(
          () =>
            `<th class="th-sub">Status</th><th class="th-sub num-cell">CPU</th><th class="th-sub num-cell">Peak RSS</th>`,
        )
        .join("");

      suiteRows += `
  <details class="suite" open>
    <summary>
      <span class="suite-name">${esc(suiteName)}</span>
      <span class="suite-stats">
        ${chipsHtml}
        ${mismatchChip}
        <span class="suite-count">${suiteTotal} tests</span>
      </span>
    </summary>
    <div class="table-container">
      <table class="matrix-table">
        <thead>
          <tr>
            <th rowspan="2" class="th-test">Modelica Test</th>
            ${theadCols}
            <th rowspan="2" class="th-details">Diffs &amp; Diagnostics</th>
          </tr>
          <tr class="sub-header-row">
            ${theadSubCols}
          </tr>
        </thead>
        <tbody>
          ${testRows}
        </tbody>
      </table>
    </div>
  </details>`;
    }

    const backendFailButtons = presentBackends
      .map((b) => {
        const label = b === "wasm" ? "WASM" : b === "js" ? "JS/TS" : "OMC";
        return `<button class="filter-pill" onclick="setMatrixFilter('${b}-fail', this)">${label} Failures (${backendFailCounts[b] ?? 0})</button>`;
      })
      .join("\n  ");

    filterControls = `
<div class="filter-bar">
  <span class="filter-label">Filter Matrix View:</span>
  <button class="filter-pill active" onclick="setMatrixFilter('all', this)">All Tests (${totalDistinctTests})</button>
  <button class="filter-pill ${totalMismatches > 0 ? "highlight-pill" : ""}" onclick="setMatrixFilter('mismatch', this)">Parity Differences (${totalMismatches})</button>
  <button class="filter-pill" onclick="setMatrixFilter('has-fail', this)">Any Failed (${totalWithFailures})</button>
  <button class="filter-pill" onclick="setMatrixFilter('all-pass', this)">All Passed (${totalAllPassed})</button>
  <span class="filter-separator"></span>
  <span class="filter-label">By Backend:</span>
  ${backendFailButtons}
</div>
`;
  } else {
    // Single-backend mode
    const suites = new Map<string, CtrfTest[]>();
    for (const t of tests) {
      const s = t.suite || "unknown";
      const list = suites.get(s) ?? [];
      list.push(t);
      suites.set(s, list);
    }

    for (const [name, items] of [...suites.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const passed = items.filter((t) => t.status === "passed").length;
      const failed = items.filter((t) => t.status === "failed").length;
      const skipped = items.filter((t) => t.status === "pending").length;
      const total = items.length;
      const pct = total > 0 ? ((passed / total) * 100).toFixed(0) : "0";
      const barColor = Number(pct) > 80 ? "#4caf50" : Number(pct) > 50 ? "#ff9800" : "#f44336";

      let testRows = "";
      for (const t of items) {
        const cls = t.status === "passed" ? "pass" : t.status === "pending" ? "skip" : "fail";
        const icon = t.status === "passed" ? "✓" : t.status === "pending" ? "⊘" : "✗";
        const b = getBackend(t);
        let chipClass = "js-chip";
        if (b === "wasm") chipClass = "wasm-chip";
        else if (b === "omc") chipClass = "omc-chip";
        const backendBadge = b ? `<span class="chip ${chipClass}">${b.toUpperCase()}</span> ` : "";
        const msg = t.message ? `<details><summary>Details</summary><pre>${esc(t.message)}</pre></details>` : "";
        const memVal = t.memoryMb ?? (t.extra?.memoryMb as number | undefined);
        const memStr = memVal !== undefined && memVal > 0 ? `${memVal.toFixed(1)} MB` : "-";
        testRows += `<tr class="${cls}" data-backend="${b}" data-status="${cls}"><td>${icon}</td><td>${backendBadge}${esc(t.name)}${bailBadge(t)}</td><td>${t.status}</td><td>${t.duration ?? 0}ms</td><td>${t.cpuTime ?? 0}ms</td><td>${memStr}</td><td class="msg">${msg}</td></tr>\n`;
      }

      suiteRows += `
  <details class="suite" open>
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
    <div class="table-container">
      <table><thead><tr><th></th><th>Test</th><th>Status</th><th>Duration</th><th>CPU</th><th>Memory</th><th>Message</th></tr></thead><tbody>
      ${testRows}
      </tbody></table>
    </div>
  </details>`;
    }

    filterControls = `
<div class="filter-bar">
  <span class="filter-label">Status:</span>
  <button class="filter-pill active" onclick="setFilter('status', 'all', this)">All</button>
  <button class="filter-pill" onclick="setFilter('status', 'pass', this)">Passed</button>
  <button class="filter-pill" onclick="setFilter('status', 'fail', this)">Failed</button>
</div>
`;
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>CTRF Test Report — ModelScript</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px;line-height:1.5}
h1{font-size:1.8rem;margin-bottom:8px;color:#f0f6fc;display:flex;align-items:center;gap:12px}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0 24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px 20px;min-width:140px;text-align:center}
.card .num{font-size:1.8rem;font-weight:700}
.card .label{font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.card .sub-label{font-size:.7rem;color:#8b949e;margin-top:4px}
.card.pass .num{color:#3fb950}
.card.fail .num{color:#f85149}
.card.skip .num{color:#d29922}
.card.total .num{color:#58a6ff}
.card.rate .num{color:#bc8cff}
.card.time .num{color:#79c0ff;font-size:1.4rem}
.card.wasm-card{border-color:rgba(188,140,255,0.4)}
.card.wasm-card .num{color:#d2a8ff}
.card.js-card{border-color:rgba(227,179,65,0.4)}
.card.js-card .num{color:#e3b341}
.card.omc-card{border-color:rgba(186,104,200,0.4)}
.card.omc-card .num{color:#ce93d8}
.filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:20px;padding:10px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px;flex-wrap:wrap}
.filter-label{font-size:.8rem;color:#8b949e;font-weight:600}
.filter-separator{width:1px;height:18px;background:#30363d;margin:0 8px}
.filter-pill{background:rgba(255,255,255,0.06);border:1px solid #30363d;border-radius:16px;padding:4px 12px;font-size:.8rem;color:#c9d1d9;cursor:pointer;transition:all .15s}
.filter-pill:hover{background:rgba(255,255,255,0.12);color:#fff}
.filter-pill.active{background:#388bfd;color:#fff;border-color:transparent}
.highlight-pill{border-color:rgba(248,81,73,0.4);color:#ff7b72}
.highlight-pill.active{background:#b62324;color:#fff;border-color:transparent}
.suite{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:12px;overflow:hidden}
.suite summary{padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:600;list-style:none;background:#1c2128}
.suite summary::-webkit-details-marker{display:none}
.suite summary::before{content:'▶';margin-right:8px;font-size:.7rem;transition:transform .2s}
.suite[open] summary::before{transform:rotate(90deg)}
.suite-name{flex:1;font-size:.95rem}
.suite-stats{display:flex;gap:8px;align-items:center;font-weight:400;font-size:.85rem}
.suite-count{color:#8b949e;font-size:.8rem;margin-left:4px}
.chip{padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
.pass-chip{background:#0d3320;color:#3fb950}
.fail-chip{background:#3d1214;color:#f85149}
.skip-chip{background:#3d2e00;color:#d29922}
.wasm-chip{background:#2a1945;color:#d2a8ff;border:1px solid rgba(210,168,255,0.3)}
.js-chip{background:#332608;color:#e3b341;border:1px solid rgba(227,179,65,0.3)}
.omc-chip{background:#3b1d4a;color:#ce93d8;border:1px solid rgba(206,147,216,0.3)}
.bail-chip{background:#2d1b0e;color:#ffa657;border:1px solid rgba(255,166,87,0.35);font-size:.68rem;margin-left:4px;cursor:help;white-space:nowrap}
.bail-card .sub-label{text-align:left;line-height:1.5}
.bar-wrap{width:80px;height:6px;background:#21262d;border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle}
.bar{height:100%;border-radius:3px;transition:width .3s}
.table-container{overflow-x:auto}
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

/* Matrix Table Styles */
.matrix-table{width:100%;border-collapse:collapse;font-size:.85rem}
.th-test{min-width:200px;vertical-align:bottom;padding:10px 12px;border-bottom:1px solid #30363d;color:#f0f6fc}
.th-backend{text-align:center;padding:6px 12px;font-size:.8rem;font-weight:700;letter-spacing:.5px;border-left:1px solid #30363d;border-right:1px solid #30363d}
.th-wasm{background:#231438;color:#d2a8ff;border-top:2px solid #a855f7}
.th-js{background:#2a2008;color:#e3b341;border-top:2px solid #eab308}
.th-omc{background:#2b1233;color:#ce93d8;border-top:2px solid #ba68c8}
.th-sub{background:#161b22;font-size:.72rem;color:#8b949e;text-align:center;padding:4px 8px;border-bottom:1px solid #30363d}
.th-details{min-width:240px;vertical-align:bottom;padding:10px 12px;border-bottom:1px solid #30363d;color:#f0f6fc}
.pass-cell{color:#3fb950;font-weight:600;text-align:center;padding:6px 10px}
.fail-cell{color:#f85149;font-weight:600;text-align:center;background:rgba(248,81,73,0.08);padding:6px 10px}
.skip-cell{color:#d29922;text-align:center;padding:6px 10px}
.cell-empty{color:#484f58;text-align:center;padding:6px 10px}
.num-cell{text-align:right;font-variant-numeric:tabular-nums;color:#c9d1d9;padding:6px 10px;white-space:nowrap}
.test-name-cell{padding:6px 12px;color:#f0f6fc;word-break:break-all}
.diag-block{margin-top:6px;border-top:1px solid #30363d;padding-top:6px}
.diag-block:first-child{margin-top:0;border-top:none;padding-top:0}
.diag-summary{cursor:pointer;color:#58a6ff;font-size:.8rem;font-weight:500}
</style>
<script>
const activeFilters = { backend: 'all', status: 'all' };
function setFilter(type, val, btn) {
  activeFilters[type] = val;
  const parent = btn.parentElement;
  const pills = parent.querySelectorAll('.filter-pill');
  pills.forEach(p => {
    if (p.getAttribute('onclick')?.includes("'" + type + "'")) {
      p.classList.remove('active');
    }
  });
  btn.classList.add('active');
  applyFilters();
}
function applyFilters() {
  const rows = document.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const rowBackend = row.getAttribute('data-backend') || '';
    const rowStatus = row.getAttribute('data-status') || '';
    const matchBackend = activeFilters.backend === 'all' || rowBackend === activeFilters.backend || (activeFilters.backend === 'js' && rowBackend === 'ts');
    const matchStatus = activeFilters.status === 'all' || rowStatus === activeFilters.status;
    row.style.display = matchBackend && matchStatus ? '' : 'none';
  });
}
function setMatrixFilter(filterType, btn) {
  const pills = btn.parentElement.querySelectorAll('.filter-pill');
  pills.forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const rows = document.querySelectorAll('tbody tr.matrix-row');
  rows.forEach(r => {
    let show = true;
    if (filterType === 'all') show = true;
    else if (filterType === 'mismatch') show = r.getAttribute('data-mismatch') === 'true';
    else if (filterType === 'has-fail') show = r.getAttribute('data-has-fail') === 'true';
    else if (filterType === 'all-pass') show = r.getAttribute('data-all-pass') === 'true';
    else if (filterType.endsWith('-fail')) {
      const b = filterType.replace('-fail', '');
      show = r.getAttribute('data-' + b + '-status') === 'fail';
    }
    r.style.display = show ? '' : 'none';
  });
}
</script>
</head><body>
<h1>ModelScript Test Report</h1>
<p style="color:#8b949e">Generated ${new Date().toISOString()}</p>
<div class="summary">
  <div class="card total"><div class="num">${summary.tests}</div><div class="label">Total Runs</div></div>
  <div class="card pass"><div class="num">${summary.passed}</div><div class="label">Passed</div></div>
  <div class="card fail"><div class="num">${summary.failed}</div><div class="label">Failed</div></div>
  <div class="card skip"><div class="num">${summary.pending}</div><div class="label">Skipped</div></div>
  <div class="card rate"><div class="num">${passRate}%</div><div class="label">Overall Pass Rate</div></div>
  ${multiBackendCards}
  ${bailCard}
  <div class="card time"><div class="num">${dur}s</div><div class="label">Duration (${cpuTime}s cpu)</div><div class="sub-label">Peak RSS: ${summaryPeakMem} MB</div></div>
</div>
${filterControls}
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
