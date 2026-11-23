// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSimscript } from "../src/parser/index.js";
import { computeMMcAnalytical, simulateSimscript } from "../src/solver/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-9, Math.abs(expected));
}

/**
 * Benchmark 1: Classic SIMSCRIPT II.5 Port/Harbor Berth Resource Allocation (M/M/3)
 * - 3 berths (c = 3)
 * - Inter-arrival time ~ Exponential(mean = 2.0 h) => lambda = 0.5 ships/h
 * - Unloading service time ~ Exponential(mean = 4.0 h) => mu = 0.25 ships/h per berth
 * - Analytical utilization: rho = lambda / (c * mu) = 0.5 / 0.75 = 2/3 = 0.6667
 */
const PORT_HARBOR_BENCHMARK = `
'' MODEL: PortHarborBerthAllocation
PREAMBLE
  TEMPORARY ENTITIES
    EVERY SHIP BELONGS TO HARBOR.QUEUE
  PROCESSES
    INCLUDE ARRIVAL.GEN
    INCLUDE SHIP
  RESOURCES
    EVERY BERTH
  DEFINE HARBOR.QUEUE AS A FIFO SET
  ACCUMULATE AVG.BUSY.BERTHS AS THE MEAN OF N.X.BERTH
  ACCUMULATE AVG.HARBOR.QUEUE AS THE MEAN OF N.Q.BERTH
END

MAIN
  CREATE EVERY BERTH(1)
  LET U.BERTH = 3
  ACTIVATE A ARRIVAL.GEN NOW
  START SIMULATION
END

PROCESS ARRIVAL.GEN
  ACTIVATE A SHIP NOW
  ACTIVATE A ARRIVAL.GEN IN EXPONENTIAL.F(2.0, 1) HOURS
END

PROCESS SHIP
  FILE THIS SHIP IN HARBOR.QUEUE
  REQUEST 1 BERTH
  REMOVE FIRST SHIP FROM HARBOR.QUEUE
  WORK EXPONENTIAL.F(4.0, 2) HOURS
  RELINQUISH 1 BERTH
END
`;

/**
 * Benchmark 2: M/M/2 Job-Shop Machine Center
 * - 2 identical CNC machines (c = 2)
 * - Inter-arrival time ~ Exponential(mean = 1.6 min) => lambda = 0.625 jobs/min
 * - Processing time ~ Exponential(mean = 2.0 min) => mu = 0.5 jobs/min per machine
 * - Analytical utilization: rho = 0.625 / (2 * 0.5) = 0.625
 */
const MMC_JOB_SHOP_BENCHMARK = `
'' MODEL: MM2JobShop
PREAMBLE
  PROCESSES
    INCLUDE JOB.GEN
    INCLUDE JOB
  RESOURCES
    EVERY MACHINE
  TALLY MEAN.SOJOURN AS THE MEAN OF FLOW.TIME
  ACCUMULATE AVG.MACHINES.BUSY AS THE MEAN OF N.X.MACHINE
  ACCUMULATE AVG.JOB.QUEUE AS THE MEAN OF N.Q.MACHINE
END

MAIN
  CREATE EVERY MACHINE(1)
  LET U.MACHINE = 2
  ACTIVATE A JOB.GEN NOW
  START SIMULATION
END

PROCESS JOB.GEN
  ACTIVATE A JOB NOW
  ACTIVATE A JOB.GEN IN EXPONENTIAL.F(1.6, 3) MINUTES
END

PROCESS JOB
  REQUEST 1 MACHINE
  WORK EXPONENTIAL.F(2.0, 4) MINUTES
  RELINQUISH 1 MACHINE
END
`;

describe("SIMSCRIPT II.5 Benchmarks — Little's Law & Analytical M/M/c Validation", () => {
  it("validates Port/Harbor 3-berth allocation against analytical M/M/3 utilization and Little's Law", () => {
    const model = parseSimscript(PORT_HARBOR_BENCHMARK);
    const sim = simulateSimscript(model, {
      seed: 20261122,
      maxTime: 40000,
      warmupTime: 2000,
      maxEvents: 500000,
    });

    const berth = sim.resources["BERTH"];
    assert.ok(berth, "Expected BERTH resource statistics");
    assert.ok(berth.departures > 15000, `Expected > 15000 ship departures, got ${berth.departures}`);

    const analytical = computeMMcAnalytical(0.5, 0.25, 3);
    const tolerance = 0.05; // 5% Monte Carlo tolerance

    // 1. Utilization rho vs analytical
    const rhoErr = relErr(berth.utilization, analytical.rho);
    assert.ok(
      rhoErr < tolerance,
      `Berth utilization relErr=${(rhoErr * 100).toFixed(2)}% (sim=${berth.utilization.toFixed(4)}, analytical=${analytical.rho.toFixed(4)})`,
    );

    // 2. Mean system length L vs analytical
    const lErr = relErr(berth.meanSystemLength, analytical.l);
    assert.ok(
      lErr < 0.08,
      `Berth L relErr=${(lErr * 100).toFixed(2)}% (sim=${berth.meanSystemLength.toFixed(4)}, analytical=${analytical.l.toFixed(4)})`,
    );

    // 3. Little's Law: L = lambda_eff * W
    const littleL = berth.throughput * berth.meanSystemTime;
    const littleErr = relErr(berth.meanSystemLength, littleL);
    assert.ok(
      littleErr < 0.02,
      `Little's Law L = lambda*W violated: relErr=${(littleErr * 100).toFixed(2)}% (L=${berth.meanSystemLength.toFixed(4)}, lambda*W=${littleL.toFixed(4)})`,
    );

    // 4. Little's Law for queue: Lq = lambda_eff * Wq
    const littleLq = berth.throughput * berth.meanWaitTime;
    const littleLqErr = relErr(berth.meanQueueLength, littleLq);
    assert.ok(
      littleLqErr < 0.03,
      `Little's Law Lq = lambda*Wq violated: relErr=${(littleLqErr * 100).toFixed(2)}% (Lq=${berth.meanQueueLength.toFixed(4)}, lambda*Wq=${littleLq.toFixed(4)})`,
    );
  });

  it("validates M/M/2 job-shop against Erlang-C analytical utilization, W, and Little's Law", () => {
    const model = parseSimscript(MMC_JOB_SHOP_BENCHMARK);
    const sim = simulateSimscript(model, {
      seed: 19680205,
      maxTime: 35000,
      warmupTime: 2000,
      maxEvents: 500000,
    });

    const machine = sim.resources["MACHINE"];
    assert.ok(machine, "Expected MACHINE resource statistics");
    assert.ok(machine.departures > 15000, `Expected > 15000 job departures, got ${machine.departures}`);

    const analytical = computeMMcAnalytical(1 / 1.6, 1 / 2.0, 2);
    const tolerance = 0.05;

    const rhoErr = relErr(machine.utilization, analytical.rho);
    assert.ok(
      rhoErr < tolerance,
      `Job-shop utilization relErr=${(rhoErr * 100).toFixed(2)}% (sim=${machine.utilization.toFixed(4)}, analytical=${analytical.rho.toFixed(4)})`,
    );

    const wErr = relErr(machine.meanSystemTime, analytical.w);
    assert.ok(
      wErr < 0.08,
      `Job-shop W relErr=${(wErr * 100).toFixed(2)}% (sim=${machine.meanSystemTime.toFixed(4)}, analytical=${analytical.w.toFixed(4)})`,
    );

    const littleErr = relErr(machine.meanSystemLength, machine.throughput * machine.meanSystemTime);
    assert.ok(littleErr < 0.02, `Job-shop Little's Law relErr=${(littleErr * 100).toFixed(2)}%`);
  });
});
