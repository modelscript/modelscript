// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { simulateSysml2 } from "../src/sysml2/index.js";

describe("SysML v2 Direct DAE Simulation Pipeline — Verification Suite", () => {
  it("Benchmark 1: Mass-Spring-Damper (Harmonic Oscillator) with damped oscillations", async () => {
    await initBltWasm();

    const oscillatorSysml = `
      constraint def HarmonicOscillator {
        in attribute m : ScalarValues::Real = 1.0;
        in attribute k : ScalarValues::Real = 100.0;
        in attribute d : ScalarValues::Real = 2.0;
        attribute x : ScalarValues::Real = 1.0;
        attribute v : ScalarValues::Real = 0.0;

        startTime = 0.0;
        stopTime = 4.0;
        step = 0.01;

        der(x) == v;
        m * der(v) + d * v + k * x == 0.0;
      }
    `;

    const res = await simulateSysml2(oscillatorSysml, {
      startTime: 0.0,
      stopTime: 4.0,
      step: 0.01,
      solver: "dopri5",
    });

    assert(res.t.length >= 400, "Should have at least 400 time points");
    assert(res.states.includes("x"), "States should contain 'x'");
    assert(res.states.includes("v"), "States should contain 'v'");

    const xIdx = res.states.indexOf("x");
    const vIdx = res.states.indexOf("v");

    // 1. Initial conditions
    const x0 = res.y[0]![xIdx]!;
    const v0 = res.y[0]![vIdx]!;
    assert.strictEqual(x0, 1.0, "x(0) must equal 1.0");
    assert(Math.abs(v0) < 1e-4, "v(0) must be approximately 0.0");

    // 2. Frequency & Oscillation detection (must cross zero multiple times)
    let zeroCrossings = 0;
    for (let i = 1; i < res.t.length; i++) {
      const prevX = res.y[i - 1]![xIdx]!;
      const currX = res.y[i]![xIdx]!;
      if ((prevX > 0 && currX <= 0) || (prevX < 0 && currX >= 0)) {
        zeroCrossings++;
      }
    }
    // Theoretical period is ~0.63s -> ~6-12 zero-crossings in 4.0s
    assert(zeroCrossings >= 6, `Expected at least 6 zero crossings, got ${zeroCrossings}`);

    // 3. Exponential envelope decay: |x(t)| <= e^(-(d/2m)*t) = e^(-t)
    const xEnd = res.y[res.t.length - 1]![xIdx]!;
    assert(Math.abs(xEnd) < 0.05, `Final state should be heavily damped (got ${xEnd})`);
  });

  it("Benchmark 2: RLC Transient Circuit with resonant overshoot and settling", async () => {
    await initBltWasm();

    const rlcSysml = `
      part def RLC_Circuit {
        attribute R : Real = 10.0;
        attribute L : Real = 0.1;
        attribute C : Real = 0.001;
        attribute v_in : Real = 12.0;
        attribute i : Real = 0.0;
        attribute v_c : Real = 0.0;

        startTime = 0.0;
        stopTime = 0.2;
        step = 0.0005;

        assert constraint {
          der(i) == (v_in - R * i - v_c) / L;
          der(v_c) == i / C;
        }
      }
    `;

    const res = await simulateSysml2(rlcSysml, {
      startTime: 0.0,
      stopTime: 0.2,
      step: 0.0005,
      solver: "dopri5",
    });

    const vcIdx = res.states.indexOf("v_c");
    const iIdx = res.states.indexOf("i");
    assert(vcIdx !== -1, "State v_c must exist");
    assert(iIdx !== -1, "State i must exist");

    // 1. Initial rest conditions
    assert.strictEqual(res.y[0]![vcIdx]!, 0.0, "v_c(0) must be 0");
    assert.strictEqual(res.y[0]![iIdx]!, 0.0, "i(0) must be 0");

    // 2. Resonant overshoot: capacitor voltage exceeds step input (12V)
    let maxVc = -Infinity;
    for (let step = 0; step < res.t.length; step++) {
      const vc = res.y[step]![vcIdx]!;
      if (vc > maxVc) maxVc = vc;
    }
    assert(maxVc > 13.0, `Expected resonant overshoot > 13.0V, observed max=${maxVc}V`);

    // 3. Steady-state settling: v_c -> 12V, i -> 0A
    const finalVc = res.y[res.t.length - 1]![vcIdx]!;
    const finalI = res.y[res.t.length - 1]![iIdx]!;
    assert(Math.abs(finalVc - 12.0) < 1.0, `Final capacitor voltage should approach 12V (got ${finalVc}V)`);
    assert(Math.abs(finalI) < 0.2, `Final inductor current should approach 0A (got ${finalI}A)`);
  });

  it("Benchmark 3: Hybrid Bouncing Ball with zero-crossing detection and velocity resets", async () => {
    await initBltWasm();

    const ballSysml = `
      part def BouncingBall {
        attribute h : Real = 10.0;
        attribute v : Real = 0.0;
        attribute g : Real = 9.81;
        attribute restitution : Real = 0.8;

        startTime = 0.0;
        stopTime = 3.5;
        step = 0.002;

        der(h) == v;
        der(v) == -g;

        when h <= 0.0 {
          assign v := -restitution * v;
        }
      }
    `;

    const res = await simulateSysml2(ballSysml, {
      startTime: 0.0,
      stopTime: 4.5,
      step: 0.002,
      solver: "dopri5",
    });

    const hIdx = res.states.indexOf("h");
    const vIdx = res.states.indexOf("v");
    assert(hIdx !== -1, "State 'h' must exist");
    assert(vIdx !== -1, "State 'v' must exist");

    // Initial position
    assert.strictEqual(res.y[0]![hIdx]!, 10.0, "Initial height h(0) must be 10.0");

    // Count bounces (velocity flips from negative to positive)
    let bounceCount = 0;
    for (let i = 1; i < res.t.length; i++) {
      const prevV = res.y[i - 1]![vIdx]!;
      const currV = res.y[i]![vIdx]!;
      if (prevV < -1.0 && currV > 1.0) {
        bounceCount++;
      }
    }

    assert(bounceCount >= 2, `Expected at least 2 bounces, detected ${bounceCount}`);

    // Height must not penetrate significantly into the ground (chattering prevention)
    let minH = Infinity;
    for (let i = 0; i < res.t.length; i++) {
      const h = res.y[i]![hIdx]!;
      if (h < minH) minH = h;
    }
    assert(minH >= -0.1, `Ball should not excessively penetrate ground (minH = ${minH})`);
  });

  it("Benchmark 4: CLI integration simulates .sysml model from command-line interface", async () => {
    const tmpSysmlPath = path.join(import.meta.dirname, "scratch-cli-oscillator.sysml");
    const sysmlCode = `
      constraint def OscillatorModel {
        attribute m : Real = 1.0;
        attribute k : Real = 100.0;
        attribute d : Real = 2.0;
        attribute x : Real = 1.0;
        attribute v : Real = 0.0;

        startTime = 0.0;
        stopTime = 1.0;
        step = 0.05;

        der(x) == v;
        m * der(v) + d * v + k * x == 0.0;
      }
    `;

    fs.writeFileSync(tmpSysmlPath, sysmlCode, "utf-8");

    try {
      const cliDist = path.resolve(import.meta.dirname, "../../../apps/cli/dist/main.js");
      const stdout = execFileSync(
        "node",
        [cliDist, "simulate", "OscillatorModel", tmpSysmlPath, "--format=json", "--stop-time=1.0"],
        { encoding: "utf-8" },
      );

      const parsed = JSON.parse(stdout);
      assert(Array.isArray(parsed), "JSON output should be an array of result rows");
      assert(parsed.length >= 15, "Should have time steps");
      assert("time" in parsed[0]!, "Row should contain time field");
      assert("x" in parsed[0]!, "Row should contain state variable x");
    } finally {
      if (fs.existsSync(tmpSysmlPath)) {
        fs.unlinkSync(tmpSysmlPath);
      }
    }
  });
});
