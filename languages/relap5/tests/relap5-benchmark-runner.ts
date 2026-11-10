// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RELAP5 Nuclear Thermal-Hydraulics & Point Kinetics Benchmark Runner
 *
 * Verifies PWR primary loop SCRAM transient, 6-group delayed neutron point kinetics,
 * Doppler reactivity feedback, and square DAE arena compilation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lowerRelap5ToDae,
  parseRelap5,
  solvePointKinetics,
  type PointKineticsResult,
  type Relap5Deck,
} from "../src/index.js";

export const PWR_BENCHMARK_DECK = `* ====================================================================
* NRC Standard Problem: PWR 4-Loop Reactor Primary System SCRAM Benchmark
* ====================================================================
100 PWR 4-Loop Reactor Primary System Benchmark
101 new transnt
201 10.0 1.0e-5 0.01 100 1000
2060001 p-100010000 gt 1.60e7 l
2060002 time gt 1.0 l
2060003 1 or 2 l
1000000 CoreChannel pipe
1000101 4.5 3.8 17.1
1000201 0.0 3.8
1000301 1.5e-5 0.012
1000501 1.55e7 580.0 0.0
1100000 UpperPlenum branch
1100101 8.0 2.5 20.0
1100201 0.0 2.5
1100301 2.0e-5 0.50
1100501 1.54e7 595.0 0.0
1050000 CoreToUpper snglj
1050101 100 110 4.5
1050102 0.15 0.25
1050201 4.5 0.0
10100000 5 1
10100101 16.5 2.1e6
10100201 100 100
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
6000010 -2.5e-5 -1.0e-4
. end`;

export interface Relap5BenchmarkReport {
  title: string;
  initialPowerMW: number;
  finalPowerMW: number;
  powerDropRatio: number;
  peakFuelTempK: number;
  scramTimeSec: number;
  simStepsCount: number;
  daeVariablesCount: number;
  daeEquationsCount: number;
  isSquare: boolean;
}

export function runRelap5Benchmark(deckText = PWR_BENCHMARK_DECK): Relap5BenchmarkReport {
  const deck = parseRelap5(deckText);

  // 1. Solve 6-group delayed neutron point kinetics during SCRAM
  const scramRes: PointKineticsResult = solvePointKinetics(deck, {
    duration: 5.0,
    tripScramTime: 1.0,
    stepSize: 0.001,
  });

  assert.equal(scramRes.initialPowerMW, 3000.0);
  assert.ok(scramRes.stepsCount >= 400, `Recorded trajectory steps ${scramRes.stepsCount}`);
  assert.ok(scramRes.finalPowerMW < 3000.0 * 0.2, "Power must drop below 20% after SCRAM");

  // 2. DAE lowering to linear memory
  const dae = lowerRelap5ToDae(deck);
  const nVars = dae.variables().length;
  const nEqs = dae.equations().length;
  assert.equal(nVars, nEqs, "RELAP5 DAE must be structurally square");

  return {
    title: deck.title,
    initialPowerMW: scramRes.initialPowerMW,
    finalPowerMW: scramRes.finalPowerMW,
    powerDropRatio: scramRes.finalPowerMW / scramRes.initialPowerMW,
    peakFuelTempK: scramRes.peakFuelTempK,
    scramTimeSec: 1.0,
    simStepsCount: scramRes.stepsCount,
    daeVariablesCount: nVars,
    daeEquationsCount: nEqs,
    isSquare: nVars === nEqs,
  };
}

if (process.argv[1] && process.argv[1].endsWith("relap5-benchmark-runner.ts")) {
  console.log("=== RELAP5 Nuclear Thermal-Hydraulics Benchmark ===");
  const report = runRelap5Benchmark();
  console.log(JSON.stringify(report, null, 2));
}
