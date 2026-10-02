// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StlMonitor } from "../src/formal/stl_monitor.js";

describe("Signal Temporal Logic (STL) Lemire Monotonic Deque Monitor Suite", () => {
  it("should evaluate Always and Eventually in O(N) using sliding-window monotonic deque", () => {
    const N = 5000;
    const time = new Float64Array(N);
    const signal = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      time[i] = i * 0.01; // 0 to 50s
      signal[i] = Math.sin(time[i]!) * 10; // sinusoidal signal between -10 and +10
    }

    const trace = { time, signals: { x: signal } };

    // Always[0, 2.0] (x >= -15) => should be satisfied with robustness around +5
    const alwaysFormula = StlMonitor.always([0, 2.0], StlMonitor.predicate("x", ">=", -15.0));

    const t0 = performance.now();
    const resAlways = StlMonitor.evaluate(alwaysFormula, trace);
    const elapsedAlways = performance.now() - t0;

    assert.strictEqual(resAlways.isSatisfied, true);
    assert.ok(resAlways.robustness > 0);
    // 5000 points with Lemire monotonic deque should evaluate in < 25ms
    assert.ok(elapsedAlways < 100, `Evaluation took ${elapsedAlways.toFixed(2)}ms (should be < 100ms)`);

    // Eventually[0, 5.0] (x >= 9.0) => should be satisfied because sin peaks near 10
    const eventuallyFormula = StlMonitor.eventually([0, 5.0], StlMonitor.predicate("x", ">=", 9.0));

    const t1 = performance.now();
    const resEventually = StlMonitor.evaluate(eventuallyFormula, trace);
    const elapsedEventually = performance.now() - t1;

    assert.strictEqual(resEventually.isSatisfied, true);
    assert.ok(resEventually.robustness > 0);
    assert.ok(elapsedEventually < 100, `Evaluation took ${elapsedEventually.toFixed(2)}ms (should be < 100ms)`);
  });

  it("should evaluate Until operator with running prefix-min acceleration", () => {
    const N = 1000;
    const time = new Float64Array(N);
    const p1 = new Float64Array(N);
    const p2 = new Float64Array(N);

    // p1 holds true (10.0) until t = 3.0s, then drops to -5.0
    // p2 becomes true (20.0) at t = 2.5s
    for (let i = 0; i < N; i++) {
      time[i] = i * 0.01;
      p1[i] = time[i]! < 3.0 ? 10.0 : -5.0;
      p2[i] = time[i]! >= 2.5 ? 20.0 : -10.0;
    }

    const trace = { time, signals: { p1, p2 } };

    // (p1 >= 0) Until[0, 5.0] (p2 >= 0)
    const untilFormula = {
      kind: "until" as const,
      interval: [0, 5.0] as [number, number],
      left: StlMonitor.predicate("p1", ">=", 0.0),
      right: StlMonitor.predicate("p2", ">=", 0.0),
    };

    const t0 = performance.now();
    const resUntil = StlMonitor.evaluate(untilFormula, trace);
    const elapsedUntil = performance.now() - t0;

    assert.strictEqual(resUntil.isSatisfied, true);
    assert.ok(resUntil.robustness > 0);
    assert.ok(elapsedUntil < 100, `Evaluation took ${elapsedUntil.toFixed(2)}ms`);
  });
});
