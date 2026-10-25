// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { parseOlga } from "../src/parser/index.js";
import { simulateDriftFlux } from "../src/solver/drift-flux-dae.js";
import { calibrateOlgaModel, parseObservationCsv } from "../src/tuning/history-matcher.js";

console.log("=== Testing OLGA Field History Matching & Parameter Tuning ===");

const testModelOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Offshore Flowline System" StartTime="0" EndTime="100" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_01">
    <Pipe Name="SUBSEA_PIPE" Length="3000.0" Diameter="0.254" Elevation="-60.0" Roughness="0.000045" Discretization="10" />
    <Pipe Name="RISER" Length="850.0" Diameter="0.254" Elevation="150.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="TOPSIDE_CHOKE" Position="3850.0" Diameter="0.12" Opening="0.80" Cd="0.84" />
    <Source Name="WELLHEAD" Position="0.0" TotalMassRate="32.0" GasMassFraction="0.22" WaterCut="0.05" Pressure="14000000" Temperature="340.15" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="MASS_SOURCE" Flowpath="FLOWLINE_01" Fraction="0.0" Pressure="14000000" Temperature="340.15" MassRate="32.0" />
  <Node Name="PLATFORM" Type="SEPARATOR" Flowpath="FLOWLINE_01" Fraction="1.0" Pressure="2500000" Temperature="295.15" />
</Model>`;

// -----------------------------------------------------------------------------
// 1. Telemetry Ingestion (parseObservationCsv)
// -----------------------------------------------------------------------------
console.log("1. Testing parseObservationCsv telemetry ingestion...");
const sampleTelemetryCsv = `TIME, PT_INLET, PT_ARRIVAL, TM_OUTLET, QLT
0.0, 140.0, 25.0, 65.0, 24.5
5.0, 142.5, 25.1, 64.8, 25.1
10.0, 144.2, 25.2, 64.5, 25.0
15.0, 145.0, 25.2, 64.2, 24.9
20.0, 145.5, 25.3, 64.0, 25.2
`;

const obs = parseObservationCsv(sampleTelemetryCsv);
assert.strictEqual(obs.times.length, 5);
assert.strictEqual(obs.inletPressurePa?.[0], 140e5); // bar converted to Pa
assert.strictEqual(obs.arrivalPressurePa?.[0], 25e5);
assert.ok(Math.abs((obs.arrivalTemperatureK?.[0] ?? 0) - (65.0 + 273.15)) < 0.1);
assert.strictEqual(obs.arrivalLiquidRateKgS?.[0], 24.5);
console.log(`✔ Ingested ${obs.times.length} telemetry points with pressure/temperature unit conversions.`);

// -----------------------------------------------------------------------------
// 2. Autonomous History Matching / Parameter Calibration
// -----------------------------------------------------------------------------
console.log("2. Testing calibrateOlgaModel parameter optimization...");
const trueModel = parseOlga(testModelOpi);

// Generate synthetic ground truth telemetry from reference model
const trueSim = simulateDriftFlux(trueModel, { durationSeconds: 20.0, timeStepSeconds: 1.0 });
const groundTruthObs = {
  times: trueSim.times,
  inletPressurePa: trueSim.trends.inletPressure,
  arrivalPressurePa: trueSim.trends.arrivalPressure,
  arrivalTemperatureK: trueSim.trends.arrivalTemperature,
};

// Intentionally perturb the model parameters away from ground truth
const perturbedModel = parseOlga(testModelOpi);
perturbedModel.flowpaths[0]!.pipes[0]!.roughness = 1.0e-5; // True was 4.5e-5
perturbedModel.flowpaths[0]!.pipes[1]!.roughness = 1.0e-5;
perturbedModel.flowpaths[0]!.valves[0]!.cd = 0.5; // True was 0.84

const tuneResult = calibrateOlgaModel(perturbedModel, groundTruthObs, {
  parameters: ["roughness", "choke-cd"],
  maxEvaluations: 30,
  durationSeconds: 20.0,
  timeStepSeconds: 1.0,
});

assert.strictEqual(tuneResult.success, true);
assert.ok(tuneResult.evaluations > 2);
assert.ok(
  tuneResult.improvementPercent > 50.0,
  `Expected > 50% objective reduction, got ${tuneResult.improvementPercent.toFixed(1)}%`,
);

console.log(`   Initial objective : ${tuneResult.initialObjective.toFixed(4)}`);
console.log(
  `   Final objective   : ${tuneResult.finalObjective.toFixed(4)} (${tuneResult.improvementPercent.toFixed(1)}% improvement)`,
);
console.log(
  `   Inlet P RMSE      : ${tuneResult.metrics.pressureRmseBar.toFixed(3)} bar (R2 = ${(tuneResult.metrics.pressureR2 * 100).toFixed(1)}%)`,
);
console.log(`   Arrival T RMSE    : ${tuneResult.metrics.temperatureRmseK.toFixed(3)} K`);

// Verify calibrated parameters moved in the correct direction (upwards towards true values)
const calRoughness = tuneResult.calibratedParameters.find((p) => p.name === "roughness")!;
const calCd = tuneResult.calibratedParameters.find((p) => p.name === "choke-cd")!;

assert.ok(calRoughness.calibratedValue > 1.0e-5, "Roughness should increase towards ground truth 4.5e-5");
assert.ok(calCd.calibratedValue > 0.5, "Choke Cd should increase towards ground truth 0.84");

// Verify Markdown report generated
assert.ok(tuneResult.markdownReport.includes("# Flowline History Matching & Parameter Calibration Report"));
assert.ok(tuneResult.markdownReport.includes("roughness"));
assert.ok(tuneResult.markdownReport.includes("choke-cd"));
console.log("✔ Markdown calibration report generated successfully!");

console.log("=== All OLGA Field History Matching Tests Passed! ===");
