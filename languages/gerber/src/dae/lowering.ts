// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Gerber PCB Copper Traces & Planes.
 *
 * Lowers copper trace DC resistance (IPC-2221 / IEC 60028 annealed copper resistivity)
 * and parallel-plate trace-to-reference-plane capacitance directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory representation.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { lowerGerberToGeometry } from "../cad/geometry.js";
import { ensureBuiltInGerberLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { GerberDocument, GerberGeometry } from "../types.js";

/** IEC 60028 standard annealed copper resistivity at 20 C (Ohm * m). */
export const COPPER_RESISTIVITY_20C_OHM_M = 1.7241e-8;
/** Copper temperature coefficient of resistance (1 / K). */
export const COPPER_TEMP_COEFF_PER_K = 0.00393;
/** Vacuum permittivity eps_0 (F / m). */
export const EPSILON_0_F_PER_M = 8.854187817e-12;
/** Nominal 1 oz/ft^2 copper foil thickness (m). */
export const COPPER_1OZ_THICKNESS_M = 34.8e-6;

export interface GerberDaeOptions {
  /** Copper foil thickness in micrometers (default: 34.8 um = 1 oz/ft^2). */
  copperThicknessUm?: number | undefined;
  /** Ambient / operating copper temperature in deg C (default: 20 C). */
  temperatureC?: number | undefined;
  /** Dielectric relative permittivity eps_r (default: 4.4 for FR-4). */
  relativePermittivity?: number | undefined;
  /** Dielectric distance to reference plane in mm (default: 1.6 mm). */
  dielectricThicknessMm?: number | undefined;
}

export interface GerberTraceElectricalMetrics {
  index: number;
  lengthMm: number;
  widthMm: number;
  resistanceOhm: number;
  capacitancePf: number;
}

export interface GerberDaeLoweringResult {
  geometry: GerberGeometry;
  variableMap: Map<string, number>;
  equationCount: number;
  /** Equivalent series resistance of all dark copper traces (Ohms). */
  totalTraceResistanceOhm: number;
  /** Total parallel-plate capacitance of copper layer to reference plane (Farads). */
  totalCapacitanceF: number;
  /** RC time constant R_total * C_total (seconds). */
  rcTimeConstantS: number;
  traces: GerberTraceElectricalMetrics[];
}

/**
 * Computes analytical copper trace resistance (Ohms) at temperature `tempC`:
 *   R(T) = rho_20 * (1 + alpha * (T - 20)) * L / (W * t_Cu)
 */
export function computeTraceResistanceOhm(
  lengthMm: number,
  widthMm: number,
  copperThicknessUm: number = 34.8,
  temperatureC: number = 20.0,
): number {
  if (lengthMm <= 0 || widthMm <= 0 || copperThicknessUm <= 0) return 0;
  const rho = COPPER_RESISTIVITY_20C_OHM_M * (1 + COPPER_TEMP_COEFF_PER_K * (temperatureC - 20.0));
  const lM = lengthMm * 1e-3;
  const wM = widthMm * 1e-3;
  const tM = copperThicknessUm * 1e-6;
  return (rho * lM) / (wM * tM);
}

/**
 * Computes parallel-plate capacitance (Farads) of copper area `areaMm2` over a dielectric
 * of thickness `dielectricThicknessMm` and relative permittivity `epsR`:
 *   C = eps_0 * eps_r * A / h
 */
export function computeCopperCapacitanceF(
  areaMm2: number,
  dielectricThicknessMm: number = 1.6,
  epsR: number = 4.4,
): number {
  if (areaMm2 <= 0 || dielectricThicknessMm <= 0 || epsR <= 0) return 0;
  const areaM2 = areaMm2 * 1e-6;
  const hM = dielectricThicknessMm * 1e-3;
  return (EPSILON_0_F_PER_M * epsR * areaM2) / hM;
}

/**
 * Lowers a `GerberDocument` into `@modelscript/runtime`'s `IDaeBuilder` linear memory DAE arena,
 * emitting copper trace resistance and layer capacitance parameters, variables, and algebraic equations.
 */
export function lowerGerberToDae(
  builder: IDaeBuilder,
  doc: GerberDocument,
  options: GerberDaeOptions = {},
): GerberDaeLoweringResult {
  ensureBuiltInGerberLibraryRegistered();

  const copperThicknessUm = options.copperThicknessUm ?? 34.8;
  const temperatureC = options.temperatureC ?? 20.0;
  const epsR = options.relativePermittivity ?? 4.4;
  const dielectricThicknessMm = options.dielectricThicknessMm ?? 1.6;

  const geometry = lowerGerberToGeometry(doc);
  const variableMap = new Map<string, number>();
  let equationCount = 0;

  const addVar = (name: string, variability: Variability, startVal: number): number => {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    return idx;
  };

  // Global physical parameters
  const rhoEff = COPPER_RESISTIVITY_20C_OHM_M * (1 + COPPER_TEMP_COEFF_PER_K * (temperatureC - 20.0));
  const tCuM = copperThicknessUm * 1e-6;
  const hDielM = dielectricThicknessMm * 1e-3;

  const pRho = addVar("rho_cu", Variability.Parameter, rhoEff);
  const pTCu = addVar("t_cu", Variability.Parameter, tCuM);
  const pEps0 = addVar("eps_0", Variability.Parameter, EPSILON_0_F_PER_M);
  const pEpsR = addVar("eps_r", Variability.Parameter, epsR);
  const pHDiel = addVar("h_diel", Variability.Parameter, hDielM);
  const pArea = addVar("A_copper_m2", Variability.Parameter, geometry.copperAreaMm2 * 1e-6);

  const traces: GerberTraceElectricalMetrics[] = [];
  let totalTraceResistanceOhm = 0;
  const traceRVars: number[] = [];

  // Per-trace resistance equations: R_trace_k = (rho_cu * L_k) / (W_k * t_cu)
  let traceIdx = 0;
  for (const stroke of geometry.strokes) {
    if (stroke.polarity !== "D" || stroke.lengthMm <= 0 || stroke.widthMm <= 0) continue;
    const rOhm = computeTraceResistanceOhm(stroke.lengthMm, stroke.widthMm, copperThicknessUm, temperatureC);
    const cF = computeCopperCapacitanceF(stroke.areaMm2, dielectricThicknessMm, epsR);
    totalTraceResistanceOhm += rOhm;

    traces.push({
      index: traceIdx,
      lengthMm: stroke.lengthMm,
      widthMm: stroke.widthMm,
      resistanceOhm: rOhm,
      capacitancePf: cF * 1e12,
    });

    const pLen = addVar(`trace_${traceIdx}_L_m`, Variability.Parameter, stroke.lengthMm * 1e-3);
    const pWid = addVar(`trace_${traceIdx}_W_m`, Variability.Parameter, stroke.widthMm * 1e-3);
    const vR = addVar(`trace_${traceIdx}_R_ohm`, Variability.Continuous, rOhm);
    traceRVars.push(vR);

    const numExpr = builder.addBinaryExpr(BinOp.Mul, builder.addName(pRho), builder.addName(pLen));
    const denExpr = builder.addBinaryExpr(BinOp.Mul, builder.addName(pWid), builder.addName(pTCu));
    const rhsExpr = builder.addBinaryExpr(BinOp.Div, numExpr, denExpr);
    builder.addEquation(EqKind.Simple, builder.addName(vR), rhsExpr);
    equationCount++;
    traceIdx++;
  }

  // Aggregate total trace resistance: R_total = sum(trace_k_R_ohm)
  const vRTotal = addVar("R_total_ohm", Variability.Continuous, totalTraceResistanceOhm);
  if (traceRVars.length === 0) {
    builder.addEquation(EqKind.Simple, builder.addName(vRTotal), builder.addRealLiteral(0.0));
  } else {
    let sumExpr = builder.addName(traceRVars[0]!);
    for (let i = 1; i < traceRVars.length; i++) {
      sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, builder.addName(traceRVars[i]!));
    }
    builder.addEquation(EqKind.Simple, builder.addName(vRTotal), sumExpr);
  }
  equationCount++;

  // Layer capacitance equation: C_total = (eps_0 * eps_r * A_copper_m2) / h_diel
  const totalCapacitanceF = computeCopperCapacitanceF(geometry.copperAreaMm2, dielectricThicknessMm, epsR);
  const vCTotal = addVar("C_total_F", Variability.Continuous, totalCapacitanceF);
  const cNum = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addBinaryExpr(BinOp.Mul, builder.addName(pEps0), builder.addName(pEpsR)),
    builder.addName(pArea),
  );
  const cRhs = builder.addBinaryExpr(BinOp.Div, cNum, builder.addName(pHDiel));
  builder.addEquation(EqKind.Simple, builder.addName(vCTotal), cRhs);
  equationCount++;

  // RC time constant equation: tau_RC = R_total * C_total
  const rcTimeConstantS = totalTraceResistanceOhm * totalCapacitanceF;
  const vTau = addVar("tau_RC_s", Variability.Continuous, rcTimeConstantS);
  const tauRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(vRTotal), builder.addName(vCTotal));
  builder.addEquation(EqKind.Simple, builder.addName(vTau), tauRhs);
  equationCount++;

  return {
    geometry,
    variableMap,
    equationCount,
    totalTraceResistanceOhm,
    totalCapacitanceF,
    rcTimeConstantS,
    traces,
  };
}
