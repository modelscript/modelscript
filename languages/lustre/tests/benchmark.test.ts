// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Numerical & Formal Verification Benchmarks for `@modelscript/lustre`:
 *   1. Classic Halbwachs Stopwatch / Counter (Proc. IEEE 1991)
 *   2. Discrete Euler Integrator vs. analytical integral with `relErr` and `rmse`
 *   3. Safety-property synchronous observer invariant verification (Halbwachs et al. 1993)
 *   4. Sub-sampled `when` / `current` / `merge` clock parity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkLustreObserver, lintLustre, parseLustre, simulateLustre, type LustreStepInputs } from "../src/index.js";

describe("@modelscript/lustre — Synchronous Dataflow Benchmarks", () => {
  it("Benchmark 1: Classic Halbwachs Stopwatch & Resettable Counter (1991)", () => {
    const src = `
node Edge(x: bool) returns (y: bool);
let
  y = false -> (x and not pre(x));
tel

node Stopwatch(on_off, reset, freeze: bool) returns (time: int);
var
  running, frozen: bool;
  cpt: int;
let
  running = false -> if Edge(on_off) then not pre(running) else pre(running);
  frozen = false -> if Edge(freeze) then not pre(frozen) else pre(frozen);
  cpt = 0 -> if reset and not running then 0
             else if running then pre(cpt) + 1
             else pre(cpt);
  time = 0 -> if frozen then pre(time) else cpt;
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(lintLustre(prog).filter((d) => d.severity === "error").length, 0);

    // Tick 0: idle (0)
    // Tick 1: press on_off -> running=true, cpt=1, time=1
    // Tick 2: release on_off -> running=true, cpt=2, time=2
    // Tick 3: press freeze -> frozen=true, cpt=3, time=2 (frozen display)
    // Tick 4: release freeze -> frozen=true, cpt=4, time=2
    // Tick 5: press freeze -> frozen=false, cpt=5, time=5 (catches up!)
    // Tick 6: press on_off -> running=false, cpt=5, time=5
    // Tick 7: press reset -> running=false, cpt=0, time=0
    const inputs: LustreStepInputs[] = [
      { on_off: false, reset: false, freeze: false },
      { on_off: true, reset: false, freeze: false },
      { on_off: false, reset: false, freeze: false },
      { on_off: false, reset: false, freeze: true },
      { on_off: false, reset: false, freeze: false },
      { on_off: false, reset: false, freeze: true },
      { on_off: true, reset: false, freeze: false },
      { on_off: false, reset: true, freeze: false },
    ];

    const sim = simulateLustre(prog, inputs, { nodeName: "Stopwatch" });
    const times = sim.outputs.map((o) => o["time"]);
    assert.deepStrictEqual(times, [0, 1, 2, 2, 2, 5, 5, 0]);
  });

  it("Benchmark 2: Discrete Euler Integrator vs. analytical integral of sin(t) (relErr & rmse)", () => {
    const src = `
node Integrator(u, dt: real) returns (y: real);
let
  y = 0.0 -> (pre(y) + dt * u);
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(lintLustre(prog).length, 0);

    // Integrate u(t) = sin(t) on [0, pi], analytical integral I(t) = 1 - cos(t), I(pi) = 2.0
    const N = 1000;
    const dt = Math.PI / N;
    const trace: LustreStepInputs[] = [];
    for (let k = 0; k <= N; k++) {
      // Midpoint evaluation u_k = sin((k - 0.5) * dt) for tick k >= 1
      const tMid = k === 0 ? 0 : (k - 0.5) * dt;
      trace.push({ u: Math.sin(tMid), dt });
    }

    const sim = simulateLustre(prog, trace, { nodeName: "Integrator" });
    let sumSqErr = 0;
    let maxAbsErr = 0;
    for (let k = 0; k <= N; k++) {
      const t = k * dt;
      const analytical = 1.0 - Math.cos(t);
      const numeric = Number(sim.outputs[k]!["y"]);
      const err = Math.abs(numeric - analytical);
      sumSqErr += err * err;
      if (err > maxAbsErr) maxAbsErr = err;
    }

    const rmse = Math.sqrt(sumSqErr / (N + 1));
    const finalNum = Number(sim.outputs[N]!["y"]);
    const finalExact = 2.0;
    const relErr = Math.abs(finalNum - finalExact) / finalExact;

    assert.ok(relErr < 1e-4, `Expected relErr < 1e-4, got ${relErr}`);
    assert.ok(rmse < 1e-4, `Expected rmse < 1e-4, got ${rmse}`);
  });

  it("Benchmark 3: Safety-property synchronous observer invariant (mutual exclusion & bounded counter)", () => {
    const src = `
node BoundedCounter(inc, reset: bool) returns (c: int);
let
  c = 0 -> if reset then 0
           else if inc and pre(c) < 5 then pre(c) + 1
           else pre(c);
tel

node SafetyObserver(inc, reset: bool) returns (ok: bool);
var
  c: int;
let
  c = BoundedCounter(inc, reset);
  ok = (c >= 0) and (c <= 5) and (true -> (reset or c >= pre(c)));
  assert ok;
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(lintLustre(prog).filter((d) => d.severity === "error").length, 0);

    const trace: LustreStepInputs[] = [];
    for (let k = 0; k < 20; k++) {
      trace.push({ inc: k % 2 === 0, reset: k === 12 });
    }

    const obs = checkLustreObserver(prog, "SafetyObserver", trace, { propertyOutput: "ok" });
    assert.strictEqual(obs.satisfied, true, `Expected safety invariant to hold on all ticks`);
    assert.strictEqual(obs.firstViolationStep, null);
    assert.strictEqual(obs.violations.length, 0);

    // Negative check: observer that violates property when c reaches 3
    const violatingProg = parseLustre(`
${src}
node StrictObserver(inc, reset: bool) returns (ok: bool);
var c: int;
let
  c = BoundedCounter(inc, reset);
  ok = c < 3;
tel
`);
    const badObs = checkLustreObserver(violatingProg, "StrictObserver", trace, { propertyOutput: "ok" });
    assert.strictEqual(badObs.satisfied, false);
    assert.ok(badObs.firstViolationStep !== null && badObs.firstViolationStep > 0);
  });

  it("Benchmark 4: Sub-sampled `when` / `current` / `merge` clock parity", () => {
    const src = `
node SubSampleParity(x: int; slow_clk: bool) returns (held: int; muxed: int);
var
  xs: int when slow_clk;
  zero_off: int when not slow_clk;
let
  xs = x when slow_clk;
  zero_off = 0 when not slow_clk;
  held = current(xs);
  muxed = merge slow_clk (xs) (zero_off);
tel
`;
    const prog = parseLustre(src);
    assert.strictEqual(lintLustre(prog).filter((d) => d.severity === "error").length, 0);

    const trace: LustreStepInputs[] = [
      { x: 10, slow_clk: true },
      { x: 20, slow_clk: false },
      { x: 30, slow_clk: false },
      { x: 40, slow_clk: true },
      { x: 50, slow_clk: false },
      { x: 60, slow_clk: true },
    ];

    const sim = simulateLustre(prog, trace, { nodeName: "SubSampleParity" });
    const heldVals = sim.outputs.map((o) => o["held"]);
    const muxVals = sim.outputs.map((o) => o["muxed"]);

    assert.deepStrictEqual(heldVals, [10, 10, 10, 40, 40, 60]);
    assert.deepStrictEqual(muxVals, [10, 0, 0, 40, 0, 60]);
  });
});
