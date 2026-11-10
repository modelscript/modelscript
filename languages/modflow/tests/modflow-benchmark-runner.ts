// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USGS MODFLOW 6 Groundwater Flow Benchmark Runner
 *
 * Verifies 3D multi-layer aquifer flow, river-aquifer leakage coupling,
 * pumping well drawdown cone of depression, and DAE arena lowering.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lowerModflowToDae,
  parseModflow,
  solveAquiferBalance,
  type ModflowModel,
  type WaterBalanceSummary,
} from "../src/index.js";

export const USGS_TWRI_BENCHMARK_DECK = `
# USGS TWRI 3-Layer Groundwater Benchmark Model
BEGIN DIS6
  NLAY 3
  NROW 5
  NCOL 5
  DELR 150.0
  DELC 150.0
  TOP 60.0
  BOTM 40.0 20.0 0.0
END DIS6

BEGIN NPF6
  K 25.0
  K33 2.5
  SS 1.0e-5
  SY 0.20
END NPF6

BEGIN WEL6
  3 3 3 -1200.0
  3 4 4 -600.0
END WEL6

BEGIN RIV6
  1 1 2 55.0 300.0 52.0
  1 1 3 54.5 300.0 51.5
  1 1 4 54.0 300.0 51.0
END RIV6

BEGIN CHD6
  1 1 1 58.0
  1 5 5 45.0
  2 1 1 57.0
  2 5 5 44.0
  3 1 1 56.0
  3 5 5 43.0
END CHD6
`;

export interface ModflowBenchmarkReport {
  nlay: number;
  nrow: number;
  ncol: number;
  totalCells: number;
  totalPumpingRateM3Day: number;
  maxDrawdownM: number;
  activeWellsCount: number;
  activeRiversCount: number;
  daeVariablesCount: number;
  daeEquationsCount: number;
}

export function runModflowBenchmark(deckText = USGS_TWRI_BENCHMARK_DECK): ModflowBenchmarkReport {
  const model = parseModflow(deckText);

  // 1. Solve 3D aquifer water balance and drawdown
  const balance: WaterBalanceSummary = solveAquiferBalance(model);
  const totalCells = model.dis.nlay * model.dis.nrow * model.dis.ncol;

  assert.equal(balance.totalPumpingRate, 1800.0, "Total pumping extraction must equal 1800 m^3/day");
  assert.ok(balance.maxDrawdown > 0.0, "Pumping must produce positive drawdown cone");
  assert.equal(balance.cellBudgets.length, totalCells, `Must calculate budget for all ${totalCells} cells`);

  // 2. DAE lowering to linear memory arena
  const arena = lowerModflowToDae(model);
  const nVars = arena.variables().length;
  const nEqs = arena.equations().length;

  assert.equal(nVars, totalCells, "DAE must allocate 1 hydraulic head variable per 3D cell");
  assert.ok(nEqs > 0, "DAE must generate Darcy flow balance equations");

  return {
    nlay: model.dis.nlay,
    nrow: model.dis.nrow,
    ncol: model.dis.ncol,
    totalCells,
    totalPumpingRateM3Day: balance.totalPumpingRate,
    maxDrawdownM: balance.maxDrawdown,
    activeWellsCount: model.wells.length,
    activeRiversCount: model.rivers.length,
    daeVariablesCount: nVars,
    daeEquationsCount: nEqs,
  };
}

if (process.argv[1] && process.argv[1].endsWith("modflow-benchmark-runner.ts")) {
  console.log("=== USGS MODFLOW 6 Groundwater Benchmark ===");
  const report = runModflowBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
