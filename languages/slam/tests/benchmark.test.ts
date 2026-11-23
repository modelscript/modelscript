// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSlamDeck } from "../src/parser/index.js";
import { simulateSlamModel } from "../src/solver/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

describe("@modelscript/slam — Combined Discrete-Continuous & Queuing Benchmarks", () => {
  it("matches Pritsker's classic Tanker-Refinery combined tank-filling & DETECT threshold benchmark", () => {
    // Storage tank SS(1) fills at 300*XX(1) - 150*XX(2) = +150/day while tanker unloads (XX(1)=1)
    // and refinery draws 150/day (XX(2)=1).
    // 1. At t = 1.0 day, SS(1) crosses 150.0 upward (XP) -> DETECT FULL stops unloading (XX(1)=0).
    // 2. Tank then drains at -150/day.
    // 3. At t = 1.8 days, SS(1) crosses 30.0 downward (XN) -> DETECT LOW shuts off refinery draw (XX(2)=0).
    // 4. Tank holds steady at SS(1) = 30.0 until t = 2.5 days.
    const deck = `
; Pritsker (1979) Tanker-Refinery Combined Discrete-Continuous Benchmark
GEN, PRITSKER, TANKER_REFINERY, 1/1/1979, 1;
LIMITS, 2, 2, 50;
CONTINUOUS, 1, 0, 0.005, 0.05, 0.05;
INTLC, SS(1)=0.0, XX(1)=1.0, XX(2)=1.0;
INITIALIZE, 0.0, 2.5;

DD(1) = 300.0 * XX(1) - 150.0 * XX(2);

NETWORK;
  FULL DETECT, SS(1), XP, 150.0, 0.0001;
       ASSIGN, XX(1)=0.0;
       COLCT, TNOW, TANK_FULL_TIME;
       TERMINATE;
  LOW  DETECT, SS(1), XN, 30.0, 0.0001;
       ASSIGN, XX(2)=0.0;
       COLCT, TNOW, TANK_LOW_TIME;
       TERMINATE;
ENDNETWORK;
FIN;
`;
    const model = parseSlamDeck(deck);
    const res = simulateSlamModel(model, { dt: 0.05 });

    const tolerance = 1e-3;
    assert.equal(res.detectedCrossings.length, 2, "Expected exactly 2 DETECT threshold crossings");

    const fullCross = res.detectedCrossings[0]!;
    assert.equal(fullCross.nodeId, "FULL");
    assert.ok(
      relErr(fullCross.time, 1.0) < tolerance,
      `Expected FULL crossing at t=1.0, got ${fullCross.time} (relErr=${relErr(fullCross.time, 1.0)})`,
    );
    assert.ok(relErr(fullCross.value, 150.0) < tolerance, `Expected FULL value=150.0, got ${fullCross.value}`);

    const lowCross = res.detectedCrossings[1]!;
    assert.equal(lowCross.nodeId, "LOW");
    assert.ok(
      relErr(lowCross.time, 1.8) < tolerance,
      `Expected LOW crossing at t=1.8, got ${lowCross.time} (relErr=${relErr(lowCross.time, 1.8)})`,
    );
    assert.ok(relErr(lowCross.value, 30.0) < tolerance, `Expected LOW value=30.0, got ${lowCross.value}`);

    // Final tank level held at 30.0 after refinery draw shutoff
    assert.ok(relErr(res.finalSS[1] ?? 0, 30.0) < tolerance, `Expected final SS(1)=30.0, got ${res.finalSS[1]}`);
    assert.equal(res.finalXX[1], 0.0);
    assert.equal(res.finalXX[2], 0.0);
  });

  it("matches analytical M/M/1 queuing parity (utilization, Lq, Wq, W) within tolerance", () => {
    // M/M/1 with lambda = 0.5 (mean interarrival = 2.0), mu = 1.0 (mean service = 1.0)
    // Analytical: rho = 0.5, Lq = 0.5, Wq = 1.0, W = 2.0
    const deck = `
GEN, PRITSKER, MM1_PARITY, 1/1/1979, 1;
LIMITS, 2, 2, 500;
INITIALIZE, 0.0, 10000.0;
NETWORK;
  RESOURCE/SERVER(1), 1;
  CREATE, EXPON(2.0), 0.0, 1;
  AWAIT(1), SERVER/1;
  ACTIVITY/1, EXPON(1.0);
  FREE, SERVER/1;
  COLCT, INT(1), SYS_TIME;
  TERMINATE;
ENDNETWORK;
FIN;
`;
    const model = parseSlamDeck(deck);
    const res = simulateSlamModel(model, { seed: 42 });

    const tolerance = 0.08; // 8% finite-horizon Monte Carlo tolerance (~5000 arrivals)
    const server = res.resourceStats["SERVER"];
    const queue = res.queueStats[1];
    const sysTime = res.colctStats["SYS_TIME"];

    assert.ok(server, "Expected SERVER resource stats");
    assert.ok(queue, "Expected file 1 queue stats");
    assert.ok(sysTime && sysTime.count > 4000, `Expected >4000 completed entities, got ${sysTime?.count}`);

    assert.ok(
      relErr(server.avgUtilization, 0.5) < tolerance,
      `M/M/1 rho parity: expected 0.5, got ${server.avgUtilization.toFixed(4)} (relErr=${relErr(server.avgUtilization, 0.5).toFixed(4)})`,
    );
    assert.ok(
      relErr(queue.avgLength, 0.5) < tolerance,
      `M/M/1 Lq parity: expected 0.5, got ${queue.avgLength.toFixed(4)} (relErr=${relErr(queue.avgLength, 0.5).toFixed(4)})`,
    );
    assert.ok(
      relErr(queue.avgWaitTime, 1.0) < tolerance,
      `M/M/1 Wq parity: expected 1.0, got ${queue.avgWaitTime.toFixed(4)} (relErr=${relErr(queue.avgWaitTime, 1.0).toFixed(4)})`,
    );
    assert.ok(
      relErr(sysTime.mean, 2.0) < tolerance,
      `M/M/1 W parity: expected 2.0, got ${sysTime.mean.toFixed(4)} (relErr=${relErr(sysTime.mean, 2.0).toFixed(4)})`,
    );
  });

  it("integrates continuous RK4 exponential decay ODE to < 1e-5 relative error", () => {
    const deck = `
GEN, ANALYST, RK4_DECAY, 1/1/1979, 1;
CONTINUOUS, 1, 0, 0.01, 0.05, 0.1;
INTLC, SS(1)=100.0;
INITIALIZE, 0.0, 4.0;
DD(1) = -0.5 * SS(1);
FIN;
`;
    const res = simulateSlamModel(parseSlamDeck(deck));
    const exact = 100.0 * Math.exp(-2.0);
    const actual = res.finalSS[1] ?? 0;
    const err = relErr(actual, exact);
    assert.ok(err < 1e-5, `Expected RK4 relErr < 1e-5, got ${err} (actual=${actual}, exact=${exact})`);
  });
});
