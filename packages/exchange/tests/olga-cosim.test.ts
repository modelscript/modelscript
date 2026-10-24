// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { OlgaCoSimParticipant } from "../src/cosim/participants/olga-provider.js";

console.log("=== Running @modelscript/exchange OLGA Co-Simulation Tests ===");

const sampleKeyDeck = `CASE TITLE = "Subsea Tieback to Topside FPSO"
INTEGRATION STARTTIME = 0.0 s, ENDTIME = 3600.0 s, MINDT = 0.01 s, MAXDT = 1.0 s

FLOWPATH NAME = PROD_FLOWPATH
PIPE LABEL = TIEBACK, LENGTH = 5000.0 m, DIAMETER = 0.3 m, ELEVATION = -100.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 10
PIPE LABEL = RISER, LENGTH = 1200.0 m, DIAMETER = 0.3 m, ELEVATION = 110.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 6
VALVE NAME = TOPSIDE_CHOKE, POSITION = 6150.0 m, DIAMETER = 0.2 m, OPENING = 1.0, CD = 0.84, TIMEOPEN = 5.0 s, TIMECLOSE = 5.0 s
MASSSOURCE NAME = WELL_SOURCE, POSITION = 0.0 m, TOTALMASSRATE = 35.0 kg/s, GASFRACTION = 0.25, WATERCUT = 0.05, TEMPERATURE = 340.0 K, PRESSURE = 180.0 bar

NODE NAME = WELLHEAD, TYPE = MASS_SOURCE, FLOWPATH = PROD_FLOWPATH, FRACTION = 0.0, TOTALMASSRATE = 35.0 kg/s, TEMPERATURE = 340.0 K
NODE NAME = SEPARATOR, TYPE = PRESSURE, FLOWPATH = PROD_FLOWPATH, FRACTION = 1.0, PRESSURE = 20.0 bar, TEMPERATURE = 293.15 K
`;

// 1. Participant Instantiation & Metadata
console.log("1. Testing OlgaCoSimParticipant initialization & port discovery...");
const participant = new OlgaCoSimParticipant("olga_fpso_riser", sampleKeyDeck, {
  mode: "wasm",
  maopLimit: 250e5, // 250 bar MAOP
  slugCatcherCapacity: 120.0,
});

assert.strictEqual(participant.id, "olga_fpso_riser");
assert.strictEqual(participant.modelName, "Subsea Tieback to Topside FPSO");

const inputVars = participant.metadata.variables.filter((v) => v.causality === "input");
const outputVars = participant.metadata.variables.filter((v) => v.causality === "output");

assert.ok(inputVars.some((v) => v.name === "choke.opening"));
assert.ok(inputVars.some((v) => v.name === "wellhead.mass_rate"));
assert.ok(inputVars.some((v) => v.name === "separator.pressure"));
assert.ok(outputVars.some((v) => v.name === "inlet.pressure"));
assert.ok(outputVars.some((v) => v.name === "arrival.temperature"));
assert.ok(outputVars.some((v) => v.name === "arrival.liquid_rate"));
assert.ok(outputVars.some((v) => v.name === "slug.surge_volume"));
assert.ok(outputVars.some((v) => v.name === "hydrate.subcooling"));
assert.ok(outputVars.some((v) => v.name === "maop.margin"));
console.log(`✔ OlgaCoSimParticipant registered ${inputVars.length} inputs and ${outputVars.length} outputs!`);

// 2. Initialize and read initial state
console.log("2. Testing baseline doStep and output retrieval...");
await participant.initialize(0, 100, 1.0);
const initialOutputs = await participant.getOutputs();
assert.ok((initialOutputs.get("inlet.pressure") as number) > 10e5);
assert.ok((initialOutputs.get("arrival.temperature") as number) > 280);
assert.ok((initialOutputs.get("maop.margin") as number) > 0);
console.log(
  `✔ Initial states: P_inlet=${((initialOutputs.get("inlet.pressure") as number) / 1e5).toFixed(1)} bar, T_arr=${((initialOutputs.get("arrival.temperature") as number) - 273.15).toFixed(1)} C`,
);

// 3. Dynamic Stepping with Choke Throttling
console.log("3. Stepping simulation with choke throttling (z = 0.2)...");
const inputMap = new Map();
inputMap.set("choke.opening", 0.2); // Throttle choke to 20%
await participant.setInputs(inputMap);

for (let step = 0; step < 10; step++) {
  await participant.doStep(step * 2.0, 2.0);
}

const throttledOutputs = await participant.getOutputs();
const throttledInletP = throttledOutputs.get("inlet.pressure") as number;
const throttledRate = throttledOutputs.get("arrival.liquid_rate") as number;
assert.ok(
  throttledInletP > (initialOutputs.get("inlet.pressure") as number),
  "Throttling choke should increase upstream inlet pressure",
);
assert.ok(
  throttledRate < (initialOutputs.get("arrival.liquid_rate") as number),
  "Throttling choke should decrease liquid arrival rate",
);
console.log(
  `✔ After throttling: P_inlet increased to ${(throttledInletP / 1e5).toFixed(1)} bar, liquid rate reduced to ${throttledRate.toFixed(1)} kg/s`,
);

// 4. Hydrate Subcooling & MAOP Safety Headroom
console.log("4. Verifying flow assurance margin outputs...");
const hydSubcooling = throttledOutputs.get("hydrate.subcooling") as number;
const maopMargin = throttledOutputs.get("maop.margin") as number;
assert.ok(typeof hydSubcooling === "number");
assert.ok(typeof maopMargin === "number");
assert.ok(maopMargin > 0, "MAOP margin should be positive under nominal operation");
console.log(
  `✔ Flow assurance outputs: Hydrate Margin = ${hydSubcooling.toFixed(1)} K, MAOP Margin = ${(maopMargin / 1e5).toFixed(1)} bar`,
);

await participant.terminate();
console.log("=== All @modelscript/exchange OLGA Co-Simulation Tests Passed! ===");
