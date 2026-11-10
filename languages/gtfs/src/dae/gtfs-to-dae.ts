// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { solveTractionProfiles, solveDepotCharging } from "../solver/index.js";
import type { GtfsFeed } from "../types.js";

/**
 * Lowers electric transit bus kinematic trajectories, battery SOC dynamics, and depot charging
 * power balances directly into ModelScript's zero-overhead DAEBuilder linear arena.
 */
export function lowerGtfsToDae(feed: GtfsFeed, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? "Electric_Transit_Fleet_Operations";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const profiles = solveTractionProfiles(feed);
  const depot = solveDepotCharging(feed);

  // 1. Per-Trip State Variables and Equations
  for (const prof of profiles) {
    const cleanTrip = prof.tripId.replace(/[^a-zA-Z0-9_]/g, "_");

    // Continuous Velocity (m/s)
    const vName = `v_${cleanTrip}`;
    const vId = interner.intern(vName);
    const avgVelocityMS = prof.averageSpeedKmh / 3.6;
    arena.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, avgVelocityMS);
    const vExpr = arena.addExpression(ExprKind.Name, vId);

    const vLit = arena.addRealLiteral(avgVelocityMS);
    arena.addEquation(EqKind.Simple, vExpr, vLit);

    // Battery State of Charge (%)
    const socName = `SOC_${cleanTrip}`;
    const socId = interner.intern(socName);
    arena.addVariable(socName, VarType.Real, Variability.Continuous, Causality.Local, prof.finalSoc);
    const socExpr = arena.addExpression(ExprKind.Name, socId);

    const socLit = arena.addRealLiteral(prof.finalSoc);
    arena.addEquation(EqKind.Simple, socExpr, socLit);

    // Traction Power Demand (kW)
    const pTractName = `P_tract_kW_${cleanTrip}`;
    const pTractId = interner.intern(pTractName);
    arena.addVariable(pTractName, VarType.Real, Variability.Continuous, Causality.Local, prof.peakTractionKW);
    const pTractExpr = arena.addExpression(ExprKind.Name, pTractId);

    const pTractLit = arena.addRealLiteral(prof.peakTractionKW);
    arena.addEquation(EqKind.Simple, pTractExpr, pTractLit);
  }

  // 2. Depot Charging and Feeder Coupling Variables
  const pDepotName = "P_grid_depot_kW";
  const pDepotId = interner.intern(pDepotName);
  arena.addVariable(pDepotName, VarType.Real, Variability.Continuous, Causality.Local, depot.peakDemandKW);
  const pDepotExpr = arena.addExpression(ExprKind.Name, pDepotId);

  const pDepotLit = arena.addRealLiteral(depot.peakDemandKW);
  arena.addEquation(EqKind.Simple, pDepotExpr, pDepotLit);

  // Total Daily Energy parameter
  const eTotalName = "E_depot_daily_kWh";
  const eTotalId = interner.intern(eTotalName);
  arena.addVariable(eTotalName, VarType.Real, Variability.Parameter, Causality.Input, depot.totalDailyEnergyKWh);
  const eTotalExpr = arena.addExpression(ExprKind.Name, eTotalId);

  const eTotalLit = arena.addRealLiteral(depot.totalDailyEnergyKWh);
  arena.addEquation(EqKind.Simple, eTotalExpr, eTotalLit);

  // Power balance relation: P_avg = E_total / 6 hours
  const pAvgName = "P_grid_depot_avg_kW";
  const pAvgId = interner.intern(pAvgName);
  const avgKw = depot.totalDailyEnergyKWh / 6.0;
  arena.addVariable(pAvgName, VarType.Real, Variability.Continuous, Causality.Local, avgKw);
  const pAvgExpr = arena.addExpression(ExprKind.Name, pAvgId);

  const sixHoursLit = arena.addRealLiteral(6.0);
  const pDepotTargetExpr = arena.addBinaryExpr(BinOp.Div, eTotalExpr, sixHoursLit);
  arena.addEquation(EqKind.Simple, pAvgExpr, pDepotTargetExpr);

  return arena;
}
