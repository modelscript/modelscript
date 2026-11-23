// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for NASA TRASYS Thermal Radiation Networks.
 *
 * Translates active radiative surfaces, Gebhart radiation conductors (RADK),
 * and orbital environmental heat loads directly into `@modelscript/runtime`'s
 * linear-memory `DAEBuilder` without allocating intermediate AST wrappers.
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { computeSurfaceArea } from "../cad/index.js";
import { solveTrasysThermal, type TrasysThermalSolution, type ViewFactorOptions } from "../solver/index.js";
import { DEEP_SPACE_TEMP_K, type TrasysDeck } from "../types.js";

export interface TrasysDaeLoweringOptions extends ViewFactorOptions {
  modelName?: string | undefined;
  spaceTempK?: number | undefined;
}

export interface TrasysDaeLoweringResult {
  temperatureVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  solution: TrasysThermalSolution;
}

function sanitizeIdent(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Lowers a parsed TRASYS deck into an existing `IDaeBuilder` linear-memory arena.
 *
 * Emits:
 *   - Global parameters `sigma_SB`, `T_space`
 *   - Per-surface parameters `A_<id>`, `alpha_<id>`, `eps_<id>`, `Q_solar_<id>`, `Q_albedo_<id>`, `Q_ir_<id>`, `Q_total_<id>`, `G_space_<id>`
 *   - Pairwise radiation conductor parameters `G_rad_<i_j>`
 *   - Per-surface continuous temperature variables `T_<id>` initialized to equilibrium temperature
 *   - Radiative heat balance equations:
 *       sum_j G_rad_ij * (T_i^4 - T_j^4) + G_space_i * (T_i^4 - T_space^4) = Q_total_i
 */
export function lowerTrasysToDae(
  builder: IDaeBuilder,
  deck: TrasysDeck,
  options?: TrasysDaeLoweringOptions,
): TrasysDaeLoweringResult {
  const spaceTempK = options?.spaceTempK ?? DEEP_SPACE_TEMP_K;
  const solution = solveTrasysThermal(deck, options);
  const variableMap = new Map<string, number>();
  const temperatureVarIndices: number[] = [];
  let equationCount = 0;

  function addParam(name: string, value: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Parameter, Causality.Local, value);
    variableMap.set(name, idx);
    return idx;
  }

  function addContinuous(name: string, startVal: number): number {
    const idx = builder.addVariable(name, VarType.Real, Variability.Continuous, Causality.Local, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  addParam("sigma_SB", deck.options.stefanBoltzmann);
  const tSpaceVar = addParam("T_space", spaceTempK);

  const activeSurfaces = deck.surfaces.filter((s) => s.active !== "NONE");
  const n = activeSurfaces.length;

  // Emit per-surface variables and parameters
  const tempVars: number[] = [];
  const qTotalVars: number[] = [];
  const gSpaceVars: number[] = [];

  for (let i = 0; i < n; i++) {
    const surf = activeSurfaces[i]!;
    const sid = sanitizeIdent(surf.id);
    const area = computeSurfaceArea(surf);
    const flux = solution.orbital.surfaces[surf.id];
    const tEq = solution.temperaturesK[surf.id] ?? surf.temperatureK ?? 290.0;

    addParam(`A_${sid}`, area);
    addParam(`alpha_${sid}`, surf.prop.alpha);
    addParam(`eps_${sid}`, surf.prop.epsilon);
    addParam(`Q_solar_${sid}`, flux?.qSolarW ?? 0);
    addParam(`Q_albedo_${sid}`, flux?.qAlbedoW ?? 0);
    addParam(`Q_ir_${sid}`, flux?.qPlanetIrW ?? 0);
    const qTot = addParam(`Q_total_${sid}`, flux?.qTotalW ?? 0);
    const gSpace = addParam(`G_space_${sid}`, solution.gebhart.radkSpace[i] ?? 0);

    const tVar = addContinuous(`T_${sid}`, tEq);
    tempVars.push(tVar);
    temperatureVarIndices.push(tVar);
    qTotalVars.push(qTot);
    gSpaceVars.push(gSpace);
  }

  // Emit pairwise radiation conductors
  const gPairVars: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const gij = solution.gebhart.radk[i]?.[j] ?? 0;
      if (gij > 0) {
        const si = sanitizeIdent(activeSurfaces[i]!.id);
        const sj = sanitizeIdent(activeSurfaces[j]!.id);
        gPairVars[i]![j] = addParam(`G_rad_${si}_${sj}`, gij);
      }
    }
  }

  // Helper to build T^4 in arena
  const pow4 = (varIdx: number): number => {
    const vRef = builder.addName(varIdx);
    const four = builder.addRealLiteral(4.0);
    return builder.addBinaryExpr(BinOp.Pow, vRef, four);
  };

  // Emit radiative heat balance equations for each active surface
  for (let i = 0; i < n; i++) {
    const ti4 = pow4(tempVars[i]!);
    const tSpace4 = pow4(tSpaceVar);
    const diffSpace = builder.addBinaryExpr(BinOp.Sub, ti4, tSpace4);
    let lhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(gSpaceVars[i]!), diffSpace);

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const gVar = gPairVars[i]![j] ?? -1;
      if (gVar !== -1) {
        const tj4 = pow4(tempVars[j]!);
        const diff = builder.addBinaryExpr(BinOp.Sub, pow4(tempVars[i]!), tj4);
        const term = builder.addBinaryExpr(BinOp.Mul, builder.addName(gVar), diff);
        lhs = builder.addBinaryExpr(BinOp.Add, lhs, term);
      }
    }

    const rhs = builder.addName(qTotalVars[i]!);
    builder.addEquation(EqKind.Simple, lhs, rhs);
    equationCount++;
  }

  return {
    temperatureVarIndices,
    equationCount,
    variableMap,
    solution,
  };
}

/**
 * Convenience wrapper creating a new `DAEBuilder` and lowering a TRASYS deck into it.
 */
export function trasysToDae(deck: TrasysDeck, options?: TrasysDaeLoweringOptions): DAEBuilder {
  const modelName = sanitizeIdent(options?.modelName || deck.name || "TrasysRadiationModel");
  const builder = new DAEBuilder(undefined, modelName);
  lowerTrasysToDae(builder, deck, options);
  return builder;
}
