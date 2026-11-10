// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ROCETS Liquid Rocket Propulsion Benchmark Runner
 *
 * Verifies NASA staged-combustion liquid rocket engine power balance cycle,
 * nozzle gas dynamics, Bartz heat transfer, and startup transient simulation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateBartzHeatTransfer,
  evaluateCombustionCEA,
  evaluateNozzlePerformance,
  lowerRocetsToDae,
  parseRocetsDeck,
  rocetsToDae,
  simulateRocetsTransient,
  solveRocetsBalance,
  type RocetsBalanceResult,
  type RocetsTransientResult,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, "../../../.cache/benchmarks/rocets");

export const SSME_BENCHMARK_DECK = `DECK: NASA_SSME_StagedCombustion
COMPONENTS:
  MAIN_CHAMBER TYPE=CHAMBER
    PARAMS: PC=20.64E6, MR=6.03, AT=0.055, EPS=69.0, VC=0.045
  HPOTP TYPE=PUMP
    PARAMS: DELTA_P=31.0E6, ETA=0.81
  HPFTP TYPE=PUMP
    PARAMS: DELTA_P=45.0E6, ETA=0.76
  OX_TURBINE TYPE=TURBINE
    PARAMS: PR=1.55, ETA=0.78, T_IN=1030.0
  FUEL_TURBINE TYPE=TURBINE
    PARAMS: PR=1.65, ETA=0.75, T_IN=1050.0
  SHAFT_OX TYPE=SHAFT
    PARAMS: SPEED_RPM=28120.0, INERTIA=0.18
  SHAFT_FUEL TYPE=SHAFT
    PARAMS: SPEED_RPM=35000.0, INERTIA=0.22
CONNECTIONS:
  HPOTP.OUT_P -> MAIN_CHAMBER.IN_OX
  HPFTP.OUT_P -> MAIN_CHAMBER.IN_FUEL
  OX_TURBINE.OUT_P -> MAIN_CHAMBER.IN_GAS
  FUEL_TURBINE.OUT_P -> MAIN_CHAMBER.IN_GAS
`;

export interface RocetsBenchmarkReport {
  engineName: string;
  converged: boolean;
  iterations: number;
  pcPa: number;
  totalMassFlowKgS: number;
  thrustVacN: number;
  ispVacSec: number;
  cStarMS: number;
  machExit: number;
  bartzHgcW_m2K: number;
  transientFinalThrustN: number;
  daeVariablesCount: number;
  daeEquationsCount: number;
  isSquare: boolean;
}

export function runRocetsBenchmark(deckText = SSME_BENCHMARK_DECK): RocetsBenchmarkReport {
  const model = parseRocetsDeck(deckText);
  const balance: RocetsBalanceResult = solveRocetsBalance(model);

  assert.ok(balance.converged, "ROCETS power balance must converge");
  assert.ok(balance.totalMassFlowKgS > 300.0, `Mass flow ${balance.totalMassFlowKgS} kg/s`);
  assert.ok(balance.thrustVacN > 1.0e6, `Vacuum thrust ${balance.thrustVacN} N`);
  assert.ok(balance.ispVacSec > 370.0, `Vacuum Isp ${balance.ispVacSec} s`);

  // Gas dynamics & CEA combustion verification
  const cea = evaluateCombustionCEA("LOX", "LH2", balance.chamberPressurePa, balance.mixtureRatio);
  assert.ok(cea.cStarMS > 1500.0 && cea.cStarMS < 2500.0, `c* should be 1500-2500 m/s, got ${cea.cStarMS}`);

  const nozzle = evaluateNozzlePerformance(balance.chamberPressurePa, 0.055, 69.0, 1.22);
  assert.ok(nozzle.exitMach > 3.0, `Exit Mach number ${nozzle.exitMach} > 3.0`);

  // Bartz cooling heat transfer coefficient at throat (Dt, Pc, cStar, areaRatioAtOverA=1.0)
  const throatDiamM = Math.sqrt((4 * 0.055) / Math.PI);
  const bartz = calculateBartzHeatTransfer(throatDiamM, balance.chamberPressurePa, cea.cStarMS, 1.0);
  assert.ok(bartz > 5000.0, `Bartz coefficient ${bartz} W/m^2-K`);

  // Transient startup simulation
  const transient: RocetsTransientResult = simulateRocetsTransient(model, {
    tStart: 0.0,
    tEnd: 1.5,
    dt: 0.01,
    valveOpenTime: 0.15,
  });
  const lastIdx = transient.times.length - 1;
  const finalThrust = transient.thrustN[lastIdx] ?? 0;
  assert.ok(finalThrust > 800000.0, `Transient final thrust ${finalThrust} N`);

  // DAE lowering
  const dae = rocetsToDae(model);
  const nVars = dae.variables().length;
  const nEqs = dae.equations().length;

  return {
    engineName: model.name,
    converged: balance.converged,
    iterations: balance.iterations,
    pcPa: balance.chamberPressurePa,
    totalMassFlowKgS: balance.totalMassFlowKgS,
    thrustVacN: balance.thrustVacN,
    ispVacSec: balance.ispVacSec,
    cStarMS: cea.cStarMS,
    machExit: nozzle.exitMach,
    bartzHgcW_m2K: bartz,
    transientFinalThrustN: finalThrust,
    daeVariablesCount: nVars,
    daeEquationsCount: nEqs,
    isSquare: nVars === nEqs,
  };
}

if (process.argv[1] && process.argv[1].endsWith("rocets-benchmark-runner.ts")) {
  console.log("=== NASA ROCETS Liquid Propulsion Benchmark ===");
  const report = runRocetsBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
