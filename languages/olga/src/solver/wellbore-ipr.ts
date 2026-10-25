// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Wellbore Inflow Performance Relationship (IPR) Engine.
 *
 * Implements reservoir deliverability equations:
 * 1. Linear Productivity Index (PI) for single-phase liquid / under-saturated oil
 * 2. Vogel's quadratic solution-gas drive inflow equation
 * 3. Fetkovich's backpressure equation for gas & gas-condensate wells
 *
 * Couples dynamic well flowing bottom-hole pressure (P_wf) to flowline inlet mass rate.
 */

import type { OlgaIpr } from "../types.js";

export interface EvaluatedIprInflow {
  totalMassRate: number; // kg / s
  liquidMassRate: number; // kg / s
  gasMassRate: number; // kg / s
  gasMassFraction: number; // [0.0 - 1.0]
  waterCut: number; // [0.0 - 1.0]
  drawdownPa: number; // P_res - P_wf [Pa]
  isCrossflow: boolean; // whether P_wf > P_res (inflow suppressed or reversed)
}

/**
 * Computes instantaneous well deliverability based on flowing bottom-hole pressure.
 *
 * @param ipr                 Well IPR specification
 * @param flowingPressurePa   Bottom-hole flowing pressure P_wf [Pa]
 */
export function evaluateWellIpr(ipr: OlgaIpr, flowingPressurePa: number): EvaluatedIprInflow {
  const pRes = ipr.reservoirPressure;
  const pWf = Math.max(0, flowingPressurePa);
  const drawdown = pRes - pWf;

  if (drawdown <= 0) {
    return {
      totalMassRate: 0.0,
      liquidMassRate: 0.0,
      gasMassRate: 0.0,
      gasMassFraction: ipr.gasMassFraction,
      waterCut: ipr.waterCut,
      drawdownPa: 0.0,
      isCrossflow: true,
    };
  }

  let totalMassRate = 0.0;

  switch (ipr.type) {
    case "LINEAR_PI": {
      const pi = ipr.productivityIndex ?? 5.0e-5; // kg / (s * Pa) (~ 43 kg/s at 10 bar drawdown)
      totalMassRate = pi * drawdown;
      break;
    }

    case "VOGEL": {
      const qMax = ipr.maxLiquidRate ?? 65.0; // kg / s
      const pb = ipr.bubblePointPressure ?? pRes;

      if (pWf >= pb) {
        // Linear above bubble point
        const pi = qMax / (1.8 * pb);
        totalMassRate = pi * drawdown;
      } else {
        // Quadratic Vogel curve
        const ratio = Math.max(0.0, Math.min(1.0, pWf / pRes));
        totalMassRate = qMax * (1.0 - 0.2 * ratio - 0.8 * ratio * ratio);
      }
      break;
    }

    case "FETKOVICH": {
      const c = ipr.cFactor ?? 1.5e-11; // kg / (s * Pa^(2n))
      const n = Math.max(0.5, Math.min(1.0, ipr.nExponent ?? 0.85));
      const deltaP2 = Math.max(0, pRes * pRes - pWf * pWf);
      totalMassRate = c * Math.pow(deltaP2, n);
      break;
    }
  }

  totalMassRate = Math.max(0.0, totalMassRate);
  const gasMassRate = totalMassRate * ipr.gasMassFraction;
  const liquidMassRate = totalMassRate - gasMassRate;

  return {
    totalMassRate,
    liquidMassRate,
    gasMassRate,
    gasMassFraction: ipr.gasMassFraction,
    waterCut: ipr.waterCut,
    drawdownPa: drawdown,
    isCrossflow: false,
  };
}

/**
 * Steps the well inflow rate with under-relaxation to prevent algebraic oscillations.
 *
 * @param currentMassRate     Previous timestep mass rate [kg/s]
 * @param ipr                 Well IPR specification
 * @param flowingPressurePa   Current flowing pressure [Pa]
 * @param relaxation          Damping weight (default: 0.35)
 */
export function stepWellInflow(
  currentMassRate: number,
  ipr: OlgaIpr,
  flowingPressurePa: number,
  relaxation = 0.35,
): number {
  const evaluated = evaluateWellIpr(ipr, flowingPressurePa);
  const target = evaluated.totalMassRate;
  const omega = Math.max(0.05, Math.min(1.0, relaxation));
  return (1.0 - omega) * currentMassRate + omega * target;
}
