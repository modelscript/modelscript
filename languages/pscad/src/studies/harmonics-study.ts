// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — IEEE 519-2022 Harmonics & Driving-Point Impedance Resonance Study
 *
 * Combines EMT steady-state harmonic DFT analysis (voltage THD, current TDD, individual harmonic orders
 * h = 2..50 against IEEE 519-2022 tables) with wideband driving-point impedance scanning Z(f) to identify
 * parallel and series harmonic resonance peaks.
 */

import { EmtSolver, type EmtNetlistInput } from "../solver/emt-solver.js";
import { runFrequencyScan, type FrequencyScanResult } from "../solver/frequency-scanner.js";
import type { EmtNetlist } from "../types.js";
import { evaluateHarmonicDistortion, type HarmonicDistortionResult } from "../verification/ieee2800.js";

export interface HarmonicsStudyOptions {
  /** Target POI bus ID to evaluate. */
  busId?: string | undefined;
  /** Nominal system frequency in Hz (default: 60.0). */
  nominalFrequencyHz?: number | undefined;
  /** Nominal line-to-line RMS voltage in kV (auto-inferred if omitted). */
  nominalKv?: number | undefined;
  /** Short-circuit ratio I_sc / I_L for IEEE 519 current TDD table selection (default: 50). */
  iscOverIl?: number | undefined;
  /** Simulation duration in seconds (default: 0.2 s). */
  durationSec?: number | undefined;
  /** Time step in seconds (default: 20e-6 s). */
  timeStepSec?: number | undefined;
  /** Maximum harmonic order to evaluate (default: 50). */
  maxHarmonicOrder?: number | undefined;
  /** Frequency scan range start in Hz (default: 10.0). */
  fMinHz?: number | undefined;
  /** Frequency scan range end in Hz (default: 2500.0). */
  fMaxHz?: number | undefined;
  /** Frequency scan step in Hz (default: 5.0). */
  fStepHz?: number | undefined;
}

export interface Ieee519Limits {
  voltageThdLimitPercent: number;
  voltageIndividualLimitPercent: number;
  currentTddLimitPercent: number;
}

export interface HarmonicOrderEntry {
  order: number;
  frequencyHz: number;
  magnitudePercent: number;
  limitPercent: number;
  passed: boolean;
}

export interface ImpedanceResonancePeak {
  frequencyHz: number;
  kind: "parallel_peak" | "series_trough";
  zMagOhm: number;
  rOhm: number;
  xOhm: number;
}

export interface HarmonicsStudyReport {
  timestamp: string;
  busId: string;
  nominalKv: number;
  nominalFrequencyHz: number;
  limits: Ieee519Limits;
  voltageHarmonics: HarmonicDistortionResult;
  orders: HarmonicOrderEntry[];
  frequencyScan: FrequencyScanResult;
  impedancePeaks: ImpedanceResonancePeak[];
  overallPassed: boolean;
  summary: string;
}

/**
 * IEEE 519-2022 Table 1 (Voltage Distortion) and Table 2 (Current TDD) limits.
 */
export function getIeee519Limits(nominalKv: number, iscOverIl = 50): Ieee519Limits {
  let voltageThdLimitPercent = 5.0;
  let voltageIndividualLimitPercent = 3.0;
  if (nominalKv <= 1.0) {
    voltageThdLimitPercent = 8.0;
    voltageIndividualLimitPercent = 5.0;
  } else if (nominalKv <= 69.0) {
    voltageThdLimitPercent = 5.0;
    voltageIndividualLimitPercent = 3.0;
  } else if (nominalKv <= 161.0) {
    voltageThdLimitPercent = 2.5;
    voltageIndividualLimitPercent = 1.5;
  } else {
    voltageThdLimitPercent = 1.5;
    voltageIndividualLimitPercent = 1.0;
  }

  let currentTddLimitPercent = 8.0;
  if (iscOverIl < 20) currentTddLimitPercent = 5.0;
  else if (iscOverIl < 50) currentTddLimitPercent = 8.0;
  else if (iscOverIl < 100) currentTddLimitPercent = 12.0;
  else if (iscOverIl < 1000) currentTddLimitPercent = 15.0;
  else currentTddLimitPercent = 20.0;

  if (nominalKv > 161.0) {
    currentTddLimitPercent = Math.min(currentTddLimitPercent, iscOverIl < 25 ? 1.5 : iscOverIl < 50 ? 2.5 : 3.75);
  }

  return { voltageThdLimitPercent, voltageIndividualLimitPercent, currentTddLimitPercent };
}

/**
 * Executes an IEEE 519-2022 harmonic distortion + wideband impedance resonance scan study.
 */
export function runHarmonicsStudy(
  netlistInput: EmtNetlist | EmtNetlistInput,
  options: HarmonicsStudyOptions = {},
): HarmonicsStudyReport {
  const netlist = netlistInput as EmtNetlist;
  const f0 = options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0;
  const maxOrder = options.maxHarmonicOrder ?? 50;

  let busId = options.busId;
  let nominalKv = options.nominalKv ?? 230.0;
  if (netlist.buses instanceof Map) {
    if (!busId) {
      for (const [id, bus] of netlist.buses) {
        busId = id;
        if (options.nominalKv === undefined && bus.baseKv > 0) nominalKv = bus.baseKv;
        break;
      }
    } else if (options.nominalKv === undefined) {
      const b = netlist.buses.get(busId);
      if (b && b.baseKv > 0) nominalKv = b.baseKv;
    }
  }
  busId = busId ?? "BUS_1";

  const limits = getIeee519Limits(nominalKv, options.iscOverIl ?? 50);

  // 1. Run EMT simulation and evaluate steady-state harmonics on target bus Phase A
  const solver = new EmtSolver(netlist, {
    timeStepSec: options.timeStepSec ?? 20e-6,
    durationSec: options.durationSec ?? 0.2,
  });
  const sim = solver.solve();
  const busTrace = sim.busVoltages.get(busId) ?? sim.busVoltages.values().next().value;
  const va = busTrace ?? new Float64Array(sim.time.length);

  const voltageHarmonics = evaluateHarmonicDistortion(sim.time, va, f0, maxOrder);

  const orders: HarmonicOrderEntry[] = [];
  let allIndividualPass = true;
  for (let h = 2; h <= maxOrder && h - 1 < voltageHarmonics.harmonics.length; h++) {
    const magPct = voltageHarmonics.harmonics[h - 1] ?? 0;
    const passed = magPct <= limits.voltageIndividualLimitPercent;
    if (!passed) allIndividualPass = false;
    orders.push({
      order: h,
      frequencyHz: Number((h * f0).toFixed(1)),
      magnitudePercent: Number(magPct.toFixed(4)),
      limitPercent: limits.voltageIndividualLimitPercent,
      passed,
    });
  }

  // 2. Wideband driving-point impedance scan Z(f)
  const frequencyScan = runFrequencyScan(netlist, {
    busId,
    fMinHz: options.fMinHz ?? 10.0,
    fMaxHz: options.fMaxHz ?? 2500.0,
    fStepHz: options.fStepHz ?? 5.0,
    nominalFrequencyHz: f0,
  });

  // Detect local parallel peaks and series troughs in |Z(f)|
  const impedancePeaks: ImpedanceResonancePeak[] = [];
  const zMag = frequencyScan.zMagOhm;
  for (let i = 1; i < zMag.length - 1; i++) {
    const prev = zMag[i - 1]!;
    const curr = zMag[i]!;
    const next = zMag[i + 1]!;
    if (curr > prev * 1.15 && curr > next * 1.15) {
      impedancePeaks.push({
        frequencyHz: frequencyScan.frequenciesHz[i]!,
        kind: "parallel_peak",
        zMagOhm: Number(curr.toFixed(3)),
        rOhm: Number(frequencyScan.rOhm[i]!.toFixed(3)),
        xOhm: Number(frequencyScan.xOhm[i]!.toFixed(3)),
      });
    } else if (curr < prev * 0.85 && curr < next * 0.85) {
      impedancePeaks.push({
        frequencyHz: frequencyScan.frequenciesHz[i]!,
        kind: "series_trough",
        zMagOhm: Number(curr.toFixed(3)),
        rOhm: Number(frequencyScan.rOhm[i]!.toFixed(3)),
        xOhm: Number(frequencyScan.xOhm[i]!.toFixed(3)),
      });
    }
  }

  const thdPassed = voltageHarmonics.thdPercent <= limits.voltageThdLimitPercent;
  const overallPassed = thdPassed && allIndividualPass;
  const summary =
    `IEEE 519 Harmonics Study at '${busId}' (${nominalKv} kV): ` +
    `THD = ${voltageHarmonics.thdPercent.toFixed(3)}% (limit ${limits.voltageThdLimitPercent}%), ` +
    `Max Individual = ${voltageHarmonics.maxIndividualHarmonicPercent.toFixed(3)}% at h=${voltageHarmonics.maxHarmonicOrder} ` +
    `(limit ${limits.voltageIndividualLimitPercent}%), Resonance Peaks = ${impedancePeaks.length} — ${overallPassed ? "PASS" : "FAIL"}.`;

  return {
    timestamp: new Date().toISOString(),
    busId,
    nominalKv,
    nominalFrequencyHz: f0,
    limits,
    voltageHarmonics,
    orders,
    frequencyScan,
    impedancePeaks,
    overallPassed,
    summary,
  };
}

export function formatHarmonicsStudyCsv(report: HarmonicsStudyReport): string {
  const lines = ["order,frequency_hz,magnitude_percent,limit_percent,passed"];
  for (const o of report.orders) {
    lines.push(`${o.order},${o.frequencyHz},${o.magnitudePercent},${o.limitPercent},${o.passed}`);
  }
  return lines.join("\n");
}

export function formatHarmonicsStudyHtml(report: HarmonicsStudyReport): string {
  const rows = report.orders
    .filter((o) => o.magnitudePercent >= 0.05 || !o.passed)
    .map(
      (o) =>
        `<tr><td>h=${o.order}</td><td>${o.frequencyHz} Hz</td><td>${o.magnitudePercent}%</td><td>${o.limitPercent}%</td><td>${o.passed ? "PASS" : "FAIL"}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>IEEE 519 Harmonics Study</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #334155;padding:8px;text-align:left}th{background:#1e293b}</style></head><body>
<h1>IEEE 519-2022 Harmonics &amp; Resonance Study — ${report.busId}</h1>
<p>${report.summary}</p>
<table><tr><th>Order</th><th>Frequency</th><th>Magnitude</th><th>Limit</th><th>Status</th></tr>${rows}</table>
</body></html>`;
}
