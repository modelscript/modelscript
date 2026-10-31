// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { parseOpi } from "../src/parser/opi-parser.js";
import { evaluateDropletMechanics } from "../src/solver/droplet-mechanics.js";
import { simulateThreeFluidDAE } from "../src/solver/three-fluid-dae.js";

console.log("=== Testing 3-Fluid 9-Equation Mechanistic Hydrodynamic Solver ===");

// 1. Test Kataoka & Ishii Droplet Entrainment & Deposition Closures
console.log("1. Testing droplet entrainment and deposition mechanics...");
const dropletRes = evaluateDropletMechanics({
  gasDensityKgM3: 45.0,
  liquidDensityKgM3: 840.0,
  gasViscosityPaS: 1.5e-5,
  liquidViscosityPaS: 0.005,
  surfaceTensionNPerM: 0.025,
  pipeDiameterM: 0.254,
  gasVelocityMS: 8.5,
  filmVelocityMS: 0.8,
  dropletVelocityMS: 7.2,
  filmThicknessM: 0.005,
  dropletVolumeFraction: 0.02,
  liquidHoldup: 0.15,
});

assert.ok(dropletRes.criticalGasVelocityMS > 0, "Critical velocity must be positive");
assert.strictEqual(dropletRes.isEntraining, true, "At 8.5 m/s gas velocity, droplet shearing should occur");
assert.ok(dropletRes.equilibriumEntrainmentFraction > 0.0, "E_inf should be positive");
assert.ok(dropletRes.entrainmentRateKgM2S > 0.0, "Entrainment flux should be positive");
assert.ok(dropletRes.depositionRateKgM2S > 0.0, "Deposition flux should be positive");
assert.ok(
  dropletRes.sauterMeanDiameterM > 10e-6 && dropletRes.sauterMeanDiameterM < 0.003,
  "d32 should be between 10um and 3mm",
);
console.log(
  `✔ Droplet closures verified (d32=${(dropletRes.sauterMeanDiameterM * 1e6).toFixed(1)} um, E_inf=${(dropletRes.equilibriumEntrainmentFraction * 100).toFixed(1)}%)!`,
);

// 2. Test 3-Fluid 9-Equation Transient DAE Simulation
console.log("2. Testing simulateThreeFluidDAE transient pipeline run...");
const testOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Three-Phase Riser System" StartTime="0" EndTime="10" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="MAIN_RISER">
    <Pipe Name="RISER_PIPE" Length="2500.0" Diameter="0.254" Elevation="120.0" Roughness="0.000045" Discretization="10" />
    <Valve Name="CHOKE" Position="2450.0" Diameter="0.18" Opening="0.85" Cd="0.84" />
  </Flowpath>
  <Node Name="SUBSEA_WELL" Type="TERMINAL" Flowpath="MAIN_RISER" Fraction="0.0" Pressure="13000000" Temperature="345.15" MassRate="40.0" GasMassFraction="0.22" WaterCut="0.30" />
  <Node Name="PLATFORM_SEP" Type="SEPARATOR" Flowpath="MAIN_RISER" Fraction="1.0" Pressure="3200000" Temperature="295.15" />
</Model>`;

const model = parseOpi(testOpi);
const simResult = simulateThreeFluidDAE(model, {
  durationSeconds: 5,
  timeStepSeconds: 1.0,
  gridCells: 8,
});

assert.strictEqual(simResult.times.length, 6, "Should record 6 timesteps [0..5s]");
assert.strictEqual(simResult.profiles.length, 6);

const lastProfile = simResult.profiles[simResult.profiles.length - 1]!;
assert.strictEqual(lastProfile.cells.length, 8);

// Verify conservation of volume fractions in every cell
for (let i = 0; i < lastProfile.cells.length; i++) {
  const c = lastProfile.cells[i]!;
  const sumFractions = c.alphaGas + c.alphaFilmOil + c.alphaFilmWater + c.alphaDropletOil + c.alphaDropletWater;
  assert.ok(Math.abs(sumFractions - 1.0) < 1e-4, `Volume fractions must sum to 1.0 in cell ${i} (got ${sumFractions})`);
  assert.ok(c.alphaGas > 0, "alphaGas must be positive");
  assert.ok(c.alphaFilmOil > 0, "alphaFilmOil must be positive");
  assert.ok(c.alphaFilmWater > 0, "alphaFilmWater must be positive");
  assert.ok(c.alphaDropletOil >= 0, "alphaDropletOil must be non-negative");
  assert.ok(c.alphaDropletWater >= 0, "alphaDropletWater must be non-negative");
  assert.ok(c.pressurePa > 30e5, "Pressure must remain above outlet backpressure");
  assert.ok(c.velocityGas > c.velocityFilm, "Gas core velocity must exceed wall film velocity");
}

console.log(
  `✔ 3-Fluid 9-equation simulation completed (Avg droplet fraction: ${(simResult.summary.averageDropletFraction * 100).toFixed(2)}%)!`,
);

// 3. Test Spatial Upwind Wave Propagation & Outlet-to-Inlet Pressure Coupling Across Cells
console.log("3. Testing spatial upwind holdup wave propagation across cells...");
const waveOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Multi-Segment Wave Propagation" StartTime="0" EndTime="40" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE">
    <Pipe Name="SEG_1" Length="400.0" Diameter="0.20" Elevation="10.0" Roughness="0.000045" Discretization="4" />
    <Pipe Name="SEG_2" Length="400.0" Diameter="0.25" Elevation="40.0" Roughness="0.000045" Discretization="4" />
    <Valve Name="INLINE_CHOKE" Position="750.0" Diameter="0.14" Opening="0.70" Cd="0.80" />
  </Flowpath>
  <Node Name="INLET" Type="TERMINAL" Flowpath="FLOWLINE" Fraction="0.0" Pressure="9000000" Temperature="335.15" MassRate="30.0" GasMassFraction="0.18" WaterCut="0.20" />
  <Node Name="OUTLET_SEP" Type="SEPARATOR" Flowpath="FLOWLINE" Fraction="1.0" Pressure="3000000" Temperature="295.15" />
</Model>`;

const waveModel = parseOpi(waveOpi);
// Inject a high inlet water-cut step (0.75 vs initial 0.20) to track spatial advection wave from cell 0 -> downstream cells
const waveSim = simulateThreeFluidDAE(waveModel, {
  durationSeconds: 30,
  timeStepSeconds: 1.0,
  gridCells: 8,
  advectionOrder: 2,
  inletWaterCutStep: 0.75,
});

const initCells = waveSim.profiles[0]!.cells;
const midCells = waveSim.profiles[10]!.cells;
const finalCells = waveSim.profiles[waveSim.profiles.length - 1]!.cells;

// Cell 0 (inlet) should see water holdup rise first, followed by downstream cells
const initWater0 = initCells[0]!.alphaFilmWater + initCells[0]!.alphaDropletWater;
const midWater0 = midCells[0]!.alphaFilmWater + midCells[0]!.alphaDropletWater;
const initWater3 = initCells[3]!.alphaFilmWater + initCells[3]!.alphaDropletWater;
const finalWater3 = finalCells[3]!.alphaFilmWater + finalCells[3]!.alphaDropletWater;

assert.ok(
  midWater0 > initWater0 + 0.05,
  `Inlet cell water holdup must increase from upwind boundary (init=${initWater0}, mid=${midWater0})`,
);
assert.ok(
  finalWater3 > initWater3 + 0.02,
  `Downstream cell 3 must receive advected water holdup wave from upstream cells (init=${initWater3}, final=${finalWater3})`,
);

// Monotonically decreasing pressure from inlet (cell 0) to outlet separator (cell N-1)
for (let i = 0; i < finalCells.length - 1; i++) {
  assert.ok(
    finalCells[i]!.pressurePa > finalCells[i + 1]!.pressurePa,
    `Cell ${i} pressure (${finalCells[i]!.pressurePa}) must exceed downstream cell ${i + 1} pressure (${finalCells[i + 1]!.pressurePa})`,
  );
}
assert.ok(
  waveSim.summary.phaseInversionLocationM !== null,
  "Water-cut front crossing inversion point should record phaseInversionLocationM",
);
console.log(
  `✔ Spatial upwind wave propagation verified (phase inversion at x=${waveSim.summary.phaseInversionLocationM?.toFixed(1)} m)!`,
);
console.log("=== All 3-Fluid 9-Equation Mechanistic Solver Tests Passed! ===");
