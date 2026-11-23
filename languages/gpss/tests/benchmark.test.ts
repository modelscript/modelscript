// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Geoffrey Gordon (1961) Classic Barbershop M/M/1 and Multi-Barber M/M/c Queuing Benchmark.
 *
 * Validates `@modelscript/gpss`'s deterministic seeded discrete-event simulator against
 * exact Erlang-C analytical queuing theory and Little's Law ($L = \lambda W$, $L_q = \lambda W_q$)
 * with explicit relative error (`relErr`) and `tolerance` assertions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGpss } from "../src/parser/index.js";
import { computeErlangC, computeMM1, simulateGpss } from "../src/solver/index.js";

function relErr(observed: number, expected: number): number {
  const denom = Math.max(1e-9, Math.abs(expected));
  return Math.abs(observed - expected) / denom;
}

describe("GPSS Benchmark: Geoffrey Gordon Barbershop (M/M/1 & M/M/c vs Erlang-C & Little's Law)", () => {
  it("validates single-barber M/M/1 barbershop against exact M/M/1 analytical formulas and Little's Law", () => {
    // Arrival mean = 10 min (lambda = 0.1/min), Service mean = 7 min (mu = 1/7/min), rho = 0.70
    const mm1Deck = `
* MODEL: GordonBarbershopMM1
      RMULT    1961
      GENERATE 10,FN$EXPON
      QUEUE    LINE
      SEIZE    JOE
      DEPART   LINE
      ADVANCE  7,FN$EXPON
      RELEASE  JOE
      TERMINATE 1
      START    40000
      END
`;
    const model = parseGpss(mm1Deck);
    const sim = simulateGpss(model, { seed: 1961, terminationCount: 40000, warmupTime: 2000 });
    const exact = computeMM1(1 / 10, 1 / 7);

    const joe = sim.facilities["JOE"]!;
    const line = sim.queues["LINE"]!;

    const utilTolerance = 0.03;
    const queueTolerance = 0.08;
    const littlesLawTolerance = 0.02;

    const utilRelErr = relErr(joe.utilization, exact.utilization);
    const lqRelErr = relErr(line.meanQueueLength, exact.meanQueueLength);
    const wqRelErr = relErr(line.meanWaitTime, exact.meanWaitTime);
    const lRelErr = relErr(sim.meanSystemCount, exact.meanSystemCount);
    const wRelErr = relErr(sim.meanSystemTime, exact.meanSystemTime);
    const throughputRelErr = relErr(sim.throughput, exact.arrivalRate);

    // Little's Law internal identity: L = lambda * W and Lq = lambda * Wq
    const littlesSystemRelErr = relErr(sim.meanSystemCount, sim.throughput * sim.meanSystemTime);
    const littlesQueueRelErr = relErr(line.meanQueueLength, sim.throughput * line.meanWaitTime);

    assert.ok(utilRelErr < utilTolerance, `Utilization relErr=${utilRelErr.toFixed(4)} >= ${utilTolerance}`);
    assert.ok(throughputRelErr < utilTolerance, `Throughput relErr=${throughputRelErr.toFixed(4)} >= ${utilTolerance}`);
    assert.ok(lqRelErr < queueTolerance, `Lq relErr=${lqRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(wqRelErr < queueTolerance, `Wq relErr=${wqRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(lRelErr < queueTolerance, `L relErr=${lRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(wRelErr < queueTolerance, `W relErr=${wRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(
      littlesSystemRelErr < littlesLawTolerance,
      `Little's Law (L = lambda*W) relErr=${littlesSystemRelErr.toFixed(4)} >= ${littlesLawTolerance}`,
    );
    assert.ok(
      littlesQueueRelErr < littlesLawTolerance,
      `Little's Law (Lq = lambda*Wq) relErr=${littlesQueueRelErr.toFixed(4)} >= ${littlesLawTolerance}`,
    );
  });

  it("validates 3-barber M/M/3 barbershop (STORAGE capacity=3) against exact Erlang-C formulas", () => {
    // c = 3 barbers, arrival mean = 4 min (lambda = 0.25/min), service mean = 9 min (mu = 1/9/min)
    // Offered load a = 2.25 Erlangs, utilization rho = 2.25 / 3 = 0.75
    const mm3Deck = `
* MODEL: GordonBarbershopMM3
BARBERS STORAGE 3
      RMULT    2025
      GENERATE 4,FN$EXPON
      QUEUE    WAITROOM
      ENTER    BARBERS,1
      DEPART   WAITROOM
      ADVANCE  9,FN$EXPON
      LEAVE    BARBERS,1
      TERMINATE 1
      START    40000
      END
`;
    const model = parseGpss(mm3Deck);
    const sim = simulateGpss(model, { seed: 2025, terminationCount: 40000, warmupTime: 2000 });
    const exact = computeErlangC(1 / 4, 1 / 9, 3);

    const barbers = sim.storages["BARBERS"]!;
    const room = sim.queues["WAITROOM"]!;

    const utilTolerance = 0.03;
    const queueTolerance = 0.08;
    const littlesLawTolerance = 0.02;

    const utilRelErr = relErr(barbers.utilization, exact.utilization);
    const avgContentsRelErr = relErr(barbers.averageContents, exact.offeredLoad);
    const lqRelErr = relErr(room.meanQueueLength, exact.meanQueueLength);
    const wqRelErr = relErr(room.meanWaitTime, exact.meanWaitTime);
    const littlesRelErr = relErr(sim.meanSystemCount, sim.throughput * sim.meanSystemTime);

    assert.ok(utilRelErr < utilTolerance, `M/M/3 utilization relErr=${utilRelErr.toFixed(4)} >= ${utilTolerance}`);
    assert.ok(
      avgContentsRelErr < utilTolerance,
      `M/M/3 average contents relErr=${avgContentsRelErr.toFixed(4)} >= ${utilTolerance}`,
    );
    assert.ok(lqRelErr < queueTolerance, `M/M/3 Lq relErr=${lqRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(wqRelErr < queueTolerance, `M/M/3 Wq relErr=${wqRelErr.toFixed(4)} >= ${queueTolerance}`);
    assert.ok(
      littlesRelErr < littlesLawTolerance,
      `M/M/3 Little's Law relErr=${littlesRelErr.toFixed(4)} >= ${littlesLawTolerance}`,
    );
  });

  it("is strictly deterministic for identical seeds", () => {
    const deck = `
      GENERATE 18,6
      QUEUE    LINE
      SEIZE    JOE
      DEPART   LINE
      ADVANCE  16,4
      RELEASE  JOE
      TERMINATE 1
      START    500
`;
    const model = parseGpss(deck);
    const run1 = simulateGpss(model, { seed: 777 });
    const run2 = simulateGpss(model, { seed: 777 });

    assert.strictEqual(run1.clock, run2.clock);
    assert.strictEqual(run1.facilities["JOE"]!.utilization, run2.facilities["JOE"]!.utilization);
    assert.strictEqual(run1.queues["LINE"]!.meanWaitTime, run2.queues["LINE"]!.meanWaitTime);
  });
});
