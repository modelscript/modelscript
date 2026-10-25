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
console.log("=== All 3-Fluid 9-Equation Mechanistic Solver Tests Passed! ===");
