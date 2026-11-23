// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for USGS DEM Overland Runoff (Manning Kinematic-Wave Equations).
 *
 * Translates watershed topographic properties (mean slope, overland flow path length,
 * drainage area) into continuous Manning kinematic-wave sheet-flow ODEs directly in
 * `@modelscript/runtime`'s linear-memory `IDaeBuilder`:
 *
 *   i_eff = rainfall_intensity - infiltration_rate
 *   alpha = sqrt(S_mean) / n_manning
 *   q_unit = alpha * h^(5/3)
 *   der(h) = i_eff - q_unit / L_flow
 *   Q_out = q_unit * (A_basin / L_flow)
 *   der(V_runoff) = Q_out
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { computeD8Flow, computeTerrainGridMetrics } from "../solver/index.js";
import type { UsgsDemModel } from "../types.js";

export interface UsgsDemDaeOptions {
  modelName?: string | undefined;
  /** Manning roughness coefficient n (s / m^(1/3)), default 0.035 (natural hillslope). */
  manningN?: number | undefined;
  /** Constant rainfall intensity (m/s), default 1.3889e-5 (50 mm/hr). */
  rainfallIntensity?: number | undefined;
  /** Constant infiltration loss rate (m/s), default 2.7778e-6 (10 mm/hr). */
  infiltrationRate?: number | undefined;
  /** Initial overland sheet-flow water depth (m), default 1e-4. */
  initialDepth?: number | undefined;
}

export interface UsgsDemDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  basinAreaM2: number;
  meanSlope: number;
  flowLengthM: number;
}

export function lowerUsgsDemToDae(
  builder: IDaeBuilder,
  model: UsgsDemModel,
  options: UsgsDemDaeOptions = {},
): UsgsDemDaeLoweringResult {
  const { grid } = model;
  const metrics = computeTerrainGridMetrics(grid);
  const d8 = computeD8Flow(grid);

  const cellArea = Math.max(1e-6, grid.dx * grid.dy);
  const totalCells = Math.max(1, grid.numCols * grid.numRows);
  const basinAreaM2 = cellArea * totalCells;
  const meanSlope = Math.max(1e-4, Math.tan((metrics.meanSlopeDeg * Math.PI) / 180));
  const flowLengthM = Math.max(grid.dx, Math.sqrt(d8.maxAccumulation) * Math.hypot(grid.dx, grid.dy) * 0.5);

  const manningN = Math.max(1e-4, options.manningN ?? 0.035);
  const rainfallIntensity = options.rainfallIntensity ?? 50 / (1000 * 3600);
  const infiltrationRate = options.infiltrationRate ?? 10 / (1000 * 3600);
  const initialDepth = Math.max(0, options.initialDepth ?? 1e-4);

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  const addVar = (
    name: string,
    variability: Variability,
    startVal: number,
    causality: Causality = Causality.Local,
  ): number => {
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  };

  // Parameters
  const pManningN = addVar("manning_n", Variability.Parameter, manningN);
  const pSlope = addVar("slope_mean", Variability.Parameter, meanSlope);
  const pLength = addVar("flow_length", Variability.Parameter, flowLengthM);
  const pArea = addVar("basin_area", Variability.Parameter, basinAreaM2);
  const pRain = addVar("rainfall_intensity", Variability.Parameter, rainfallIntensity);
  const pInfil = addVar("infiltration_rate", Variability.Parameter, infiltrationRate);

  // Continuous states & algebraic variables
  const vIEff = addVar("i_eff", Variability.Continuous, Math.max(0, rainfallIntensity - infiltrationRate));
  const vAlpha = addVar("kinematic_alpha", Variability.Continuous, Math.sqrt(meanSlope) / manningN);
  const vH = addVar("h_depth", Variability.Continuous, initialDepth);
  const vQUnit = addVar("q_unit", Variability.Continuous, 0.0);
  const vQOut = addVar("Q_out", Variability.Continuous, 0.0, Causality.Output);
  const vVRunoff = addVar("V_runoff", Variability.Continuous, 0.0, Causality.Output);

  stateVarIndices.push(vH, vVRunoff);

  // 1. i_eff = rainfall_intensity - infiltration_rate
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vIEff),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(pRain), builder.addName(pInfil)),
  );
  equationCount++;

  // 2. kinematic_alpha = (slope_mean ^ 0.5) / manning_n
  const sqrtSlope = builder.addBinaryExpr(BinOp.Pow, builder.addName(pSlope), builder.addRealLiteral(0.5));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vAlpha),
    builder.addBinaryExpr(BinOp.Div, sqrtSlope, builder.addName(pManningN)),
  );
  equationCount++;

  // 3. q_unit = kinematic_alpha * (h_depth ^ (5/3))
  const hPow = builder.addBinaryExpr(BinOp.Pow, builder.addName(vH), builder.addRealLiteral(5 / 3));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vQUnit),
    builder.addBinaryExpr(BinOp.Mul, builder.addName(vAlpha), hPow),
  );
  equationCount++;

  // 4. der(h_depth) = i_eff - q_unit / flow_length
  const outflowRate = builder.addBinaryExpr(BinOp.Div, builder.addName(vQUnit), builder.addName(pLength));
  builder.addEquation(
    EqKind.Simple,
    builder.addDer(vH),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vIEff), outflowRate),
  );
  equationCount++;

  // 5. Q_out = q_unit * (basin_area / flow_length)
  const effectiveWidth = builder.addBinaryExpr(BinOp.Div, builder.addName(pArea), builder.addName(pLength));
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vQOut),
    builder.addBinaryExpr(BinOp.Mul, builder.addName(vQUnit), effectiveWidth),
  );
  equationCount++;

  // 6. der(V_runoff) = Q_out
  builder.addEquation(EqKind.Simple, builder.addDer(vVRunoff), builder.addName(vQOut));
  equationCount++;

  return {
    stateVarIndices,
    equationCount,
    variableMap,
    basinAreaM2,
    meanSlope,
    flowLengthM,
  };
}

/**
 * High-level wrapper that allocates a `DAEBuilder` and lowers a `UsgsDemModel` into it.
 */
export function usgsDemToDae(model: UsgsDemModel, options: UsgsDemDaeOptions = {}): DAEBuilder {
  const modelName = (options.modelName || model.header.quadrangleName || "UsgsDemRunoff").replace(
    /[^A-Za-z0-9_]/g,
    "_",
  );
  const builder = new DAEBuilder(undefined, modelName);
  lowerUsgsDemToDae(builder, model, options);
  return builder;
}
