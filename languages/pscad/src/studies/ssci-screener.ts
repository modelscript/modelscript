// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Subsynchronous Resonance & Control Interaction (SSR / SSCI) Stability Screener
 *
 * Evaluates subsynchronous driving-point impedance Z(f) = R(f) + j*X(f) across 5-55 Hz (or 5-45 Hz at 50 Hz)
 * per IEEE Std 2800 / CIGRE TB 671, flagging negative-resistance damping regions (R(f) < 0), series
 * resonance crossovers (X(f) = 0), and generalized Nyquist phase-margin risks.
 */

import type { EmtNetlistInput } from "../solver/emt-solver.js";
import { runFrequencyScan, type FrequencyScanResult, type ResonancePoint } from "../solver/frequency-scanner.js";
import type { EmtNetlist } from "../types.js";

export interface SsciScreenerOptions {
  /** Target Point-of-Interconnection (POI) bus ID. */
  busId?: string | undefined;
  /** Nominal system frequency in Hz (default: 60.0). */
  nominalFrequencyHz?: number | undefined;
  /** Lower subsynchronous scan bound in Hz (default: 5.0). */
  fMinHz?: number | undefined;
  /** Upper subsynchronous scan bound in Hz (default: nominalFrequencyHz - 5.0). */
  fMaxHz?: number | undefined;
  /** Scan resolution in Hz (default: 0.5). */
  fStepHz?: number | undefined;
  /** Minimum acceptable positive resistance damping margin in Ohms (default: 0.0). */
  minDampingOhm?: number | undefined;
}

export interface SsciCriticalBand {
  fStartHz: number;
  fEndHz: number;
  minResistanceOhm: number;
  worstFrequencyHz: number;
  severity: "unstable" | "marginal";
}

export interface SsciScreeningReport {
  timestamp: string;
  busId: string;
  nominalFrequencyHz: number;
  scan: FrequencyScanResult;
  negativeResistanceBands: SsciCriticalBand[];
  unstableResonances: ResonancePoint[];
  minResistanceOhm: number;
  minResistanceFreqHz: number;
  passed: boolean;
  summary: string;
}

/**
 * Executes an impedance-based SSR/SSCI stability screening study at the POI bus.
 */
export function runSsciScreening(
  netlistInput: EmtNetlist | EmtNetlistInput,
  options: SsciScreenerOptions = {},
): SsciScreeningReport {
  const netlist = netlistInput as EmtNetlist;
  const f0 = options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0;
  let busId = options.busId;
  if (!busId && netlist.buses instanceof Map) {
    busId = netlist.buses.keys().next().value;
  }
  busId = busId ?? "BUS_1";

  const fMinHz = options.fMinHz ?? 5.0;
  const fMaxHz = options.fMaxHz ?? Math.max(fMinHz + 5.0, f0 - 5.0);
  const fStepHz = options.fStepHz ?? 0.5;
  const minDampingOhm = options.minDampingOhm ?? 0.0;

  const scan = runFrequencyScan(netlist, {
    busId,
    fMinHz,
    fMaxHz,
    fStepHz,
    nominalFrequencyHz: f0,
    modelIbrControlInteraction: true,
  });

  // Identify contiguous subsynchronous bands where R(f) <= minDampingOhm
  const negativeResistanceBands: SsciCriticalBand[] = [];
  let minR = Infinity;
  let minRFreq = fMinHz;

  let bandStart = -1;
  let bandMinR = Infinity;
  let bandWorstF = fMinHz;

  for (let i = 0; i < scan.frequenciesHz.length; i++) {
    const f = scan.frequenciesHz[i]!;
    const r = scan.rOhm[i]!;
    if (r < minR) {
      minR = r;
      minRFreq = f;
    }
    if (r <= minDampingOhm) {
      if (bandStart < 0) {
        bandStart = f;
        bandMinR = r;
        bandWorstF = f;
      } else if (r < bandMinR) {
        bandMinR = r;
        bandWorstF = f;
      }
    } else if (bandStart >= 0) {
      negativeResistanceBands.push({
        fStartHz: bandStart,
        fEndHz: scan.frequenciesHz[i - 1]!,
        minResistanceOhm: Number(bandMinR.toFixed(4)),
        worstFrequencyHz: bandWorstF,
        severity: bandMinR < 0 ? "unstable" : "marginal",
      });
      bandStart = -1;
    }
  }
  if (bandStart >= 0) {
    negativeResistanceBands.push({
      fStartHz: bandStart,
      fEndHz: scan.frequenciesHz[scan.frequenciesHz.length - 1]!,
      minResistanceOhm: Number(bandMinR.toFixed(4)),
      worstFrequencyHz: bandWorstF,
      severity: bandMinR < 0 ? "unstable" : "marginal",
    });
  }

  const unstableResonances = scan.resonancePoints.filter((p) => p.isUnstable);
  const passed =
    !scan.hasSsciRisk &&
    unstableResonances.length === 0 &&
    negativeResistanceBands.every((b) => b.severity !== "unstable");
  const summary =
    `SSR/SSCI Screening at '${busId}' (${fMinHz}-${fMaxHz} Hz): ` +
    `min R(f) = ${Number.isFinite(minR) ? minR.toFixed(4) : "0"} Ohm at ${minRFreq} Hz, ` +
    `Negative-Resistance Bands = ${negativeResistanceBands.length}, Unstable Resonances = ${unstableResonances.length} — ${passed ? "PASS" : "FAIL"}.`;

  return {
    timestamp: new Date().toISOString(),
    busId,
    nominalFrequencyHz: f0,
    scan,
    negativeResistanceBands,
    unstableResonances,
    minResistanceOhm: Number.isFinite(minR) ? Number(minR.toFixed(4)) : 0,
    minResistanceFreqHz: minRFreq,
    passed,
    summary,
  };
}

export function formatSsciReportCsv(report: SsciScreeningReport): string {
  const lines = ["frequency_hz,r_ohm,x_ohm,z_mag_ohm,phase_deg"];
  for (let i = 0; i < report.scan.frequenciesHz.length; i++) {
    lines.push(
      `${report.scan.frequenciesHz[i]},${report.scan.rOhm[i]!.toFixed(5)},${report.scan.xOhm[i]!.toFixed(5)},${report.scan.zMagOhm[i]!.toFixed(5)},${report.scan.phaseDeg[i]!.toFixed(3)}`,
    );
  }
  return lines.join("\n");
}
