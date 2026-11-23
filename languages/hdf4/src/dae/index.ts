// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { computeSdsStatistics } from "../solver/index.js";
import type { Hdf4Document } from "../types.js";

export interface Hdf4DaeLoweringResult {
  variableCount: number;
  equationCount: number;
  datasetCount: number;
}

export interface Hdf4ToDaeOptions {
  modelName?: string | undefined;
}

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `sds_${cleaned}` : cleaned || "sds";
}

/**
 * Lowers an HDF4 scientific dataset container into a linear-memory `IDaeBuilder`:
 * - Emits parameters for each SDS's declared element count, raw_mean, min, max, std, scale_factor, add_offset
 * - Emits continuous algebraic variables for each SDS's calibrated_mean, dynamic_range, and integral_sum
 * - Emits conservation/balance equations tying calibrated mean, range, and global container integral
 */
export function lowerHdf4ToDae(builder: IDaeBuilder, doc: Hdf4Document): Hdf4DaeLoweringResult {
  let variableCount = 0;
  let equationCount = 0;

  const totalEnergyTerms: number[] = [];

  for (const sds of doc.sdsList) {
    const base = sanitizeIdent(sds.name);
    const stats = computeSdsStatistics(sds.data);
    const scale = sds.scaleFactor ?? 1.0;
    const offset = sds.addOffset ?? 0.0;

    // Parameters
    const pCount = builder.addVariable(
      `${base}.count`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      stats.validCount,
    );
    variableCount++;

    const pRawMean = builder.addVariable(
      `${base}.raw_mean`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      stats.mean,
    );
    variableCount++;

    const pMin = builder.addVariable(`${base}.min`, VarType.Real, Variability.Parameter, Causality.Local, stats.min);
    variableCount++;

    const pMax = builder.addVariable(`${base}.max`, VarType.Real, Variability.Parameter, Causality.Local, stats.max);
    variableCount++;

    builder.addVariable(`${base}.std`, VarType.Real, Variability.Parameter, Causality.Local, stats.std);
    variableCount++;

    const pScale = builder.addVariable(
      `${base}.scale_factor`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      scale,
    );
    variableCount++;

    const pOffset = builder.addVariable(
      `${base}.add_offset`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      offset,
    );
    variableCount++;

    // Continuous algebraic variables
    const calMeanVal = scale * stats.mean + offset;
    const vCalMean = builder.addVariable(
      `${base}.calibrated_mean`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      calMeanVal,
    );
    variableCount++;

    const vRange = builder.addVariable(
      `${base}.dynamic_range`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      stats.max - stats.min,
    );
    variableCount++;

    const vIntegral = builder.addVariable(
      `${base}.integral_sum`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      calMeanVal * stats.validCount,
    );
    variableCount++;

    // Equation 1: calibrated_mean = scale_factor * raw_mean + add_offset
    const eqCalRhs = builder.addBinaryExpr(
      BinOp.Add,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(pScale), builder.addName(pRawMean)),
      builder.addName(pOffset),
    );
    builder.addEquation(EqKind.Simple, builder.addName(vCalMean), eqCalRhs);
    equationCount++;

    // Equation 2: dynamic_range = max - min
    const eqRangeRhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(pMax), builder.addName(pMin));
    builder.addEquation(EqKind.Simple, builder.addName(vRange), eqRangeRhs);
    equationCount++;

    // Equation 3: integral_sum = calibrated_mean * count
    const eqIntRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(vCalMean), builder.addName(pCount));
    builder.addEquation(EqKind.Simple, builder.addName(vIntegral), eqIntRhs);
    equationCount++;

    totalEnergyTerms.push(vIntegral);
  }

  // Global container balance equation: container.total_integral = sum(sds.integral_sum)
  if (totalEnergyTerms.length > 0) {
    const vTotal = builder.addVariable(
      "container.total_integral",
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    variableCount++;
    let sumExpr = builder.addName(totalEnergyTerms[0] ?? 0);
    for (let i = 1; i < totalEnergyTerms.length; i++) {
      sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, builder.addName(totalEnergyTerms[i] ?? 0));
    }
    builder.addEquation(EqKind.Simple, builder.addName(vTotal), sumExpr);
    equationCount++;
  }

  return {
    variableCount,
    equationCount,
    datasetCount: doc.sdsList.length,
  };
}

/**
 * High-level wrapper creating a `DAEBuilder` arena from an `Hdf4Document`.
 */
export function hdf4ToDae(doc: Hdf4Document, options?: Hdf4ToDaeOptions): DAEBuilder {
  const modelName = sanitizeIdent(options?.modelName || doc.name || "Hdf4Container");
  const builder = new DAEBuilder(undefined, modelName);
  lowerHdf4ToDae(builder, doc);
  return builder;
}
