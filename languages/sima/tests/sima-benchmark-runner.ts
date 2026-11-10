// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for SINTEF SIMA / SIMO / RIFLEX Floating Marine Structure Dynamics.
 *
 * Evaluates:
 * 1. OC4 Semi-Submersible Floating Offshore Wind Turbine (FOWT) floater
 * 2. 3-line catenary mooring spread with studless chain
 * 3. 6-DOF time-domain Cummins equation floater dynamics simulation
 * 4. DNV-OS-E301 mooring intact safety factor compliance verification
 * 5. ASTM E1049 rainflow cycle counting and Palmgren-Miner fatigue damage
 * 6. Direct lowering to DAEBuilder linear memory arena
 */

import assert from "node:assert/strict";
import {
  computeFatigueDamage,
  evaluateOffsetLimits,
  lowerSimaToDae,
  parseCardDeck,
  rainflowCount,
  simulateCumminsDynamics,
  verifyDnvMooringCompliance,
  type DnvVerificationReport,
  type OffsetLimitReport,
  type SimaModel,
} from "../src/index.js";

export const SIMA_OC4_SEMI_BENCHMARK_DECK = `
! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

export interface SimaBenchmarkMetrics {
  vesselsCount: number;
  mooringLinesCount: number;
  waterDepthM: number;
  watchCircleRadiusM: number;
  meanOffsetM: number;
  maxSurgeExcursionM: number;
  dnvCompliancePassed: boolean;
  minSafetyFactor: number;
  fatigueAnnualDamage: number;
  daeVarCount: number;
  daeEqCount: number;
}

export function runSimaBenchmark(
  deckContent = SIMA_OC4_SEMI_BENCHMARK_DECK,
): SimaBenchmarkMetrics {
  const model: SimaModel = parseCardDeck(deckContent);

  assert.equal(model.vessels.length, 1);
  assert.equal(model.lines.length, 3);
  assert.equal(model.environment.waterDepth, 200.0);

  // 1. Evaluate offset limits and watch circle
  const offsetRep: OffsetLimitReport = evaluateOffsetLimits(model, {
    maxOffsetPercentWaterDepth: 8.0,
    maxFairleadAngleDeg: 80.0,
    minGroundedLengthMeters: 50.0,
  });

  assert.equal(offsetRep.allPassed, true);
  assert.ok(offsetRep.watchCircleRadiusMeters > 0);

  // 2. Simulate 6-DOF Cummins dynamics
  const vessel = model.vessels[0]!;
  const sim = simulateCumminsDynamics(vessel, model, {
    durationSeconds: 10.0,
    timeStepSeconds: 0.1,
  });

  assert.equal(sim.time.length, 100);
  assert.ok(sim.maxExcursion.surge >= 0);

  // 3. Verify DNV-OS-E301 compliance
  const dnvRep: DnvVerificationReport = verifyDnvMooringCompliance(model);
  assert.equal(dnvRep.summary.allPassed, true);
  assert.ok(dnvRep.summary.minSafetyFactor >= 1.67);

  // 4. Rainflow counting and fatigue
  const syntheticTension: number[] = [];
  for (let t = 0; t <= 100; t++) {
    syntheticTension.push(1500 + 250 * Math.sin((2 * Math.PI * t) / 10) + 100 * Math.cos((2 * Math.PI * t) / 25));
  }
  const cycles = rainflowCount(syntheticTension);
  assert.ok(cycles.length > 0);

  const fatigue = computeFatigueDamage({
    timeSeries: syntheticTension,
    simDurationSeconds: 100,
    curve: "studless_chain",
    designFatigueFactor: 2.5,
    designLifeYears: 25,
  });
  assert.ok(fatigue.annualDamage > 0);

  // 5. Lower to DAE arena
  const dae = lowerSimaToDae(model);
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount > 20, `Expected > 20 variables, got ${varCount}`);
  assert.ok(eqCount >= 15, `Expected >= 15 equations, got ${eqCount}`);

  return {
    vesselsCount: model.vessels.length,
    mooringLinesCount: model.lines.length,
    waterDepthM: model.environment.waterDepth,
    watchCircleRadiusM: offsetRep.watchCircleRadiusMeters,
    meanOffsetM: offsetRep.meanOffsetMeters.total,
    maxSurgeExcursionM: sim.maxExcursion.surge,
    dnvCompliancePassed: dnvRep.summary.allPassed,
    minSafetyFactor: dnvRep.summary.minSafetyFactor,
    fatigueAnnualDamage: fatigue.annualDamage,
    daeVarCount: varCount,
    daeEqCount: eqCount,
  };
}

if (process.argv[1]?.endsWith("sima-benchmark-runner.ts")) {
  const m = runSimaBenchmark();
  console.log("SIMA Benchmark Results:", m);
}
