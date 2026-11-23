// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for `@modelscript/segy`.
 *
 * Lowers a 1D acoustic wave propagation and convolutional seismic reflection model
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation
 * without allocating intermediate AST wrapper objects.
 *
 * Physics lowered:
 * - Per-layer acoustic impedance Z_i = rho_i * v_i
 * - Interface reflection coefficients R_i = (Z_{i+1} - Z_i) / (Z_{i+1} + Z_i)
 * - Semi-discretized 1D acoustic wave PDE (staggered pressure p_k / particle velocity u_k):
 *     der(p_k) = -K_k * (u_k - u_{k-1}) / dz_k
 *     der(u_k) = -(1 / rho_k) * (p_{k+1} - p_k) / dz_k
 * - Convolutional synthetic trace readout combining interface reflectivities with surface pressure.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInSegyLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { SegyAcousticLayer, SegyAcousticModel, SegyFile } from "../types.js";

export interface SegyDaeLoweringResult {
  stateVarIndices: number[];
  parameterVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  impedances: number[];
  reflectionCoefficients: number[];
}

function isSegyFile(input: SegyAcousticModel | SegyFile): input is SegyFile {
  return "binaryHeader" in input && "traces" in input;
}

/**
 * Builds a default 3-layer acoustic earth model from a decoded `SegyFile` metadata.
 */
export function buildAcousticModelFromSegy(file: SegyFile): SegyAcousticModel {
  const dtSec = (file.binaryHeader.sampleIntervalUs || 2000) * 1e-6;
  const name = file.textualHeader.line ?? `SEGY_JOB_${file.binaryHeader.jobId}`;
  return {
    name,
    dominantFreqHz: 30.0,
    dtSec,
    cellsPerLayer: 1,
    layers: [
      { name: "overburden", thicknessM: 300, velocityMps: 2000, densityKgM3: 2100 },
      { name: "reservoir", thicknessM: 120, velocityMps: 2800, densityKgM3: 2350 },
      { name: "basement", thicknessM: 500, velocityMps: 4200, densityKgM3: 2650 },
    ],
  };
}

/**
 * Lowers a 1D acoustic wave & convolutional reflection model directly into `IDaeBuilder`.
 */
export function lowerSegyToDae(builder: IDaeBuilder, input: SegyAcousticModel | SegyFile): SegyDaeLoweringResult {
  ensureBuiltInSegyLibraryRegistered();

  const model: SegyAcousticModel = isSegyFile(input) ? buildAcousticModelFromSegy(input) : input;
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  let equationCount = 0;

  const addVar = (name: string, variability: Variability, causality: Causality, startVal: number): number => {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    if (variability === Variability.Parameter) {
      parameterVarIndices.push(idx);
    }
    return idx;
  };

  // Global source parameters
  addVar("f0_Hz", Variability.Parameter, Causality.Local, model.dominantFreqHz);
  addVar("dt_s", Variability.Parameter, Causality.Local, model.dtSec);

  const layers: SegyAcousticLayer[] =
    model.layers.length > 0
      ? model.layers
      : [{ name: "halfspace", thicknessM: 500, velocityMps: 2500, densityKgM3: 2200 }];

  const impedances: number[] = [];
  const reflectionCoefficients: number[] = [];

  // 1. Layer acoustic impedance parameters & equations: Z_i = rho_i * v_i
  const zVars: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    const zVal = layer.densityKgM3 * layer.velocityMps;
    impedances.push(zVal);

    const vVar = addVar(`v_${i}`, Variability.Parameter, Causality.Local, layer.velocityMps);
    const rhoVar = addVar(`rho_${i}`, Variability.Parameter, Causality.Local, layer.densityKgM3);
    const zVar = addVar(`Z_${i}`, Variability.Continuous, Causality.Local, zVal);
    zVars.push(zVar);

    const zRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), builder.addName(vVar));
    builder.addEquation(EqKind.Simple, builder.addName(zVar), zRhs);
    equationCount++;
  }

  // 2. Interface reflection coefficients: R_i = (Z_{i+1} - Z_i) / (Z_{i+1} + Z_i)
  const rVars: number[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const z0 = impedances[i]!;
    const z1 = impedances[i + 1]!;
    const rc = (z1 - z0) / Math.max(1e-9, z1 + z0);
    reflectionCoefficients.push(rc);

    const rVar = addVar(`R_${i}`, Variability.Continuous, Causality.Local, rc);
    rVars.push(rVar);

    const num = builder.addBinaryExpr(BinOp.Sub, builder.addName(zVars[i + 1]!), builder.addName(zVars[i]!));
    const den = builder.addBinaryExpr(BinOp.Add, builder.addName(zVars[i + 1]!), builder.addName(zVars[i]!));
    const rhs = builder.addBinaryExpr(BinOp.Div, num, den);
    builder.addEquation(EqKind.Simple, builder.addName(rVar), rhs);
    equationCount++;
  }

  // 3. Semi-discretized 1D acoustic wave propagation (staggered pressure p_k and velocity u_k)
  const cellsPerLayer = Math.max(1, model.cellsPerLayer ?? 1);
  const pVars: number[] = [];
  const uVars: number[] = [];
  const cellBulkModulus: number[] = [];
  const cellRho: number[] = [];
  const cellDz: number[] = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    const dz = Math.max(1.0, layer.thicknessM / cellsPerLayer);
    const bulkK = layer.densityKgM3 * layer.velocityMps * layer.velocityMps;
    for (let c = 0; c < cellsPerLayer; c++) {
      const k = pVars.length;
      const pVar = addVar(`p_${k}`, Variability.Continuous, Causality.Local, k === 0 ? 1.0 : 0.0);
      const uVar = addVar(`u_${k}`, Variability.Continuous, Causality.Local, 0.0);
      pVars.push(pVar);
      uVars.push(uVar);
      stateVarIndices.push(pVar, uVar);
      cellBulkModulus.push(bulkK);
      cellRho.push(layer.densityKgM3);
      cellDz.push(dz);
    }
  }

  const nCells = pVars.length;
  for (let k = 0; k < nCells; k++) {
    const bulkOverDz = cellBulkModulus[k]! / cellDz[k]!;
    const invRhoDz = 1.0 / (cellRho[k]! * cellDz[k]!);

    // der(p_k) = -(K_k / dz_k) * (u_k - u_{k-1})
    const uDiff =
      k === 0
        ? builder.addName(uVars[0]!)
        : builder.addBinaryExpr(BinOp.Sub, builder.addName(uVars[k]!), builder.addName(uVars[k - 1]!));
    const derP = builder.addDer(pVars[k]!);
    const rhsP = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(-bulkOverDz), uDiff);
    builder.addEquation(EqKind.Simple, derP, rhsP);
    equationCount++;

    // der(u_k) = -(1 / (rho_k * dz_k)) * (p_{k+1} - p_k)
    const pDiff =
      k === nCells - 1
        ? builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), builder.addName(pVars[k]!))
        : builder.addBinaryExpr(BinOp.Sub, builder.addName(pVars[k + 1]!), builder.addName(pVars[k]!));
    const derU = builder.addDer(uVars[k]!);
    const rhsU = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(-invRhoDz), pDiff);
    builder.addEquation(EqKind.Simple, derU, rhsU);
    equationCount++;
  }

  // 4. Convolutional synthetic seismic trace output: s_synth = p_0 + sum(R_i * p_{i+1})
  const synthVar = addVar("seismic_trace", Variability.Continuous, Causality.Output, 0.0);
  let synthExpr = builder.addName(pVars[0]!);
  for (let i = 0; i < rVars.length; i++) {
    const cellIdx = Math.min(nCells - 1, (i + 1) * cellsPerLayer);
    const term = builder.addBinaryExpr(BinOp.Mul, builder.addName(rVars[i]!), builder.addName(pVars[cellIdx]!));
    synthExpr = builder.addBinaryExpr(BinOp.Add, synthExpr, term);
  }
  builder.addEquation(EqKind.Simple, builder.addName(synthVar), synthExpr);
  equationCount++;

  return {
    stateVarIndices,
    parameterVarIndices,
    equationCount,
    variableMap,
    impedances,
    reflectionCoefficients,
  };
}
