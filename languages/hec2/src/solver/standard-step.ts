// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hec2CrossSection, Hec2Deck, Hec2UnitSystem } from "../types.js";
import {
  computeCriticalWsel,
  computeFroudeNumber,
  computeNormalWsel,
  computeSectionHydraulics,
  getUnitConstants,
  type SectionHydraulics,
} from "./hydraulics.js";

export interface Hec2SolveOptions {
  /** Override discharge Q (default: from J1.Q or QT[0]) */
  discharge?: number | undefined;
  /** Override downstream known WSEL (default: from J1.WSEL) */
  downstreamWsel?: number | undefined;
  /** Override starting energy slope for normal depth BC (default: J1.STRT or 0.001) */
  startingSlope?: number | undefined;
  /** Override unit system (default: deck.units) */
  units?: Hec2UnitSystem | undefined;
  /** Friction slope averaging scheme: "avg-conveyance" (HEC-2 default) or "avg-friction" */
  frictionSlopeMethod?: "avg-conveyance" | "avg-friction" | undefined;
  /** Energy balance tolerance (default: 1e-9) */
  tolerance?: number | undefined;
  /** Maximum iterations per cross-section (default: 80) */
  maxIterations?: number | undefined;
}

export interface Hec2ProfileStationResult {
  secno: number;
  invertElevation: number;
  wsel: number;
  depth: number;
  egl: number;
  velocity: number;
  velocityHead: number;
  alpha: number;
  area: number;
  topWidth: number;
  wettedPerimeter: number;
  hydraulicRadius: number;
  conveyance: number;
  froudeNumber: number;
  criticalWsel: number;
  criticalDepth: number;
  normalWsel?: number | undefined;
  normalDepth?: number | undefined;
  frictionSlope: number;
  headLoss: number;
  energyResidual: number;
  flowRegime: "subcritical" | "critical" | "supercritical";
  iterations: number;
  converged: boolean;
}

export interface Hec2ProfileResult {
  units: Hec2UnitSystem;
  discharge: number;
  stations: Hec2ProfileStationResult[];
  maxEnergyResidual: number;
  allConverged: boolean;
}

/**
 * Computes discharge-weighted reach length `L` between downstream section 1 and upstream section 2.
 */
function computeWeightedReachLength(xsUp: Hec2CrossSection, hyd1: SectionHydraulics, hyd2: SectionHydraulics): number {
  const k1 = Math.max(hyd1.conveyance, 1e-12);
  const k2 = Math.max(hyd2.conveyance, 1e-12);
  const wLob = 0.5 * (hyd1.lob.conveyance / k1 + hyd2.lob.conveyance / k2);
  const wCh = 0.5 * (hyd1.channel.conveyance / k1 + hyd2.channel.conveyance / k2);
  const wRob = 0.5 * (hyd1.rob.conveyance / k1 + hyd2.rob.conveyance / k2);
  const denom = wLob + wCh + wRob;
  if (denom <= 0) return xsUp.xlch;
  return (xsUp.xlobl * wLob + xsUp.xlch * wCh + xsUp.xlobr * wRob) / denom;
}

/**
 * Computes average friction slope `Sf_bar` between downstream section 1 and upstream section 2.
 */
function computeAverageFrictionSlope(
  q1: number,
  q2: number,
  k1: number,
  k2: number,
  method: "avg-conveyance" | "avg-friction",
): number {
  const safeK1 = Math.max(k1, 1e-12);
  const safeK2 = Math.max(k2, 1e-12);
  if (method === "avg-friction") {
    const sf1 = (q1 / safeK1) ** 2;
    const sf2 = (q2 / safeK2) ** 2;
    return 0.5 * (sf1 + sf2);
  }
  // HEC-2 default: Average Conveyance Equation
  return ((q1 + q2) / (safeK1 + safeK2)) ** 2;
}

function classifyRegime(fr: number): "subcritical" | "critical" | "supercritical" {
  if (Math.abs(fr - 1.0) < 0.02) return "critical";
  return fr < 1.0 ? "subcritical" : "supercritical";
}

/**
 * Solves 1D steady gradually-varied open-channel water surface profiles using the
 * USACE HEC-2 Standard Step Energy Equation:
 *
 *   WSE_2 + alpha_2 * V_2^2 / (2g) = WSE_1 + alpha_1 * V_1^2 / (2g) + h_e
 *
 * Cross-sections in a HEC-2 subcritical deck are ordered downstream-to-upstream
 * (first X1 card is downstream control; subsequent X1 cards march upstream).
 */
export function solveHec2Profile(deck: Hec2Deck, options: Hec2SolveOptions = {}): Hec2ProfileResult {
  const units = options.units ?? deck.units;
  const { g } = getUnitConstants(units);
  const method = options.frictionSlopeMethod ?? "avg-conveyance";
  const tol = options.tolerance ?? 1e-9;
  const maxIter = options.maxIterations ?? 80;

  const discharge = options.discharge ?? deck.jobCard?.q ?? deck.dischargeTable?.discharges[0] ?? 100.0;

  const startingSlope =
    options.startingSlope ??
    (deck.jobCard?.strt !== undefined && deck.jobCard.strt > 0 ? deck.jobCard.strt : undefined);

  if (deck.crossSections.length === 0) {
    return {
      units,
      discharge,
      stations: [],
      maxEnergyResidual: 0,
      allConverged: true,
    };
  }

  const results: Hec2ProfileStationResult[] = [];

  // Station 0: Downstream boundary condition
  const xs0 = deck.crossSections[0]!;
  const critWsel0 = computeCriticalWsel(xs0, discharge, units);
  const normWsel0 =
    startingSlope !== undefined && startingSlope > 0
      ? computeNormalWsel(xs0, discharge, startingSlope, units)
      : undefined;

  let wsel0: number;
  if (options.downstreamWsel !== undefined) {
    wsel0 = options.downstreamWsel;
  } else if (deck.jobCard?.wsel !== undefined && deck.jobCard.wsel > 0) {
    wsel0 = deck.jobCard.wsel;
  } else if (deck.jobCard?.strt !== undefined && deck.jobCard.strt < 0) {
    wsel0 = critWsel0;
  } else if (normWsel0 !== undefined) {
    wsel0 = normWsel0;
  } else {
    wsel0 = computeNormalWsel(xs0, discharge, 0.001, units);
  }

  let prevHyd = computeSectionHydraulics(xs0, wsel0, units);
  const v0 = prevHyd.area > 0 ? discharge / prevHyd.area : 0;
  const hv0 = (prevHyd.alpha * v0 * v0) / (2 * g);
  const egl0 = wsel0 + hv0;
  const sf0 = prevHyd.conveyance > 0 ? (discharge / prevHyd.conveyance) ** 2 : 0;
  const fr0 = computeFroudeNumber(discharge, prevHyd, units);

  results.push({
    secno: xs0.secno,
    invertElevation: prevHyd.invertElevation,
    wsel: wsel0,
    depth: prevHyd.depth,
    egl: egl0,
    velocity: v0,
    velocityHead: hv0,
    alpha: prevHyd.alpha,
    area: prevHyd.area,
    topWidth: prevHyd.topWidth,
    wettedPerimeter: prevHyd.wettedPerimeter,
    hydraulicRadius: prevHyd.hydraulicRadius,
    conveyance: prevHyd.conveyance,
    froudeNumber: fr0,
    criticalWsel: critWsel0,
    criticalDepth: critWsel0 - prevHyd.invertElevation,
    normalWsel: normWsel0,
    normalDepth: normWsel0 !== undefined ? normWsel0 - prevHyd.invertElevation : undefined,
    frictionSlope: sf0,
    headLoss: 0,
    energyResidual: 0,
    flowRegime: classifyRegime(fr0),
    iterations: 0,
    converged: true,
  });

  let prevEgl = egl0;
  let prevHv = hv0;

  // March upstream across remaining cross-sections
  for (let i = 1; i < deck.crossSections.length; i++) {
    const xs = deck.crossSections[i]!;
    const critWsel = computeCriticalWsel(xs, discharge, units);
    const minZ = xs.grPoints.reduce((m, p) => Math.min(m, p.elevation), Infinity);

    // Local bed slope estimate (if positive) for reference normal depth
    const localBedSlope =
      xs.xlch > 0 && minZ > prevHyd.invertElevation ? (minZ - prevHyd.invertElevation) / xs.xlch : startingSlope;
    const normWsel =
      localBedSlope !== undefined && localBedSlope > 0
        ? computeNormalWsel(xs, discharge, localBedSlope, units)
        : undefined;

    /**
     * Energy balance residual:
     *   F(WSE_2) = (WSE_2 + alpha_2 * V_2^2 / 2g) - (EGL_1 + h_e(WSE_2))
     * On the subcritical branch (WSE_2 >= WSE_c), F(WSE_2) is strictly monotonically increasing!
     */
    const evalEnergy = (w2: number) => {
      const h2 = computeSectionHydraulics(xs, w2, units);
      const v2 = h2.area > 0 ? discharge / h2.area : 0;
      const hv2 = (h2.alpha * v2 * v2) / (2 * g);
      const egl2 = w2 + hv2;
      const L = computeWeightedReachLength(xs, prevHyd, h2);
      const sfBar = computeAverageFrictionSlope(discharge, discharge, prevHyd.conveyance, h2.conveyance, method);
      const hf = L * sfBar;
      const coef = hv2 > prevHv ? xs.contractionCoef : xs.expansionCoef;
      const hce = coef * Math.abs(hv2 - prevHv);
      const he = hf + hce;
      const residual = egl2 - (prevEgl + he);
      return { h2, v2, hv2, egl2, sfBar, he, residual };
    };

    // Subcritical lower bound is critical depth
    let lo = critWsel;
    let fLo = evalEnergy(lo).residual;

    let wselSol = critWsel;
    let iterations = 0;
    let converged = false;

    if (fLo >= 0) {
      // Flow passes through critical depth (control section)
      wselSol = critWsel;
      converged = true;
    } else {
      // Expand upper bound until F(hi) >= 0
      let hi = Math.max(prevEgl, critWsel) + Math.max(0.5, xs.xlch * Math.max(sf0, 0.001) * 2.0);
      let fHi = evalEnergy(hi).residual;
      for (let k = 0; k < 40 && fHi < 0; k++) {
        hi += Math.max(1.0, (hi - lo) * 2.0);
        fHi = evalEnergy(hi).residual;
      }

      // Bracketed secant / bisection hybrid for rapid, guaranteed convergence
      let a = lo;
      let b = hi;
      let fa = fLo;
      let fb = fHi;

      for (let iter = 1; iter <= maxIter; iter++) {
        iterations = iter;
        // Secant candidate inside (a, b), guarded by bisection
        let c = 0.5 * (a + b);
        if (Math.abs(fb - fa) > 1e-15) {
          const sec = b - (fb * (b - a)) / (fb - fa);
          const margin = 0.05 * (b - a);
          if (sec > a + margin && sec < b - margin) {
            c = sec;
          }
        }

        const ev = evalEnergy(c);
        wselSol = c;

        if (Math.abs(ev.residual) <= tol || Math.abs(b - a) <= 1e-12) {
          converged = Math.abs(ev.residual) <= Math.max(tol, 1e-6);
          break;
        }

        if (ev.residual < 0) {
          a = c;
          fa = ev.residual;
        } else {
          b = c;
          fb = ev.residual;
        }
      }
    }

    const finalEv = evalEnergy(wselSol);
    const sf2 = finalEv.h2.conveyance > 0 ? (discharge / finalEv.h2.conveyance) ** 2 : 0;
    const fr2 = computeFroudeNumber(discharge, finalEv.h2, units);

    results.push({
      secno: xs.secno,
      invertElevation: finalEv.h2.invertElevation,
      wsel: wselSol,
      depth: finalEv.h2.depth,
      egl: finalEv.egl2,
      velocity: finalEv.v2,
      velocityHead: finalEv.hv2,
      alpha: finalEv.h2.alpha,
      area: finalEv.h2.area,
      topWidth: finalEv.h2.topWidth,
      wettedPerimeter: finalEv.h2.wettedPerimeter,
      hydraulicRadius: finalEv.h2.hydraulicRadius,
      conveyance: finalEv.h2.conveyance,
      froudeNumber: fr2,
      criticalWsel: critWsel,
      criticalDepth: critWsel - finalEv.h2.invertElevation,
      normalWsel: normWsel,
      normalDepth: normWsel !== undefined ? normWsel - finalEv.h2.invertElevation : undefined,
      frictionSlope: sf2,
      headLoss: finalEv.he,
      energyResidual: Math.abs(finalEv.residual),
      flowRegime: classifyRegime(fr2),
      iterations,
      converged,
    });

    prevHyd = finalEv.h2;
    prevEgl = finalEv.egl2;
    prevHv = finalEv.hv2;
  }

  let maxEnergyResidual = 0;
  let allConverged = true;
  for (const st of results) {
    if (st.energyResidual > maxEnergyResidual) maxEnergyResidual = st.energyResidual;
    if (!st.converged) allConverged = false;
  }

  return {
    units,
    discharge,
    stations: results,
    maxEnergyResidual,
    allConverged,
  };
}
