// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Insulation Coordination, Switching Overvoltage (SSOV), TRV & Arrester Duty Study
 *
 * Productizes Point-on-Wave statistical switching overvoltage (IEC 60071 / IEEE C37.011 V_2%),
 * circuit-breaker Transient Recovery Voltage (TRV peak u_c & RRRV du/dt vs. IEEE C37.06 envelopes),
 * and MOV surge arrester thermal energy duty into a unified study runner with JSON/CSV/HTML reports.
 */

import { EmtSolver, type EmtNetlistInput } from "../solver/emt-solver.js";
import { runPointOnWaveSweep, type PointOnWaveSweepResult } from "../solver/parametric-sweep.js";
import type { EmtNetlist } from "../types.js";

export interface InsulationStudyOptions {
  /** Target circuit breaker ID for Point-on-Wave & TRV analysis. */
  breakerId?: string | undefined;
  /** Number of statistical PoW runs (default: 50). */
  numRuns?: number | undefined;
  /** Breaker pole scatter std dev in seconds (default: 0.001). */
  poleScatterSec?: number | undefined;
  /** Simulation duration per run in seconds (default: 0.05). */
  durationSec?: number | undefined;
  /** Time step in seconds (default: 20e-6). */
  timeStepSec?: number | undefined;
  /** Nominal system line-to-line RMS voltage in kV (auto-inferred if omitted). */
  nominalKv?: number | undefined;
  /** Allowable 2% statistical switching overvoltage ceiling in p.u. (default: 2.5 p.u.). */
  ssovLimitPu?: number | undefined;
  /** IEEE C37.06 TRV RRRV ceiling in kV/us (default: 2.0 kV/us for T100 terminal fault). */
  trvRrrvLimitKvPerUs?: number | undefined;
  /** IEEE C37.06 TRV peak ceiling multiplier over base peak phase voltage (default: 1.4 * 1.3 * 1.5 = 2.73). */
  trvPeakLimitPu?: number | undefined;
  /** Rated MOV surge arrester thermal absorption limit in kJ (default: 1500 kJ). */
  arresterEnergyLimitKj?: number | undefined;
  /** Specific bus IDs to monitor. */
  monitoredBuses?: string[] | undefined;
}

export interface TrvAssessment {
  breakerId: string;
  peakTrvKv: number;
  peakTrvPu: number;
  maxRrrvKvPerUs: number;
  rrrvLimitKvPerUs: number;
  peakLimitPu: number;
  passed: boolean;
}

export interface ArresterDutyRecord {
  arresterId: string;
  energyKj: number;
  limitKj: number;
  dutyPercent: number;
  passed: boolean;
}

export interface InsulationStudyReport {
  timestamp: string;
  nominalKv: number;
  basePeakPhaseKv: number;
  ssov: PointOnWaveSweepResult;
  ssovLimitPu: number;
  ssovPassed: boolean;
  trv: TrvAssessment;
  arresters: ArresterDutyRecord[];
  overallPassed: boolean;
  summary: string;
}

/**
 * Executes an Insulation Coordination, SSOV (V_2%), TRV, and MOV Arrester Duty study.
 */
export function runInsulationStudy(
  netlistInput: EmtNetlist | EmtNetlistInput,
  options: InsulationStudyOptions = {},
): InsulationStudyReport {
  const netlist = netlistInput as EmtNetlist;
  const nominalKv =
    options.nominalKv ??
    (() => {
      if (netlist.buses instanceof Map) {
        for (const [, bus] of netlist.buses) {
          if (bus.baseKv > 0) return bus.baseKv;
        }
      }
      return 230.0;
    })();
  const basePeakPhaseKv = (nominalKv * Math.SQRT2) / Math.sqrt(3);
  const ssovLimitPu = options.ssovLimitPu ?? 2.5;
  const trvRrrvLimitKvPerUs = options.trvRrrvLimitKvPerUs ?? 2.0;
  const trvPeakLimitPu = options.trvPeakLimitPu ?? 2.73;
  const arresterEnergyLimitKj = options.arresterEnergyLimitKj ?? 1500.0;
  const dt = options.timeStepSec ?? 20e-6;
  const durationSec = options.durationSec ?? 0.05;

  // 1. Statistical Point-on-Wave SSOV (V_2%) sweep
  const ssov = runPointOnWaveSweep(netlist, {
    breakerId: options.breakerId,
    numRuns: options.numRuns ?? 50,
    poleScatterSec: options.poleScatterSec ?? 0.001,
    durationSec,
    timeStepSec: dt,
    basePeakKv: basePeakPhaseKv,
    monitoredBuses: options.monitoredBuses,
  });
  const ssovPassed = ssov.ssovV2PercentPu <= ssovLimitPu;

  // 2. Deterministic EMT run for TRV peak/RRRV and MOV surge arrester thermal duty
  const solver = new EmtSolver(netlist, { timeStepSec: dt, durationSec });
  const simResult = solver.solve();

  let peakTrvKv = 0;
  let maxRrrvKvPerUs = 0;
  const dtUs = Math.max(dt * 1e6, 1e-6);

  for (const [, phaseTrace] of simResult.busVoltages) {
    for (let k = 0; k < phaseTrace.length; k++) {
      const vKv = Math.abs(phaseTrace[k]!) * 1e-3;
      if (vKv > peakTrvKv) peakTrvKv = vKv;
      if (k > 0) {
        const dvKv = Math.abs(phaseTrace[k]! - phaseTrace[k - 1]!) * 1e-3;
        const rrrv = dvKv / dtUs;
        if (rrrv > maxRrrvKvPerUs) maxRrrvKvPerUs = rrrv;
      }
    }
  }

  const peakTrvPu = basePeakPhaseKv > 0 ? peakTrvKv / basePeakPhaseKv : 0;
  const trv: TrvAssessment = {
    breakerId: ssov.breakerId,
    peakTrvKv: Number(peakTrvKv.toFixed(3)),
    peakTrvPu: Number(peakTrvPu.toFixed(4)),
    maxRrrvKvPerUs: Number(maxRrrvKvPerUs.toFixed(4)),
    rrrvLimitKvPerUs: trvRrrvLimitKvPerUs,
    peakLimitPu: trvPeakLimitPu,
    passed: maxRrrvKvPerUs <= trvRrrvLimitKvPerUs && peakTrvPu <= trvPeakLimitPu,
  };

  // 3. Surge arrester thermal absorption duty
  const arresters: ArresterDutyRecord[] = [];
  if (simResult.surgeArresterEnergies) {
    for (const [arresterId, energyKj] of simResult.surgeArresterEnergies) {
      const dutyPercent = arresterEnergyLimitKj > 0 ? (energyKj / arresterEnergyLimitKj) * 100 : 0;
      arresters.push({
        arresterId,
        energyKj: Number(energyKj.toFixed(3)),
        limitKj: arresterEnergyLimitKj,
        dutyPercent: Number(dutyPercent.toFixed(2)),
        passed: energyKj <= arresterEnergyLimitKj,
      });
    }
  }

  const arrestersPassed = arresters.every((a) => a.passed);
  const overallPassed = ssovPassed && trv.passed && arrestersPassed;
  const summary =
    `Insulation Coordination Study (${nominalKv} kV): ` +
    `SSOV V_2% = ${ssov.ssovV2PercentPu.toFixed(3)} pu (limit ${ssovLimitPu} pu, ${ssovPassed ? "PASS" : "FAIL"}), ` +
    `TRV RRRV = ${trv.maxRrrvKvPerUs.toFixed(3)} kV/us (limit ${trvRrrvLimitKvPerUs} kV/us, ${trv.passed ? "PASS" : "FAIL"}), ` +
    `Arresters = ${arresters.length} (${arrestersPassed ? "PASS" : "FAIL"}).`;

  return {
    timestamp: new Date().toISOString(),
    nominalKv,
    basePeakPhaseKv: Number(basePeakPhaseKv.toFixed(3)),
    ssov,
    ssovLimitPu,
    ssovPassed,
    trv,
    arresters,
    overallPassed,
    summary,
  };
}

export function formatInsulationStudyCsv(report: InsulationStudyReport): string {
  const lines = ["run_index,closing_angle_deg,max_peak_kv,max_peak_pu,peak_bus_id"];
  for (const r of report.ssov.runs) {
    lines.push(
      `${r.runIndex},${r.closingAngleDeg.toFixed(2)},${r.maxPeakKv.toFixed(3)},${r.maxPeakPu.toFixed(4)},${r.peakBusId}`,
    );
  }
  return lines.join("\n");
}

export function formatInsulationStudyHtml(report: InsulationStudyReport): string {
  const badge = (ok: boolean) =>
    ok
      ? `<span style="color:#4ade80;font-weight:600">PASS</span>`
      : `<span style="color:#f87171;font-weight:600">FAIL</span>`;
  const arresterRows = report.arresters
    .map(
      (a) =>
        `<tr><td>${a.arresterId}</td><td>${a.energyKj} kJ</td><td>${a.limitKj} kJ</td><td>${a.dutyPercent}%</td><td>${badge(a.passed)}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>PSCAD Insulation Study</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #334155;padding:8px;text-align:left}th{background:#1e293b}</style></head><body>
<h1>Insulation Coordination, SSOV &amp; TRV Study</h1>
<p>${report.summary}</p>
<table><tr><th>Metric</th><th>Observed</th><th>Limit</th><th>Status</th></tr>
<tr><td>SSOV V_2% (98th percentile)</td><td>${report.ssov.ssovV2PercentPu.toFixed(3)} pu (${report.ssov.ssovV2PercentKv.toFixed(2)} kV)</td><td>&le; ${report.ssovLimitPu} pu</td><td>${badge(report.ssovPassed)}</td></tr>
<tr><td>TRV Peak</td><td>${report.trv.peakTrvPu} pu (${report.trv.peakTrvKv} kV)</td><td>&le; ${report.trv.peakLimitPu} pu</td><td>${badge(report.trv.passed)}</td></tr>
<tr><td>TRV Max RRRV</td><td>${report.trv.maxRrrvKvPerUs} kV/&mu;s</td><td>&le; ${report.trv.rrrvLimitKvPerUs} kV/&mu;s</td><td>${badge(report.trv.passed)}</td></tr>
</table>
${report.arresters.length > 0 ? `<h2>Surge Arrester Duty</h2><table><tr><th>Arrester</th><th>Energy</th><th>Limit</th><th>Duty</th><th>Status</th></tr>${arresterRows}</table>` : ""}
</body></html>`;
}
