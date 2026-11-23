// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for WMO BUFR Meteorological Observations & Soundings.
 *
 * Lowers atmospheric thermodynamic state equations directly into `@modelscript/runtime`'s
 * linear-memory `IDaeBuilder`:
 *   - Ideal gas law:          rho = P / (R_d * T_v)
 *   - Hydrostatic balance:    der(P) = -rho * g0 * w_ascent
 *   - Potential temperature:  theta = T * (P0 / P)^kappa
 *   - Wind vector components: u = -V * sin(dir), v = -V * cos(dir)
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInBufrLibraryRegistered } from "../catalog/library-package-adapter.js";
import { G0, KAPPA, R_DRY, solveBufrMeteorology } from "../solver/meteo-qa.js";
import type { BufrMessage } from "../types.js";

export interface BufrDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

/**
 * Lowers a parsed `BufrMessage` directly into an existing `IDaeBuilder` arena.
 */
export function lowerBufrToDae(builder: IDaeBuilder, message: BufrMessage): BufrDaeLoweringResult {
  ensureBuiltInBufrLibraryRegistered();
  const solution = solveBufrMeteorology(message);
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(name: string, variability: Variability, startVal: number): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Global physical constants as DAE parameters
  const g0Param = addVar("g0", Variability.Parameter, G0);
  const rdParam = addVar("R_d", Variability.Parameter, R_DRY);
  const pRefParam = addVar("P_ref", Variability.Parameter, 100000.0);
  const kappaParam = addVar("kappa", Variability.Parameter, KAPPA);

  // Lower each station observation or sounding level
  if (solution.soundingLevels.length > 0) {
    for (let i = 0; i < solution.soundingLevels.length; i++) {
      const lv = solution.soundingLevels[i]!;
      const prefix = `level_${i}`;

      const pVar = addVar(`${prefix}_P`, Variability.Continuous, lv.pressurePa);
      const tVar = addVar(`${prefix}_T`, Variability.Parameter, lv.temperatureK);
      const tvVar = addVar(`${prefix}_Tv`, Variability.Parameter, lv.virtualTemperatureK);
      const rhoVar = addVar(`${prefix}_rho`, Variability.Continuous, lv.pressurePa / (R_DRY * lv.virtualTemperatureK));
      const thetaVar = addVar(`${prefix}_theta`, Variability.Continuous, lv.potentialTemperatureK);
      const zVar = addVar(`${prefix}_z`, Variability.Continuous, lv.altitudeM);
      stateVarIndices.push(pVar, zVar);

      // Equation 1: Ideal gas law: rho * (R_d * Tv) = P
      const rdTv = builder.addBinaryExpr(BinOp.Mul, builder.addName(rdParam), builder.addName(tvVar));
      const rhoRdTv = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), rdTv);
      builder.addEquation(EqKind.Simple, rhoRdTv, builder.addName(pVar));
      equationCount++;

      // Equation 2: Potential temperature: theta = T * (P_ref / P)^kappa
      const pRatio = builder.addBinaryExpr(BinOp.Div, builder.addName(pRefParam), builder.addName(pVar));
      const pPow = builder.addBinaryExpr(BinOp.Pow, pRatio, builder.addName(kappaParam));
      const thetaRhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(tVar), pPow);
      builder.addEquation(EqKind.Simple, builder.addName(thetaVar), thetaRhs);
      equationCount++;

      // Equation 3: Hydrostatic differential balance along balloon ascent (w_ascent = 5 m/s)
      const wAscent = addVar(`${prefix}_w_ascent`, Variability.Parameter, 5.0);
      const derZ = builder.addDer(zVar);
      builder.addEquation(EqKind.Simple, derZ, builder.addName(wAscent));
      equationCount++;

      const derP = builder.addDer(pVar);
      const rhoG = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), builder.addName(g0Param));
      const rhoGW = builder.addBinaryExpr(BinOp.Mul, rhoG, builder.addName(wAscent));
      const negRhoGW = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(0.0), rhoGW);
      builder.addEquation(EqKind.Simple, derP, negRhoGW);
      equationCount++;

      // Optional wind u/v decomposition
      if (lv.windDirectionDeg !== undefined && lv.windSpeedMs !== undefined) {
        const rad = (lv.windDirectionDeg * Math.PI) / 180;
        const uVal = -lv.windSpeedMs * Math.sin(rad);
        const vVal = -lv.windSpeedMs * Math.cos(rad);
        const uVar = addVar(`${prefix}_u`, Variability.Continuous, uVal);
        const vVar = addVar(`${prefix}_v`, Variability.Continuous, vVal);
        builder.addEquation(EqKind.Simple, builder.addName(uVar), builder.addRealLiteral(uVal));
        builder.addEquation(EqKind.Simple, builder.addName(vVar), builder.addRealLiteral(vVal));
        equationCount += 2;
      }
    }
  } else {
    // Surface station lowering
    for (let i = 0; i < solution.stations.length; i++) {
      const st = solution.stations[i]!;
      const prefix = `stn_${i}`;
      const pVal = st.surfacePressurePa ?? st.seaLevelPressurePa ?? 101325.0;
      const tVal = st.temperatureK ?? 288.15;
      const rhoVal = pVal / (R_DRY * tVal);

      const pVar = addVar(`${prefix}_P`, Variability.Continuous, pVal);
      const tVar = addVar(`${prefix}_T`, Variability.Parameter, tVal);
      const rhoVar = addVar(`${prefix}_rho`, Variability.Continuous, rhoVal);
      stateVarIndices.push(pVar);

      // Ideal gas law: rho * R_d * T = P
      const rdT = builder.addBinaryExpr(BinOp.Mul, builder.addName(rdParam), builder.addName(tVar));
      const lhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(rhoVar), rdT);
      builder.addEquation(EqKind.Simple, lhs, builder.addName(pVar));
      equationCount++;
    }
  }

  return { stateVarIndices, equationCount, variableMap };
}

/**
 * High-level wrapper that allocates a fresh `DAEBuilder` and lowers a `BufrMessage` into it.
 */
export function bufrToDae(message: BufrMessage): {
  builder: DAEBuilder;
  result: BufrDaeLoweringResult;
} {
  const builder = new DAEBuilder(message.name || "BUFR_ATMOSPHERE");
  const result = lowerBufrToDae(builder, message);
  return { builder, result };
}
