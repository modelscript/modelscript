// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MSL Comparison & Verification Suite Runner
 *
 * Runs the ModelScript compiler against MSL models and compares results
 * (flattening, simulation, diagram rendering, and icon rendering) to OpenModelica (omc).
 *
 * Usage:
 *   npx tsx tests/msl-comparison-runner.ts [options]
 *
 * Options:
 *   --stage=<all|flatten|simulate|icon|diagram>  Stage to execute (default: flatten)
 *   --flatten                                    Run flattening comparison (shortcut)
 *   --simulate                                   Run simulation trajectory comparison (shortcut)
 *   --diagram                                    Run diagram rendering verification (shortcut)
 *   --icon                                       Run icon rendering verification (shortcut)
 *   --all-stages                                 Run all 4 stages (shortcut)
 *   --tolerance=<number>                         Numerical simulation tolerance (default: 1e-3)
 *   --version=<4.0.0|4.1.0>                      MSL version (default: 4.0.0)
 *   --all                                        Include all models/blocks (default: only Examples)
 *   --examples-only                              Only test models in Examples subpackages (default)
 *   --package=<prefix>                           Filter by package prefix (e.g. Modelica.Electrical.Analog)
 *   --model=<FQN>                                Test a single model (e.g. Modelica.Electrical.Analog.Examples.ChuaCircuit)
 *   --limit=<N>                                  Limit execution to the first N models
 *   --jobs=<N>, -j <N>                           Number of parallel workers (default: 4)
 *   --force-omc                                  Bypass cached OMC output and re-evaluate with omc
 *   --timeout=<seconds>                          Per-model timeout in seconds (default: 60)
 *   --report-json=<path>                         Export results to a JSON file
 *   --report-html=<path>                         Export an interactive HTML report
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveredModel, MslStage, RunnerOptions, WorkerResult, WorkerTask } from "./msl-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function parseArgs(): RunnerOptions {
  const opts: RunnerOptions = {
    version: "4.0.0",
    stage: "flatten",
    all: false,
    jobs: Math.max(1, Math.min(8, (os.cpus()?.length || 4) - 1)),
    forceOmc: false,
    timeoutMs: 60_000,
    tolerance: 1e-3,
  };

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--version=")) {
      opts.version = arg.split("=")[1].trim();
    } else if (arg.startsWith("--stage=")) {
      opts.stage = arg.split("=")[1].trim() as MslStage;
    } else if (arg === "--flatten") {
      opts.stage = "flatten";
    } else if (arg === "--simulate") {
      opts.stage = "simulate";
    } else if (arg === "--diagram" || arg === "--diagrams") {
      opts.stage = "diagram";
    } else if (arg === "--icon" || arg === "--icons") {
      opts.stage = "icon";
    } else if (arg === "--all-stages") {
      opts.stage = "all";
    } else if (arg.startsWith("--tolerance=")) {
      opts.tolerance = parseFloat(arg.split("=")[1].trim());
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
    } else if (arg.startsWith("--report-ctrf=")) {
      opts.reportCtrf = path.resolve(arg.split("=")[1].trim());
    } else if (arg === "--report-ctrf") {
      opts.reportCtrf = path.resolve(repoRoot, "languages/modelica/ctrf", `ctrf-msl-${opts.stage}-report.json`);
    }
  }

  if (!opts.reportCtrf && (process.env.CTRF_OUTPUT_PATH || process.env.CTRF_OUTPUT_DIR)) {
    if (process.env.CTRF_OUTPUT_PATH) {
      opts.reportCtrf = path.resolve(process.env.CTRF_OUTPUT_PATH);
    } else if (process.env.CTRF_OUTPUT_DIR) {
      opts.reportCtrf = path.resolve(process.env.CTRF_OUTPUT_DIR, `ctrf-msl-${opts.stage}-report.json`);
    }
  }

  return opts;
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
          stage: task.stage,
          error: "Process timed out",
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
        stage: task.stage,
        error: errDetails,
      });
    });

    // Send task payload
    child.stdin.write(JSON.stringify(task) + "\n");
    child.stdin.end();
  });
}

function renderTrajectorySparkline(traj: NonNullable<SimComparisonResult["comparison"]["sampleTrajectory"]>): string {
  const { variable, times, omcValues, msValues } = traj;
  if (!times || times.length < 2) return "";

  const w = 580;
  const h = 170;
  const padL = 60;
  const padR = 20;
  const padT = 30;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minT = times[0];
  const maxT = times[times.length - 1];
  const tSpan = maxT - minT || 1;

  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of [...omcValues, ...msValues]) {
    if (Number.isFinite(v)) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!Number.isFinite(minV)) minV = 0;
  if (!Number.isFinite(maxV)) maxV = 1;
  if (minV === maxV) {
    minV -= 1;
    maxV += 1;
  }
  const vSpan = maxV - minV;

  const toX = (t: number) => (padL + ((t - minT) / tSpan) * plotW).toFixed(1);
  const toY = (v: number) => (padT + plotH - ((v - minV) / vSpan) * plotH).toFixed(1);

  const msPoints = times.map((t, idx) => `${toX(t)},${toY(msValues[idx])}`).join(" ");
  const omcPoints = times.map((t, idx) => `${toX(t)},${toY(omcValues[idx])}`).join(" ");

  const yMid = padT + plotH / 2;
  const midV = ((minV + maxV) / 2).toPrecision(4);

  return `
  <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 14px; margin-top: 10px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-weight: 600; color: #fff; font-size: 13px;">Trajectory Overlay: <code style="color: #38bdf8;">${variable}</code></span>
      <div style="display: flex; gap: 14px; font-size: 12px;">
        <span style="color: #38bdf8; display: flex; align-items: center; gap: 4px;">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#38bdf8" stroke-width="2.5"/></svg> ModelScript
        </span>
        <span style="color: #a855f7; display: flex; align-items: center; gap: 4px;">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#a855f7" stroke-width="2" stroke-dasharray="3,2"/></svg> OMC
        </span>
      </div>
    </div>
    <svg viewBox="0 0 ${w} ${h}" style="width: 100%; max-width: 600px; height: auto; display: block; overflow: visible;">
      <!-- Gridlines -->
      <line x1="${padL}" y1="${padT}" x2="${padL + plotW}" y2="${padT}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${yMid}" x2="${padL + plotW}" y2="${yMid}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.12)"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.12)"/>

      <!-- Y Axis Labels -->
      <text x="${padL - 8}" y="${padT + 4}" fill="#8b949e" font-size="10" text-anchor="end" font-family="monospace">${maxV.toPrecision(3)}</text>
      <text x="${padL - 8}" y="${yMid + 3}" fill="#8b949e" font-size="10" text-anchor="end" font-family="monospace">${midV}</text>
      <text x="${padL - 8}" y="${padT + plotH}" fill="#8b949e" font-size="10" text-anchor="end" font-family="monospace">${minV.toPrecision(3)}</text>

      <!-- X Axis Labels -->
      <text x="${padL}" y="${h - 8}" fill="#8b949e" font-size="10" text-anchor="start" font-family="monospace">t=${minT.toFixed(2)}s</text>
      <text x="${padL + plotW}" y="${h - 8}" fill="#8b949e" font-size="10" text-anchor="end" font-family="monospace">t=${maxT.toFixed(2)}s</text>

      <!-- Trajectory curves -->
      <polyline points="${omcPoints}" fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="4,3" opacity="0.9" />
      <polyline points="${msPoints}" fill="none" stroke="#38bdf8" stroke-width="2.5" opacity="0.95" />
    </svg>
  </div>`;
}

function renderSvgPreview(svg: string, label: string): string {
  const sanitized = svg.replace("<svg", '<svg style="width:100%; height:100%; object-fit:contain;"');
  return `
  <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 14px; margin-top: 10px;">
    <div style="font-weight: 600; color: #fff; font-size: 13px; margin-bottom: 8px;">${label} Preview:</div>
    <div style="display: flex; justify-content: center; align-items: center; background: radial-gradient(circle, #1a2234 0%, #090d16 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 16px; max-height: 280px; overflow: hidden;">
      <div style="width: 220px; height: 180px; display: flex; align-items: center; justify-content: center;">
        ${sanitized}
      </div>
    </div>
  </div>`;
}

function generateCtrfReport(
  options: RunnerOptions,
  results: WorkerResult[],
  startTime: number,
  stopTime: number,
  metrics: {
    totalCpuMs: number;
    peakMemoryMB: number;
  },
): object {
  const tests = results.map((r) => {
    let status: "passed" | "failed" | "skipped" | "pending" | "other" = "other";
    if (r.status === "MATCH") status = "passed";
    else if (r.status === "SKIPPED") status = "skipped";
    else if (r.status === "DIFF" || r.status === "MS_ERROR" || r.status === "OMC_ERROR" || r.status === "TIMEOUT") {
      status = "failed";
    }

    let message: string | undefined;
    if (r.error) {
      message = r.error;
    } else if (r.status === "DIFF") {
      message =
        r.flatten?.comparison.diffSummary ||
        r.simulation?.comparison.errorSummary ||
        (r.diagram ? `Unresolved components: ${r.diagram.modelscript.unresolvedCount}` : "Verification diff detected");
    } else if (r.status === "OMC_ERROR") {
      message = r.flatten?.omc.error || r.simulation?.omc.error || "OMC execution error";
    } else if (r.status === "TIMEOUT") {
      message = `Verification timed out after ${r.durationMs}ms`;
    }

    const testItem: Record<string, any> = {
      name: `${r.modelFqn} [${r.stage}]`,
      status,
      duration: r.durationMs,
      rawStatus: r.status,
    };

    if (message) {
      testItem.message = message;
    }

    if (r.cpuMs !== undefined || r.peakMemoryMB !== undefined) {
      testItem.extra = {
        cpuMs: r.cpuMs,
        peakMemoryMB: r.peakMemoryMB,
      };
    }

    return testItem;
  });

  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const pending = tests.filter((t) => t.status === "pending").length;
  const other = tests.filter((t) => t.status === "other").length;

  return {
    results: {
      tool: {
        name: `msl-verification-${options.stage}`,
        version: options.version,
      },
      summary: {
        tests: tests.length,
        passed,
        failed,
        pending,
        skipped,
        other,
        start: startTime,
        stop: stopTime,
      },
      environment: {
        appName: "ModelScript",
        stage: options.stage,
        totalCpuMs: metrics.totalCpuMs,
        peakMemoryMB: metrics.peakMemoryMB,
      },
      tests,
    },
  };
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
    totalCpuSec: number;
    peakMemoryMB: number;
  },
): string {
  const matchPct = ((stats.matches / (stats.total || 1)) * 100).toFixed(1);
  const diffPct = ((stats.diffs / (stats.total || 1)) * 100).toFixed(1);
  const msErrPct = ((stats.msErrors / (stats.total || 1)) * 100).toFixed(1);

  const rows = results
    .map((r, i) => {
      let badgeClass = "badge-match";
      if (r.status === "DIFF") badgeClass = "badge-diff";
      else if (r.status === "MS_ERROR") badgeClass = "badge-ms-err";
      else if (r.status === "OMC_ERROR") badgeClass = "badge-omc-err";
      else if (r.status === "TIMEOUT") badgeClass = "badge-timeout";
      else if (r.status === "SKIPPED") badgeClass = "badge-skipped";

      let detailText = "";
      if (r.flatten) {
        detailText +=
          r.flatten.comparison.diffSummary ||
          `DAE: v=${r.flatten.modelscript.varCount}, e=${r.flatten.modelscript.eqCount}`;
      }
      if (r.simulation) {
        detailText +=
          (detailText ? " | " : "") +
          (r.simulation.comparison.errorSummary ||
            `Sim: matched=${r.simulation.comparison.matchedVariables}, maxRelErr=${r.simulation.comparison.maxRelativeError.toExponential(1)}`);
      }
      if (r.icon) {
        detailText +=
          (detailText ? " | " : "") +
          `Icon: elems=${r.icon.modelscript.elementCount}, len=${r.icon.modelscript.svgLength}`;
      }
      if (r.diagram) {
        detailText +=
          (detailText ? " | " : "") +
          `Diag: nodes=${r.diagram.modelscript.nodeCount}, edges=${r.diagram.modelscript.edgeCount}`;
      }
      if (r.error) {
        detailText = r.error.slice(0, 140);
      }

      const msCpuStr = r.cpuMs !== undefined ? `${r.cpuMs}ms` : "-";
      const msMemStr = r.peakMemoryMB !== undefined ? `${r.peakMemoryMB} MB` : "-";
      const omcCpu = r.flatten?.omc.cpuMs ?? r.simulation?.omc.cpuMs;
      const omcMem = r.flatten?.omc.peakMemoryMB ?? r.simulation?.omc.peakMemoryMB;
      const omcCpuStr = omcCpu !== undefined ? `${omcCpu}ms` : "-";
      const omcMemStr = omcMem !== undefined ? `${omcMem} MB` : "-";

      const resourceCard = `
          <div class="drawer-card">
            <div class="drawer-label">Resource Consumption</div>
            <div class="metric-row"><span>ModelScript CPU:</span> <strong>${msCpuStr}</strong></div>
            <div class="metric-row"><span>ModelScript RSS:</span> <strong>${msMemStr}</strong></div>
            ${
              omcCpu !== undefined || omcMem !== undefined
                ? `<div class="metric-row"><span>OpenModelica CPU:</span> <strong>${omcCpuStr}</strong></div>
            <div class="metric-row"><span>OpenModelica RSS:</span> <strong>${omcMemStr}</strong></div>`
                : ""
            }
          </div>`;

      // Build accordion details block
      let drawerContent = "";

      if (r.simulation) {
        const sim = r.simulation;
        drawerContent += `
        <div class="drawer-grid">
          <div class="drawer-card">
            <div class="drawer-label">Simulation Metrics</div>
            <div class="metric-row"><span>Matched Variables:</span> <strong>${sim.comparison.matchedVariables}</strong></div>
            <div class="metric-row"><span>Max Relative Error:</span> <strong>${sim.comparison.maxRelativeError.toExponential(3)}</strong></div>
            <div class="metric-row"><span>RMSE:</span> <strong>${sim.comparison.rmse.toExponential(3)}</strong></div>
          </div>
          <div class="drawer-card">
            <div class="drawer-label">Performance Breakdown</div>
            <div class="metric-row"><span>ModelScript Sim Time:</span> <strong>${sim.modelscript.durationMs}ms</strong> (${sim.modelscript.stepCount} steps)</div>
            <div class="metric-row"><span>OMC Sim Time:</span> <strong>${sim.omc.durationMs}ms</strong> (${sim.omc.stepCount} steps, cached: ${sim.omc.cached})</div>
          </div>
          ${resourceCard}
        </div>`;
        if (sim.comparison.sampleTrajectory) {
          drawerContent += renderTrajectorySparkline(sim.comparison.sampleTrajectory);
        }
      }

      if (r.flatten) {
        const fl = r.flatten;
        drawerContent += `
        <div class="drawer-grid">
          <div class="drawer-card">
            <div class="drawer-label">ModelScript DAE</div>
            <div class="metric-row"><span>Variables:</span> <strong>${fl.modelscript.varCount}</strong></div>
            <div class="metric-row"><span>Equations:</span> <strong>${fl.modelscript.eqCount}</strong></div>
            <div class="metric-row"><span>Duration:</span> <strong>${fl.modelscript.durationMs}ms</strong></div>
          </div>
          <div class="drawer-card">
            <div class="drawer-label">OpenModelica DAE</div>
            <div class="metric-row"><span>Variables:</span> <strong>${fl.omc.varCount}</strong></div>
            <div class="metric-row"><span>Equations:</span> <strong>${fl.omc.eqCount}</strong></div>
            <div class="metric-row"><span>Duration:</span> <strong>${fl.omc.durationMs}ms</strong> (cached: ${fl.omc.cached})</div>
          </div>
          ${resourceCard}
        </div>`;
      }

      if (r.icon) {
        const ic = r.icon;
        drawerContent += `
        <div class="drawer-grid">
          <div class="drawer-card">
            <div class="drawer-label">Icon Metrics</div>
            <div class="metric-row"><span>Graphic Elements:</span> <strong>${ic.modelscript.elementCount}</strong></div>
            <div class="metric-row"><span>SVG Length:</span> <strong>${ic.modelscript.svgLength} bytes</strong></div>
            <div class="metric-row"><span>ViewBox:</span> <strong>${ic.modelscript.viewBox || "default"}</strong></div>
            <div class="metric-row"><span>Duration:</span> <strong>${ic.modelscript.durationMs}ms</strong></div>
          </div>
          ${resourceCard}
        </div>`;
        if (ic.modelscript.svgPreview) {
          drawerContent += renderSvgPreview(ic.modelscript.svgPreview, "Icon");
        }
      }

      if (r.diagram) {
        const dg = r.diagram;
        drawerContent += `
        <div class="drawer-grid">
          <div class="drawer-card">
            <div class="drawer-label">Diagram Metrics</div>
            <div class="metric-row"><span>Nodes / Components:</span> <strong>${dg.modelscript.nodeCount}</strong></div>
            <div class="metric-row"><span>Connections / Edges:</span> <strong>${dg.modelscript.edgeCount}</strong></div>
            <div class="metric-row"><span>Unresolved Components:</span> <strong>${dg.modelscript.unresolvedCount}</strong></div>
            <div class="metric-row"><span>Duration:</span> <strong>${dg.modelscript.durationMs}ms</strong></div>
          </div>
          ${resourceCard}
        </div>`;
        if (dg.modelscript.svgPreview) {
          drawerContent += renderSvgPreview(dg.modelscript.svgPreview, "Diagram");
        }
      }

      if (r.error) {
        drawerContent += `
        <div style="margin-top: 10px;">
          <div style="font-weight: 600; color: var(--danger); font-size: 13px; margin-bottom: 6px;">Error Output:</div>
          <pre style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 12px; color: #ff8b8b; font-size: 12px; overflow-x: auto; white-space: pre-wrap;">${r.error}</pre>
        </div>`;
      }

      return `
      <tr class="result-row clickable" data-status="${r.status}" onclick="toggleDetails(${i})">
        <td class="text-muted">${i + 1}</td>
        <td><span class="badge ${badgeClass}">${r.status}</span></td>
        <td class="font-mono model-name">${r.modelFqn}</td>
        <td class="text-center font-mono">${r.stage}</td>
        <td class="text-right font-mono text-muted">${r.durationMs}ms <span style="font-size: 11px; color: var(--primary); opacity: 0.85;">(${msCpuStr})</span></td>
        <td class="text-right font-mono text-muted">${msMemStr}</td>
        <td class="details-cell font-mono text-sm">${detailText}</td>
      </tr>
      <tr id="details-${i}" class="details-row" style="display: none;">
        <td colspan="7">
          <div class="drawer-box">
            ${drawerContent || '<span class="text-muted">No additional details recorded.</span>'}
          </div>
        </td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ModelScript vs OMC: MSL ${options.version} Benchmark [${options.stage.toUpperCase()}]</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 27, 34, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --primary: #38bdf8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
    .container { max-width: 1440px; margin: 0 auto; }
    .header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 24px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 12px; }
    .stage-pill { font-size: 13px; text-transform: uppercase; background: rgba(56, 189, 248, 0.15); color: var(--primary); padding: 3px 10px; border-radius: 12px; border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 600; }
    .subtitle { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 18px; text-align: center; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
    .stat-val { font-size: 30px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .stat-lbl { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.8px; font-weight: 600; }
    .controls { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
    .search-input { flex: 1; min-width: 280px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 9px 14px; color: #fff; font-size: 14px; outline: none; }
    .search-input:focus { border-color: var(--primary); }
    .btn { background: var(--card-bg); border: 1px solid var(--border); color: var(--text); padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.15s ease; }
    .btn:hover { border-color: var(--text-muted); }
    .btn.active { background: var(--primary); color: #000; border-color: var(--primary); }
    .table-container { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; backdrop-filter: blur(12px); box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 11px 16px; border-bottom: 1px solid var(--border); text-align: left; }
    th { background: rgba(255, 255, 255, 0.03); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    .result-row.clickable { cursor: pointer; transition: background 0.15s ease; }
    .result-row.clickable:hover { background: rgba(255, 255, 255, 0.04); }
    .details-row td { background: rgba(0, 0, 0, 0.35); padding: 18px 24px; border-bottom: 1px solid var(--border); }
    .drawer-box { max-width: 100%; }
    .drawer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 12px; }
    .drawer-card { background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; }
    .drawer-label { font-size: 12px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
    .metric-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; color: var(--text-muted); font-family: monospace; }
    .metric-row strong { color: var(--text); }
    .badge { padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; display: inline-block; letter-spacing: 0.3px; }
    .badge-match { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-diff { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-ms-err { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-omc-err { background: rgba(139, 92, 246, 0.15); color: var(--purple); border: 1px solid rgba(139, 92, 246, 0.3); }
    .badge-timeout { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-skipped { background: rgba(139, 148, 158, 0.15); color: var(--text-muted); border: 1px solid rgba(139, 148, 158, 0.3); }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">
          ModelScript vs OMC Benchmark
          <span class="stage-pill">${options.stage}</span>
        </div>
        <div class="subtitle">MSL Version: ${options.version} | Workers: ${options.jobs} | Generated: ${new Date().toISOString()}</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val">${stats.total}</div>
        <div class="stat-lbl">Total Models Tested</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--success);">${stats.matches}</div>
        <div class="stat-lbl">Matches (${matchPct}%)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--warning);">${stats.diffs}</div>
        <div class="stat-lbl">Diffs (${diffPct}%)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--danger);">${stats.msErrors}</div>
        <div class="stat-lbl">Errors (${msErrPct}%)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.totalDurationSec.toFixed(1)}s</div>
        <div class="stat-lbl">Wall Time</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--primary);">${stats.totalCpuSec.toFixed(1)}s</div>
        <div class="stat-lbl">Total CPU</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--purple);">${stats.peakMemoryMB.toFixed(0)} MB</div>
        <div class="stat-lbl">Peak Memory</div>
      </div>
    </div>

    <div class="controls">
      <input type="text" id="searchInput" class="search-input" placeholder="Search models by name (e.g. Electrical.Analog)..." />
      <button class="btn active" onclick="filterStatus('ALL')">All (${stats.total})</button>
      <button class="btn" onclick="filterStatus('MATCH')">Matches (${stats.matches})</button>
      <button class="btn" onclick="filterStatus('DIFF')">Diffs (${stats.diffs})</button>
      <button class="btn" onclick="filterStatus('MS_ERROR')">Errors (${stats.msErrors})</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 45px;">#</th>
            <th style="width: 95px;">Status</th>
            <th>Model FQN</th>
            <th style="width: 90px;" class="text-center">Stage</th>
            <th style="width: 140px;" class="text-right">Wall / CPU</th>
            <th style="width: 95px;" class="text-right">Peak Memory</th>
            <th>Details (Click row to expand)</th>
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
      rows.forEach((r, idx) => {
        const rowStatus = r.getAttribute('data-status');
        const text = r.querySelector('.model-name').textContent.toLowerCase();
        const matchesStatus = currentStatus === 'ALL' || rowStatus === currentStatus;
        const matchesSearch = !q || text.includes(q);
        const shouldShow = matchesStatus && matchesSearch;
        r.style.display = shouldShow ? '' : 'none';
        const detailsRow = document.getElementById('details-' + idx);
        if (detailsRow && !shouldShow) {
          detailsRow.style.display = 'none';
        }
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

    window.toggleDetails = function(index) {
      const row = document.getElementById('details-' + index);
      if (!row) return;
      row.style.display = row.style.display === 'none' ? '' : 'none';
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

  // Check or build cache
  if (!fs.existsSync(indexCachePath) || !fs.existsSync(modelsCachePath)) {
    console.log(`[msl-runner] Precomputed index not found at ${indexCachePath}`);
    console.log(`[msl-runner] Generating index cache now (this is done once per MSL version)...`);
    const buildIndexScript = path.resolve(__dirname, "build-msl-index.ts");
    execSync(`npx tsx "${buildIndexScript}" --version=${options.version}`, {
      stdio: "inherit",
      cwd: repoRoot,
    });
  }

  const allModels: DiscoveredModel[] = JSON.parse(fs.readFileSync(modelsCachePath, "utf-8"));

  // Apply filters
  let selectedModels = allModels;

  // Default to examples-only for simulation and flattening unless --all is passed
  if (!options.all && (options.stage === "simulate" || options.stage === "flatten" || !options.packagePrefix)) {
    selectedModels = selectedModels.filter((m) => m.isExample);
  }

  if (options.packagePrefix) {
    selectedModels = selectedModels.filter((m) => m.fqn.startsWith(options.packagePrefix!));
  }

  if (options.modelFqn) {
    selectedModels = selectedModels.filter((m) => m.fqn === options.modelFqn);
  }

  if (options.limit && options.limit > 0) {
    selectedModels = selectedModels.slice(0, options.limit);
  }

  if (selectedModels.length === 0) {
    console.log(`[msl-runner] No models matched the given filters.`);
    process.exit(0);
  }

  console.log(`================================================================================`);
  console.log(`ModelScript vs OpenModelica Verification Suite (MSL ${options.version})`);
  console.log(`================================================================================`);
  console.log(`Stage:           ${options.stage.toUpperCase()}`);
  console.log(`Models selected: ${selectedModels.length}`);
  console.log(`Workers:         ${options.jobs}`);
  console.log(`OMC caching:     ${options.forceOmc ? "Disabled (force re-run)" : "Enabled (.cache/)"}`);
  console.log(`Timeout:         ${options.timeoutMs / 1000}s per model`);
  if (options.tolerance) console.log(`Sim Tolerance:   ${options.tolerance}`);
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
        stage: options.stage,
        forceOmc: options.forceOmc,
        simTolerance: options.tolerance,
      };

      const result = await runWorker(task, options.timeoutMs);
      results.push(result);
      completed++;

      const pct = ((completed / selectedModels.length) * 100).toFixed(0).padStart(3);
      const idxStr = `[${String(completed).padStart(String(selectedModels.length).length)}/${selectedModels.length}]`;
      const durStr = `${result.durationMs}ms`.padStart(7);
      const cpuMemStr =
        result.cpuMs !== undefined && result.peakMemoryMB !== undefined
          ? `(cpu: ${result.cpuMs}ms, mem: ${result.peakMemoryMB}MB)`
          : "";

      let statusDisplay = result.status;
      if (result.status === "MATCH") {
        let details = "";
        if (result.flatten)
          details = `DAE(v=${result.flatten.modelscript.varCount}, e=${result.flatten.modelscript.eqCount})`;
        else if (result.simulation)
          details = `Sim(vars=${result.simulation.comparison.matchedVariables}, maxRelErr=${result.simulation.comparison.maxRelativeError.toExponential(1)})`;
        else if (result.icon)
          details = `Icon(elems=${result.icon.modelscript.elementCount}, len=${result.icon.modelscript.svgLength})`;
        else if (result.diagram)
          details = `Diag(nodes=${result.diagram.modelscript.nodeCount}, edges=${result.diagram.modelscript.edgeCount})`;
        statusDisplay = `\x1b[32mMATCH\x1b[0m     ${details}`;
      } else if (result.status === "DIFF") {
        let details = "";
        if (result.flatten) details = result.flatten.comparison.diffSummary || "";
        else if (result.simulation) details = result.simulation.comparison.errorSummary || "";
        else if (result.diagram) details = `Unresolved nodes: ${result.diagram.modelscript.unresolvedCount}`;
        statusDisplay = `\x1b[33mDIFF\x1b[0m      ${details}`;
      } else if (result.status === "SKIPPED") {
        statusDisplay = `\x1b[90mSKIPPED\x1b[0m   (not applicable/no annotation)`;
      } else if (result.status === "MS_ERROR") {
        const preview = (
          result.error ||
          result.diagram?.modelscript.error ||
          result.icon?.modelscript.error ||
          result.flatten?.modelscript.error ||
          result.simulation?.modelscript.error ||
          ""
        )
          .replace(/\n/g, " ")
          .slice(0, 60);
        statusDisplay = `\x1b[31mMS_ERROR\x1b[0m  ${preview}`;
      } else if (result.status === "OMC_ERROR") {
        const preview = (result.flatten?.omc.error || result.simulation?.omc.error || "").slice(0, 50);
        statusDisplay = `\x1b[35mOMC_ERROR\x1b[0m ${preview}`;
      } else if (result.status === "TIMEOUT") {
        statusDisplay = `\x1b[31mTIMEOUT\x1b[0m   (> ${options.timeoutMs / 1000}s)`;
      }

      console.log(`${idxStr} ${pct}% | ${durStr} ${cpuMemStr.padEnd(26)} | ${result.modelFqn} -> ${statusDisplay}`);
    }
  }

  // Spawn parallel workers
  const workerPromises = Array.from({ length: options.jobs }, () => workerLoop());
  await Promise.all(workerPromises);

  const totalDurationSec = (Date.now() - tSuiteStart) / 1000;
  const totalCpuMs = results.reduce((sum, r) => sum + (r.cpuMs || 0), 0);
  const totalCpuSec = totalCpuMs / 1000;
  const peakMemoryMB = results.reduce((max, r) => Math.max(max, r.peakMemoryMB || 0), 0);

  // Compute aggregate stats
  const matches = results.filter((r) => r.status === "MATCH").length;
  const diffs = results.filter((r) => r.status === "DIFF").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  const msErrors = results.filter((r) => r.status === "MS_ERROR").length;
  const omcErrors = results.filter((r) => r.status === "OMC_ERROR").length;
  const timeouts = results.filter((r) => r.status === "TIMEOUT").length;

  console.log(`\n================================================================================`);
  console.log(`SUMMARY RESULTS (MSL ${options.version} - Stage: ${options.stage.toUpperCase()})`);
  console.log(`================================================================================`);
  console.log(`Total Models:   ${results.length}`);
  console.log(`MATCH:          ${matches.toString().padStart(5)} (${((matches / results.length) * 100).toFixed(1)}%)`);
  console.log(`DIFF:           ${diffs.toString().padStart(5)} (${((diffs / results.length) * 100).toFixed(1)}%)`);
  if (skipped > 0) {
    console.log(
      `SKIPPED:        ${skipped.toString().padStart(5)} (${((skipped / results.length) * 100).toFixed(1)}%)`,
    );
  }
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
    `Wall Time:      ${totalDurationSec.toFixed(2)}s (avg ${(totalDurationSec / results.length).toFixed(2)}s/model)`,
  );
  console.log(
    `Total CPU Time: ${totalCpuSec.toFixed(2)}s (avg ${(totalCpuMs / (results.length || 1)).toFixed(1)}ms/model)`,
  );
  console.log(`Peak Memory:    ${peakMemoryMB.toFixed(1)} MB`);
  console.log(`================================================================================\n`);

  // Export JSON Report
  if (options.reportJson) {
    const jsonOutput = {
      version: options.version,
      stage: options.stage,
      timestamp: new Date().toISOString(),
      durationSec: totalDurationSec,
      cpuSec: totalCpuSec,
      peakMemoryMB,
      stats: { total: results.length, matches, diffs, msErrors, omcErrors, timeouts },
      results,
    };
    fs.mkdirSync(path.dirname(options.reportJson), { recursive: true });
    fs.writeFileSync(options.reportJson, JSON.stringify(jsonOutput, null, 2), "utf-8");
    console.log(`[msl-runner] Wrote JSON report to: ${options.reportJson}`);
  }

  // Export HTML Report
  if (options.reportHtml) {
    const htmlOutput = generateHtmlReport(options, results, {
      total: results.length,
      matches,
      diffs,
      msErrors,
      omcErrors,
      timeouts,
      totalDurationSec,
      totalCpuSec,
      peakMemoryMB,
    });
    fs.mkdirSync(path.dirname(options.reportHtml), { recursive: true });
    fs.writeFileSync(options.reportHtml, htmlOutput, "utf-8");
    console.log(`[msl-runner] Wrote HTML report to: ${options.reportHtml}`);
  }

  // Export CTRF Report
  if (options.reportCtrf) {
    const ctrfOutput = generateCtrfReport(options, results, tSuiteStart, Date.now(), {
      totalCpuMs,
      peakMemoryMB,
    });
    fs.mkdirSync(path.dirname(options.reportCtrf), { recursive: true });
    fs.writeFileSync(options.reportCtrf, JSON.stringify(ctrfOutput, null, 2), "utf-8");
    console.log(`[msl-runner] Wrote CTRF report to: ${options.reportCtrf}`);
  }
}

main().catch(console.error);
