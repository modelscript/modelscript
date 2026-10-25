// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateEn14363,
  gensysToModelica,
  lintGensysModel,
  parseGensysDeck,
  parseTrackGeometry,
  solveFastsim,
} from "../src/index.js";

describe("@modelscript/gensys", () => {
  it("should parse a GENSYS vehicle deck", () => {
    const deck = `
# Bogie Vehicle Model with line continuation & inline comments
body carbody 32000.0 65000.0 1800000.0 & # Mass and roll/pitch inertia
     1700000.0 0.0 0.0 1.2
body bogie1  3000.0   2500.0    3000.0 \
     5000.0 9.0 0.0 0.4 ! Bogie frame
wheelset ws1 1500.0 1.435 0.46 0.05 "S1002_profile.wheel"
spring sec_susp carbody bogie1 150000 150000 400000 20000 20000 35000
sub bogie_subsystem
`;
    const model = parseGensysDeck(deck, "PassengerCoach");
    assert.equal(model.bodies.size, 2);
    assert.equal(model.wheelsets.size, 1);
    assert.equal(model.couplings.size, 1);
    assert.equal(model.subsystems.length, 1);
    assert.equal(model.bodies.get("carbody")?.mass, 32000);

    const diags = lintGensysModel(model);
    assert.equal(diags.length, 0);

    const mo = gensysToModelica(model);
    assert.ok(mo.includes("model PassengerCoach"));
    assert.ok(mo.includes("Body carbody"));
  });

  it("should calculate FASTSIM tangential creep forces", () => {
    const res = solveFastsim({
      normalForce: 100000,
      longitudinalCreep: 0.002,
      lateralCreep: 0.001,
      spin: 0.0,
      ellipseSemiMajor: 0.006,
      ellipseSemiMinor: 0.005,
      shearModulus: 8.2e10,
      poissonRatio: 0.28,
      frictionCoeff: 0.35,
    });

    assert.ok(res.fx > 0);
    assert.ok(res.fy > 0);
    assert.ok(res.adhesionRatio <= 1.0);
  });

  it("should evaluate EN 14363 railway vehicle acceptance criteria", () => {
    // Normal acceptable run
    const resPass = evaluateEn14363({
      lateralForceY: 25,
      verticalForceQ: 80,
      nominalAxleLoadQ0: 160,
    });
    assert.ok(resPass.derailmentRiskPassed);
    assert.ok(resPass.prudhommeLimitPassed);
    assert.ok(resPass.yOverQ < 0.8);

    // High derailment risk
    const resFail = evaluateEn14363({
      lateralForceY: 70,
      verticalForceQ: 80,
      nominalAxleLoadQ0: 160,
    });
    assert.equal(resFail.derailmentRiskPassed, false);
  });

  it("should parse track geometry and irregularities", () => {
    const trackData = `
0.0   0.001  -0.001   0.0005  -0.0002   0.0   0.0
10.0  0.002  -0.001   0.0010  -0.0005   0.02  0.001
`;
    const geom = parseTrackGeometry(trackData, "Mainline");
    assert.equal(geom.points.length, 2);
    assert.equal(geom.points[1]?.cant, 0.02);
  });

  it("should evaluate wheel-rail equivalent conicity and Sperling ride index", async () => {
    const { evaluateEquivalentConicity } = await import("../src/contact/profile-analysis.js");
    const { calculateSperlingRideIndex } = await import("../src/verification/ride-comfort.js");

    const profileTable = [
      {
        lateralDisplacement: 0,
        rollingRadiusRight: 0.46,
        rollingRadiusLeft: 0.46,
        contactAngleRight: 0.05,
        contactAngleLeft: 0.05,
      },
      {
        lateralDisplacement: 3,
        rollingRadiusRight: 0.4603,
        rollingRadiusLeft: 0.4597,
        contactAngleRight: 0.08,
        contactAngleLeft: 0.03,
      },
    ];

    const conicityRes = evaluateEquivalentConicity(profileTable, 3.0, 0.46);
    assert.ok(conicityRes.equivalentConicity > 0);

    const wz = calculateSperlingRideIndex(0.5, 2.5, "vertical");
    assert.ok(wz > 1.0 && wz < 5.0);
  });

  it("should calculate Polach non-linear wheel-rail creep forces and evaluate suspension bump-stops", async () => {
    const { solvePolach, evaluateBumpStop } = await import("../src/contact/index.js");

    // 1. Polach test
    const polachRes = solvePolach({
      normalForce: 85000,
      longitudinalCreep: 0.003,
      lateralCreep: 0.001,
      wheelVelocity: 30.0, // 30 m/s (~108 km/h)
      ellipseSemiMajor: 0.006,
      ellipseSemiMinor: 0.005,
      staticFriction: 0.4,
      kineticFrictionRatio: 0.7,
    });

    assert.ok(polachRes.fx > 0);
    assert.ok(polachRes.fy > 0);
    assert.ok(polachRes.effectiveFrictionCoeff < 0.4 && polachRes.effectiveFrictionCoeff > 0.25);
    assert.ok(polachRes.adhesionRatio <= 1.0);

    // 2. Bump-stop test
    const bumpConfig = {
      name: "lateral_stop",
      clearanceGap: 0.025, // 25 mm gap
      linearStiffness: 2.5e6, // 2.5 MN/m
      nonlinearStiffnessCoeff: 5.0e8,
      damping: 10000,
    };

    // Within free-play clearance gap
    const freeRes = evaluateBumpStop(bumpConfig, 0.015, 0.1);
    assert.equal(freeRes.inContact, false);
    assert.equal(freeRes.totalForce, 0);

    // Contact with 10 mm penetration beyond gap
    const contactRes = evaluateBumpStop(bumpConfig, 0.035, 0.2);
    assert.ok(contactRes.inContact);
    assert.ok(contactRes.penetration > 0.0099);
    assert.ok(contactRes.totalForce > 25000);
  });

  it("should index GENSYS models into Salsa multi-file WorkspaceIndex", async () => {
    const { GensysWorkspaceIndex } = await import("../src/workspace-index.js");
    const index = new GensysWorkspaceIndex();

    const deck = `
body carbody 32000.0 65000.0 1800000.0 1700000.0 0 0 1.2
body bogie1  3000.0   2500.0    3000.0    5000.0 9 0 0.4
spring sec_susp carbody bogie1 150000 150000 400000 20000 20000 35000
sub bogie_rear
`;
    const res = index.indexFile("file:///workspace/Coach.calc", deck);
    assert.equal(index.fileCount, 1);
    assert.ok(res.symbols.size >= 4);
    assert.ok(res.byName.has("carbody"));
    assert.ok(res.byName.has("sec_susp"));
  });

  it("should lower direct spring-damper constitutive equations into DAEBuilder", async () => {
    const { lowerGensysToDae } = await import("../src/dae/gensys-to-dae.js");
    const { parseGensysDeck } = await import("../src/parser/deck-parser.js");

    const deck = `
body mass1 1000.0 500.0 500.0 500.0 0 0 0
spring k1 mass1 ground 200000 0 0 5000 0 0
`;
    const model = parseGensysDeck(deck, "SingleDofOscillator");
    const dae = lowerGensysToDae(model);

    // Verify state variables and constitutive force variables exist in the DAE arena
    assert.ok(dae.lookupVariable("mass1.x") >= 0);
    assert.ok(dae.lookupVariable("mass1.vx") >= 0);
    assert.ok(dae.lookupVariable("k1.fx") >= 0);

    // Verify equations count (3 kinematic + 3 dynamic for mass1 + 3 constitutive for k1 = 9 equations)
    assert.equal(dae.eqCount, 9);
    assert.equal(dae.varCount, 9);
  });

  it("should simulate direct DAE dynamics of a damped suspension oscillator", async () => {
    const { lowerGensysToDae } = await import("../src/dae/gensys-to-dae.js");
    const { parseGensysDeck } = await import("../src/parser/deck-parser.js");
    const { initBltWasm } = await import("@modelscript/runtime");
    const { simulateArena } = await import("@modelscript/simulate");

    await initBltWasm();

    const deck = `
body mass1 1000.0 500.0 500.0 500.0 0.05 0 0
spring k1 mass1 ground 200000 0 0 5000 0 0
`;
    const model = parseGensysDeck(deck, "Oscillator");
    const dae = lowerGensysToDae(model);

    const xIdx = dae.lookupVariable("mass1.x");
    if (xIdx >= 0) {
      dae.setVarStartValue(xIdx, 0.05); // 50 mm initial displacement
    }

    const result = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.5,
      step: 0.001,
    });

    assert.equal(result.t.length, 501);
    const xStateIdx = result.states.indexOf("mass1.x");
    assert.ok(xStateIdx >= 0);

    // Initial displacement
    assert.equal(result.y[0]![xStateIdx], 0.05);
    // Damped settling after 0.5 seconds
    const finalX = result.y[result.y.length - 1]![xStateIdx]!;
    assert.ok(Math.abs(finalX) < 0.05, "Oscillator amplitude must decay due to damping");
  });

  it("should evaluate parameter arithmetic and variable bindings in GENSYS decks", async () => {
    const { parseGensysDeck } = await import("../src/parser/deck-parser.js");

    const deck = `
# Parameter definition bindings
set m_car = 32000.0 * 1.05
set k_sec = (180000 + 20000) * 2

body carbody m_car 25000 (180000/2) 190000 0 0 1.8
spring s1 carbody ground k_sec 0 0 5000 0 0
`;
    const model = parseGensysDeck(deck, "ParamTest");
    const carbody = model.bodies.get("carbody");
    assert.ok(carbody);
    assert.equal(carbody.mass, 33600.0);
    assert.equal(carbody.inertia.jy, 90000.0);

    const s1 = model.couplings.get("s1");
    assert.ok(s1);
    assert.equal(s1.stiffness.x, 400000.0);
  });

  it("should resolve and merge hierarchical child subsystems across workspace files", async () => {
    const { GensysWorkspaceIndex } = await import("../src/workspace-index.js");
    const index = new GensysWorkspaceIndex();

    const bogieDeck = `
body frame 2500.0 1200.0 1800.0 2200.0 0 0 0.5
spring prim_front frame ground 800000 800000 1200000 30000 30000 45000
`;
    index.indexFile("file:///workspace/bogie_front.sub", bogieDeck);

    const carDeck = `
body carbody 32000.0 25000.0 180000.0 190000.0 0 0 1.8
sub bogie_front
`;
    index.indexFile("file:///workspace/Coach.calc", carDeck);

    const coachModel = index.getModel("file:///workspace/Coach.calc")!;
    assert.equal(coachModel.bodies.size, 1);
    assert.equal(coachModel.subsystems.length, 1);

    const merged = index.resolveSubsystems(coachModel, "file:///workspace/Coach.calc");
    assert.equal(merged.bodies.size, 2);
    assert.ok(merged.bodies.has("carbody"));
    assert.ok(merged.bodies.has("bogie_front.frame"));
    assert.ok(merged.couplings.has("bogie_front.prim_front"));
  });

  it("should achieve 100% numerical parity between WebAssembly contact kernel and pure TS reference", async () => {
    const { getWasmContactBridge, pureTsSolveFastsim, pureTsSolvePolach } = await import("../src/contact/index.js");

    const bridge = getWasmContactBridge();
    assert.ok(bridge);

    // 1. FASTSIM parity across varying creep combinations
    const fastsimTestCases = [
      {
        normalForce: 50000,
        longitudinalCreep: 0.002,
        lateralCreep: 0.001,
        spin: 0.05,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.35,
      },
      {
        normalForce: 80000,
        longitudinalCreep: 0.005,
        lateralCreep: -0.003,
        spin: -0.1,
        ellipseSemiMajor: 0.008,
        ellipseSemiMinor: 0.006,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.4,
      },
      {
        normalForce: 25000,
        longitudinalCreep: 0.015,
        lateralCreep: 0.008,
        spin: 0.0,
        ellipseSemiMajor: 0.005,
        ellipseSemiMinor: 0.004,
        shearModulus: 8.0e10,
        poissonRatio: 0.3,
        frictionCoeff: 0.3,
      },
      {
        normalForce: 0,
        longitudinalCreep: 0.002,
        lateralCreep: 0.001,
        spin: 0.0,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.35,
      },
    ];

    for (const inp of fastsimTestCases) {
      const wasmRes = bridge.solveFastsim(inp, 20);
      const tsRes = pureTsSolveFastsim(inp, 20);

      assert.ok(Math.abs(wasmRes.fx - tsRes.fx) < 1e-10, `FASTSIM Fx diff: wasm=${wasmRes.fx}, ts=${tsRes.fx}`);
      assert.ok(Math.abs(wasmRes.fy - tsRes.fy) < 1e-10, `FASTSIM Fy diff: wasm=${wasmRes.fy}, ts=${tsRes.fy}`);
      assert.ok(Math.abs(wasmRes.mz - tsRes.mz) < 1e-10, `FASTSIM Mz diff: wasm=${wasmRes.mz}, ts=${tsRes.mz}`);
      assert.ok(Math.abs(wasmRes.adhesionRatio - tsRes.adhesionRatio) < 1e-12, `FASTSIM adhesion diff`);
    }

    // 2. Polach non-linear creep parity
    const polachTestCases = [
      {
        normalForce: 60000,
        longitudinalCreep: 0.003,
        lateralCreep: 0.001,
        wheelVelocity: 40,
        ellipseSemiMajor: 0.007,
        ellipseSemiMinor: 0.005,
      },
      {
        normalForce: 90000,
        longitudinalCreep: 0.008,
        lateralCreep: -0.004,
        wheelVelocity: 60,
        ellipseSemiMajor: 0.008,
        ellipseSemiMinor: 0.006,
        staticFriction: 0.42,
        kineticFrictionRatio: 0.7,
      },
      {
        normalForce: 30000,
        longitudinalCreep: 0.025,
        lateralCreep: 0.015,
        wheelVelocity: 25,
        ellipseSemiMajor: 0.005,
        ellipseSemiMinor: 0.004,
      },
      {
        normalForce: 0,
        longitudinalCreep: 0.005,
        lateralCreep: 0.002,
        wheelVelocity: 30,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
      },
    ];

    for (const inp of polachTestCases) {
      const wasmRes = bridge.solvePolach(inp);
      const tsRes = pureTsSolvePolach(inp);

      assert.ok(Math.abs(wasmRes.fx - tsRes.fx) < 1e-10, `Polach Fx diff: wasm=${wasmRes.fx}, ts=${tsRes.fx}`);
      assert.ok(Math.abs(wasmRes.fy - tsRes.fy) < 1e-10, `Polach Fy diff: wasm=${wasmRes.fy}, ts=${tsRes.fy}`);
      assert.ok(Math.abs(wasmRes.resultantForce - tsRes.resultantForce) < 1e-10, `Polach Resultant diff`);
      assert.ok(Math.abs(wasmRes.effectiveFrictionCoeff - tsRes.effectiveFrictionCoeff) < 1e-12);
      assert.ok(Math.abs(wasmRes.adhesionRatio - tsRes.adhesionRatio) < 1e-12);
    }
  });

  it("should evaluate batched wheel-rail contact patches in WebAssembly with high throughput", async () => {
    const { getWasmContactBridge } = await import("../src/contact/index.js");
    const bridge = getWasmContactBridge();

    // 8 contact patches for a 4-axle rail vehicle
    const inputs = [
      {
        normalForce: 52000,
        longitudinalCreep: 0.002,
        lateralCreep: 0.001,
        spin: 0.02,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 49000,
        longitudinalCreep: 0.002,
        lateralCreep: -0.001,
        spin: -0.02,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 51000,
        longitudinalCreep: 0.002,
        lateralCreep: 0.0008,
        spin: 0.015,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 50000,
        longitudinalCreep: 0.002,
        lateralCreep: -0.0008,
        spin: -0.015,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 53000,
        longitudinalCreep: 0.0015,
        lateralCreep: 0.0012,
        spin: 0.01,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 48000,
        longitudinalCreep: 0.0015,
        lateralCreep: -0.0012,
        spin: -0.01,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 51500,
        longitudinalCreep: 0.0018,
        lateralCreep: 0.0009,
        spin: 0.012,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
      {
        normalForce: 49500,
        longitudinalCreep: 0.0018,
        lateralCreep: -0.0009,
        spin: -0.012,
        ellipseSemiMajor: 0.006,
        ellipseSemiMinor: 0.005,
        shearModulus: 8.2e10,
        poissonRatio: 0.28,
        frictionCoeff: 0.38,
      },
    ];

    const results = bridge.batchFastsim(inputs, 15);
    assert.equal(results.length, 8);
    for (const r of results) {
      assert.ok(r.fx > 0, "Forward driving force must be positive");
      assert.ok(r.adhesionRatio > 0 && r.adhesionRatio <= 1.0);
    }

    // Benchmark: 2,000 FASTSIM strip integrations
    const N = 2000;
    const tStart = performance.now();
    for (let k = 0; k < N; k++) {
      bridge.solveFastsim(inputs[0]!, 10);
    }
    const tElapsed = performance.now() - tStart;
    assert.ok(tElapsed < 500, `Benchmark took ${tElapsed}ms for ${N} FASTSIM solves (< 500ms expected)`);
  });
});
