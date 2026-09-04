// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MSL Comparison Runner
 *
 * Runs the ModelScript arena-native flattener against MSL models and compares
 * the results (variable count, equation count, and flat structure) to OpenModelica (omc).
 *
 * Usage:
 *   npx tsx tests/msl-comparison-runner.ts [options]
 *
 * Options:
 *   --version=<4.0.0|4.1.0>      MSL version (default: 4.0.0)
 *   --all                        Include all models/blocks (default: only Examples)
 *   --examples-only              Only test models in Examples subpackages (default)
 *   --package=<prefix>           Filter by package prefix (e.g. Modelica.Electrical.Analog)
 *   --model=<FQN>                Test a single model (e.g. Modelica.Electrical.Analog.Examples.ChuaCircuit)
 *   --limit=<N>                  Limit execution to the first N models
 *   --jobs=<N>, -j <N>           Number of parallel workers (default: 4)
 *   --force-omc                  Bypass cached OMC output and re-flatten with omc
 *   --timeout=<seconds>          Per-model timeout in seconds (default: 60)
 *   --report-json=<path>         Export results to a JSON file
 *   --report-html=<path>         Export an interactive HTML report
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerResult, WorkerTask } from "./msl-comparison-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// CLI Argument parsing
interface RunnerOptions {
  version: string;
  all: boolean;
  packagePrefix?: string;
  modelFqn?: string;
  limit?: number;
  jobs: number;
  forceOmc: boolean;
  timeoutMs: number;
  reportJson?: string;
  reportHtml?: string;
}

function parseArgs(): RunnerOptions {
  const opts: RunnerOptions = {
    version: "4.0.0",
    all: false,
    jobs: Math.max(1, Math.min(8, (os.cpus()?.length || 4) - 1)),
    forceOmc: false,
    timeoutMs: 60_000,
  };

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--version=")) {
      opts.version = arg.split("=")[1].trim();
    } else if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--examples-only") {
      opts.all = false;
    } else if (arg.startsWith("--package=")) {
      opts.packagePrefix = arg.split("=")[1].trim();
    } else if (arg.startsWith("--model=")) {
      opts.modelFqn = arg.split("=")[1].trim();
    } else if (arg.startsWith("--limit=")) {
      opts.limit = parseInt(arg.split("=")[1].trim(), 10);
    } else if (arg.startsWith("--jobs=") || arg.startsWith("-j=")) {
      opts.jobs = Math.max(1, parseInt(arg.split("=")[1].trim(), 10));
    } else if (arg === "-j" && i + 1 < args.length) {
      opts.jobs = Math.max(1, parseInt(args[++i].trim(), 10));
    } else if (arg === "--force-omc") {
      opts.forceOmc = true;
    } else if (arg.startsWith("--timeout=")) {
      opts.timeoutMs = parseInt(arg.split("=")[1].trim(), 10) * 1000;
    } else if (arg.startsWith("--report-json=")) {
      opts.reportJson = path.resolve(arg.split("=")[1].trim());
    } else if (arg.startsWith("--report-html=")) {
      opts.reportHtml = path.resolve(arg.split("=")[1].trim());
    }
  }

  return opts;
}

interface DiscoveredModel {
  fqn: string;
  name: string;
  file: string;
  isExample: boolean;
  package: string;
}

async function runWorker(task: WorkerTask, timeoutMs: number): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const workerScript = path.resolve(__dirname, "msl-comparison-worker.ts");
    const child = spawn(
      process.execPath,
      ["--expose-gc", "--max-old-space-size=2048", "--import", "tsx", workerScript],
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdoutData = "";
    let stderrData = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        return resolve({
          modelFqn: task.modelFqn,
          status: "TIMEOUT",
          durationMs: timeoutMs,
          omc: { success: false, cached: false, durationMs: 0, varCount: 0, eqCount: 0, error: "Timed out" },
          modelscript: { success: false, durationMs: 0, varCount: 0, eqCount: 0, error: "Timed out" },
          comparison: { varCountMatch: false, eqCountMatch: false, diffLines: 0, diffSummary: "Process timed out" },
        });
      }

      try {
        const lastJsonLine = stdoutData
          .trim()
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("{") && l.endsWith("}"))
          .pop();
        if (lastJsonLine) {
          const parsed: WorkerResult = JSON.parse(lastJsonLine);
          return resolve(parsed);
        }
      } catch (err: any) {
        // JSON parsing failed
      }

      const errDetails = stderrData.trim() || stdoutData.trim() || `Worker exited with code ${code}`;
      resolve({
        modelFqn: task.modelFqn,
        status: "MS_ERROR",
        durationMs: 0,
        omc: { success: false, cached: false, durationMs: 0, varCount: 0, eqCount: 0, error: "Worker failed" },
        modelscript: {
          success: false,
          durationMs: 0,
          varCount: 0,
          eqCount: 0,
          error: errDetails,
        },
        comparison: { varCountMatch: false, eqCountMatch: false, diffLines: 0, diffSummary: "Worker crash" },
      });
    });

    // Send task payload
    child.stdin.write(JSON.stringify(task) + "\n");
    child.stdin.end();
  });
}

function generateHtmlReport(
  options: RunnerOptions,
  results: WorkerResult[],
  stats: {
    total: number;
    matches: number;
    diffs: number;
    msErrors: number;
    omcErrors: number;
    timeouts: number;
    totalDurationSec: number;
  },
): string {
  const matchPct = ((stats.matches / (stats.total || 1)) * 100).toFixed(1);
  const diffPct = ((stats.diffs / (stats.total || 1)) * 100).toFixed(1);
  const msErrPct = ((stats.msErrors / (stats.total || 1)) * 100).toFixed(1);
  const omcErrPct = ((stats.omcErrors / (stats.total || 1)) * 100).toFixed(1);

  const rows = results
    .map((r, i) => {
      let badgeClass = "badge-match";
      if (r.status === "DIFF") badgeClass = "badge-diff";
      else if (r.status === "MS_ERROR") badgeClass = "badge-ms-err";
      else if (r.status === "OMC_ERROR") badgeClass = "badge-omc-err";
      else if (r.status === "TIMEOUT") badgeClass = "badge-timeout";

      const details =
        r.status === "DIFF"
          ? r.comparison.diffSummary || ""
          : r.status === "MS_ERROR"
            ? (r.modelscript.error || "").slice(0, 140)
            : r.status === "OMC_ERROR"
              ? (r.omc.error || "").slice(0, 140)
              : "";

      return `
      <tr class="result-row" data-status="${r.status}">
        <td class="text-muted">${i + 1}</td>
        <td><span class="badge ${badgeClass}">${r.status}</span></td>
        <td class="font-mono model-name">${r.modelFqn}</td>
        <td class="text-center font-mono">${r.omc.success ? `${r.omc.varCount} / ${r.omc.eqCount}` : '<span class="text-danger">err</span>'}</td>
        <td class="text-center font-mono">${r.modelscript.success ? `${r.modelscript.varCount} / ${r.modelscript.eqCount}` : '<span class="text-danger">err</span>'}</td>
        <td class="text-right font-mono text-muted">${r.durationMs}ms</td>
        <td class="details-cell font-mono text-sm">${details}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ModelScript vs OMC: MSL ${options.version} Benchmark</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --primary: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      padding: 32px 24px;
      line-height: 1.5;
    }
    .container { max-width: 1300px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .subtitle { color: var(--text-muted); font-size: 14px; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .stat-val { font-size: 28px; font-weight: 700; color: #fff; }
    .stat-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-top: 4px; }

    .controls {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .search-input {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 14px;
      flex: 1;
      min-width: 250px;
    }
    .btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
    }
    .btn:hover, .btn.active {
      background: #21262d;
      border-color: var(--primary);
      color: #fff;
    }

    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      background: #1c2128;
      text-align: left;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid #21262d;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #1c2128; }

    .font-mono { font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }
    .text-danger { color: var(--danger); }
    .text-sm { font-size: 12px; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-match { background: rgba(63, 185, 80, 0.15); color: var(--success); border: 1px solid rgba(63, 185, 80, 0.3); }
    .badge-diff { background: rgba(210, 153, 34, 0.15); color: var(--warning); border: 1px solid rgba(210, 153, 34, 0.3); }
    .badge-ms-err { background: rgba(248, 81, 73, 0.15); color: var(--danger); border: 1px solid rgba(248, 81, 73, 0.3); }
    .badge-omc-err { background: rgba(163, 113, 247, 0.15); color: #a371f7; border: 1px solid rgba(163, 113, 247, 0.3); }
    .badge-timeout { background: rgba(248, 81, 73, 0.2); color: var(--danger); border: 1px solid var(--danger); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>ModelScript vs OpenModelica Flattener Benchmark</h1>
      <div class="subtitle">MSL Version: ${options.version} | Generated: ${new Date().toISOString()}</div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val">${stats.total}</div>
        <div class="stat-lbl">Models Tested</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--success);">${stats.matches} (${matchPct}%)</div>
        <div class="stat-lbl">Exact Matches</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--warning);">${stats.diffs} (${diffPct}%)</div>
        <div class="stat-lbl">Count Diffs</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--danger);">${stats.msErrors} (${msErrPct}%)</div>
        <div class="stat-lbl">ModelScript Errors</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.totalDurationSec.toFixed(1)}s</div>
        <div class="stat-lbl">Total Time</div>
      </div>
    </div>

    <div class="controls">
      <input type="text" id="searchInput" class="search-input" placeholder="Filter models by name (e.g. Electrical.Analog)..." />
      <button class="btn active" onclick="filterStatus('ALL')">All</button>
      <button class="btn" onclick="filterStatus('MATCH')">Matches</button>
      <button class="btn" onclick="filterStatus('DIFF')">Diffs</button>
      <button class="btn" onclick="filterStatus('MS_ERROR')">MS Errors</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th style="width: 90px;">Status</th>
            <th>Model FQN</th>
            <th style="width: 120px;" class="text-center">OMC (v/e)</th>
            <th style="width: 120px;" class="text-center">MS (v/e)</th>
            <th style="width: 80px;" class="text-right">Time</th>
            <th>Details / Delta</th>
          </tr>
        </thead>
        <tbody id="resultsTable">
          ${rows}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let currentStatus = 'ALL';
    const searchInput = document.getElementById('searchInput');
    const table = document.getElementById('resultsTable');
    const rows = Array.from(table.getElementsByClassName('result-row'));

    function applyFilters() {
      const q = searchInput.value.toLowerCase().trim();
      rows.forEach(r => {
        const rowStatus = r.getAttribute('data-status');
        const text = r.querySelector('.model-name').textContent.toLowerCase();
        const matchesStatus = currentStatus === 'ALL' || rowStatus === currentStatus;
        const matchesSearch = !q || text.includes(q);
        r.style.display = matchesStatus && matchesSearch ? '' : 'none';
      });
    }

    searchInput.addEventListener('input', applyFilters);

    window.filterStatus = function(status) {
      currentStatus = status;
      document.querySelectorAll('.controls .btn').forEach(b => {
        b.classList.toggle('active', b.textContent.toUpperCase().includes(status));
      });
      applyFilters();
    };
  </script>
</body>
</html>`;
}

async function main() {
  const options = parseArgs();
  const cacheDir = path.join(repoRoot, ".cache");
  const indexCachePath = path.join(cacheDir, `msl-${options.version}-symbol-index.json`);
  const modelsCachePath = path.join(cacheDir, `msl-${options.version}-models.json`);

  // Locate MSL directory
  const candidatePaths = [
    path.join(repoRoot, "scripts", "msl", `Modelica ${options.version}`),
    path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${options.version}+maint.om`),
    path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${options.version}`),
  ];
  const mslDir = candidatePaths.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, "package.mo")));

  if (!mslDir) {
    console.error(`[msl-runner] MSL ${options.version} directory not found!`);
    console.error(`Run: node scripts/download-msl.cjs --version=${options.version} --extract`);
    process.exit(1);
  }

  // Check if cache files exist
  if (!fs.existsSync(indexCachePath) || !fs.existsSync(modelsCachePath)) {
    console.log(`[msl-runner] Precomputed index not found at ${indexCachePath}`);
    console.log(`[msl-runner] Generating index cache now (this is done once per MSL version)...`);
    const buildIndexScript = path.resolve(__dirname, "build-msl-index.ts");
    const p = spawn(
      process.execPath,
      ["--expose-gc", "--max-old-space-size=4096", "--import", "tsx", buildIndexScript, `--version=${options.version}`],
      { stdio: "inherit" },
    );
    await new Promise((res, rej) => {
      p.on("close", (code) => (code === 0 ? res(null) : rej(new Error(`Index build exited with code ${code}`))));
    });
  }

  // Load models list
  const allModels: DiscoveredModel[] = JSON.parse(fs.readFileSync(modelsCachePath, "utf-8"));

  // Filter models
  let selectedModels = allModels;

  if (options.modelFqn) {
    selectedModels = selectedModels.filter((m) => m.fqn === options.modelFqn);
  } else {
    if (!options.all) {
      selectedModels = selectedModels.filter((m) => m.isExample);
    }
    if (options.packagePrefix) {
      const prefix = options.packagePrefix;
      selectedModels = selectedModels.filter((m) => m.fqn.startsWith(prefix));
    }
  }

  if (options.limit && options.limit > 0) {
    selectedModels = selectedModels.slice(0, options.limit);
  }

  if (selectedModels.length === 0) {
    console.log(`[msl-runner] No models matched the given filters.`);
    process.exit(0);
  }

  console.log(`================================================================================`);
  console.log(`ModelScript vs OpenModelica Flattener Benchmark (MSL ${options.version})`);
  console.log(`================================================================================`);
  console.log(`Models selected: ${selectedModels.length}`);
  console.log(`Workers:         ${options.jobs}`);
  console.log(`OMC caching:     ${options.forceOmc ? "Disabled (force re-run)" : "Enabled (.cache/omc/)"}`);
  console.log(`Timeout:         ${options.timeoutMs / 1000}s per model`);
  if (options.packagePrefix) console.log(`Package filter:  ${options.packagePrefix}`);
  if (options.modelFqn) console.log(`Single model:    ${options.modelFqn}`);
  console.log(`================================================================================\n`);

  const tSuiteStart = Date.now();
  const results: WorkerResult[] = [];
  let completed = 0;

  // Worker task queue
  const queue = [...selectedModels];

  async function workerLoop() {
    while (queue.length > 0) {
      const model = queue.shift();
      if (!model) break;
      const task: WorkerTask = {
        modelFqn: model.fqn,
        mslDir,
        version: options.version,
        cacheDir,
        indexCachePath,
        forceOmc: options.forceOmc,
      };

      const result = await runWorker(task, options.timeoutMs);
      results.push(result);
      completed++;

      const pct = ((completed / selectedModels.length) * 100).toFixed(0).padStart(3);
      const idxStr = `[${String(completed).padStart(String(selectedModels.length).length)}/${selectedModels.length}]`;
      const durStr = `${result.durationMs}ms`.padStart(7);

      let statusDisplay = result.status;
      if (result.status === "MATCH") {
        statusDisplay = `\x1b[32mMATCH\x1b[0m     (v=${result.modelscript.varCount}, e=${result.modelscript.eqCount})`;
      } else if (result.status === "DIFF") {
        statusDisplay = `\x1b[33mDIFF\x1b[0m      OMC(v=${result.omc.varCount}, e=${result.omc.eqCount}) vs MS(v=${result.modelscript.varCount}, e=${result.modelscript.eqCount})`;
      } else if (result.status === "MS_ERROR") {
        const preview = (result.modelscript.error || "").replace(/\n/g, " ").slice(0, 60);
        statusDisplay = `\x1b[31mMS_ERROR\x1b[0m  ${preview}`;
      } else if (result.status === "OMC_ERROR") {
        statusDisplay = `\x1b[35mOMC_ERROR\x1b[0m ${(result.omc.error || "").slice(0, 50)}`;
      } else if (result.status === "TIMEOUT") {
        statusDisplay = `\x1b[31mTIMEOUT\x1b[0m   (> ${options.timeoutMs / 1000}s)`;
      }

      console.log(`${idxStr} ${pct}% | ${durStr} | ${result.modelFqn} -> ${statusDisplay}`);
    }
  }

  // Spawn parallel workers
  const workerPromises = Array.from({ length: options.jobs }, () => workerLoop());
  await Promise.all(workerPromises);

  const totalDurationSec = (Date.now() - tSuiteStart) / 1000;

  // Compute aggregate stats
  const matches = results.filter((r) => r.status === "MATCH").length;
  const diffs = results.filter((r) => r.status === "DIFF").length;
  const msErrors = results.filter((r) => r.status === "MS_ERROR").length;
  const omcErrors = results.filter((r) => r.status === "OMC_ERROR").length;
  const timeouts = results.filter((r) => r.status === "TIMEOUT").length;

  console.log(`\n================================================================================`);
  console.log(`SUMMARY RESULTS (MSL ${options.version})`);
  console.log(`================================================================================`);
  console.log(`Total Models:   ${results.length}`);
  console.log(`MATCH:          ${matches.toString().padStart(5)} (${((matches / results.length) * 100).toFixed(1)}%)`);
  console.log(`DIFF:           ${diffs.toString().padStart(5)} (${((diffs / results.length) * 100).toFixed(1)}%)`);
  console.log(
    `MS_ERROR:       ${msErrors.toString().padStart(5)} (${((msErrors / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `OMC_ERROR:      ${omcErrors.toString().padStart(5)} (${((omcErrors / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `TIMEOUT:        ${timeouts.toString().padStart(5)} (${((timeouts / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Total Time:     ${totalDurationSec.toFixed(2)}s (avg ${(totalDurationSec / results.length).toFixed(2)}s/model)`,
  );
  console.log(`================================================================================\n`);

  // Package-level breakdown
  const packageStats = new Map<string, { total: number; match: number; diff: number; msErr: number; omcErr: number }>();
  for (const r of results) {
    const pkg = r.modelFqn.split(".").slice(0, 2).join(".");
    const s = packageStats.get(pkg) || { total: 0, match: 0, diff: 0, msErr: 0, omcErr: 0 };
    s.total++;
    if (r.status === "MATCH") s.match++;
    else if (r.status === "DIFF") s.diff++;
    else if (r.status === "MS_ERROR") s.msErr++;
    else if (r.status === "OMC_ERROR") s.omcErr++;
    packageStats.set(pkg, s);
  }

  console.log(`Package Breakdown:`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Package                                Total  Match   Diff  MS_Err  OMC_Err  Match%`);
  console.log(`--------------------------------------------------------------------------------`);
  for (const [pkg, s] of packageStats.entries()) {
    const pct = ((s.match / s.total) * 100).toFixed(1) + "%";
    console.log(
      `${pkg.padEnd(36)} ${String(s.total).padStart(5)}  ${String(s.match).padStart(5)}  ${String(s.diff).padStart(5)}  ${String(s.msErr).padStart(6)}  ${String(s.omcErr).padStart(7)}  ${pct.padStart(6)}`,
    );
  }
  console.log(`--------------------------------------------------------------------------------\n`);

  // Save JSON report if requested
  if (options.reportJson) {
    fs.writeFileSync(options.reportJson, JSON.stringify(results, null, 2), "utf-8");
    console.log(`[msl-runner] Wrote JSON report to: ${options.reportJson}`);
  }

  // Save HTML report if requested
  if (options.reportHtml) {
    const html = generateHtmlReport(options, results, {
      total: results.length,
      matches,
      diffs,
      msErrors,
      omcErrors,
      timeouts,
      totalDurationSec,
    });
    fs.writeFileSync(options.reportHtml, html, "utf-8");
    console.log(`[msl-runner] Wrote HTML report to: ${options.reportHtml}`);
  }
}

main().catch((err) => {
  console.error("Runner fatal error:", err);
  process.exit(1);
});
