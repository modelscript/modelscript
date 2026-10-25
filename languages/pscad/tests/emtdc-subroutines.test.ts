// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { FortranExecutionContext } from "../src/script/fortran-codegen.js";
import { compileFortranSegment } from "../src/script/fortran-codegen.js";

describe("PSCAD EMTDC Companion Subroutines Dispatch Suite", () => {
  test("REALPOLE: first-order lag filter H(s) = K / (1 + sT)", () => {
    // REALPOLE(K, T, Vin, Vout)
    const script = `
CALL REALPOLE(2.0, 0.01, $Vin, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    assert.ok(compiled.numRealStates >= 2, "REALPOLE requires at least 2 real state slots");

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(0);
    const dt = 1e-4; // 100 us
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt,
      time: 0,
      firstStep: true,
      storf,
      stori,
      getInput: (name) => (name === "Vin" ? 1.0 : 0.0),
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    // Step 0 (first step)
    compiled.step(ctx);
    ctx.firstStep = false;

    // Simulate for 50 ms (5 * Tau)
    const steps = Math.round(0.05 / dt);
    for (let i = 1; i <= steps; i++) {
      ctx.time = i * dt;
      compiled.step(ctx);
    }

    // Steady state for input 1.0 and K=2.0 is 2.0 * (1 - exp(-5)) ~ 1.9865
    assert.ok(Math.abs(outVal - 2.0) < 0.03, `Expected REALPOLE output to approach 2.0, got ${outVal}`);
  });

  test("DELAY1: one-step discrete delay", () => {
    // DELAY1(Vin, Vout)
    const script = `
CALL DELAY1($Vin, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    assert.ok(compiled.numRealStates >= 1, "DELAY1 requires at least 1 real state slot");

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(0);
    let currentIn = 10.0;
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt: 1e-3,
      time: 0,
      firstStep: true,
      storf,
      stori,
      getInput: () => currentIn,
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    // Step 0: initialization
    compiled.step(ctx);
    assert.equal(outVal, 10.0);

    // Step 1: change input to 25.0, delay output should still be 10.0
    ctx.firstStep = false;
    ctx.time = 1e-3;
    currentIn = 25.0;
    compiled.step(ctx);
    assert.equal(outVal, 10.0, "At step 1, DELAY1 output should still reflect step 0 input");

    // Step 2: output should now reflect 25.0
    ctx.time = 2e-3;
    currentIn = 50.0;
    compiled.step(ctx);
    assert.equal(outVal, 25.0, "At step 2, DELAY1 output should reflect step 1 input");
  });

  test("INTGRL: integrator H(s) = K / s using trapezoidal rule", () => {
    // INTGRL(K, Vin, Vout)
    const script = `
CALL INTGRL(5.0, $Vin, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    assert.ok(compiled.numRealStates >= 2, "INTGRL requires 2 real state slots");

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(0);
    const dt = 1e-3; // 1 ms
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt,
      time: 0,
      firstStep: true,
      storf,
      stori,
      getInput: () => 2.0, // constant input 2.0
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    // Step 0
    compiled.step(ctx);
    assert.equal(outVal, 0.0, "Integrator starts at 0");
    ctx.firstStep = false;

    // Run for 100 ms (t = 0.1 s)
    // Analytical integral of K * u = 5.0 * 2.0 * t = 10.0 * 0.1 = 1.0
    const steps = 100;
    for (let i = 1; i <= steps; i++) {
      ctx.time = i * dt;
      compiled.step(ctx);
    }

    assert.ok(Math.abs(outVal - 1.0) < 1e-6, `Expected INTGRL output ~1.0, got ${outVal}`);
  });

  test("LEADLAG: lead-lag filter H(s) = K*(1 + s*T1) / (1 + s*T2)", () => {
    // LEADLAG(K, T1, T2, Vin, Vout)
    const script = `
CALL LEADLAG(3.0, 0.02, 0.05, $Vin, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    assert.ok(compiled.numRealStates >= 2, "LEADLAG requires 2 real state slots");

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(0);
    const dt = 1e-4;
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt,
      time: 0,
      firstStep: true,
      storf,
      stori,
      getInput: () => 1.0,
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    compiled.step(ctx);
    ctx.firstStep = false;

    // Run for 0.5s (10 * T2)
    const steps = Math.round(0.5 / dt);
    for (let i = 1; i <= steps; i++) {
      ctx.time = i * dt;
      compiled.step(ctx);
    }

    // Steady state gain is K = 3.0
    assert.ok(Math.abs(outVal - 3.0) < 0.01, `Expected LEADLAG steady-state output ~3.0, got ${outVal}`);
  });

  test("DIFF: derivative filter H(s) = K*s / (1 + s*T)", () => {
    // DIFF(K, T, Vin, Vout)
    const script = `
CALL DIFF(1.0, 0.005, $Vin, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    assert.ok(compiled.numRealStates >= 2, "DIFF requires 2 real state slots");

    const storf = new Float64Array(compiled.numRealStates);
    const stori = new Int32Array(0);
    const dt = 1e-4;
    let currentIn = 0;
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt,
      time: 0,
      firstStep: true,
      storf,
      stori,
      getInput: () => currentIn,
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    // Ramp input u(t) = 10.0 * t. Derivative is du/dt = 10.0.
    // Steady-state of K*s/(1+sT) for a ramp is K * 10.0 = 10.0.
    compiled.step(ctx);
    ctx.firstStep = false;

    const steps = Math.round(0.05 / dt); // 50 ms (10 time constants)
    for (let i = 1; i <= steps; i++) {
      ctx.time = i * dt;
      currentIn = 10.0 * ctx.time;
      compiled.step(ctx);
    }

    assert.ok(
      Math.abs(outVal - 10.0) < 0.05,
      `Expected DIFF steady-state output for slope 10.0 to approach 10.0, got ${outVal}`,
    );
  });

  test("LIMITER: hard clamp limiter [Vmin, Vmax]", () => {
    const script = `
CALL LIMITER($Vin, -10.0, 10.0, $Vout)
`;
    const compiled = compileFortranSegment(script, {}, {});
    const storf = new Float64Array(0);
    const stori = new Int32Array(0);
    let inVal = 0;
    let outVal = 0;

    const ctx: FortranExecutionContext = {
      dt: 1e-3,
      time: 0,
      firstStep: false,
      storf,
      stori,
      getInput: () => inVal,
      setOutput: (name, val) => {
        if (name === "Vout") outVal = val;
      },
    };

    inVal = 5.0;
    compiled.step(ctx);
    assert.equal(outVal, 5.0);

    inVal = 25.0;
    compiled.step(ctx);
    assert.equal(outVal, 10.0, "Should clamp to upper bound 10.0");

    inVal = -30.0;
    compiled.step(ctx);
    assert.equal(outVal, -10.0, "Should clamp to lower bound -10.0");
  });

  test("SIN_COS: simultaneous trigonometric projection", () => {
    const script = `
CALL SIN_COS($Theta, $SinOut, $CosOut)
`;
    const compiled = compileFortranSegment(script, {}, {});
    const storf = new Float64Array(0);
    const stori = new Int32Array(0);
    let sinVal = 0;
    let cosVal = 0;

    const ctx: FortranExecutionContext = {
      dt: 1e-3,
      time: 0,
      firstStep: false,
      storf,
      stori,
      getInput: () => Math.PI / 6, // 30 degrees
      setOutput: (name, val) => {
        if (name === "SinOut") sinVal = val;
        if (name === "CosOut") cosVal = val;
      },
    };

    compiled.step(ctx);
    assert.ok(Math.abs(sinVal - 0.5) < 1e-6, `Expected sin(pi/6) = 0.5, got ${sinVal}`);
    assert.ok(Math.abs(cosVal - Math.sqrt(3) / 2) < 1e-6, `Expected cos(pi/6) = sqrt(3)/2, got ${cosVal}`);
  });

  test("CURRENT_SOURCE & E_BRANCH: companion circuit stamps", () => {
    const script = `
CALL CURRENT_SOURCE("Bus1", "GND", 12.5)
CALL E_BRANCH("Bus1", "Bus2", 0.5, 0.01, 1e-6, 120.0)
`;
    const compiled = compileFortranSegment(script, {}, {});

    let injected = false;
    let stamped = false;

    const ctx: FortranExecutionContext = {
      dt: 1e-3,
      time: 0,
      firstStep: false,
      storf: new Float64Array(0),
      stori: new Int32Array(0),
      getInput: () => 0,
      setOutput: () => {},
      injectCurrent: (from, to, val) => {
        assert.equal(from, "Bus1");
        assert.equal(to, "GND");
        assert.equal(val, 12.5);
        injected = true;
      },
      stampBranch: (from, to, r, l, c, e) => {
        assert.equal(from, "Bus1");
        assert.equal(to, "Bus2");
        assert.equal(r, 0.5);
        assert.equal(l, 0.01);
        assert.equal(c, 1e-6);
        assert.equal(e, 120.0);
        stamped = true;
      },
    };

    compiled.step(ctx);
    assert.ok(injected, "CURRENT_SOURCE should invoke ctx.injectCurrent");
    assert.ok(stamped, "E_BRANCH should invoke ctx.stampBranch");
  });
});
