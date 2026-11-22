// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Cross-Domain Phasor <-> EMT Co-Simulation Pre-Flight Linter
 *
 * Statically verifies boundary consistency between a bulk phasor grid (e.g., PSS/E)
 * and one or more detailed EMT plants (e.g., PSCAD/ATP) before co-simulation starts:
 *   - H1001: Nominal frequency mismatch (e.g. 50 Hz vs 60 Hz)
 *   - H1002: Coupled boundary bus base-kV mismatch (> 1%)
 *   - H1003: t=0 steady-state power-flow imbalance at boundary POI
 *   - H1004: Low short-circuit ratio (SCR < 3.0) weak-grid buffer-zone / FDNE advisory
 *   - H1005: Boundary FDNE passivity or wide-band fitting accuracy violation
 */

import type { FdneRationalModel } from "./fdne-fitter.js";
import type { ComplexPhasor } from "./phasor-emt-types.js";

export interface HybridBoundaryDiagnostic {
  code: "H1001" | "H1002" | "H1003" | "H1004" | "H1005";
  rule: string;
  severity: "error" | "warning" | "info";
  phasorBusId?: string | undefined;
  emtBusId?: string | undefined;
  message: string;
  rigor: "rigorous" | "float-sound" | "heuristic";
}

export interface HybridBoundaryPortPreflight {
  phasorBusId: string;
  emtBusId: string;
  phasorBaseKv: number;
  emtBaseKv: number;
  /** Optional Kron-reduced driving-point admittance Y_eq (pu on baseMva) at this boundary port. */
  yEqPosPu?: ComplexPhasor | undefined;
  /** Optional EMT plant rated active power (MW) for SCR calculation. */
  emtPlantRatedMw?: number | undefined;
  /** Optional steady-state active power at phasor POI (MW) and EMT POI (MW) for t=0 balance check. */
  phasorPoiMw?: number | undefined;
  emtPoiMw?: number | undefined;
  /** Optional pre-fitted FDNE rational model at this boundary port. */
  fdneModel?: FdneRationalModel | undefined;
}

export interface HybridBoundaryPreflightSpec {
  phasorFrequencyHz: number;
  emtFrequencyHz: number;
  baseMva?: number | undefined;
  ports: HybridBoundaryPortPreflight[];
  /** Relative base-kV tolerance (default: 0.01 = 1%). */
  baseKvToleranceRel?: number | undefined;
  /** Minimum recommended Short-Circuit Ratio before advising buffer-zone expansion (default: 3.0). */
  minRecommendedScr?: number | undefined;
  /** Maximum acceptable t=0 power imbalance in MW (default: 10.0 MW). */
  maxPowerMismatchMw?: number | undefined;
}

/**
 * Runs fast cross-domain pre-flight verification across all coupled Phasor <-> EMT boundary ports.
 */
export function lintHybridBoundary(spec: HybridBoundaryPreflightSpec): HybridBoundaryDiagnostic[] {
  const out: HybridBoundaryDiagnostic[] = [];
  const baseMva = spec.baseMva && spec.baseMva > 0 ? spec.baseMva : 100.0;
  const kvTol = spec.baseKvToleranceRel ?? 0.01;
  const minScr = spec.minRecommendedScr ?? 3.0;
  const maxPImbalance = spec.maxPowerMismatchMw ?? 10.0;

  // H1001: Nominal frequency match
  if (Math.abs(spec.phasorFrequencyHz - spec.emtFrequencyHz) > 0.05) {
    out.push({
      code: "H1001",
      rule: "boundary-frequency-mismatch",
      severity: "error",
      message: `Nominal frequency mismatch between phasor grid (${spec.phasorFrequencyHz} Hz) and EMT plant (${spec.emtFrequencyHz} Hz).`,
      rigor: "rigorous",
    });
  }

  for (const p of spec.ports) {
    // H1002: Base-kV consistency
    const refKv = Math.max(1e-6, p.phasorBaseKv);
    const relKvDiff = Math.abs(p.phasorBaseKv - p.emtBaseKv) / refKv;
    if (relKvDiff > kvTol) {
      out.push({
        code: "H1002",
        rule: "boundary-basekv-mismatch",
        severity: "error",
        phasorBusId: p.phasorBusId,
        emtBusId: p.emtBusId,
        message: `Boundary base-kV mismatch at (${p.phasorBusId} <-> ${p.emtBusId}): phasor=${p.phasorBaseKv} kV vs EMT=${p.emtBaseKv} kV (${(relKvDiff * 100).toFixed(2)}% > ${(kvTol * 100).toFixed(1)}%).`,
        rigor: "rigorous",
      });
    }

    // H1003: t=0 steady-state power balance
    if (p.phasorPoiMw !== undefined && p.emtPoiMw !== undefined) {
      const diffMw = Math.abs(p.phasorPoiMw - p.emtPoiMw);
      if (diffMw > maxPImbalance) {
        out.push({
          code: "H1003",
          rule: "boundary-t0-power-imbalance",
          severity: "warning",
          phasorBusId: p.phasorBusId,
          emtBusId: p.emtBusId,
          message: `t=0 steady-state power imbalance at (${p.phasorBusId} <-> ${p.emtBusId}): phasor=${p.phasorPoiMw.toFixed(1)} MW vs EMT=${p.emtPoiMw.toFixed(1)} MW (|dP|=${diffMw.toFixed(1)} MW > ${maxPImbalance} MW); expect startup transient.`,
          rigor: "float-sound",
        });
      }
    }

    // H1004: Short-Circuit Ratio (SCR) buffer-zone adequacy check
    if (p.yEqPosPu && p.emtPlantRatedMw && p.emtPlantRatedMw > 0) {
      const yMagPu = Math.hypot(p.yEqPosPu.re, p.yEqPosPu.im);
      if (yMagPu > 1e-9) {
        const sScMva = yMagPu * baseMva;
        const scr = sScMva / p.emtPlantRatedMw;
        if (scr < minScr) {
          out.push({
            code: "H1004",
            rule: "boundary-weak-grid-scr",
            severity: "warning",
            phasorBusId: p.phasorBusId,
            emtBusId: p.emtBusId,
            message: `Weak-grid boundary at (${p.phasorBusId} <-> ${p.emtBusId}): SCR=${scr.toFixed(2)} (< ${minScr.toFixed(1)}). Recommend expanding EMT buffer zone by +1 hop or enabling complex-conjugate FDNE.`,
            rigor: "float-sound",
          });
        }
      }
    }

    // H1005: FDNE passivity & wide-band fit quality
    if (p.fdneModel) {
      if (!p.fdneModel.isPassive) {
        out.push({
          code: "H1005",
          rule: "boundary-fdne-passivity-or-fit",
          severity: "error",
          phasorBusId: p.phasorBusId,
          emtBusId: p.emtBusId,
          message: `Boundary FDNE at (${p.phasorBusId} <-> ${p.emtBusId}) is non-passive (minRe=${p.fdneModel.minRealPart.toExponential(2)}); EMT integration may diverge.`,
          rigor: "rigorous",
        });
      } else if (p.fdneModel.rmsRelError > 0.25) {
        out.push({
          code: "H1005",
          rule: "boundary-fdne-passivity-or-fit",
          severity: "warning",
          phasorBusId: p.phasorBusId,
          emtBusId: p.emtBusId,
          message: `Boundary FDNE at (${p.phasorBusId} <-> ${p.emtBusId}) has elevated wide-band fit error (${(p.fdneModel.rmsRelError * 100).toFixed(1)}%); consider adding complex-conjugate pole pairs (numComplexPairs >= 2).`,
          rigor: "float-sound",
        });
      }
    }
  }

  return out;
}
