// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  plot3dIndex,
  type Plot3dGrid,
  type Plot3dGridBlock,
  type Plot3dSolution,
  type Plot3dSolutionBlock,
} from "../types.js";
import { computeBlockFlowField, computeSurfaceMassFlux, primitiveToConservative } from "./flow.js";

export interface IsentropicNozzleConfig {
  /** Number of axial stations (NI). Default: 21. */
  ni?: number | undefined;
  /** Number of transverse nodes in Y (NJ). Default: 5. */
  nj?: number | undefined;
  /** Number of spanwise nodes in Z (NK). Default: 5. */
  nk?: number | undefined;
  /** Nozzle length in meters. Default: 1.0. */
  length?: number | undefined;
  /** Throat cross-sectional area A* in m^2. Default: 0.1. */
  throatArea?: number | undefined;
  /** Exit/Inlet area ratio relative to throat. Default: 2.2. */
  areaRatioMax?: number | undefined;
  /** Stagnation pressure p0 in Pa. Default: 500000 Pa. */
  p0?: number | undefined;
  /** Stagnation temperature T0 in K. Default: 300 K. */
  t0?: number | undefined;
  /** Ratio of specific heats gamma. Default: 1.4. */
  gamma?: number | undefined;
  /** Specific gas constant R in J/(kg·K). Default: 287.058. */
  gasConstantR?: number | undefined;
  /** If true, supersonic branch downstream of throat (x > L/2); otherwise purely subsonic. Default: true. */
  supersonicExit?: boolean | undefined;
  /** Number of axial blocks to split the nozzle into. Default: 1. */
  numBlocks?: number | undefined;
}

export interface NozzleVerificationResult {
  stations: number;
  inletMassFlux: number;
  outletMassFlux: number;
  massConservationRelErr: number;
  maxTotalPressureRatioRelErr: number;
  rmseTotalPressureRatio: number;
  maxMachRelErr: number;
  rmseMach: number;
  throatMach: number;
  exitMach: number;
}

/**
 * Exact isentropic area-Mach relation:
 * $A / A^* = \frac{1}{M} \left[\frac{2}{\gamma+1}\left(1 + \frac{\gamma-1}{2} M^2\right)\right]^{\frac{\gamma+1}{2(\gamma-1)}}$.
 */
export function isentropicAreaRatioFromMach(mach: number, gamma: number = 1.4): number {
  const gp1 = gamma + 1.0;
  const gm1 = gamma - 1.0;
  const term = (2.0 / gp1) * (1.0 + 0.5 * gm1 * mach * mach);
  return (1.0 / mach) * Math.pow(term, gp1 / (2.0 * gm1));
}

/**
 * Solves the isentropic area-Mach relation for Mach number M given A/A* >= 1
 * on either the subsonic (0 < M <= 1) or supersonic (M >= 1) branch via Newton-Raphson.
 */
export function solveIsentropicMachFromAreaRatio(
  areaRatio: number,
  gamma: number = 1.4,
  supersonic: boolean = false,
): number {
  if (areaRatio <= 1.0 + 1e-12) return 1.0;
  const gp1 = gamma + 1.0;
  const gm1 = gamma - 1.0;
  const exp = gp1 / (2.0 * gm1);

  let m = supersonic ? 1.5 + 0.5 * Math.log(areaRatio) : Math.min(0.95, 0.5 / areaRatio);
  for (let iter = 0; iter < 50; iter++) {
    const term = (2.0 / gp1) * (1.0 + 0.5 * gm1 * m * m);
    const f = (1.0 / m) * Math.pow(term, exp) - areaRatio;
    if (Math.abs(f) < 1e-13) break;
    const dTermDm = ((2.0 * gm1) / gp1) * m;
    const dfDm = (-1.0 / (m * m)) * Math.pow(term, exp) + (1.0 / m) * exp * Math.pow(term, exp - 1.0) * dTermDm;
    if (Math.abs(dfDm) < 1e-15) break;
    const next = m - f / dfDm;
    if (supersonic) {
      m = next > 1.0001 ? next : 1.0001;
    } else {
      m = Math.max(1e-6, Math.min(0.9999, next));
    }
  }
  return m;
}

/**
 * Exact parabolic converging-diverging nozzle area profile A(x)/A* with throat at x = L/2.
 */
export function nozzleAreaRatioAt(x: number, length: number, areaRatioMax: number): number {
  const xi = (2.0 * x) / length - 1.0; // [-1, 1], throat at xi = 0
  return 1.0 + (areaRatioMax - 1.0) * xi * xi;
}

/**
 * Generates an exact 3D structured PLOT3D grid (`.xyz`) and conservative solution (`.q`)
 * for a quasi-1D isentropic converging-diverging nozzle with square cross-section $A(x) = h(x)^2$.
 */
export function generateIsentropicNozzlePlot3d(config?: IsentropicNozzleConfig): {
  grid: Plot3dGrid;
  solution: Plot3dSolution;
} {
  const totalNi = config?.ni ?? 21;
  const nj = config?.nj ?? 5;
  const nk = config?.nk ?? 5;
  const length = config?.length ?? 1.0;
  const throatArea = config?.throatArea ?? 0.1;
  const areaRatioMax = config?.areaRatioMax ?? 2.2;
  const p0 = config?.p0 ?? 500_000.0;
  const t0 = config?.t0 ?? 300.0;
  const gamma = config?.gamma ?? 1.4;
  const R = config?.gasConstantR ?? 287.058;
  const supersonicExit = config?.supersonicExit ?? true;
  const numBlocks = Math.max(1, config?.numBlocks ?? 1);

  const gridBlocks: Plot3dGridBlock[] = [];
  const solBlocks: Plot3dSolutionBlock[] = [];

  const totalIntervals = totalNi - 1;
  const baseIntervals = Math.floor(totalIntervals / numBlocks);

  let startI = 0;
  for (let b = 0; b < numBlocks; b++) {
    const intervals = b === numBlocks - 1 ? totalIntervals - startI : baseIntervals;
    const blockNi = intervals + 1;
    const nNodes = blockNi * nj * nk;

    const xArr = new Float64Array(nNodes);
    const yArr = new Float64Array(nNodes);
    const zArr = new Float64Array(nNodes);

    const rhoArr = new Float64Array(nNodes);
    const rhouArr = new Float64Array(nNodes);
    const rhovArr = new Float64Array(nNodes);
    const rhowArr = new Float64Array(nNodes);
    const energyArr = new Float64Array(nNodes);

    let inletMach = 0.2;

    for (let li = 0; li < blockNi; li++) {
      const gi = startI + li;
      const x = (gi / totalIntervals) * length;
      const areaRatio = nozzleAreaRatioAt(x, length, areaRatioMax);
      const area = throatArea * areaRatio;
      const halfSide = 0.5 * Math.sqrt(area);

      const isSupersonic = supersonicExit && x > 0.5 * length + 1e-12;
      const mach = solveIsentropicMachFromAreaRatio(areaRatio, gamma, isSupersonic);
      if (li === 0) inletMach = mach;

      const isen = 1.0 + 0.5 * (gamma - 1.0) * mach * mach;
      const t = t0 / isen;
      const p = p0 * Math.pow(isen, -gamma / (gamma - 1.0));
      const rho = p / (R * t);
      const a = Math.sqrt(gamma * R * t);
      const u = mach * a;
      const q = primitiveToConservative(rho, u, 0.0, 0.0, p, gamma);

      for (let k = 0; k < nk; k++) {
        const zeta = nk > 1 ? k / (nk - 1) : 0.5;
        const z = (2.0 * zeta - 1.0) * halfSide;
        for (let j = 0; j < nj; j++) {
          const eta = nj > 1 ? j / (nj - 1) : 0.5;
          const y = (2.0 * eta - 1.0) * halfSide;
          const idx = plot3dIndex(li, j, k, blockNi, nj);
          xArr[idx] = x;
          yArr[idx] = y;
          zArr[idx] = z;

          rhoArr[idx] = q.rho;
          rhouArr[idx] = q.rhou;
          rhovArr[idx] = q.rhov;
          rhowArr[idx] = q.rhow;
          energyArr[idx] = q.energy;
        }
      }
    }

    gridBlocks.push({ index: b, ni: blockNi, nj, nk, x: xArr, y: yArr, z: zArr });
    solBlocks.push({
      index: b,
      ni: blockNi,
      nj,
      nk,
      conditions: { fsmach: inletMach, alpha: 0.0, re: 1.0e6, time: 0.0 },
      rho: rhoArr,
      rhou: rhouArr,
      rhov: rhovArr,
      rhow: rhowArr,
      energy: energyArr,
    });

    startI += intervals;
  }

  return {
    grid: {
      format: "ascii",
      dimension: "3d",
      multiBlock: numBlocks > 1,
      hasIblank: false,
      blocks: gridBlocks,
    },
    solution: {
      format: "ascii",
      dimension: "3d",
      multiBlock: numBlocks > 1,
      blocks: solBlocks,
    },
  };
}

/**
 * Verifies isentropic total-pressure ratio $p_0/p = (1 + \frac{\gamma-1}{2}M^2)^{\gamma/(\gamma-1)}$,
 * analytical Mach distribution, and cross-sectional mass-flux conservation across a nozzle PLOT3D dataset.
 */
export function verifyIsentropicNozzle(
  grid: Plot3dGrid,
  solution: Plot3dSolution,
  config?: IsentropicNozzleConfig,
): NozzleVerificationResult {
  const gamma = config?.gamma ?? 1.4;
  const R = config?.gasConstantR ?? 287.058;
  const length = config?.length ?? 1.0;
  const areaRatioMax = config?.areaRatioMax ?? 2.2;
  const supersonicExit = config?.supersonicExit ?? true;

  let stations = 0;
  let sumSqPr = 0;
  let maxPrErr = 0;
  let sumSqMach = 0;
  let maxMachErr = 0;
  let throatMach = 0;
  let exitMach = 0;
  let bestThroatDist = Number.POSITIVE_INFINITY;

  const firstFlux = computeSurfaceMassFlux(grid.blocks[0]!, solution.blocks[0]!, "imin", 0).massFlux;
  const lastBlockIdx = grid.blocks.length - 1;
  const lastFlux = computeSurfaceMassFlux(
    grid.blocks[lastBlockIdx]!,
    solution.blocks[lastBlockIdx]!,
    "imax",
    grid.blocks[lastBlockIdx]!.ni - 1,
  ).massFlux;

  for (let b = 0; b < grid.blocks.length; b++) {
    const gb = grid.blocks[b]!;
    const sb = solution.blocks[b]!;
    const flow = computeBlockFlowField(sb, { gamma, gasConstantR: R });

    for (let i = 0; i < gb.ni; i++) {
      const idx = plot3dIndex(i, 0, 0, gb.ni, gb.nj);
      const x = gb.x[idx]!;
      const areaRatio = nozzleAreaRatioAt(x, length, areaRatioMax);
      const isSupersonic = supersonicExit && x > 0.5 * length + 1e-12;
      const expectedMach = solveIsentropicMachFromAreaRatio(areaRatio, gamma, isSupersonic);

      const actualMach = flow.mach[idx]!;
      const actualPr = flow.totalPressure[idx]! / flow.pressure[idx]!;
      const expectedPr = Math.pow(1.0 + 0.5 * (gamma - 1.0) * expectedMach * expectedMach, gamma / (gamma - 1.0));

      const prErr = Math.abs(actualPr - expectedPr) / Math.max(1e-12, Math.abs(expectedPr));
      const mErr = Math.abs(actualMach - expectedMach) / Math.max(1e-12, Math.abs(expectedMach));

      sumSqPr += prErr * prErr;
      if (prErr > maxPrErr) maxPrErr = prErr;
      sumSqMach += mErr * mErr;
      if (mErr > maxMachErr) maxMachErr = mErr;

      const throatDist = Math.abs(x - 0.5 * length);
      if (throatDist < bestThroatDist) {
        bestThroatDist = throatDist;
        throatMach = actualMach;
      }
      exitMach = actualMach;
      stations++;
    }
  }

  const massConservationRelErr = Math.abs(lastFlux - firstFlux) / Math.max(1e-12, Math.abs(firstFlux));

  return {
    stations,
    inletMassFlux: firstFlux,
    outletMassFlux: lastFlux,
    massConservationRelErr,
    maxTotalPressureRatioRelErr: maxPrErr,
    rmseTotalPressureRatio: stations > 0 ? Math.sqrt(sumSqPr / stations) : 0,
    maxMachRelErr: maxMachErr,
    rmseMach: stations > 0 ? Math.sqrt(sumSqMach / stations) : 0,
    throatMach,
    exitMach,
  };
}
