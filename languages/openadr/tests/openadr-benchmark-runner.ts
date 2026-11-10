// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for OpenADR 2.0b / OpenADR 3.0 Automated Demand Response (ADR).
 *
 * Evaluates:
 * 1. Industrial demand response program with multi-stage peak shaving intervals
 * 2. Virtual Top Node (VTN) to Virtual End Node (VEN) payload dispatch
 * 3. Time-series curtailment scheduling and energy shed estimation
 * 4. Structurally square DAEBuilder linear arena lowering
 */

import assert from "node:assert/strict";
import {
  evaluateCurtailment,
  lowerOpenAdrToDae,
  parseOpenAdr,
  type CurtailmentSchedulePoint,
  type OpenAdrDeck,
} from "../src/index.js";

export const OPENADR_GRID_CURTAILMENT_BENCHMARK = `
program "CAISO_Emergency_DR_Program" {
  event "EVENT_FAST_CURTAIL_2026" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN_REFINERY_MICROGRID_01"

    interval {
      start: "2026-08-15T14:00:00Z"
      durationSeconds: 1800
      payload: 450.0
    }

    interval {
      start: "2026-08-15T14:30:00Z"
      durationSeconds: 3600
      payload: 250.0
    }

    interval {
      start: "2026-08-15T15:30:00Z"
      durationSeconds: 1800
      payload: 150.0
    }

    interval {
      start: "2026-08-15T16:00:00Z"
      durationSeconds: 3600
      payload: 500.0
    }
  }
}
`;

export interface OpenAdrBenchmarkMetrics {
  programsCount: number;
  eventsCount: number;
  intervalsCount: number;
  baselineDemandKW: number;
  minCurtailmentKW: number;
  maxEnergyShedKWh: number;
  eventDurationSeconds: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runOpenAdrBenchmark(
  deckStr = OPENADR_GRID_CURTAILMENT_BENCHMARK,
): OpenAdrBenchmarkMetrics {
  const deck: OpenAdrDeck = parseOpenAdr(deckStr);

  assert.equal(deck.programs.length, 1);
  assert.equal(deck.events.length, 1);

  const event = deck.events[0]!;
  assert.equal(event.intervals.length, 4);

  // Evaluate time-series curtailment for target VEN
  const schedule: CurtailmentSchedulePoint[] = evaluateCurtailment(
    deck,
    "VEN_REFINERY_MICROGRID_01",
  );
  assert.equal(schedule.length, 4);

  let totalDuration = 0;
  let minLimit = Infinity;
  const baseline = 600.0; // Nominal uncurtailed microgrid power
  let totalEnergyShedKWh = 0;

  for (let i = 0; i < event.intervals.length; i++) {
    const it = event.intervals[i]!;
    totalDuration += it.durationSeconds;
    if (it.payload < minLimit) {
      minLimit = it.payload;
    }
    const shedPower = Math.max(0, baseline - it.payload);
    totalEnergyShedKWh += (shedPower * it.durationSeconds) / 3600.0;
  }

  assert.equal(totalDuration, 10800); // 3 hours
  assert.equal(minLimit, 150.0);
  assert.ok(totalEnergyShedKWh > 0);

  // DAE Lowering
  const arena = lowerOpenAdrToDae(deck);
  const varCount = arena.getVarCount();
  const eqCount = arena.getEqCount();

  assert.equal(varCount, 2);
  assert.equal(eqCount, 2);
  assert.equal(varCount, eqCount, "OpenADR DAE arena must be square");

  return {
    programsCount: deck.programs.length,
    eventsCount: deck.events.length,
    intervalsCount: event.intervals.length,
    baselineDemandKW: baseline,
    minCurtailmentKW: minLimit,
    maxEnergyShedKWh: totalEnergyShedKWh,
    eventDurationSeconds: totalDuration,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("openadr-benchmark-runner.ts")) {
  const m = runOpenAdrBenchmark();
  console.log("OpenADR Benchmark Results:", m);
}
