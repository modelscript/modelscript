// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for COMTRADE Fault Records.
 *
 * Compiles analog waveform channels into ModelScript's zero-GC DAEBuilder arena
 * for automated fault playback, dynamic model validation, and hardware-in-the-loop replay.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { ComtradeRecord } from "../types.js";

export interface ComtradeDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers a ComtradeRecord directly into a DAEBuilder arena.
 */
export function lowerComtradeToDae(record: ComtradeRecord, options?: ComtradeDaeOptions): DAEBuilder {
  const cfg = record.config ?? record.cfg;
  const station = cfg?.stationName ?? "COMTRADE_Playback";
  const modelName = (options?.modelName ?? station).replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  const analogs = cfg?.analogChannels ?? cfg?.analogs ?? [];
  const digitals = cfg?.digitalChannels ?? cfg?.digitals ?? [];

  // 2. Declare continuous variables and playback equations for each analog channel
  for (let i = 0; i < analogs.length; i++) {
    const ch = analogs[i]!;
    const rawName = ch.name ?? ch.chId ?? `A_${i + 1}`;
    const safeName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");

    let initialVal = 0.0;
    if (record.analogData instanceof Map) {
      const arr = record.analogData.get(rawName);
      initialVal = arr && arr.length > 0 ? arr[0]! : 0.0;
    } else if (Array.isArray(record.analogData)) {
      const arr = record.analogData[i];
      initialVal = arr && arr.length > 0 ? arr[0]! : 0.0;
    }

    dae.addVariable(safeName, VarType.Real, Variability.Continuous, Causality.Output, initialVal);

    // Equation: safeName = initialVal
    const chId = interner.intern(safeName);
    const chExpr = dae.addExpression(ExprKind.Name, chId);
    const initLit = dae.addRealLiteral(initialVal);
    dae.addEquation(EqKind.Simple, chExpr, initLit);
  }

  // 3. Declare discrete variables and playback equations for each digital channel
  for (let i = 0; i < digitals.length; i++) {
    const ch = digitals[i]!;
    const rawName = ch.name ?? ch.chId ?? `D_${i + 1}`;
    const safeName = `d_${rawName.replace(/[^a-zA-Z0-9_]/g, "_")}`;

    let initialVal = 0;
    if (record.digitalData instanceof Map) {
      const arr = record.digitalData.get(rawName);
      initialVal = arr && arr.length > 0 ? (arr[0]! ? 1 : 0) : 0;
    } else if (Array.isArray(record.digitalData)) {
      const arr = record.digitalData[i];
      initialVal = arr && arr.length > 0 ? (arr[0]! ? 1 : 0) : 0;
    }

    dae.addVariable(safeName, VarType.Integer, Variability.Discrete, Causality.Output, initialVal);

    // Equation: safeName = initialVal
    const chId = interner.intern(safeName);
    const chExpr = dae.addExpression(ExprKind.Name, chId);
    const initLit = dae.addIntLiteral(initialVal);
    dae.addEquation(EqKind.Simple, chExpr, initLit);
  }

  return dae;
}
