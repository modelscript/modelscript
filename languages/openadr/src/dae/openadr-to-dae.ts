// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { evaluateCurtailment } from "../solver/curtailment-evaluator.js";
import type { OpenAdrDeck } from "../types.js";

/**
 * Lowers OpenADR demand response events into DAEBuilder linear arena parameters and boundaries.
 */
export function lowerOpenAdrToDae(deck: OpenAdrDeck, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? "OpenADR_Demand_Response";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const schedule = evaluateCurtailment(deck);
  const initialLimit = schedule[0]?.activeLimitKW ?? 100.0;
  const signalType = schedule[0]?.signalType ?? "setpoint";

  if (signalType === "price" || signalType === "multiplier") {
    // Dynamic price multiplier parameter
    const multName = "dr_price_multiplier";
    const multId = interner.intern(multName);
    arena.addVariable(multName, VarType.Real, Variability.Parameter, Causality.Input, initialLimit);
    const multExpr = arena.addExpression(ExprKind.Name, multId);
    const multLit = arena.addRealLiteral(initialLimit);
    arena.addEquation(EqKind.Simple, multExpr, multLit);
  } else {
    // Power curtailment ceiling parameter: P_curtail_limit
    const limitName = "P_curtail_limit";
    const limitId = interner.intern(limitName);
    arena.addVariable(limitName, VarType.Real, Variability.Parameter, Causality.Input, initialLimit);
    const limitExpr = arena.addExpression(ExprKind.Name, limitId);
    const limitLit = arena.addRealLiteral(initialLimit);
    arena.addEquation(EqKind.Simple, limitExpr, limitLit);

    // Target active power dispatch: P_target_demand
    const targetName = "P_target_demand";
    const targetId = interner.intern(targetName);
    arena.addVariable(targetName, VarType.Real, Variability.Continuous, Causality.Local, initialLimit);
    const targetExpr = arena.addExpression(ExprKind.Name, targetId);
    arena.addEquation(EqKind.Simple, targetExpr, limitExpr);
  }

  return arena;
}
