// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/optical — Direct Linear-Memory DAE Arena Lowering for Dynamic EDFA Amplifiers.
 *
 * Compiles dynamic Erbium-Doped Fiber Amplifier (EDFA) gain saturation state equations
 * into ModelScript's zero-GC linear memory DAEBuilder:
 *   1. Optical input and output power variables (P_in, P_out)
 *   2. Dynamic saturated gain state variable G
 *   3. Small-signal gain (G_0), saturation power (P_sat), and fluorescence lifetime (tau) parameters
 *   4. Transient gain saturation differential equation:
 *      der(G) = (G_0 - G) / tau - (P_in / (P_sat * tau)) * G * (G - 1)
 *   5. Output conservation equation: P_out = G * P_in
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";

export interface EdfaDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  smallSignalGainDb?: number | undefined; // e.g. 30 dB (linear 1000)
  saturationPowerMilliwatts?: number | undefined; // e.g. 15 mW (0.015 W)
  fluorescenceLifetimeMs?: number | undefined; // tau, e.g. 10 ms (0.01 s)
  nominalInputPowerMilliwatts?: number | undefined; // e.g. 0.1 mW (-10 dBm)
}

export function lowerOpticalEdfaToDae(options?: EdfaDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? "OpticalEdfaDynamic").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const gainDb = options?.smallSignalGainDb ?? 30.0;
  const g0Linear = Math.pow(10, gainDb / 10);
  const pSatWatts = (options?.saturationPowerMilliwatts ?? 15.0) * 1e-3;
  const tauSec = (options?.fluorescenceLifetimeMs ?? 10.0) * 1e-3;
  const pInNominalWatts = (options?.nominalInputPowerMilliwatts ?? 0.1) * 1e-3;

  // 1. Declare Parameters
  const g0Var = dae.addVariable("G_0", VarType.Real, Variability.Parameter, Causality.Local, g0Linear);
  dae.addEquation(EqKind.Simple, dae.addName(g0Var), dae.addRealLiteral(g0Linear));

  const pSatVar = dae.addVariable("P_sat", VarType.Real, Variability.Parameter, Causality.Local, pSatWatts);
  dae.addEquation(EqKind.Simple, dae.addName(pSatVar), dae.addRealLiteral(pSatWatts));

  const tauVar = dae.addVariable("tau", VarType.Real, Variability.Parameter, Causality.Local, tauSec);
  dae.addEquation(EqKind.Simple, dae.addName(tauVar), dae.addRealLiteral(tauSec));

  // 2. Declare Dynamic Variables
  // P_in (input signal power)
  const pInVar = dae.addVariable("P_in", VarType.Real, Variability.Continuous, Causality.Input, pInNominalWatts);

  // G (dynamic optical gain)
  const gVar = dae.addVariable("G", VarType.Real, Variability.Continuous, Causality.Local, g0Linear / 2);

  // P_out (output signal power)
  const pOutVar = dae.addVariable(
    "P_out",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    (g0Linear / 2) * pInNominalWatts,
  );

  // 3. Equation 1: P_out = G * P_in
  const pOutLhs = dae.addName(pOutVar);
  const pOutRhs = dae.addBinaryExpr(BinOp.Mul, dae.addName(gVar), dae.addName(pInVar));
  dae.addEquation(EqKind.Simple, pOutLhs, pOutRhs);

  // 4. Equation 2: der(G) = (G_0 - G) / tau - (P_in / (P_sat * tau)) * G * (G - 1)
  // Term A: (G_0 - G) / tau
  const diffGain = dae.addBinaryExpr(BinOp.Sub, dae.addName(g0Var), dae.addName(gVar));
  const termA = dae.addBinaryExpr(BinOp.Div, diffGain, dae.addName(tauVar));

  // Term B: (P_in / (P_sat * tau)) * G * (G - 1)
  const satScale = dae.addBinaryExpr(BinOp.Mul, dae.addName(pSatVar), dae.addName(tauVar));
  const normInput = dae.addBinaryExpr(BinOp.Div, dae.addName(pInVar), satScale);
  const gMinus1 = dae.addBinaryExpr(BinOp.Sub, dae.addName(gVar), dae.addRealLiteral(1.0));
  const gTimesGminus1 = dae.addBinaryExpr(BinOp.Mul, dae.addName(gVar), gMinus1);
  const termB = dae.addBinaryExpr(BinOp.Mul, normInput, gTimesGminus1);

  const dG_dt_rhs = dae.addBinaryExpr(BinOp.Sub, termA, termB);
  const dG_dt_lhs = dae.addDer(gVar);
  dae.addEquation(EqKind.Simple, dG_dt_lhs, dG_dt_rhs);

  return dae;
}
