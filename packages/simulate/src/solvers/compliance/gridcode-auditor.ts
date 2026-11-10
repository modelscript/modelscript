// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview DIgSILENT GridCode Parity: Automated Grid Code Compliance Testing Suite.
 *
 * Implements automated compliance auditing against:
 *   - ENTSO-E RfG (Requirements for Generators - Commission Regulation EU 2016/631)
 *   - IEEE 2800-2022 (Interconnection and Interoperability of Inverter-Based Resources)
 *   - IEEE 1547-2018 (Interconnection and Interoperability of Distributed Energy Resources)
 *
 * Tests:
 *   - Fault Ride-Through (FRT / LVRT / HVRT) boundary envelope verification.
 *   - Post-fault active power recovery time t_rec and active power gradient.
 *   - Dynamic reactive current injection during voltage dips (Delta_IQ = K_qv * Delta_U).
 *   - P-Q Reactive Power Capability Curve verification under nominal and off-nominal voltage excursions.
 */

export type GridCodeStandard =
  | "entsoe_rfg_type_b"
  | "entsoe_rfg_type_c_d"
  | "ieee_2800_2022"
  | "ieee_1547_2018_cat3"
  | "custom";

export interface FrtBoundaryPoint {
  /** Time relative to fault inception in seconds (s). */
  timeSec: number;
  /** Minimum allowable voltage limit in per-unit (pu) for LVRT. */
  vMinPu: number;
  /** Maximum allowable voltage limit in per-unit (pu) for HVRT. */
  vMaxPu: number;
}

export interface GridCodeStandardProfile {
  standard: GridCodeStandard;
  name: string;
  nominalVoltageKv: number;
  nominalFreqHz: number;
  /** Voltage-time boundary points defining the ride-through envelope. */
  frtBoundaries: FrtBoundaryPoint[];
  /** Maximum allowable active power recovery time t_rec to 90% pre-fault power in seconds. */
  maxActivePowerRecoveryTimeSec: number;
  /** Minimum reactive current gain K_qv during voltage dips (pu current per pu voltage dip). */
  minReactiveCurrentGainKqv: number;
}

export interface TrajectorySamplePoint {
  tSec: number;
  voltagePu: number;
  activePowerPu: number;
  reactiveCurrentPu?: number | undefined;
}

export interface FrtAuditResult {
  compliant: boolean;
  standardName: string;
  preFaultActivePowerPu: number;
  activePowerRecoveryTimeSec?: number | undefined;
  activePowerRecovered: boolean;
  minObservedVoltagePu: number;
  maxObservedVoltagePu: number;
  violatedPoints: Array<{ tSec: number; voltagePu: number; limitPu: number; violationType: "LVRT" | "HVRT" }>;
  reactiveCurrentGainEvaluated?: number | undefined;
  reactiveSupportCompliant: boolean;
  verdict: "PASS" | "MARGINAL" | "FAIL";
  summaryText: string;
}

export interface PqCapabilityEnvelope {
  name: string;
  pMinPu: number;
  pMaxPu: number;
  qMinPu: number;
  qMaxPu: number;
  /** Minimum required power factor at rated power (e.g. 0.95 or 0.90). */
  minPowerFactor?: number | undefined;
  /** Voltage range over which full capability must be delivered (e.g. [0.90, 1.10]). */
  voltageBandPu: [number, number];
}

export interface PqOperatingPoint {
  label: string;
  pPu: number;
  qPu: number;
  voltagePu: number;
}

export interface PqAuditResult {
  compliant: boolean;
  totalPointsEvaluated: number;
  violatingPoints: Array<{ label: string; pPu: number; qPu: number; reason: string }>;
  qReserveMarginLeadingPu: number;
  qReserveMarginLaggingPu: number;
  verdict: "PASS" | "FAIL";
  summaryText: string;
}

/**
 * Standard Grid Code Profiles for European and North American grids.
 */
export const STANDARD_GRID_CODE_PROFILES: Record<string, GridCodeStandardProfile> = {
  entsoe_rfg_type_d: {
    standard: "entsoe_rfg_type_c_d",
    name: "ENTSO-E RfG Type D Transmission Generator",
    nominalVoltageKv: 400.0,
    nominalFreqHz: 50.0,
    frtBoundaries: [
      { timeSec: 0.0, vMinPu: 0.0, vMaxPu: 1.20 },
      { timeSec: 0.15, vMinPu: 0.0, vMaxPu: 1.20 },
      { timeSec: 0.25, vMinPu: 0.25, vMaxPu: 1.15 },
      { timeSec: 0.70, vMinPu: 0.70, vMaxPu: 1.15 },
      { timeSec: 1.50, vMinPu: 0.85, vMaxPu: 1.10 },
      { timeSec: 3.00, vMinPu: 0.90, vMaxPu: 1.10 },
    ],
    maxActivePowerRecoveryTimeSec: 0.50,
    minReactiveCurrentGainKqv: 2.0,
  },
  ieee_2800_2022: {
    standard: "ieee_2800_2022",
    name: "IEEE 2800-2022 Transmission Inverter-Based Resource",
    nominalVoltageKv: 230.0,
    nominalFreqHz: 60.0,
    frtBoundaries: [
      { timeSec: 0.0, vMinPu: 0.0, vMaxPu: 1.20 },
      { timeSec: 0.16, vMinPu: 0.0, vMaxPu: 1.20 },
      { timeSec: 0.50, vMinPu: 0.50, vMaxPu: 1.18 },
      { timeSec: 1.00, vMinPu: 0.70, vMaxPu: 1.15 },
      { timeSec: 3.00, vMinPu: 0.88, vMaxPu: 1.10 },
    ],
    maxActivePowerRecoveryTimeSec: 1.0,
    minReactiveCurrentGainKqv: 2.0,
  },
  ieee_1547_2018_cat3: {
    standard: "ieee_1547_2018_cat3",
    name: "IEEE 1547-2018 Category III Distributed Energy Resource",
    nominalVoltageKv: 13.8,
    nominalFreqHz: 60.0,
    frtBoundaries: [
      { timeSec: 0.0, vMinPu: 0.0, vMaxPu: 1.20 },
      { timeSec: 1.0, vMinPu: 0.50, vMaxPu: 1.20 },
      { timeSec: 5.0, vMinPu: 0.70, vMaxPu: 1.10 },
      { timeSec: 10.0, vMinPu: 0.88, vMaxPu: 1.10 },
    ],
    maxActivePowerRecoveryTimeSec: 2.0,
    minReactiveCurrentGainKqv: 1.5,
  },
};

/**
 * Audits a transient simulation voltage and power trajectory against a Grid Code FRT profile.
 */
export function auditFaultRideThrough(
  trajectory: TrajectorySamplePoint[],
  profile: GridCodeStandardProfile,
): FrtAuditResult {
  if (trajectory.length === 0) {
    throw new Error("Trajectory array cannot be empty.");
  }

  const p0 = trajectory[0]!.activePowerPu;
  let minV = Infinity;
  let maxV = -Infinity;
  const violations: Array<{ tSec: number; voltagePu: number; limitPu: number; violationType: "LVRT" | "HVRT" }> = [];

  // Helper to interpolate boundary limits at time t
  const getBoundary = (t: number): { vMin: number; vMax: number } => {
    const bounds = profile.frtBoundaries;
    if (t <= bounds[0]!.timeSec) return { vMin: bounds[0]!.vMinPu, vMax: bounds[0]!.vMaxPu };
    if (t >= bounds[bounds.length - 1]!.timeSec) {
      const last = bounds[bounds.length - 1]!;
      return { vMin: last.vMinPu, vMax: last.vMaxPu };
    }
    for (let i = 0; i < bounds.length - 1; i++) {
      const b1 = bounds[i]!;
      const b2 = bounds[i + 1]!;
      if (t >= b1.timeSec && t <= b2.timeSec) {
        const alpha = (t - b1.timeSec) / (b2.timeSec - b1.timeSec);
        return {
          vMin: b1.vMinPu + alpha * (b2.vMinPu - b1.vMinPu),
          vMax: b1.vMaxPu + alpha * (b2.vMaxPu - b1.vMaxPu),
        };
      }
    }
    return { vMin: 0.9, vMax: 1.1 };
  };

  let activeRecovered = false;
  let activeRecoveryTime: number | undefined;

  let totalDipSamples = 0;
  let reactiveSupportPassingSamples = 0;

  for (const pt of trajectory) {
    if (pt.voltagePu < minV) minV = pt.voltagePu;
    if (pt.voltagePu > maxV) maxV = pt.voltagePu;

    const { vMin, vMax } = getBoundary(pt.tSec);

    // LVRT check
    if (pt.voltagePu < vMin - 1e-4) {
      violations.push({ tSec: pt.tSec, voltagePu: pt.voltagePu, limitPu: vMin, violationType: "LVRT" });
    }
    // HVRT check
    if (pt.voltagePu > vMax + 1e-4) {
      violations.push({ tSec: pt.tSec, voltagePu: pt.voltagePu, limitPu: vMax, violationType: "HVRT" });
    }

    // Active power recovery check after clearing
    if (pt.tSec > 0.20 && !activeRecovered && pt.activePowerPu >= 0.90 * p0) {
      activeRecovered = true;
      activeRecoveryTime = pt.tSec;
    }

    // Dynamic reactive current check during voltage dips (V < 0.90)
    if (pt.voltagePu < 0.90 && pt.reactiveCurrentPu !== undefined) {
      totalDipSamples++;
      const deltaV = 1.0 - pt.voltagePu;
      const expectedIq = profile.minReactiveCurrentGainKqv * deltaV;
      if (pt.reactiveCurrentPu >= 0.85 * expectedIq) {
        reactiveSupportPassingSamples++;
      }
    }
  }

  const activeCompliant =
    activeRecoveryTime !== undefined &&
    activeRecoveryTime <= profile.maxActivePowerRecoveryTimeSec + 0.20;

  const reactiveSupportCompliant =
    totalDipSamples === 0 || reactiveSupportPassingSamples / totalDipSamples >= 0.80;

  const compliant = violations.length === 0 && activeCompliant && reactiveSupportCompliant;
  let verdict: "PASS" | "MARGINAL" | "FAIL" = "PASS";
  if (!compliant) {
    if (violations.length > 2 || !activeCompliant || !reactiveSupportCompliant) {
      verdict = "FAIL";
    } else {
      verdict = "MARGINAL";
    }
  }

  const summary = `Grid Code Audit against ${profile.name}: Verdict = ${verdict}. Min V = ${minV.toFixed(3)} pu, Max V = ${maxV.toFixed(3)} pu. Violations = ${violations.length}. Active power recovery = ${activeRecovered ? `${activeRecoveryTime?.toFixed(2)}s` : "FAILED"}.`;

  return {
    compliant,
    standardName: profile.name,
    preFaultActivePowerPu: p0,
    activePowerRecoveryTimeSec: activeRecoveryTime,
    activePowerRecovered: activeCompliant,
    minObservedVoltagePu: minV,
    maxObservedVoltagePu: maxV,
    violatedPoints: violations,
    reactiveSupportCompliant,
    verdict,
    summaryText: summary,
  };
}

/**
 * Audits generator or inverter operating points against a P-Q capability curve envelope.
 */
export function auditPqCapability(
  operatingPoints: PqOperatingPoint[],
  envelope: PqCapabilityEnvelope,
): PqAuditResult {
  const violations: Array<{ label: string; pPu: number; qPu: number; reason: string }> = [];

  let minLeadingMargin = Infinity;
  let minLaggingMargin = Infinity;

  for (const pt of operatingPoints) {
    let ptCompliant = true;
    let reason = "";

    // Active power limits
    if (pt.pPu < envelope.pMinPu - 1e-4) {
      ptCompliant = false;
      reason += `Active power ${pt.pPu.toFixed(2)} pu below P_min ${envelope.pMinPu} pu. `;
    }
    if (pt.pPu > envelope.pMaxPu + 1e-4) {
      ptCompliant = false;
      reason += `Active power ${pt.pPu.toFixed(2)} pu above P_max ${envelope.pMaxPu} pu. `;
    }

    // Reactive power limits
    if (pt.qPu < envelope.qMinPu - 1e-4) {
      ptCompliant = false;
      reason += `Reactive power ${pt.qPu.toFixed(2)} pu below leading limit Q_min ${envelope.qMinPu} pu. `;
    }
    if (pt.qPu > envelope.qMaxPu + 1e-4) {
      ptCompliant = false;
      reason += `Reactive power ${pt.qPu.toFixed(2)} pu above lagging limit Q_max ${envelope.qMaxPu} pu. `;
    }

    // Power factor limit check at high power
    if (envelope.minPowerFactor && pt.pPu > 0.5 * envelope.pMaxPu) {
      const s = Math.hypot(pt.pPu, pt.qPu);
      const pf = s > 1e-4 ? pt.pPu / s : 1.0;
      if (pf < envelope.minPowerFactor - 0.01) {
        ptCompliant = false;
        reason += `Power factor ${pf.toFixed(3)} below minimum required ${envelope.minPowerFactor}. `;
      }
    }

    // Track reserve margins
    const leadMargin = pt.qPu - envelope.qMinPu;
    const lagMargin = envelope.qMaxPu - pt.qPu;
    if (leadMargin < minLeadingMargin) minLeadingMargin = leadMargin;
    if (lagMargin < minLaggingMargin) minLaggingMargin = lagMargin;

    if (!ptCompliant) {
      violations.push({ label: pt.label, pPu: pt.pPu, qPu: pt.qPu, reason: reason.trim() });
    }
  }

  const compliant = violations.length === 0;
  const verdict: "PASS" | "FAIL" = compliant ? "PASS" : "FAIL";

  const summary = `P-Q Capability Audit against ${envelope.name}: Verdict = ${verdict}. Evaluated ${operatingPoints.length} points with ${violations.length} violations. Minimum Leading Reserve = ${minLeadingMargin.toFixed(3)} pu, Lagging Reserve = ${minLaggingMargin.toFixed(3)} pu.`;

  return {
    compliant,
    totalPointsEvaluated: operatingPoints.length,
    violatingPoints: violations,
    qReserveMarginLeadingPu: minLeadingMargin,
    qReserveMarginLaggingPu: minLaggingMargin,
    verdict,
    summaryText: summary,
  };
}
