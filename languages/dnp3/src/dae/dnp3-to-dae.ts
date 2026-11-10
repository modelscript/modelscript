// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for IEEE 1815 / DNP3 SCADA Points.
 *
 * Compiles RTU/PLC telemetry point maps directly into ModelScript's zero-GC
 * DAEBuilder arena for hardware-in-the-loop SCADA co-simulation and digital twin monitoring.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { Dnp3DeviceProfile } from "../types.js";

export interface Dnp3DaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers a Dnp3DeviceProfile directly into a DAEBuilder linear-memory arena.
 */
export function lowerDnp3ToDae(profile: Dnp3DeviceProfile, options?: Dnp3DaeOptions): DAEBuilder {
  const rawName = options?.modelName ?? profile.deviceName ?? profile.id;
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Binary Inputs (discrete telemetry states e.g. breaker status, pump running)
  for (const bi of profile.binaryInputs) {
    const varName = `bi_${bi.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const initialVal = bi.normalState ?? 0;
    dae.addVariable(varName, VarType.Integer, Variability.Discrete, Causality.Output, initialVal);

    const vId = interner.intern(varName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addIntLiteral(initialVal);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  // 3. Binary Outputs (control commands e.g. trip breaker, start pump)
  for (const bo of profile.binaryOutputs) {
    const varName = `bo_${bo.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    dae.addVariable(varName, VarType.Integer, Variability.Discrete, Causality.Input, 0);

    const vId = interner.intern(varName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addIntLiteral(0);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  // 4. Analog Inputs (continuous telemetry e.g. bus voltage, line current, tank level, pipe flow)
  for (const ai of profile.analogInputs) {
    const varName = `ai_${ai.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const initialVal = ai.scalingOffset !== 0 ? ai.scalingOffset : 0.0;
    dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Output, initialVal);

    const vId = interner.intern(varName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addRealLiteral(initialVal);
    dae.addEquation(EqKind.Simple, vExpr, initLit);

    // Deadband parameter
    const dbName = `deadband_${ai.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    dae.addVariable(dbName, VarType.Real, Variability.Parameter, Causality.Local, ai.deadband);
    const dbId = interner.intern(dbName);
    const dbExpr = dae.addExpression(ExprKind.Name, dbId);
    const dbLit = dae.addRealLiteral(ai.deadband);
    dae.addEquation(EqKind.Simple, dbExpr, dbLit);
  }

  // 5. Analog Outputs (continuous setpoints e.g. voltage regulator target, pump VFD speed)
  for (const ao of profile.analogOutputs) {
    const varName = `ao_${ao.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Input, 0.0);

    const vId = interner.intern(varName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addRealLiteral(0.0);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  // 6. Counters (totalized energy kWh, cumulative water m3)
  for (const ctr of profile.counters) {
    const varName = `ctr_${ctr.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    dae.addVariable(varName, VarType.Integer, Variability.Discrete, Causality.Output, 0);

    const vId = interner.intern(varName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addIntLiteral(0);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  return dae;
}
