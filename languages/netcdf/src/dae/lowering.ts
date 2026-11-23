// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Unidata NetCDF Classic Datasets.
 *
 * Lowers gridded CF-1.x field variables and domain-averaged conservation /
 * relaxation equations directly into `@modelscript/runtime`'s `IDaeBuilder`
 * linear memory representation without allocating intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { computeFieldStats, unpackVariableValues } from "../solver/field-ops.js";
import type { NetcdfDataset } from "../types.js";

export interface NetcdfDaeLoweringResult {
  stateVarIndices: number[];
  parameterVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Lowers a `NetcdfDataset` into `@modelscript/runtime`'s `IDaeBuilder` arena.
 *
 * - Each dimension becomes an Integer parameter `dim_<name>`.
 * - Coordinate variables (1D variables matching a dimension name) become Real parameters (`<name>_min`, `<name>_max`, `<name>_span`).
 * - Field variables become continuous state variables (`<name>_mean`) governed by a first-order field conservation equation:
 *   `der(<name>_mean) = (<name>_ref - <name>_mean) / <name>_tau + <name>_flux`,
 *   plus an algebraic field-range balance equation `<name>_spread = <name>_max - <name>_min`.
 */
export function lowerNetcdfToDae(builder: IDaeBuilder, dataset: NetcdfDataset): NetcdfDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  let equationCount = 0;

  const addVar = (name: string, varType: VarType, variability: Variability, startVal: number): number => {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, varType, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    if (variability === Variability.Parameter) {
      parameterVarIndices.push(idx);
    }
    return idx;
  };

  // 1. Dimensions as Integer parameters
  const dimNames = new Set<string>();
  for (const dim of dataset.dimensions) {
    dimNames.add(dim.name);
    const paramName = `dim_${sanitizeId(dim.name)}`;
    addVar(paramName, VarType.Integer, Variability.Parameter, Math.max(0, dim.size));
  }

  // 2. Variables
  for (const v of dataset.variables) {
    if (v.type === "char") continue;

    const base = sanitizeId(v.name);
    const unpacked = unpackVariableValues(v);
    const stats = computeFieldStats(unpacked);
    const meanVal = Number.isFinite(stats.mean) ? stats.mean : 0.0;
    const minVal = Number.isFinite(stats.min) ? stats.min : 0.0;
    const maxVal = Number.isFinite(stats.max) ? stats.max : 0.0;

    const isCoordVar = v.dimensions.length === 1 && v.dimensions[0] === v.name && dimNames.has(v.name);

    if (isCoordVar) {
      const minIdx = addVar(`${base}_min`, VarType.Real, Variability.Parameter, minVal);
      const maxIdx = addVar(`${base}_max`, VarType.Real, Variability.Parameter, maxVal);
      const spanIdx = addVar(`${base}_span`, VarType.Real, Variability.Continuous, maxVal - minVal);

      // span = max - min
      const lhs = builder.addName(spanIdx);
      const rhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(maxIdx), builder.addName(minIdx));
      builder.addEquation(EqKind.Simple, lhs, rhs);
      equationCount++;
      continue;
    }

    // Field variable: conservation/relaxation ODE on spatial mean + algebraic spread balance
    const stateIdx = addVar(`${base}_mean`, VarType.Real, Variability.Continuous, meanVal);
    stateVarIndices.push(stateIdx);

    const refIdx = addVar(`${base}_ref`, VarType.Real, Variability.Parameter, meanVal);
    const tauIdx = addVar(`${base}_tau`, VarType.Real, Variability.Parameter, 3600.0);
    const fluxIdx = addVar(`${base}_flux`, VarType.Real, Variability.Parameter, 0.0);

    // der(mean) = (ref - mean) / tau + flux
    const derMean = builder.addDer(stateIdx);
    const diffExpr = builder.addBinaryExpr(BinOp.Sub, builder.addName(refIdx), builder.addName(stateIdx));
    const relaxExpr = builder.addBinaryExpr(BinOp.Div, diffExpr, builder.addName(tauIdx));
    const rhsOde = builder.addBinaryExpr(BinOp.Add, relaxExpr, builder.addName(fluxIdx));
    builder.addEquation(EqKind.Simple, derMean, rhsOde);
    equationCount++;

    // Algebraic spread equation: spread = max - min
    const minIdx = addVar(`${base}_min`, VarType.Real, Variability.Parameter, minVal);
    const maxIdx = addVar(`${base}_max`, VarType.Real, Variability.Parameter, maxVal);
    const spreadIdx = addVar(`${base}_spread`, VarType.Real, Variability.Continuous, maxVal - minVal);
    const spreadRhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(maxIdx), builder.addName(minIdx));
    builder.addEquation(EqKind.Simple, builder.addName(spreadIdx), spreadRhs);
    equationCount++;
  }

  return {
    stateVarIndices,
    parameterVarIndices,
    equationCount,
    variableMap,
  };
}
