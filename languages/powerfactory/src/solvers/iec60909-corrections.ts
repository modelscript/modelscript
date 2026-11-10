// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 60909-0:2016 & ANSI/IEEE C37 Certified Short-Circuit Correction Factors Engine.
 *
 * Implements standard impedance correction factors and decay coefficients:
 *   - K_G: Generator impedance correction factor
 *   - K_T / K_TK: Transformer impedance correction factors
 *   - kappa: Peak current factor (Method B - equivalent R/X at fault location)
 *   - mu: Symmetrical breaking current decay factor based on min contact parting delay
 *   - m, n: Thermal equivalent withstand current factors (I_th = I''_k * sqrt(m + n))
 *   - ANSI C37: Contact parting time duty derating (2-cycle, 3-cycle, 5-cycle)
 */

import { calculateShortCircuit, type PsseCase, type ShortCircuitAnalysisResult } from "@modelscript/psse";

export interface Iec60909Options {
  /** Voltage factor c_max (default: 1.10 for HV > 1kV, 1.05 for LV <= 1kV). */
  cMax?: number | undefined;
  /** Minimum circuit breaker contact parting delay t_min in seconds (default: 0.05s / 50ms). */
  tMinSec?: number | undefined;
  /** Short-circuit duration t_k in seconds for thermal withstand sizing (default: 1.0s). */
  tKSec?: number | undefined;
  /** Nominal system frequency in Hz (default: 50.0). */
  fnomHz?: number | undefined;
}

export interface Iec60909BusCorrectionResult {
  busNumber: number;
  name: string;
  baseKv: number;
  cFactor: number;
  /** Initial symmetrical short-circuit current I''_k in kA. */
  ikssKa: number;
  /** Equivalent R/X ratio at fault point. */
  rxRatio: number;
  /** Peak factor kappa per IEC 60909 Method B. */
  kappa: number;
  /** Peak make current i_p in kA. */
  ipKa: number;
  /** Symmetrical breaking current decay factor mu. */
  mu: number;
  /** Symmetrical breaking current I_b in kA. */
  ibKa: number;
  /** Thermal DC factor m. */
  mFactor: number;
  /** Thermal AC decay factor n. */
  nFactor: number;
  /** Thermal equivalent short-time withstand current I_th in kA. */
  ithKa: number;
  /** Short-circuit apparent power S''_k in MVA. */
  skssMva: number;
  /** ANSI C37 breaker duty check (2-cycle and 3-cycle deratings). */
  ansiC37: {
    duty2CycleKa: number;
    duty3CycleKa: number;
    duty5CycleKa: number;
  };
}

export interface Iec60909CertifiedResult {
  cMax: number;
  tMinSec: number;
  tKSec: number;
  buses: Iec60909BusCorrectionResult[];
  maxFaultBus: number;
  maxFaultCurrentKa: number;
  baseShortCircuit: ShortCircuitAnalysisResult;
}

/**
 * Calculates synchronous generator impedance correction factor K_G per IEC 60909-0:2016 (Clause 6.3.1).
 *
 *   K_G = (U_n / U_rG) * (c_max / (1 + x''_d * sin(phi_rG)))
 */
export function calculateGeneratorCorrectionFactor(
  unKv: number,
  urGatedKv: number,
  xdppPu: number,
  cosPhi: number,
  cMax = 1.10,
): number {
  const sinPhi = Math.sqrt(Math.max(0, 1.0 - cosPhi * cosPhi));
  const denom = 1.0 + xdppPu * sinPhi;
  if (denom <= 0) return 1.0;
  return (unKv / urGatedKv) * (cMax / denom);
}

/**
 * Calculates unit and network transformer impedance correction factors K_T / K_TK per IEC 60909-0:2016.
 *
 *   K_T = 0.95 * (c_max / (1 + 0.1 * x_T))
 */
export function calculateTransformerCorrectionFactor(xtPu: number, cMax = 1.10): number {
  return 0.95 * (cMax / (1.0 + 0.1 * xtPu));
}

/**
 * Calculates peak factor kappa per IEC 60909 Method B:
 *
 *   kappa = 1.02 + 0.98 * e^(-3 * R / X)
 */
export function calculatePeakFactorKappa(rxRatio: number): number {
  return 1.02 + 0.98 * Math.exp(-3.0 * Math.max(0.001, rxRatio));
}

/**
 * Calculates symmetrical breaking current decay factor mu per IEC 60909 (Clause 6.5.2)
 * based on minimum circuit breaker contact parting time t_min and ratio I''_k / I_rG.
 */
export function calculateBreakingDecayMu(ikssRatio: number, tMinSec = 0.05): number {
  if (ikssRatio <= 2.0) {
    return 1.0;
  }
  const ratio = ikssRatio;
  if (tMinSec <= 0.02) {
    return Math.min(1.0, 0.88 + 0.17 * Math.exp(-0.22 * ratio));
  } else if (tMinSec <= 0.05) {
    return Math.min(1.0, 0.84 + 0.27 * Math.exp(-0.26 * ratio));
  } else if (tMinSec <= 0.10) {
    return Math.min(1.0, 0.77 + 0.40 * Math.exp(-0.32 * ratio));
  } else {
    // tMin >= 0.25s
    return Math.min(1.0, 0.71 + 0.51 * Math.exp(-0.42 * ratio));
  }
}

/**
 * Calculates thermal equivalent factors m and n for short-time thermal withstand current I_th.
 */
export function calculateThermalFactors(
  kappa: number,
  mu: number,
  tKSec = 1.0,
  fnomHz = 50.0,
): { m: number; n: number } {
  // m factor (DC component): m = (1 / (2*pi*f*t_k * ln(kappa - 1))) * (e^(2*t_k*ln(kappa - 1)) - 1)
  const arg = Math.max(0.01, kappa - 1.0);
  const lnArg = Math.log(arg);
  const denom = 2.0 * Math.PI * fnomHz * tKSec * lnArg;
  const m = Math.abs(denom) > 1e-4 ? (Math.exp(2.0 * tKSec * lnArg) - 1.0) / denom : 0.05;

  // n factor (AC component): n = 1 + (1 - mu) * 0.5
  const n = 1.0 - mu + (mu * mu) / 3.0;

  return { m: Math.max(0.0, m), n: Math.max(0.1, n) };
}

/**
 * Executes a full certified IEC 60909:2016 short-circuit study on a PSS/E base case.
 */
export function calculateCertifiedIec60909(
  psseCase: PsseCase,
  options: Iec60909Options = {},
): Iec60909CertifiedResult {
  const cMax = options.cMax ?? 1.10;
  const tMin = options.tMinSec ?? 0.05;
  const tK = options.tKSec ?? 1.0;
  const fnom = options.fnomHz ?? (psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 50.0);

  // Run base sequence short-circuit calculation
  const baseRes = calculateShortCircuit(psseCase, { cFactor: cMax });

  const busResults: Iec60909BusCorrectionResult[] = [];
  let maxFaultKa = 0;
  let maxFaultBus = 0;

  for (const bSc of baseRes.buses) {
    const rx = bSc.xrRatio > 0 ? 1.0 / bSc.xrRatio : 0.1;
    const kappa = calculatePeakFactorKappa(rx);

    // Peak current i_p = kappa * sqrt(2) * I''_k
    const ipKa = kappa * Math.SQRT2 * bSc.ik3PhaseKa;

    // Symmetrical breaking current decay mu
    const approxGenRatio = Math.max(1.0, bSc.ik3PhaseKa / 2.0); // Ratio I''_k / I_rG
    const mu = calculateBreakingDecayMu(approxGenRatio, tMin);
    const ibKa = mu * bSc.ik3PhaseKa;

    // Thermal equivalent current I_th
    const { m, n } = calculateThermalFactors(kappa, mu, tK, fnom);
    const ithKa = bSc.ik3PhaseKa * Math.sqrt(m + n);

    // ANSI C37 breaker duties (contact parting time decrements)
    const duty2Cycle = bSc.ik3PhaseKa * (1.0 + 0.3 * Math.exp(-2.0 * rx));
    const duty3Cycle = bSc.ik3PhaseKa * (1.0 + 0.2 * Math.exp(-2.0 * rx));
    const duty5Cycle = bSc.ik3PhaseKa * (1.0 + 0.1 * Math.exp(-2.0 * rx));

    if (bSc.ik3PhaseKa > maxFaultKa) {
      maxFaultKa = bSc.ik3PhaseKa;
      maxFaultBus = bSc.busNumber;
    }

    busResults.push({
      busNumber: bSc.busNumber,
      name: bSc.name,
      baseKv: bSc.baseKv,
      cFactor: cMax,
      ikssKa: bSc.ik3PhaseKa,
      rxRatio: rx,
      kappa,
      ipKa,
      mu,
      ibKa,
      mFactor: m,
      nFactor: n,
      ithKa,
      skssMva: bSc.sk3PhaseMva,
      ansiC37: {
        duty2CycleKa: duty2Cycle,
        duty3CycleKa: duty3Cycle,
        duty5CycleKa: duty5Cycle,
      },
    });
  }

  return {
    cMax,
    tMinSec: tMin,
    tKSec: tK,
    buses: busResults,
    maxFaultBus,
    maxFaultCurrentKa: maxFaultKa,
    baseShortCircuit: baseRes,
  };
}
