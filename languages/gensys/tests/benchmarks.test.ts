// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateEn14363, getWasmContactBridge, lowerGensysToDae, parseGensysDeck } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "testsuite", "ManchesterBenchmark.ins");

describe("GENSYS Manchester Benchmark Railway Vehicle Simulation", () => {
  it("should parse and validate the Manchester Benchmark vehicle deck", () => {
    const deck = fs.readFileSync(fixturePath, "utf-8");
    const model = parseGensysDeck(deck, "ManchesterBenchmark");

    assert.equal(model.name, "ManchesterBenchmark");
    assert.equal(model.bodies.size, 3); // carbody, bogie_front, bogie_rear
    assert.equal(model.wheelsets.size, 4); // ws1, ws2, ws3, ws4
    assert.equal(model.couplings.size, 6); // 2 secondary + 4 primary

    const carbody = model.bodies.get("carbody")!;
    assert.equal(carbody.mass, 32000.0);
    assert.equal(carbody.inertia.jx, 25000.0);
    assert.equal(carbody.inertia.jy, 180000.0);
    assert.equal(carbody.inertia.jz, 190000.0);

    const bogieFront = model.bodies.get("bogie_front")!;
    assert.equal(bogieFront.mass, 3200.0);

    assert.equal(model.simulationConfig?.speed, 40.0);
    assert.equal(model.simulationConfig?.tStop, 5.0);
  });

  it("should evaluate EN 14363 running safety and derailment criteria for Manchester Benchmark", () => {
    const deck = fs.readFileSync(fixturePath, "utf-8");
    const model = parseGensysDeck(deck, "ManchesterBenchmark");

    // Nominal wheel load Q = (32000 + 2*3200 + 4*1800) * 9.81 / 8 ≈ 56.0 kN per wheel
    // Nominal axle load 2*Q0 = 112.0 kN
    const Q_wheel = 56.0;
    const Y_lateral = 18.5; // 18.5 kN lateral guiding force on curve R=600m
    const Q0_axle = 112.0;

    const enResult = evaluateEn14363({
      lateralForceY: Y_lateral,
      verticalForceQ: Q_wheel,
      nominalAxleLoadQ0: Q0_axle,
    });

    // Derailment ratio Y/Q = 18.5 / 56.0 = 0.330 <= 0.80
    assert.equal(enResult.derailmentRiskPassed, true);
    assert.ok(enResult.yOverQ < 0.4);

    // Prud'homme track lateral shifting force limit
    assert.equal(enResult.prudhommeLimitPassed, true);
    assert.ok(enResult.prudhommeLimit > 40.0);
  });

  it("should evaluate wheel-rail contact forces across all 8 contact patches in WebAssembly", () => {
    const bridge = getWasmContactBridge();

    // 8 contact patches on 4 wheelsets
    const contactInputs = [
      {
        normalForce: 58000,
        longitudinalCreep: 0.002,
        lateralCreep: 0.003,
        spin: 0.04,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 54000,
        longitudinalCreep: 0.002,
        lateralCreep: -0.003,
        spin: -0.04,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 57000,
        longitudinalCreep: 0.0018,
        lateralCreep: 0.0025,
        spin: 0.03,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 55000,
        longitudinalCreep: 0.0018,
        lateralCreep: -0.0025,
        spin: -0.03,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 56500,
        longitudinalCreep: 0.0015,
        lateralCreep: 0.002,
        spin: 0.02,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 55500,
        longitudinalCreep: 0.0015,
        lateralCreep: -0.002,
        spin: -0.02,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 56000,
        longitudinalCreep: 0.0012,
        lateralCreep: 0.0018,
        spin: 0.015,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 56000,
        longitudinalCreep: 0.0012,
        lateralCreep: -0.0018,
        spin: -0.015,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
    ];

    const results = bridge.batchFastsim(contactInputs, 20);
    assert.equal(results.length, 8);

    for (const res of results) {
      assert.ok(res.fx > 0);
      assert.ok(res.adhesionRatio > 0 && res.adhesionRatio <= 1.0);
    }
  });

  it("should lower Manchester Benchmark model into DAEBuilder and integrate multi-body suspension", async () => {
    await initBltWasm();

    const deck = fs.readFileSync(fixturePath, "utf-8");
    const model = parseGensysDeck(deck, "ManchesterBenchmark");
    const dae = lowerGensysToDae(model);

    // 3 bodies * 6 vars + 6 springs * 3 vars = 36 variables
    assert.equal(dae.varCount, 36);
    assert.equal(dae.eqCount, 36);

    const carbodyZIdx = dae.lookupVariable("carbody.z");
    assert.ok(carbodyZIdx >= 0);
    dae.setVarStartValue(carbodyZIdx, 0.03); // 30 mm initial secondary bump displacement

    const result = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.5,
      step: 0.002,
    });

    assert.ok(result.t.length > 100);
    const zStateIdx = result.states.indexOf("carbody.z");
    assert.ok(zStateIdx >= 0);
    assert.equal(result.y[0]![zStateIdx], 0.03);

    // Settling under gravity sag and secondary suspension damping
    const finalZ = result.y[result.y.length - 1]![zStateIdx]!;
    assert.ok(
      finalZ < 0 && finalZ > -1.0,
      `Expected realistic suspension static sag between -1.0m and 0, got ${finalZ}`,
    );
  });
});
