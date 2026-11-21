// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Unified Structured Study Reporter (JSON / CSV / HTML)
 *
 * Provides consistent machine-readable (JSON, CSV) and interactive dark-mode HTML
 * report generation across Power Flow, N-1 Contingency, Short-Circuit, Modal Analysis,
 * and Continuation Power Flow studies.
 */

import type {
  N1ContingencyAnalysisResult,
  PowerFlowSolution,
  ShortCircuitAnalysisResult,
} from "../solver/ac-powerflow.js";
import type { CpfResult } from "../solver/continuation-powerflow.js";
import type { ModalAnalysisResult } from "../solver/small-signal.js";

export type StudyReportFormat = "json" | "csv" | "html";

export function formatPowerFlowStudyReport(
  solution: PowerFlowSolution,
  format: StudyReportFormat,
  caseTitle = "PSS/E BASE CASE",
): string {
  if (format === "json") {
    return JSON.stringify({ study: "power_flow", caseTitle, ...solution }, null, 2);
  }
  if (format === "csv") {
    const lines = ["bus_number,name,base_kv,vm_pu,va_deg,pg_mw,qg_mvar,pl_mw,ql_mvar"];
    for (const b of solution.buses) {
      lines.push(
        `${b.busNumber},"${b.name}",${b.baseKv},${b.vm.toFixed(5)},${b.va.toFixed(3)},${b.pgMw.toFixed(3)},${b.qgMvar.toFixed(3)},${b.plMw.toFixed(3)},${b.qlMvar.toFixed(3)}`,
      );
    }
    return lines.join("\n");
  }
  const rows = solution.buses
    .map(
      (b) =>
        `<tr><td>${b.busNumber}</td><td>${b.name}</td><td>${b.baseKv}</td><td>${b.vm.toFixed(4)}</td><td>${b.va.toFixed(2)}&deg;</td><td>${b.pgMw.toFixed(2)}</td><td>${b.plMw.toFixed(2)}</td></tr>`,
    )
    .join("");
  return wrapDarkHtml(
    `Power Flow — ${caseTitle}`,
    `<p>Converged: <b>${solution.converged}</b> (${solution.iterations} iters, ${solution.algorithm}) | Gen: ${solution.totalGenMw.toFixed(2)} MW | Load: ${solution.totalLoadMw.toFixed(2)} MW | Losses: ${solution.totalLossMw.toFixed(2)} MW</p>
<table><tr><th>Bus</th><th>Name</th><th>kV</th><th>Vm (pu)</th><th>Va (deg)</th><th>Pgen (MW)</th><th>Pload (MW)</th></tr>${rows}</table>`,
  );
}

export function formatN1StudyReport(
  result: N1ContingencyAnalysisResult,
  format: StudyReportFormat,
  caseTitle = "PSS/E BASE CASE",
): string {
  if (format === "json") {
    return JSON.stringify({ study: "n1_contingency", caseTitle, ...result }, null, 2);
  }
  if (format === "csv") {
    const lines = [
      "contingency_id,outage_type,description,converged,severity,max_branch_loading_pct,min_voltage_pu,max_voltage_pu,overloads,voltage_violations",
    ];
    for (const c of result.contingencies) {
      lines.push(
        `"${c.contingencyId}",${c.outageType},"${c.description}",${c.converged},${c.severity},${c.maxBranchLoadingPct.toFixed(2)},${c.minVoltagePu.toFixed(4)},${c.maxVoltagePu.toFixed(4)},${c.overloadedBranches.length},${c.voltageViolations.length}`,
      );
    }
    return lines.join("\n");
  }
  const rows = result.contingencies
    .slice(0, 100)
    .map(
      (c) =>
        `<tr><td>${c.contingencyId}</td><td>${c.description}</td><td>${c.severity.toUpperCase()}</td><td>${c.maxBranchLoadingPct.toFixed(1)}%</td><td>${c.minVoltagePu.toFixed(4)}</td><td>${c.maxVoltagePu.toFixed(4)}</td></tr>`,
    )
    .join("");
  return wrapDarkHtml(
    `N-1 Contingency Screening — ${caseTitle}`,
    `<p>Total: ${result.totalContingencies} | Secure: ${result.secureCount} | Warnings: ${result.warningCount} | Violations: ${result.violationCount} | Collapses: ${result.collapseCount}</p>
<table><tr><th>ID</th><th>Description</th><th>Severity</th><th>Max Loading</th><th>Min V (pu)</th><th>Max V (pu)</th></tr>${rows}</table>`,
  );
}

export function formatShortCircuitStudyReport(
  result: ShortCircuitAnalysisResult,
  format: StudyReportFormat,
  caseTitle = "PSS/E BASE CASE",
): string {
  if (format === "json") {
    return JSON.stringify({ study: "short_circuit", caseTitle, ...result }, null, 2);
  }
  if (format === "csv") {
    const lines = ["bus_number,name,base_kv,xr_ratio,ik_3ph_ka,ik_1lg_ka,ik_ll_ka,ik_2lg_ka,ip_peak_ka,sk_3ph_mva"];
    for (const b of result.buses) {
      lines.push(
        `${b.busNumber},"${b.name}",${b.baseKv},${b.xrRatio.toFixed(2)},${b.ik3PhaseKa.toFixed(3)},${b.ik1LineGroundKa.toFixed(3)},${b.ikLineToLineKa.toFixed(3)},${b.ik2LineGroundKa.toFixed(3)},${b.ipPeakMakeKa.toFixed(3)},${b.sk3PhaseMva.toFixed(2)}`,
      );
    }
    return lines.join("\n");
  }
  const rows = result.buses
    .map(
      (b) =>
        `<tr><td>${b.busNumber}</td><td>${b.name}</td><td>${b.baseKv}</td><td>${b.xrRatio.toFixed(2)}</td><td>${b.ik3PhaseKa.toFixed(2)}</td><td>${b.ik1LineGroundKa.toFixed(2)}</td><td>${b.ipPeakMakeKa.toFixed(2)}</td><td>${b.sk3PhaseMva.toFixed(1)}</td></tr>`,
    )
    .join("");
  return wrapDarkHtml(
    `Short-Circuit Analysis — ${caseTitle}`,
    `<p>Max Fault Current: ${result.maxFaultCurrentKa.toFixed(2)} kA at Bus ${result.maxFaultBus} | c-factor: ${result.cFactor}</p>
<table><tr><th>Bus</th><th>Name</th><th>kV</th><th>X/R</th><th>I''k 3Ph (kA)</th><th>I''k 1LG (kA)</th><th>ip Peak (kA)</th><th>S''k (MVA)</th></tr>${rows}</table>`,
  );
}

export function formatModalStudyReport(
  result: ModalAnalysisResult,
  format: StudyReportFormat,
  caseTitle = "PSS/E BASE CASE",
): string {
  if (format === "json") {
    return JSON.stringify({ study: "small_signal_modal", caseTitle, ...result }, null, 2);
  }
  if (format === "csv") {
    const lines = ["mode_index,real,imag,frequency_hz,damping_ratio_pct,mode_type"];
    result.modes.forEach((m, idx) => {
      lines.push(
        `${idx + 1},${m.real.toFixed(5)},${m.imag.toFixed(5)},${m.frequencyHz.toFixed(4)},${(m.dampingRatio * 100).toFixed(3)},${m.modeType}`,
      );
    });
    return lines.join("\n");
  }
  const rows = result.modes
    .map(
      (m, idx) =>
        `<tr><td>${idx + 1}</td><td>${m.real.toFixed(4)} &plusmn; j${Math.abs(m.imag).toFixed(4)}</td><td>${m.frequencyHz.toFixed(3)} Hz</td><td>${(m.dampingRatio * 100).toFixed(2)}%</td><td>${m.modeType}</td></tr>`,
    )
    .join("");
  return wrapDarkHtml(
    `Small-Signal Modal Analysis — ${caseTitle}`,
    `<p>System Stable: <b>${result.summary.stable}</b> | Modes: ${result.modes.length}</p>
<table><tr><th>#</th><th>Eigenvalue</th><th>Freq</th><th>Damping</th><th>Type</th></tr>${rows}</table>`,
  );
}

export function formatCpfStudyReport(
  result: CpfResult,
  format: StudyReportFormat,
  caseTitle = "PSS/E BASE CASE",
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        study: "continuation_power_flow",
        caseTitle,
        converged: result.converged,
        lambdaMax: result.lambdaMax,
        maxLoadabilityMw: result.maxLoadabilityMw,
        marginMw: result.marginMw,
        marginPercent: result.marginPercent,
        weakestBus: result.weakestBus,
        criticalVoltagePu: result.criticalVoltagePu,
        steps: result.steps.map((s) => ({
          step: s.step,
          lambda: s.lambda,
          totalLoadMw: s.totalLoadMw,
          minVoltagePu: s.minVoltagePu,
          weakestBus: s.weakestBus,
        })),
      },
      null,
      2,
    );
  }
  if (format === "csv") {
    const lines = ["step,lambda,total_load_mw,min_voltage_pu,weakest_bus"];
    for (const s of result.steps) {
      lines.push(
        `${s.step},${s.lambda.toFixed(4)},${s.totalLoadMw.toFixed(2)},${s.minVoltagePu.toFixed(4)},${s.weakestBus}`,
      );
    }
    return lines.join("\n");
  }
  return wrapDarkHtml(
    `Continuation Power Flow — ${caseTitle}`,
    `<p>Max Loadability: ${result.maxLoadabilityMw.toFixed(1)} MW (Margin: ${result.marginMw.toFixed(1)} MW / ${result.marginPercent.toFixed(1)}%) | Weakest Bus: ${result.weakestBus} (${result.criticalVoltagePu.toFixed(4)} pu)</p>`,
  );
}

function wrapDarkHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #334155;padding:8px;text-align:left}th{background:#1e293b}</style></head><body>
<h1>${title}</h1>${body}</body></html>`;
}
