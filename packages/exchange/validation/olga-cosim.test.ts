// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseOlga } from "@modelscript/olga";
import assert from "node:assert";
import { TopsideFacilityCoSimParticipant, formatOlgaCoSimCsv, runOlgaCoSimulation } from "../src/index.js";

console.log("=== Testing OLGA Subsea-to-Topside Co-Simulation Master Harness ===");

const testModelOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Deepwater 10in Tieback" StartTime="0" EndTime="100" MinDt="0.05" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_01">
    <Pipe Name="SEABED_TIEBACK" Length="3500.0" Diameter="0.254" Elevation="-80.0" Roughness="0.000045" Discretization="15" />
    <Pipe Name="STEEL_CATENARY_RISER" Length="950.0" Diameter="0.254" Elevation="300.0" Roughness="0.000045" Discretization="10" />
    <Valve Name="TOPSIDE_CHOKE" Position="4450.0" Diameter="0.12" Opening="0.85" Cd="0.84" />
    <Source Name="WELL_MANIFOLD" Position="0.0" TotalMassRate="32.0" GasMassFraction="0.22" WaterCut="0.08" Pressure="15000000" Temperature="338.15" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="MASS_SOURCE" Flowpath="FLOWLINE_01" Fraction="0.0" Pressure="15000000" Temperature="338.15" MassRate="32.0" />
  <Node Name="PLATFORM_INLET" Type="TERMINAL" Flowpath="FLOWLINE_01" Fraction="1.0" Pressure="2500000" Temperature="295.15" />
</Model>`;

// -----------------------------------------------------------------------------
// 1. TopsideFacilityCoSimParticipant Port Discovery & Initialization
// -----------------------------------------------------------------------------
console.log("1. Testing TopsideFacilityCoSimParticipant ports & lifecycle...");
const topside = new TopsideFacilityCoSimParticipant("topside_fpso", {
  separatorPressureBar: 22.0,
  slugCapacityM3: 90.0,
});

assert.strictEqual(topside.id, "topside_fpso");
assert.strictEqual(topside.modelName, "Topside Process Facilities");

const topInputs = topside.metadata.variables.filter((v) => v.causality === "input");
const topOutputs = topside.metadata.variables.filter((v) => v.causality === "output");

assert.ok(topInputs.some((v) => v.name === "inlet.pressure"));
assert.ok(topInputs.some((v) => v.name === "inlet.temperature"));
assert.ok(topInputs.some((v) => v.name === "liquid.arrival_rate"));
assert.ok(topInputs.some((v) => v.name === "slug.surge_volume"));

assert.ok(topOutputs.some((v) => v.name === "separator.pressure"));
assert.ok(topOutputs.some((v) => v.name === "choke.opening"));
assert.ok(topOutputs.some((v) => v.name === "separator.level"));
assert.ok(topOutputs.some((v) => v.name === "slug_catcher.margin"));
assert.ok(topOutputs.some((v) => v.name === "compressor.power"));
assert.ok(topOutputs.some((v) => v.name === "gas_export.rate"));

console.log(`✔ Topside participant registered ${topInputs.length} inputs and ${topOutputs.length} outputs.`);

await topside.initialize(0, 100, 1.0);
let topsideOutputs = await topside.getOutputs();
assert.strictEqual(topsideOutputs.get("separator.pressure"), 22e5);
assert.strictEqual(topsideOutputs.get("choke.opening"), 0.85);

// -----------------------------------------------------------------------------
// 2. Dynamic Stepping of Topside Unit with Surge Inflow
// -----------------------------------------------------------------------------
console.log("2. Testing topside slug catcher accumulation & anti-slug choking...");
const surgeInlet = new Map<string, number>();
surgeInlet.set("liquid.arrival_rate", 80.0); // Severe slug arrival (80 kg/s)
surgeInlet.set("slug.surge_volume", 25.0);
surgeInlet.set("inlet.pressure", 35e5);
surgeInlet.set("inlet.temperature", 310.15);

await topside.setInputs(surgeInlet);
for (let s = 0; s < 15; s++) {
  await topside.doStep(s * 1.0, 1.0);
}

topsideOutputs = await topside.getOutputs();
const chokeCmd = topsideOutputs.get("choke.opening") as number;
const compPower = topsideOutputs.get("compressor.power") as number;
const scMargin = topsideOutputs.get("slug_catcher.margin") as number;

assert.ok(chokeCmd < 0.85, "Anti-slug controller must throttle topside choke during slug surge");
assert.ok(compPower > 0.5, "Gas export compressor power must be positive and non-zero");
assert.ok(scMargin < 90.0, "Slug catcher capacity margin should decrease during surge");

console.log(
  `✔ Surge dynamics: Choke throttled to ${(chokeCmd * 100).toFixed(1)}%, Capacity margin=${scMargin.toFixed(1)} m³, Compressor Power=${compPower.toFixed(2)} MW`,
);

// -----------------------------------------------------------------------------
// 3. Multi-Rate Subsea-to-Topside Co-Simulation (Gauss-Seidel)
// -----------------------------------------------------------------------------
console.log("3. Testing runOlgaCoSimulation with Gauss-Seidel coupling...");
const model = parseOlga(testModelOpi);

const resultGs = await runOlgaCoSimulation(model, topside, {
  durationSeconds: 30.0,
  macroStepSize: 1.0,
  subseaMicroStep: 0.1,
  topsideMicroStep: 0.5,
  algorithm: "gauss-seidel",
  maxIterations: 4,
  tolerancePa: 5000,
});

assert.ok(resultGs.times.length >= 30, `Expected at least 30 time points, got ${resultGs.times.length}`);
assert.ok(
  resultGs.trajectory.length >= 30,
  `Expected at least 30 trajectory points, got ${resultGs.trajectory.length}`,
);
assert.strictEqual(resultGs.summary.durationSeconds, 30.0);

const lastFrameGs = resultGs.trajectory[resultGs.trajectory.length - 1];
assert.ok(lastFrameGs.time >= 29.0);
assert.ok(lastFrameGs.subseaArrivalPressureBar > 10.0);
assert.ok(lastFrameGs.topsideSeparatorPressureBar > 10.0);
assert.ok(lastFrameGs.topsideChokeOpening > 0);
assert.ok(lastFrameGs.topsideCompressorPowerMW > 0);

console.log(
  `✔ Gauss-Seidel CoSim: ${resultGs.trajectory.length} steps, convergedRate=${(resultGs.summary.convergedRate * 100).toFixed(1)}%, peakSurge=${resultGs.summary.peakSurgeM3.toFixed(2)} m³`,
);

// -----------------------------------------------------------------------------
// 4. Multi-Rate Subsea-to-Topside Co-Simulation (Jacobi)
// -----------------------------------------------------------------------------
console.log("4. Testing runOlgaCoSimulation with Jacobi coupling...");
const resultJac = await runOlgaCoSimulation(model, undefined, {
  durationSeconds: 20.0,
  macroStepSize: 1.0,
  algorithm: "jacobi",
});

assert.ok(resultJac.trajectory.length >= 20);
assert.ok(
  resultJac.trajectory.every((pt) => pt.iterations === 1),
  "Jacobi algorithm executes exactly 1 iteration per macro-step",
);

console.log(`✔ Jacobi CoSim: ${resultJac.trajectory.length} frames completed successfully.`);

// -----------------------------------------------------------------------------
// 5. RFC 4180 CSV Export
// -----------------------------------------------------------------------------
console.log("5. Testing formatOlgaCoSimCsv output...");
const csv = formatOlgaCoSimCsv(resultGs);
const csvLines = csv.trim().split("\n");

assert.ok(csvLines.length >= 31, `Expected at least 31 CSV lines (header + 30 data rows), got ${csvLines.length}`);
const header = csvLines[0];
assert.ok(header.includes("time_s"));
assert.ok(header.includes("subsea_arrival_pressure_bar"));
assert.ok(header.includes("topside_separator_pressure_bar"));
assert.ok(header.includes("topside_choke_opening"));
assert.ok(header.includes("topside_compressor_power_mw"));
assert.ok(header.includes("interface_discrepancy_bar"));

const sampleRow = csvLines[1].split(",");
assert.strictEqual(sampleRow.length, 18, "Each CSV row must contain exactly 18 columns");

console.log(`✔ RFC 4180 CSV Export validated (${csvLines.length} lines, 18 columns).`);

console.log("=== All OLGA Subsea-to-Topside Co-Simulation Master Tests Passed! ===");
