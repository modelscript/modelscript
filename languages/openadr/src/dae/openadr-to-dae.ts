// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { evaluateCurtailment } from "../solver/curtailment-evaluator.js";
import type { OpenAdrDeck } from "../types.js";

/**
 * Lowers an OpenADR Demand Response deck into an executable WebAssembly DAE arena
 * modeling first-order demand flexibility ramp dynamics and cumulative energy curtailment.
 */
export function lowerOpenAdrToDae(deck: OpenAdrDeck, arenaTitle?: string): DAEBuilder {
  const arena = new DAEBuilder(undefined, arenaTitle || "OpenAdrCurtailment");
  const schedule = evaluateCurtailment(deck);

  const firstSignal = schedule.length > 0 ? schedule[0]! : null;
  const initialLimit = firstSignal ? firstSignal.activeLimitKW : 0.0;
  const isPriceOrMultiplier =
    firstSignal !== null && (firstSignal.signalType === "price" || firstSignal.signalType === "multiplier");

  const maxScheduleKW = schedule.length > 0 ? Math.max(...schedule.map((pt) => pt.activeLimitKW)) : initialLimit;
  const baselineKW = isPriceOrMultiplier ? 600.0 : Math.max(maxScheduleKW * 1.25, initialLimit > 0 ? 600.0 : 0.0);
  const rampTauSec = 30.0;

  if (isPriceOrMultiplier) {
    arena.addVariable("dr_price_multiplier", VarType.Real, Variability.Parameter, Causality.Local, initialLimit);
    arena.addEquation(EqKind.Simple, arena.addNameExpr("dr_price_multiplier"), arena.addRealLiteral(initialLimit));
  }

  // Active curtailment setpoint [kW]
  const targetSetpointKW = isPriceOrMultiplier ? baselineKW / Math.max(initialLimit, 1.0) : initialLimit;
  arena.addVariable("P_curtail_limit", VarType.Real, Variability.Parameter, Causality.Local, targetSetpointKW);
  arena.addEquation(EqKind.Simple, arena.addNameExpr("P_curtail_limit"), arena.addRealLiteral(targetSetpointKW));

  // Baseline load [kW] and ramp time constant [s]
  arena.addVariable("P_baseline", VarType.Real, Variability.Parameter, Causality.Local, baselineKW);
  arena.addEquation(EqKind.Simple, arena.addNameExpr("P_baseline"), arena.addRealLiteral(baselineKW));

  arena.addVariable("tau_ramp", VarType.Real, Variability.Parameter, Causality.Local, rampTauSec);
  arena.addEquation(EqKind.Simple, arena.addNameExpr("tau_ramp"), arena.addRealLiteral(rampTauSec));

  // First-order load flexibility ramp ODE: der(P_target_demand) = (P_curtail_limit - P_target_demand) / tau_ramp
  arena.addVariable("P_target_demand", VarType.Real, Variability.Continuous, Causality.Local, baselineKW);
  const rampError = arena.addBinaryExpr(
    BinOp.Sub,
    arena.addNameExpr("P_curtail_limit"),
    arena.addNameExpr("P_target_demand"),
  );
  const rampDerivRhs = arena.addBinaryExpr(BinOp.Div, rampError, arena.addNameExpr("tau_ramp"));
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("P_target_demand")), rampDerivRhs);

  // Cumulative energy curtailed [kWh]: der(E_shed_kWh) = (P_baseline - P_target_demand) / 3600.0
  arena.addVariable("E_shed_kWh", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const powerReduction = arena.addBinaryExpr(
    BinOp.Sub,
    arena.addNameExpr("P_baseline"),
    arena.addNameExpr("P_target_demand"),
  );
  const energyRate = arena.addBinaryExpr(BinOp.Div, powerReduction, arena.addRealLiteral(3600.0));
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("E_shed_kWh")), energyRate);

  return arena;
}
