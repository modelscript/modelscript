// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1588-2019 PTP & ITU-T G.8275.1 / G.8273.2 Precision Time Protocol Analyzer.
 *
 * Computes constant Time Error (cTE), dynamic Time Error (dTE), link asymmetry,
 * MTIE/TDEV masks, and validates end-to-end time error budgets against 3GPP 5G TDD requirements.
 */

/** ITU-T G.8273.2 Telecom Boundary Clock (T-BC) and Time Slave Clock (T-TSC) classes. */
export type TelecomClockClass = "ClassA" | "ClassB" | "ClassC" | "ClassD";

/** Specification limits for ITU-T G.8273.2 clock classes. */
export const ITU_T_G8273_2_LIMITS: Record<TelecomClockClass, { maxCteNs: number; maxDteNs: number }> = {
  ClassA: { maxCteNs: 50.0, maxDteNs: 100.0 },
  ClassB: { maxCteNs: 20.0, maxDteNs: 70.0 },
  ClassC: { maxCteNs: 10.0, maxDteNs: 30.0 },
  ClassD: { maxCteNs: 5.0, maxDteNs: 15.0 },
};

/** Primary Reference Time Clock (PRTC) type according to ITU-T G.8272 / G.8272.1. */
export type PrtcType = "PRTC-A" | "PRTC-B" | "ePRTC";

export const PRTC_ACCURACY_NS: Record<PrtcType, number> = {
  "PRTC-A": 100.0, // G.8272 PRTC-A (+-100 ns to UTC)
  "PRTC-B": 40.0, // G.8272 PRTC-B (+-40 ns to UTC)
  ePRTC: 30.0, // G.8272.1 enhanced PRTC (+-30 ns to UTC)
};

/** PTP node definition in a synchronization chain. */
export interface PtpNode {
  id: string;
  name: string;
  role: "T-GM" | "T-BC" | "T-TSC";
  clockClass: TelecomClockClass;
  /** Custom calibrated constant time error if known (ns). Defaults to class limit / 2 if omitted. */
  calibratedCteNs?: number;
  /** Custom dynamic time error noise generation (ns). Defaults to class limit if omitted. */
  calibratedDteNs?: number;
}

/** Optical link between PTP nodes with potential forward/reverse path asymmetry. */
export interface PtpLink {
  fromNodeId: string;
  toNodeId: string;
  lengthKm: number;
  /** Forward propagation delay (ns) if measured directly. */
  forwardDelayNs?: number;
  /** Reverse propagation delay (ns) if measured directly. */
  reverseDelayNs?: number;
  /** Fiber length difference between Tx and Rx fibers (meters). (~5 ns/m asymmetry in silica). */
  fiberLengthDeltaMeters?: number;
  /** Chromatic dispersion differential delay for BiDi single-fiber links (ns). */
  dispersionDelayDeltaNs?: number;
}

/** PTP synchronization chain configuration. */
export interface PtpSyncChain {
  id: string;
  prtcType: PrtcType;
  nodes: PtpNode[];
  links: PtpLink[];
  /** Target 3GPP application requirement in ns. Defaults to 1500 ns (3GPP 5G TDD basic). */
  maxAllowedTimeErrorNs?: number;
}

/** PTP Time Error Budget Result. */
export interface PtpTimeErrorBudget {
  chainId: string;
  prtcAccuracyNs: number;
  hopCount: number;
  totalConstantTimeErrorNs: number;
  totalDynamicTimeErrorNs: number;
  totalLinkAsymmetryNs: number;
  /** End-to-end maximum estimated time error (cTE_tot + linkAsym + sqrt(sum(dTE^2))). */
  maxTimeErrorNs: number;
  allowedTimeErrorNs: number;
  marginNs: number;
  compliant: boolean;
  /** Cluster-internal time alignment error (excluding PRTC absolute offset) for CoMP/MIMO. */
  clusterInternalTimeErrorNs: number;
  clusterInternalCompliant: boolean; // Must be <= 130 ns (3GPP Cat A+)
  nodeBudgets: {
    nodeId: string;
    cteNs: number;
    dteNs: number;
  }[];
}

/**
 * Computes fiber propagation asymmetry in nanoseconds.
 * In standard single-mode silica fiber (c/n = ~2e8 m/s), 1 meter difference = 5.0 ns delay.
 */
export function computeFiberLinkAsymmetryNs(link: PtpLink): number {
  if (link.forwardDelayNs !== undefined && link.reverseDelayNs !== undefined) {
    return Math.abs(link.forwardDelayNs - link.reverseDelayNs) / 2.0;
  }
  let asym = 0.0;
  if (link.fiberLengthDeltaMeters) {
    const SPEED_OF_LIGHT_VACUUM = 299792458; // m/s
    const REFRACTIVE_INDEX = 1.4682;
    const fiberSpeed = SPEED_OF_LIGHT_VACUUM / REFRACTIVE_INDEX;
    const delayPerMeterNs = (1.0 / fiberSpeed) * 1e9; // ~4.9 ns/m
    asym += (Math.abs(link.fiberLengthDeltaMeters) * delayPerMeterNs) / 2.0;
  }
  if (link.dispersionDelayDeltaNs) {
    asym += Math.abs(link.dispersionDelayDeltaNs) / 2.0;
  }
  return asym;
}

/**
 * Solves the end-to-end ITU-T G.8275.1 PTP time error budget.
 */
export function solvePtpTimeErrorBudget(chain: PtpSyncChain): PtpTimeErrorBudget {
  const prtcAcc = PRTC_ACCURACY_NS[chain.prtcType];
  let sumCte = 0.0;
  let sumDteSquared = 0.0;
  const nodeBudgets: { nodeId: string; cteNs: number; dteNs: number }[] = [];

  for (const node of chain.nodes) {
    const limits = ITU_T_G8273_2_LIMITS[node.clockClass];
    const cte = node.calibratedCteNs ?? limits.maxCteNs * 0.5;
    const dte = node.calibratedDteNs ?? limits.maxDteNs;

    sumCte += cte;
    sumDteSquared += dte * dte;
    nodeBudgets.push({ nodeId: node.id, cteNs: cte, dteNs: dte });
  }

  let totalLinkAsym = 0.0;
  for (const link of chain.links) {
    totalLinkAsym += computeFiberLinkAsymmetryNs(link);
  }

  const totalDte = Math.sqrt(sumDteSquared);
  const totalConstantTimeError = sumCte;
  const maxTimeErrorNs = prtcAcc + totalConstantTimeError + totalLinkAsym + totalDte;
  const allowedNs = chain.maxAllowedTimeErrorNs ?? 1500.0; // 3GPP +-1.5 us
  const marginNs = allowedNs - maxTimeErrorNs;

  // Cluster internal time error excludes the common PRTC satellite reference error
  const clusterInternalTimeErrorNs = totalConstantTimeError + totalLinkAsym + totalDte;
  const clusterInternalCompliant = clusterInternalTimeErrorNs <= 130.0; // 3GPP TR 38.801 Cat A+ (130 ns)

  return {
    chainId: chain.id,
    prtcAccuracyNs: prtcAcc,
    hopCount: chain.nodes.length,
    totalConstantTimeErrorNs: totalConstantTimeError,
    totalDynamicTimeErrorNs: totalDte,
    totalLinkAsymmetryNs: totalLinkAsym,
    maxTimeErrorNs,
    allowedTimeErrorNs: allowedNs,
    marginNs,
    compliant: marginNs >= 0,
    clusterInternalTimeErrorNs,
    clusterInternalCompliant,
    nodeBudgets,
  };
}

/**
 * Calculates Maximum Time Interval Error (MTIE) over observation intervals tau.
 * MTIE(tau) = max_t [ max_{t <= t' <= t+tau} x(t') - min_{t <= t' <= t+tau} x(t') ]
 *
 * @param timeErrorSamplesNs - Evenly spaced time error samples in nanoseconds.
 * @param samplingIntervalSeconds - Sample interval (e.g. 1/30 second or 1.0 second).
 * @param observationIntervalsSeconds - List of tau intervals in seconds to evaluate.
 */
export function computeMtie(
  timeErrorSamplesNs: number[],
  samplingIntervalSeconds: number,
  observationIntervalsSeconds: number[],
): { tau: number; mtieNs: number }[] {
  const n = timeErrorSamplesNs.length;
  const results: { tau: number; mtieNs: number }[] = [];

  for (const tau of observationIntervalsSeconds) {
    const k = Math.max(2, Math.round(tau / samplingIntervalSeconds) + 1);
    if (k >= n) {
      continue;
    }
    let maxPeakToPeak = 0.0;
    for (let i = 0; i <= n - k; i++) {
      let minVal = timeErrorSamplesNs[i] ?? 0;
      let maxVal = minVal;
      for (let j = i; j < i + k; j++) {
        const val = timeErrorSamplesNs[j] ?? 0;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
      const peakToPeak = maxVal - minVal;
      if (peakToPeak > maxPeakToPeak) {
        maxPeakToPeak = peakToPeak;
      }
    }
    results.push({ tau, mtieNs: maxPeakToPeak });
  }

  return results;
}
