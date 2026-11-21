// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — ANSI C37.010 / IEC 60909 Circuit Breaker Interrupting Duty Evaluator
 *
 * Computes asymmetrical interrupting current at breaker contact-parting time (t_min) using
 * bus X/R decrement factors and ranks substation breakers by interrupting duty percentage.
 */

import type { PsseCase } from "../types.js";
import { calculateShortCircuit, type ShortCircuitAnalysisResult } from "./ac-powerflow.js";

export type BreakerDutyStandard = "ansi-c37" | "iec-60909";

export interface BreakerDutyOptions {
  /** Fault standard (default: "ansi-c37"). */
  standard?: BreakerDutyStandard | undefined;
  /** Nominal system frequency in Hz (default: 60.0). */
  nominalFreqHz?: number | undefined;
  /** Minimum breaker contact-parting time in seconds (default: 0.05 s = 3 cycles at 60 Hz). */
  contactPartingSec?: number | undefined;
  /** Optional map of busNumber -> rated symmetrical interrupting current in kA (default: 40 kA). */
  breakerRatingsKa?: Record<number, number> | undefined;
  /** Default breaker interrupting rating in kA when not specified per bus (default: 40.0 kA). */
  defaultRatingKa?: number | undefined;
  /** Warning threshold percentage (default: 80%). */
  warningDutyPct?: number | undefined;
}

export interface BreakerDutyBusRecord {
  busNumber: number;
  busName: string;
  baseKv: number;
  xrRatio: number;
  ikSym3PhKa: number;
  ikAsymInterruptingKa: number;
  ipPeakMakeKa: number;
  ratedInterruptingKa: number;
  dutyPercent: number;
  status: "pass" | "warning" | "exceeded";
}

export interface BreakerDutyReport {
  timestamp: string;
  standard: BreakerDutyStandard;
  contactPartingSec: number;
  shortCircuit: ShortCircuitAnalysisResult;
  buses: BreakerDutyBusRecord[];
  exceededCount: number;
  warningCount: number;
  maxDutyPercent: number;
  summary: string;
}

/**
 * Evaluates circuit breaker interrupting duty across all buses per ANSI C37.010 or IEC 60909.
 */
export function evaluateBreakerDuty(psseCase: PsseCase, options: BreakerDutyOptions = {}): BreakerDutyReport {
  const standard = options.standard ?? "ansi-c37";
  const f0 = options.nominalFreqHz ?? 60.0;
  const tMin = options.contactPartingSec ?? 0.05;
  const defaultRatingKa = options.defaultRatingKa ?? 40.0;
  const warningDutyPct = options.warningDutyPct ?? 80.0;
  const cFactor = standard === "iec-60909" ? 1.1 : 1.0;

  const shortCircuit = calculateShortCircuit(psseCase, { cFactor });
  const omega = 2 * Math.PI * f0;

  const buses: BreakerDutyBusRecord[] = [];
  let exceededCount = 0;
  let warningCount = 0;
  let maxDutyPercent = 0;

  for (const b of shortCircuit.buses) {
    const xr = Math.max(b.xrRatio, 0.1);
    const tauDc = xr / omega;
    // DC component decay at contact parting time t_min
    const dcFactor = Math.exp(-tMin / tauDc);
    // Total RMS asymmetrical interrupting current: I_asym = I_sym * sqrt(1 + 2 * exp(-2*t_min/tau))
    const asymMultiplier = Math.sqrt(1.0 + 2.0 * dcFactor * dcFactor);
    const ikAsymInterruptingKa = b.ik3PhaseKa * asymMultiplier;
    const ratedKa = options.breakerRatingsKa?.[b.busNumber] ?? defaultRatingKa;
    const dutyPercent = ratedKa > 0 ? (ikAsymInterruptingKa / ratedKa) * 100.0 : 0;

    let status: "pass" | "warning" | "exceeded" = "pass";
    if (dutyPercent > 100.0) {
      status = "exceeded";
      exceededCount++;
    } else if (dutyPercent >= warningDutyPct) {
      status = "warning";
      warningCount++;
    }
    if (dutyPercent > maxDutyPercent) maxDutyPercent = dutyPercent;

    buses.push({
      busNumber: b.busNumber,
      busName: b.name,
      baseKv: b.baseKv,
      xrRatio: Number(xr.toFixed(2)),
      ikSym3PhKa: Number(b.ik3PhaseKa.toFixed(3)),
      ikAsymInterruptingKa: Number(ikAsymInterruptingKa.toFixed(3)),
      ipPeakMakeKa: Number(b.ipPeakMakeKa.toFixed(3)),
      ratedInterruptingKa: ratedKa,
      dutyPercent: Number(dutyPercent.toFixed(2)),
      status,
    });
  }

  buses.sort((a, b) => b.dutyPercent - a.dutyPercent);
  const summary =
    `Breaker Duty (${standard.toUpperCase()}, t_min=${(tMin * 1e3).toFixed(1)} ms): ` +
    `max duty = ${maxDutyPercent.toFixed(1)}%, ${exceededCount} exceeded (>100%), ${warningCount} warnings (>=${warningDutyPct}%).`;

  return {
    timestamp: new Date().toISOString(),
    standard,
    contactPartingSec: tMin,
    shortCircuit,
    buses,
    exceededCount,
    warningCount,
    maxDutyPercent: Number(maxDutyPercent.toFixed(2)),
    summary,
  };
}
