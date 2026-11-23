// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { conservativeToPrimitive } from "../solver/flow.js";
import { computeGridMetrics } from "../solver/metrics.js";
import { plot3dIndex, type Plot3dGrid, type Plot3dSolution } from "../types.js";

export interface Plot3dDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Ratio of specific heats gamma (default: 1.4). */
  gamma?: number | undefined;
  /** Maximum axial finite-volume cells to emit per block (default: 8). */
  maxCellsPerBlock?: number | undefined;
}

/**
 * Lowers a structured PLOT3D CFD grid and optional conservative solution into
 * finite-volume 1D Euler conservation equations directly inside ModelScript's
 * zero-GC WebAssembly `DAEBuilder` arena:
 *
 * - Mass:     `der(rho_i)  = -(rhou_i - rhou_{i-1}) / dx_i`
 * - Momentum: `der(rhou_i) = -((rhou_i * u_i + p_i) - (rhou_{i-1} * u_{i-1} + p_{i-1})) / dx_i`
 * - Energy:   `der(E_i)    = -(((E_i + p_i) * u_i) - ((E_{i-1} + p_{i-1}) * u_{i-1})) / dx_i`
 * - Velocity: `u_i * rho_i = rhou_i`
 * - EOS:      `p_i = (gamma - 1) * (E_i - 0.5 * rhou_i * u_i)`
 */
export function plot3dToDae(grid: Plot3dGrid, solution?: Plot3dSolution, options?: Plot3dDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? "Plot3dEulerFVM").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const gamma = options?.gamma ?? 1.4;
  const maxCells = options?.maxCellsPerBlock ?? 8;

  const metrics = computeGridMetrics(grid);

  // Global thermodynamic & geometric summary parameters
  const gammaParam = dae.addVariable("gamma", VarType.Real, Variability.Parameter, Causality.Local, gamma);
  dae.addEquation(EqKind.Simple, gammaParam, dae.addRealLiteral(gamma));

  const totalVolVar = dae.addVariable(
    "total_volume",
    VarType.Real,
    Variability.Parameter,
    Causality.Output,
    metrics.totalVolume,
  );
  dae.addEquation(EqKind.Simple, totalVolVar, dae.addRealLiteral(metrics.totalVolume));

  const gm1Expr = dae.addRealLiteral(gamma - 1.0);
  const halfExpr = dae.addRealLiteral(0.5);

  for (let bIdx = 0; bIdx < grid.blocks.length; bIdx++) {
    const gb = grid.blocks[bIdx]!;
    const sb = solution?.blocks[bIdx];
    const nCells = Math.max(1, Math.min(maxCells, Math.max(1, gb.ni - 1)));

    // Compute axial domain extent for block
    const xStart = gb.x[plot3dIndex(0, 0, 0, gb.ni, gb.nj)] ?? 0.0;
    const xEnd = gb.x[plot3dIndex(gb.ni - 1, 0, 0, gb.ni, gb.nj)] ?? 1.0;
    const blockLen = Math.max(1e-6, Math.abs(xEnd - xStart));
    const dx = blockLen / nCells;
    const dxExpr = dae.addRealLiteral(dx);

    // Inlet boundary state from node (0,0,0) or standard sea-level flow
    let rhoInVal = 1.225;
    let rhouInVal = 1.225 * 100.0;
    let eInVal = 101325.0 / (gamma - 1.0) + 0.5 * 1.225 * 100.0 * 100.0;
    let uInVal = 100.0;
    let pInVal = 101325.0;

    if (sb && sb.rho.length > 0) {
      rhoInVal = sb.rho[0]!;
      rhouInVal = sb.rhou[0]!;
      eInVal = sb.energy[0]!;
      const prim = conservativeToPrimitive(
        {
          rho: rhoInVal,
          rhou: rhouInVal,
          rhov: sb.rhov[0]!,
          rhow: sb.rhow[0]!,
          energy: eInVal,
        },
        { gamma },
      );
      uInVal = prim.u;
      pInVal = Math.max(1.0, prim.pressure);
    }

    let prevRhou = dae.addRealLiteral(rhouInVal);
    let prevMomFlux = dae.addRealLiteral(rhouInVal * uInVal + pInVal);
    let prevEnergyFlux = dae.addRealLiteral((eInVal + pInVal) * uInVal);

    for (let c = 0; c < nCells; c++) {
      const sampleI = Math.min(gb.ni - 1, Math.floor(((c + 0.5) / nCells) * (gb.ni - 1)));
      const sampleIdx = plot3dIndex(sampleI, 0, 0, gb.ni, gb.nj);

      let rho0 = rhoInVal;
      let rhou0 = rhouInVal;
      let e0 = eInVal;
      let u0 = uInVal;
      let p0 = pInVal;

      if (sb && sampleIdx < sb.rho.length) {
        rho0 = sb.rho[sampleIdx]!;
        rhou0 = sb.rhou[sampleIdx]!;
        e0 = sb.energy[sampleIdx]!;
        const prim = conservativeToPrimitive(
          {
            rho: rho0,
            rhou: rhou0,
            rhov: sb.rhov[sampleIdx]!,
            rhow: sb.rhow[sampleIdx]!,
            energy: e0,
          },
          { gamma },
        );
        u0 = prim.u;
        p0 = Math.max(1.0, prim.pressure);
      }

      const prefix = `b${bIdx}_c${c}`;
      const rhoVar = dae.addVariable(`${prefix}_rho`, VarType.Real, Variability.Continuous, Causality.Local, rho0);
      const rhouVar = dae.addVariable(`${prefix}_rhou`, VarType.Real, Variability.Continuous, Causality.Local, rhou0);
      const eVar = dae.addVariable(`${prefix}_E`, VarType.Real, Variability.Continuous, Causality.Local, e0);
      const uVar = dae.addVariable(`${prefix}_u`, VarType.Real, Variability.Continuous, Causality.Local, u0);
      const pVar = dae.addVariable(`${prefix}_p`, VarType.Real, Variability.Continuous, Causality.Local, p0);

      // Velocity relation: u * rho = rhou
      const rhoUProd = dae.addBinaryExpr(BinOp.Mul, rhoVar, uVar);
      dae.addEquation(EqKind.Simple, rhoUProd, rhouVar);

      // Ideal gas EOS: p = (gamma - 1) * (E - 0.5 * rhou * u)
      const rhouTimesU = dae.addBinaryExpr(BinOp.Mul, rhouVar, uVar);
      const keExpr = dae.addBinaryExpr(BinOp.Mul, halfExpr, rhouTimesU);
      const eIntExpr = dae.addBinaryExpr(BinOp.Sub, eVar, keExpr);
      const pRhs = dae.addBinaryExpr(BinOp.Mul, gm1Expr, eIntExpr);
      dae.addEquation(EqKind.Simple, pVar, pRhs);

      // Mass conservation: der(rho) = (prevRhou - rhou) / dx
      const derRho = dae.addDer(rhoVar);
      const massDiff = dae.addBinaryExpr(BinOp.Sub, prevRhou, rhouVar);
      const dRhoDt = dae.addBinaryExpr(BinOp.Div, massDiff, dxExpr);
      dae.addEquation(EqKind.Simple, derRho, dRhoDt);

      // Momentum conservation: der(rhou) = (prevMomFlux - (rhou * u + p)) / dx
      const currMomFlux = dae.addBinaryExpr(BinOp.Add, rhouTimesU, pVar);
      const derRhou = dae.addDer(rhouVar);
      const momDiff = dae.addBinaryExpr(BinOp.Sub, prevMomFlux, currMomFlux);
      const dRhouDt = dae.addBinaryExpr(BinOp.Div, momDiff, dxExpr);
      dae.addEquation(EqKind.Simple, derRhou, dRhouDt);

      // Energy conservation: der(E) = (prevEnergyFlux - (E + p) * u) / dx
      const ePlusP = dae.addBinaryExpr(BinOp.Add, eVar, pVar);
      const currEnergyFlux = dae.addBinaryExpr(BinOp.Mul, ePlusP, uVar);
      const derE = dae.addDer(eVar);
      const energyDiff = dae.addBinaryExpr(BinOp.Sub, prevEnergyFlux, currEnergyFlux);
      const dEDt = dae.addBinaryExpr(BinOp.Div, energyDiff, dxExpr);
      dae.addEquation(EqKind.Simple, derE, dEDt);

      prevRhou = rhouVar;
      prevMomFlux = currMomFlux;
      prevEnergyFlux = currEnergyFlux;
    }
  }

  return dae;
}
