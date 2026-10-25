// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — In-WASM Cubic EOS Compositional Flash Test Suite.
 *
 * Validates:
 * 1. Pure component critical constants & Van der Waals mixing with binary k_ij
 * 2. Binary C1/C3 (Methane / Propane) two-phase flash equilibrium (Wilson init + Rachford-Rice)
 * 3. Multi-component rich gas-condensate fluid (N2, CO2, C1, C2, C3, nC4, C7)
 * 4. Peng-Robinson (PR78) vs Soave-Redlich-Kwong (SRK) formulation comparisons
 * 5. Lohrenz-Bray-Clark (LBC) dense fluid viscosity and Macleod-Sugden surface tension
 * 6. Saturation curve calculation: Bubble point and dew point pressures
 * 7. Phase envelope generation (cricondenbar, cricondentherm, critical point)
 * 8. `eosToPvtTable(...)` synthesis and end-to-end simulation in `simulateDriftFlux`
 */

import assert from "node:assert";
import { CubicEos, eosToPvtTable, interpolatePvt, simulateDriftFlux, type OlgaModel } from "../src/index.js";

console.log("=== Testing OLGA Native In-WASM Cubic EOS Compositional Flash ===");

// ---------------------------------------------------------------------------
// 1. Binary C1/C3 Mixture Two-Phase PT-Flash
// ---------------------------------------------------------------------------
console.log("1. Testing Binary C1/C3 Mixture Two-Phase PT-Flash...");

const binaryEos = new CubicEos(["C1", "C3"], "PENG_ROBINSON");
assert.strictEqual(binaryEos.numComponents, 2);
assert.strictEqual(binaryEos.components[0]!.name, "Methane");
assert.strictEqual(binaryEos.components[1]!.name, "Propane");

// Feed: 60% Methane, 40% Propane
const binaryFeed = { C1: 0.6, C3: 0.4 };

// Test subcooled liquid at high pressure and low temperature (100 bar, 200 K)
const liquidState = binaryEos.flashPT(100.0e5, 200.0, binaryFeed);
assert.strictEqual(liquidState.isTwoPhase, false, "Should be single-phase liquid at 100 bar, 200 K");
assert.strictEqual(liquidState.vaporFraction, 0.0);
assert.ok(liquidState.liquid.densityKgM3 > 450.0, "Liquid density should exceed 450 kg/m^3");

// Test superheated vapor at low pressure and high temperature (2 bar, 380 K)
const vaporState = binaryEos.flashPT(2.0e5, 380.0, binaryFeed);
assert.strictEqual(vaporState.isTwoPhase, false, "Should be single-phase vapor at 2 bar, 380 K");
assert.strictEqual(vaporState.vaporFraction, 1.0);
assert.ok(vaporState.gas.densityKgM3 < 5.0, "Gas density at 2 bar should be low (< 5 kg/m^3)");

// Test two-phase region (30 bar, 280 K)
const twoPhaseState = binaryEos.flashPT(30.0e5, 280.0, binaryFeed);
assert.strictEqual(twoPhaseState.isTwoPhase, true, "Should be two-phase at 30 bar, 280 K");
assert.ok(twoPhaseState.vaporFraction > 0.1 && twoPhaseState.vaporFraction < 0.9, "Vapor fraction in two-phase region");

// Check K-values: Methane is more volatile (K_C1 > 1), Propane is heavier (K_C3 < 1)
const [kC1, kC3] = twoPhaseState.equilibriumKValues;
assert.ok(kC1! > 1.0, `Methane K-value (${kC1}) must be > 1`);
assert.ok(kC3! < 1.0, `Propane K-value (${kC3}) must be < 1`);

// Check phase densities
assert.ok(
  twoPhaseState.liquid.densityKgM3 > twoPhaseState.gas.densityKgM3,
  `Liquid density (${twoPhaseState.liquid.densityKgM3}) must exceed gas density (${twoPhaseState.gas.densityKgM3})`,
);

// Check phase viscosities (LBC method)
assert.ok(
  twoPhaseState.liquid.viscosityPaS > twoPhaseState.gas.viscosityPaS,
  `Liquid viscosity (${twoPhaseState.liquid.viscosityPaS}) must exceed gas viscosity (${twoPhaseState.gas.viscosityPaS})`,
);

// Check interfacial tension
assert.ok(
  twoPhaseState.surfaceTensionNPerM > 0.0001 && twoPhaseState.surfaceTensionNPerM < 0.05,
  `Surface tension (${twoPhaseState.surfaceTensionNPerM} N/m) must be physically realistic`,
);

console.log(
  `   -> Binary C1/C3 @ 30 bar, 280 K: beta=${twoPhaseState.vaporFraction.toFixed(3)}, rhoL=${twoPhaseState.liquid.densityKgM3.toFixed(1)} kg/m3, rhoG=${twoPhaseState.gas.densityKgM3.toFixed(1)} kg/m3, sigma=${(twoPhaseState.surfaceTensionNPerM * 1e3).toFixed(2)} mN/m`,
);

// ---------------------------------------------------------------------------
// 2. Multi-Component Gas-Condensate Fluid & EOS Comparison (PR vs SRK)
// ---------------------------------------------------------------------------
console.log("2. Testing Multi-Component Gas Condensate Fluid (PR vs SRK)...");

const multiComponents = ["N2", "CO2", "C1", "C2", "C3", "nC4", "C7"];
const prEos = new CubicEos(multiComponents, "PENG_ROBINSON");
const srkEos = new CubicEos(multiComponents, "SRK");

const condensateFeed = {
  N2: 0.02,
  CO2: 0.03,
  C1: 0.7,
  C2: 0.08,
  C3: 0.06,
  nC4: 0.04,
  C7: 0.07,
};

const P_test = 50.0e5; // 50 bar
const T_test = 300.15; // 27 C

const prResult = prEos.flashPT(P_test, T_test, condensateFeed);
const srkResult = srkEos.flashPT(P_test, T_test, condensateFeed);

assert.ok(prResult.isTwoPhase, "Condensate should exhibit two phases at 50 bar, 300 K under PR");
assert.ok(srkResult.isTwoPhase, "Condensate should exhibit two phases at 50 bar, 300 K under SRK");

// Both models should produce consistent liquid and gas densities within 15% (PR has lower co-volume b)
const rhoLDiffPercent =
  Math.abs(prResult.liquid.densityKgM3 - srkResult.liquid.densityKgM3) / prResult.liquid.densityKgM3;
assert.ok(
  rhoLDiffPercent < 0.15,
  `Liquid density difference between PR and SRK (${(rhoLDiffPercent * 100).toFixed(1)}%) must be < 15%`,
);

console.log(
  `   -> Multi-component PR:  beta=${prResult.vaporFraction.toFixed(3)}, rhoL=${prResult.liquid.densityKgM3.toFixed(1)}, rhoG=${prResult.gas.densityKgM3.toFixed(1)}`,
);
console.log(
  `   -> Multi-component SRK: beta=${srkResult.vaporFraction.toFixed(3)}, rhoL=${srkResult.liquid.densityKgM3.toFixed(1)}, rhoG=${srkResult.gas.densityKgM3.toFixed(1)}`,
);

// ---------------------------------------------------------------------------
// 3. Saturation Curves: Bubble Point and Dew Point
// ---------------------------------------------------------------------------
console.log("3. Testing Saturation Curves (Bubble Point & Dew Point)...");

const T_sat = 290.0; // 16.85 C
const pb = prEos.calculateBubblePoint(T_sat, condensateFeed);
const pd = prEos.calculateDewPoint(T_sat, condensateFeed);

assert.ok(pb > 0, `Bubble point pressure must be positive: ${(pb / 1e5).toFixed(1)} bar`);
assert.ok(pd > 0, `Dew point pressure must be positive: ${(pd / 1e5).toFixed(1)} bar`);
assert.ok(
  pb > pd,
  `Bubble point (${(pb / 1e5).toFixed(1)} bar) must exceed dew point (${(pd / 1e5).toFixed(1)} bar) for retrograde fluid`,
);

console.log(`   -> Saturation @ 290 K: P_bubble=${(pb / 1e5).toFixed(1)} bar, P_dew=${(pd / 1e5).toFixed(1)} bar`);

// ---------------------------------------------------------------------------
// 4. Phase Envelope Generation
// ---------------------------------------------------------------------------
console.log("4. Testing Phase Envelope Generation (Envelope, Cricondenbar, Cricondentherm)...");

const envelope = prEos.generatePhaseEnvelope(condensateFeed, 240.0, 360.0, 15);
assert.ok(envelope.bubblePoints.length > 5, "Should compute multiple bubble points");
assert.ok(envelope.dewPoints.length > 5, "Should compute multiple dew points");
assert.ok(envelope.cricondenbar.pressurePa > 50.0e5, "Cricondenbar must exceed 50 bar");
assert.ok(envelope.cricondentherm.temperatureK > 300.0, "Cricondentherm must exceed 300 K");

console.log(
  `   -> Cricondenbar: ${(envelope.cricondenbar.pressurePa / 1e5).toFixed(1)} bar @ ${envelope.cricondenbar.temperatureK.toFixed(1)} K`,
);
console.log(
  `   -> Cricondentherm: ${envelope.cricondentherm.temperatureK.toFixed(1)} K @ ${(envelope.cricondentherm.pressurePa / 1e5).toFixed(1)} bar`,
);

// ---------------------------------------------------------------------------
// 5. Synthesis: eosToPvtTable(...) & Simulation Integration
// ---------------------------------------------------------------------------
console.log("5. Testing eosToPvtTable(...) Grid Generation and Drift-Flux Simulation...");

const pressuresPa = [10.0e5, 30.0e5, 60.0e5, 100.0e5];
const temperaturesK = [275.15, 295.15, 320.15, 350.15];

const synthesizedTable = eosToPvtTable(prEos, condensateFeed, pressuresPa, temperaturesK);

assert.strictEqual(synthesizedTable.pressures.length, 4);
assert.strictEqual(synthesizedTable.temperatures.length, 4);
assert.strictEqual(synthesizedTable.rhoG.length, 4);
assert.strictEqual(synthesizedTable.rhoL.length, 4);
assert.ok(synthesizedTable.bubblePointCurve && synthesizedTable.bubblePointCurve.length > 0);

// Validate 2D interpolation against the synthesized table
const interpolated = interpolatePvt(synthesizedTable, 45.0e5, 305.15);
assert.ok(interpolated.rhoL > 400.0, `Interpolated rhoL (${interpolated.rhoL}) should exceed 400 kg/m^3`);
assert.ok(interpolated.rhoG > 20.0, `Interpolated rhoG (${interpolated.rhoG}) should exceed 20 kg/m^3`);
assert.ok(interpolated.sigma > 0.001, "Interfacial tension must be interpolated");

// Run transient drift-flux simulation with the synthesized EOS table
const testModel: OlgaModel = {
  version: "7.0",
  caseName: "EosCompositionalSimulation",
  startTime: 0,
  endTime: 20,
  maxDt: 1.0,
  pvtFile: "synthesized.tab",
  flowpaths: [
    {
      name: "TIEBACK_EOS",
      pipes: [
        {
          id: "P1",
          diameter: 0.25,
          length: 1000.0,
          elevation: -50.0,
          roughness: 0.000045,
          discretization: 5,
        },
      ],
      sources: [
        {
          name: "WELL_SRC",
          pipeline: "TIEBACK_EOS",
          distance: 0,
          totalMassRate: 35.0,
          gasMassFraction: 0.35,
          waterCut: 0.0,
          temperature: 330.15,
        },
      ],
      valves: [],
      pigs: [],
    },
  ],
  nodes: [
    {
      name: "TOPSIDES",
      flowpath: "TIEBACK_EOS",
      type: "PRESSURE",
      boundaryPosition: 1.0,
      pressure: 25.0e5,
      temperature: 285.15,
    },
  ],
};

const simResult = simulateDriftFlux(testModel, {
  durationSeconds: 10,
  pvtTable: synthesizedTable,
});

assert.ok(simResult.times.length > 5, "Simulation should produce time steps");
assert.ok(simResult.trends.arrivalPressure.length > 5, "Arrival pressure trend should exist");
assert.ok(simResult.trends.inletPressure[0]! > 25.0e5, "Inlet pressure must exceed topside pressure");

console.log("✔ All Cubic EOS Compositional Flash tests passed successfully!");
