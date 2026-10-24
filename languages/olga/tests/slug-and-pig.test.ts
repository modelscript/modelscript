// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { lintOlgaModel } from "../src/lints/index.js";
import { solveDriftFluxDAE } from "../src/solver/drift-flux-dae.js";
import { evaluateEmulsionViscosity } from "../src/solver/emulsion-rheology.js";
import { calculateMechanisticShear, classifyFlowRegime, MechanisticFlowRegime } from "../src/solver/flow-regimes.js";
import { PigTracker } from "../src/solver/pig-tracker.js";
import { SlugTracker } from "../src/solver/slug-tracker.js";
import type { OlgaModel } from "../src/types.js";

console.log("=== Testing OLGA Tier 1 Features: Rheology, Regimes, Slugs, Pigging ===");

// ---------------------------------------------------------------------------
// 1. Three-Phase Emulsion Inversion Rheology
// ---------------------------------------------------------------------------
console.log("1. Testing Pal & Rhodes Three-Phase Emulsion Inversion Rheology...");

const muOil = 0.015; // 15 cP
const muWater = 0.001; // 1 cP

// Pure oil: WC = 0.0
const resPureOil = evaluateEmulsionViscosity(0.0, muOil, muWater);
assert.strictEqual(resPureOil.effectiveViscosity, muOil, "Pure oil (WC=0) should equal oil viscosity");
assert.strictEqual(resPureOil.continuousPhase, "OIL");

// Pure water: WC = 1.0
const resPureWater = evaluateEmulsionViscosity(1.0, muOil, muWater);
assert.strictEqual(resPureWater.effectiveViscosity, muWater, "Pure water (WC=1) should equal water viscosity");
assert.strictEqual(resPureWater.continuousPhase, "WATER");

// Emulsion inversion peak near WC = 0.42
const viscLowWC = evaluateEmulsionViscosity(0.2, muOil, muWater).effectiveViscosity;
const viscPeak = evaluateEmulsionViscosity(0.42, muOil, muWater).effectiveViscosity;
const viscHighWC = evaluateEmulsionViscosity(0.7, muOil, muWater).effectiveViscosity;

assert.ok(viscLowWC > muOil, "Water droplets in oil increase apparent viscosity");
assert.ok(viscPeak > viscLowWC, "Peak viscosity occurs near inversion point");
assert.ok(viscPeak > 3.0 * muOil, `Peak viscosity (${viscPeak.toFixed(4)} Pa.s) should be > 3x oil viscosity`);
assert.ok(viscHighWC < viscPeak, "Viscosity drops after phase inversion to oil-in-water");

console.log(
  `✔ Emulsion rheology verified: pure oil = ${resPureOil.effectiveViscosity} Pa·s, peak = ${viscPeak.toFixed(4)} Pa·s, pure water = ${resPureWater.effectiveViscosity} Pa·s`,
);

// ---------------------------------------------------------------------------
// 2. Mechanistic Flow Regime Map (Taitel-Dukler / Barnea)
// ---------------------------------------------------------------------------
console.log("2. Testing Mechanistic Flow Regime Map & Interfacial Shear...");

const D = 0.3048; // 12-inch pipe
const rhoL = 850.0;
const rhoG = 45.0;
const muG = 1.5e-5;
const sigma = 0.025; // 25 mN/m
const eps = 0.000045; // Commercial steel

// A. Stratified Smooth: low vsL, low vsG, horizontal
const regSmooth = classifyFlowRegime(0.02, 0.4, 0.0, D, rhoL, rhoG, muOil, muG, sigma);
assert.strictEqual(regSmooth.regime, MechanisticFlowRegime.STRATIFIED_SMOOTH);
assert.ok(regSmooth.liquidHoldup > 0.0 && regSmooth.liquidHoldup < 1.0);

// B. Stratified Wavy: low vsL, moderate vsG
const regWavy = classifyFlowRegime(0.05, 3.5, 0.0, D, rhoL, rhoG, muOil, muG, sigma);
assert.strictEqual(regWavy.regime, MechanisticFlowRegime.STRATIFIED_WAVY);

// C. Intermittent / Slug: moderate vsL, moderate vsG
const regSlug = classifyFlowRegime(0.8, 2.5, 0.0, D, rhoL, rhoG, muOil, muG, sigma);
assert.strictEqual(regSlug.regime, MechanisticFlowRegime.SLUG);

// D. Annular: low vsL, very high vsG
const regAnnular = classifyFlowRegime(0.05, 25.0, 0.0, D, rhoL, rhoG, muOil, muG, sigma);
assert.strictEqual(regAnnular.regime, MechanisticFlowRegime.ANNULAR);

// E. Dispersed Bubble: very high vsL, low vsG
const regBubble = classifyFlowRegime(4.0, 0.15, 0.0, D, rhoL, rhoG, muOil, muG, sigma);
assert.strictEqual(regBubble.regime, MechanisticFlowRegime.DISPERSED_BUBBLE);

// F. Interfacial Shear Stress & Andritsos-Hanratty wave enhancement
const shearResult = calculateMechanisticShear(0.05, 8.0, 0.25, D, 0.0, rhoL, rhoG, muOil, muG, sigma, eps);
assert.ok(shearResult.tauInterfacial > 0, "Interfacial shear stress must be positive");
assert.ok(
  shearResult.fi >= shearResult.fG,
  "Interfacial friction factor must be >= gas wall friction (wave roughness effect)",
);
console.log(
  `✔ Flow regimes verified: Smooth, Wavy, Slug, Annular, Bubble, and interfacial shear tau_i = ${shearResult.tauInterfacial.toFixed(2)} Pa`,
);

// ---------------------------------------------------------------------------
// 3. Lagrangian Slug Front/Tail Tracker
// ---------------------------------------------------------------------------
console.log("3. Testing Lagrangian Slug Tracker...");

const slugTracker = new SlugTracker({
  minSlugLength: 2.0,
  initiationHoldupThreshold: 0.35,
});

assert.strictEqual(slugTracker.getActiveSlugs().length, 0, "Should have 0 slugs initially");

const pipeLength = 3000;
const nCells = 30;
const dx = pipeLength / nCells;
const cellPositions = Array.from({ length: nCells }, (_, i) => i * dx);
// Build a liquid holdup wave exceeding threshold in the middle of the flowline
const spatialHoldup = cellPositions.map((x) => (x > 1000 && x < 1800 ? 0.65 : 0.2));
const dt = 1.0;
const mixtureVelocity = 3.5; // m/s

// Run tracker forward to trigger hydrodynamic initiation and propagation
for (let t = 0; t < 25; t += dt) {
  slugTracker.step(t, dt, pipeLength, D, spatialHoldup, cellPositions, mixtureVelocity, 65e5 + Math.sin(t * 0.1) * 3e5);
}

const activeSlugs = slugTracker.getActiveSlugs();
assert.ok(activeSlugs.length > 0, "Slug tracker should have initiated discrete slugs");

const stats = slugTracker.getStatistics();
assert.ok(stats.slugsInitiated > 0, "Slugs should be initiated");
assert.ok(stats.meanSlugLength > 0, "Mean slug length should be positive");
assert.ok(stats.slugFrequencyHz >= 0, "Slug frequency should be non-negative");
console.log(
  `✔ Slug tracker verified: ${activeSlugs.length} active slugs, mean length = ${stats.meanSlugLength.toFixed(1)}m, freq = ${stats.slugFrequencyHz.toFixed(3)} Hz`,
);

// ---------------------------------------------------------------------------
// 4. Scraper Pig Dynamics
// ---------------------------------------------------------------------------
console.log("4. Testing Pipeline Scraper Pig Dynamics...");

const pigTracker = new PigTracker([
  {
    name: "INSPECTION_PIG_01",
    diameter: D * 0.98,
    mass: 120.0, // 120 kg
    launchTime: 5.0, // launch at t = 5s
    frictionForce: 3000.0, // 3000 N sliding seal friction
    bypassFraction: 0.02,
  },
]);

const xGrid = [0, 500, 1000, 1500, 2000, 2500, 3000];
const pHighInlet = [80e5, 78e5, 75e5, 70e5, 65e5, 60e5, 50e5];
const pLowInlet = [50.001e5, 50.001e5, 50.001e5, 50e5, 50e5, 50e5, 50e5]; // negligible delta P
const alphaGrid = [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4];

// At t = 2s: Pig should not be launched yet
pigTracker.step(2.0, 1.0, pipeLength, D, alphaGrid, xGrid, pHighInlet, 0.0);
const pPreLaunch = pigTracker.getStates()[0]!;
assert.strictEqual(pPreLaunch.position, 0.0);
assert.strictEqual(pPreLaunch.isLaunched, false);

// At t = 6s with high inlet pressure: Pig should be launched and moving
pigTracker.step(6.0, 1.0, pipeLength, D, alphaGrid, xGrid, pHighInlet, 0.0);
const pMoving = pigTracker.getStates()[0]!;
assert.strictEqual(pMoving.isLaunched, true);
assert.ok(pMoving.velocity > 0, "Pig should accelerate and move forward");
assert.ok(pMoving.position > 0, "Pig position should advance");
assert.strictEqual(pMoving.isStuck, false);

// Test stuck condition: low driving pressure where dP * A < F_friction
const pigTrackerStuck = new PigTracker([
  {
    name: "STUCK_PIG_TEST",
    launchTime: 0.0,
    mass: 200.0,
    diameter: D,
    frictionForce: 500000.0, // 500 kN friction
  },
]);
pigTrackerStuck.step(1.0, 1.0, pipeLength, D, alphaGrid, xGrid, pLowInlet, 0.0);
const pStuck = pigTrackerStuck.getStates()[0]!;
assert.strictEqual(pStuck.isStuck, true, "Pig should be stuck when friction exceeds driving force");
assert.strictEqual(pStuck.velocity, 0.0, "Stuck pig velocity must be 0");

console.log(
  `✔ Scraper pig dynamics verified: launch, acceleration (v=${pMoving.velocity.toFixed(2)} m/s), stuck condition detection`,
);

// ---------------------------------------------------------------------------
// 5. Pre-flight Flow Assurance Linter Rules (M7006 & M7007)
// ---------------------------------------------------------------------------
console.log("5. Testing Flow Assurance Linter Rules (M7006 Severe Slugging, M7007 Pig Stuck)...");

const modelSevereSlugging: OlgaModel = {
  title: "Deepwater Severe Slugging Hazard Pipeline",
  startTime: 0,
  endTime: 1000,
  minDt: 0.1,
  maxDt: 1.0,
  flowpaths: [
    {
      name: "RISER_FLOWPATH",
      pipes: [
        { label: "PIPE_DOWN", length: 3000, diameter: 0.3, elevation: -600, roughness: 4.5e-5, discretization: 10 },
        { label: "PIPE_DIP", length: 1000, diameter: 0.3, elevation: -200, roughness: 4.5e-5, discretization: 8 }, // dip
        { label: "CATENARY_RISER", length: 1200, diameter: 0.3, elevation: 850, roughness: 4.5e-5, discretization: 12 }, // steep riser
      ],
      valves: [], // No choke valve!
      sources: [],
      controllers: [],
      pigs: [
        {
          name: "OVERSIZED_PIG",
          launchTime: 0,
          frictionForce: 2500000.0, // 2.5 MN friction -> stuck hazard (> 1.41 MN drive capability)
        },
      ],
    },
  ],
  nodes: [
    { name: "WELL_1", type: "TERMINAL", flowpath: "RISER_FLOWPATH", boundaryPosition: 0, pressure: 70e5 },
    { name: "TOPSIDE_SEP", type: "SEPARATOR", flowpath: "RISER_FLOWPATH", boundaryPosition: 1, pressure: 50e5 },
  ],
};

const diagnostics = lintOlgaModel(modelSevereSlugging);

const m7006 = diagnostics.find((d) => d.code === "M7006");
assert.ok(m7006, "Should trigger M7006: severe-slugging-hazard");
assert.ok(m7006.message.includes("Severe slugging hazard") || m7006.message.includes("severe riser-base slugging"));

const m7007 = diagnostics.find((d) => d.code === "M7007");
assert.ok(m7007, "Should trigger M7007: pig-stuck-hazard");
assert.ok(m7007.message.includes("catastrophic stuck pig hazard"));

console.log(`✔ Linter diagnostics verified: M7006 and M7007 correctly detected!`);

// ---------------------------------------------------------------------------
// 6. Integrated DAE Solver Verification with Slugs & Pigging
// ---------------------------------------------------------------------------
console.log("6. Testing solveDriftFluxDAE with Slug Tracker & Pigging Integration...");

const modelWithPig: OlgaModel = {
  title: "Tieback Simulation with Scraper Pig and Slugs",
  startTime: 0,
  endTime: 20,
  minDt: 0.1,
  maxDt: 1.0,
  flowpaths: [
    {
      name: "TIEBACK",
      pipes: [
        { label: "SEALINE", length: 2000, diameter: 0.254, elevation: -150, roughness: 4.5e-5, discretization: 10 },
        { label: "RISER", length: 800, diameter: 0.254, elevation: 180, roughness: 4.5e-5, discretization: 8 },
      ],
      valves: [{ name: "TOPSIDE_CHOKE", position: 2800, diameter: 0.15, opening: 0.6, cd: 0.84 }],
      sources: [],
      controllers: [],
      pigs: [
        {
          name: "FOAM_PIG",
          launchTime: 2.0,
          mass: 80,
          frictionForce: 1500,
        },
      ],
    },
  ],
  nodes: [
    {
      name: "WELL",
      type: "TERMINAL",
      flowpath: "TIEBACK",
      boundaryPosition: 0,
      pressure: 110e5,
      temperature: 330,
      massRate: 35.0,
    },
    { name: "PLATFORM", type: "SEPARATOR", flowpath: "TIEBACK", boundaryPosition: 1, pressure: 35e5, temperature: 290 },
  ],
};

const simResult = solveDriftFluxDAE(modelWithPig, {
  durationSeconds: 10,
  timeStepSeconds: 1.0,
  snapshotCount: 10,
});

assert.ok(simResult.profiles.length > 0, "Simulation should produce spatial profile snapshots");
assert.ok(simResult.trends.meanSlugLength !== undefined, "Trends should include meanSlugLength");
assert.ok(simResult.trends.pigPosition !== undefined, "Trends should include pigPosition");
assert.ok(simResult.trends.pigVelocity !== undefined, "Trends should include pigVelocity");

const lastProfile = simResult.profiles[simResult.profiles.length - 1]!;
assert.ok(lastProfile.flowRegimes !== undefined, "Profile should include flowRegimes classification");
assert.ok(lastProfile.pigs !== undefined, "Profile should include active pigs");
assert.strictEqual(lastProfile.pigs.length, 1);
assert.strictEqual(lastProfile.pigs[0]!.name, "FOAM_PIG");
assert.ok(lastProfile.pigs[0]!.position > 0, "Pig should have advanced during simulation");

console.log(
  `✔ Integrated DAE simulation complete: pig advanced to ${lastProfile.pigs[0]!.position.toFixed(1)}m (v=${lastProfile.pigs[0]!.velocity.toFixed(2)}m/s)`,
);

console.log("=== All Tier 1 Slug, Pig, Rheology, and Regime Tests Passed! ===");
