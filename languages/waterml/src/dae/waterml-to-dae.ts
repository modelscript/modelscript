// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for OGC WaterML 2.0 Telemetry.
 *
 * Compiles hydrologic observation timeseries into ModelScript's zero-GC DAEBuilder arena
 * for continuous boundary playback, stage-discharge routing, and hydrodynamic simulation.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import { filterValidObservations } from "../analysis/rating-curve.js";
import type { RatingCurve, WaterMlDocument, WaterTimeSeries } from "../types.js";

export interface WaterMlDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  ratingCurve?: RatingCurve | undefined;
}

/**
 * Lowers a WaterMlDocument or WaterTimeSeries directly into a DAEBuilder linear-memory arena.
 */
export function lowerWaterMlToDae(
  docOrSeries: WaterMlDocument | WaterTimeSeries,
  options?: WaterMlDaeOptions,
): DAEBuilder {
  const isDoc = "timeSeriesList" in docOrSeries;
  const seriesList: WaterTimeSeries[] = isDoc ? docOrSeries.timeSeriesList : [docOrSeries];
  const docId = isDoc ? docOrSeries.id : docOrSeries.seriesId;
  const rawModelName = options?.modelName ?? docId;
  const modelName = rawModelName.replace(/[^a-zA-Z0-9_]/g, "_");

  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Process each timeseries
  for (let idx = 0; idx < seriesList.length; idx++) {
    const ts = seriesList[idx]!;
    const validPts = filterValidObservations(ts);
    const varPrefix = ts.observedProperty.toLowerCase().includes("stage") ? "stage" : "discharge";
    const safeStation = ts.monitoringPoint.stationId.replace(/[^a-zA-Z0-9_]/g, "_");
    const varName = `${varPrefix}_${safeStation}`;

    const initialVal = validPts.length > 0 ? validPts[0]!.value : 0.0;

    // Add continuous state / boundary variable
    dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Output, initialVal);

    // Initial boundary equation: varName = initialVal
    const varId = interner.intern(varName);
    const varExpr = dae.addExpression(ExprKind.Name, varId);
    const initLit = dae.addRealLiteral(initialVal);
    dae.addEquation(EqKind.Simple, varExpr, initLit);

    // Add parameter for observation count
    const countParamName = `n_obs_${safeStation}`;
    dae.addVariable(countParamName, VarType.Integer, Variability.Parameter, Causality.Local, validPts.length);
    const countId = interner.intern(countParamName);
    const countExpr = dae.addExpression(ExprKind.Name, countId);
    const countLit = dae.addIntLiteral(validPts.length);
    dae.addEquation(EqKind.Simple, countExpr, countLit);
  }

  // 3. If a rating curve is attached, lower stage-discharge algebraic relationship
  if (options?.ratingCurve?.equation) {
    const eq = options.ratingCurve.equation;
    dae.addVariable("rc_a", VarType.Real, Variability.Parameter, Causality.Local, eq.a);
    dae.addVariable("rc_h0", VarType.Real, Variability.Parameter, Causality.Local, eq.h0);
    dae.addVariable("rc_b", VarType.Real, Variability.Parameter, Causality.Local, eq.b);

    const aId = interner.intern("rc_a");
    const h0Id = interner.intern("rc_h0");
    const bId = interner.intern("rc_b");

    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, aId), dae.addRealLiteral(eq.a));
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, h0Id), dae.addRealLiteral(eq.h0));
    dae.addEquation(EqKind.Simple, dae.addExpression(ExprKind.Name, bId), dae.addRealLiteral(eq.b));
  }

  return dae;
}
