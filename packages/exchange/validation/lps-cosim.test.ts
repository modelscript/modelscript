// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { LpsCoSimParticipant } from "../src/index.js";

console.log("=== Testing LPS / PipelineStudio Gas-Power Co-Simulation Participant ===");

const testNetworkXml = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudioStudy Version="4.2.0">
  <StudyHeader Title="Trans-Texas Gas Interconnect" FluidType="Gas" EngineeringUnits="SI" />
  <NetworkModel>
    <Nodes>
      <Node Name="PERMIAN_HUB" Type="SupplySource" Elevation="750.0" Pressure="7500000.0" Temperature="293.15" />
      <Node Name="MIDLAND_JCT" Type="Junction" Elevation="700.0" />
      <Node Name="AUSTIN_CITY_GATE" Type="DeliveryPoint" Elevation="150.0" FlowRate="95.0" />
    </Nodes>
    <Pipes>
      <Pipe Name="LINE_A" FromNode="PERMIAN_HUB" ToNode="MIDLAND_JCT" Length="120000.0" Diameter="0.9144" WallThickness="0.0159" Roughness="0.000015" MAOP="8500000.0" />
      <Pipe Name="LINE_B" FromNode="MIDLAND_JCT" ToNode="AUSTIN_CITY_GATE" Length="180000.0" Diameter="0.762" WallThickness="0.0127" Roughness="0.000015" MAOP="8000000.0" />
    </Pipes>
  </NetworkModel>
  <FluidProperties Model="AGA8">
    <Composition Methane="0.94" Ethane="0.035" Propane="0.01" Nitrogen="0.005" CarbonDioxide="0.01" />
  </FluidProperties>
</PipelineStudioStudy>`;

// -----------------------------------------------------------------------------
// 1. Participant Discovery & Port Introspection
// -----------------------------------------------------------------------------
console.log("1. Testing LpsCoSimParticipant ports & metadata...");
const participant = new LpsCoSimParticipant("tx_gas_grid", testNetworkXml, {
  maopLimit: 85.0e5, // 85 bar
  minDeliveryPressure: 38.0e5, // 38 bar contractual minimum
  deliveryNode: "AUSTIN_CITY_GATE",
  supplyNode: "PERMIAN_HUB",
});

assert.strictEqual(participant.id, "tx_gas_grid");
assert.strictEqual(participant.modelName, "Trans-Texas Gas Interconnect");

const inputs = participant.metadata.variables.filter((v) => v.causality === "input");
const outputs = participant.metadata.variables.filter((v) => v.causality === "output");

assert.ok(inputs.some((v) => v.name === "ccgt_fuel_demand_mw"));
assert.ok(inputs.some((v) => v.name === "delivery_withdrawal_kg_s"));
assert.ok(inputs.some((v) => v.name === "h2_injection_kg_s"));
assert.ok(inputs.some((v) => v.name === "supply_pressure_bar"));

assert.ok(outputs.some((v) => v.name === "fuel_gas_pressure_bar"));
assert.ok(outputs.some((v) => v.name === "fuel_gas_wobbe_index"));
assert.ok(outputs.some((v) => v.name === "line_pack_mmsm3"));
assert.ok(outputs.some((v) => v.name === "deliverable_line_pack_mmsm3"));
assert.ok(outputs.some((v) => v.name === "deliverable_energy_mwh"));
assert.ok(outputs.some((v) => v.name === "maop_headroom_bar"));
assert.ok(outputs.some((v) => v.name === "exhaustion_time_hours"));
assert.ok(outputs.some((v) => v.name === "h2_molar_fraction"));

console.log(`✔ LPS participant registered ${inputs.length} inputs and ${outputs.length} outputs.`);

// -----------------------------------------------------------------------------
// 2. Initialization & Initial Thermodynamic Line Pack Evaluation
// -----------------------------------------------------------------------------
console.log("2. Initializing participant and checking baseline hydraulics...");
await participant.initialize(0, 3600, 60.0);
const initOutputs = await participant.getOutputs();

const initLinePackMmsm3 = Number(initOutputs.get("line_pack_mmsm3"));
const initDeliveryPressureBar = Number(initOutputs.get("fuel_gas_pressure_bar"));
const initWobbe = Number(initOutputs.get("fuel_gas_wobbe_index"));

assert.ok(initLinePackMmsm3 > 5.0, `Initial line pack ${initLinePackMmsm3} MMSm3 should be positive`);
assert.ok(initDeliveryPressureBar > 40.0, `Initial delivery pressure ${initDeliveryPressureBar} bar`);
assert.ok(initWobbe > 45.0 && initWobbe < 55.0, `Initial Wobbe index ${initWobbe} MJ/Sm3 in natural gas range`);

console.log(
  `✔ Baseline: Line Pack = ${initLinePackMmsm3.toFixed(2)} MMSm³, Delivery P = ${initDeliveryPressureBar.toFixed(1)} bar, Wobbe = ${initWobbe.toFixed(1)} MJ/Sm³.`,
);

// -----------------------------------------------------------------------------
// 3. Dynamic CCGT Electric Generation Demand Ramp
// -----------------------------------------------------------------------------
console.log("3. Simulating 500 MW CCGT power plant dispatch...");
const stepInputs = new Map<string, number>();
stepInputs.set("ccgt_fuel_demand_mw", 500.0); // 500 MW electric power dispatch
stepInputs.set("delivery_withdrawal_kg_s", 120.0);
await participant.setInputs(stepInputs);

// Advance 30 minutes in steps of 60 seconds
for (let t = 0; t < 1800; t += 60) {
  await participant.doStep(t, 60.0);
}

const loadedOutputs = await participant.getOutputs();
const loadedLinePackMmsm3 = Number(loadedOutputs.get("line_pack_mmsm3"));
const loadedDeliveryPressureBar = Number(loadedOutputs.get("fuel_gas_pressure_bar"));
const exhaustionHours = Number(loadedOutputs.get("exhaustion_time_hours"));

assert.ok(loadedLinePackMmsm3 < initLinePackMmsm3, "Line pack should deplete under 500 MW CCGT generation draft");
assert.ok(
  loadedDeliveryPressureBar < initDeliveryPressureBar,
  "Delivery pressure should decrease due to higher flow and friction",
);
assert.ok(exhaustionHours > 0 && exhaustionHours < 500, `Exhaustion buffer ${exhaustionHours} hours`);

console.log(
  `✔ Post-dispatch: Line Pack = ${loadedLinePackMmsm3.toFixed(2)} MMSm³ (drafted ${(initLinePackMmsm3 - loadedLinePackMmsm3).toFixed(3)} MMSm³), Delivery P = ${loadedDeliveryPressureBar.toFixed(1)} bar, Exhaustion = ${exhaustionHours.toFixed(1)} h.`,
);

// -----------------------------------------------------------------------------
// 4. Hydrogen Blending Injection (Power-to-Gas Coupling)
// -----------------------------------------------------------------------------
console.log("4. Simulating green hydrogen injection (electrolyzer coupling)...");
const h2Inputs = new Map<string, number>();
h2Inputs.set("h2_injection_kg_s", 15.0); // 15 kg/s H2 injection
await participant.setInputs(h2Inputs);

await participant.doStep(1800, 60.0);
const h2Outputs = await participant.getOutputs();
const h2Fraction = Number(h2Outputs.get("h2_molar_fraction"));
const newWobbe = Number(h2Outputs.get("fuel_gas_wobbe_index"));

assert.ok(h2Fraction > 0.05, `H2 molar fraction ${h2Fraction} should reflect hydrogen injection`);
assert.ok(newWobbe !== initWobbe, "Wobbe index should update with hydrogen blending");

console.log(
  `✔ Hydrogen blending: H2 Mole Fraction = ${(h2Fraction * 100).toFixed(1)}%, Updated Wobbe Index = ${newWobbe.toFixed(2)} MJ/Sm³.`,
);

await participant.terminate();
console.log("✔ LPS Co-Simulation Participant tests completed successfully.");
