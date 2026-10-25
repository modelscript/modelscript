// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseGensysDeck } from "@modelscript/gensys";
import { parseSpckXml } from "@modelscript/simpack";
import assert from "node:assert";
import { exportGensysFmu, exportSimpackFmu } from "../src/fmu/multibody-fmu-exporter.js";

console.log("=== Running @modelscript/exchange Multibody FMU Exporter Tests ===");

// 1. Test SIMPACK FMU Export
console.log("1. Testing SIMPACK FMI 2.0 Co-Simulation FMU export...");
const simpackXml = `
<simpack_model name="QuarterCar">
  <body id="b_chassis" name="Chassis" mass="350.0" ixx="80.0" iyy="120.0" izz="150.0" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_chassis" body="b_chassis" x="0" y="0" z="-0.2" />
  <joint id="j_slide" type="prismatic" from="m_ground" to="m_chassis" />
</simpack_model>
`;

const simpackModel = parseSpckXml(simpackXml, "QuarterCar");
const simpackResult = exportSimpackFmu(simpackModel, {
  modelIdentifier: "QuarterCarMbs",
  startTime: 0.0,
  stepSize: 0.002,
});

assert.strictEqual(simpackResult.modelIdentifier, "QuarterCarMbs");
assert.ok(simpackResult.archive.length > 100, "FMU archive ZIP must not be empty");
assert.ok(simpackResult.files.includes("modelDescription.xml"));
assert.ok(simpackResult.files.includes("sources/QuarterCarMbs_cosim.c"));
assert.ok(simpackResult.variableCount > 5, "Must expose multiple FMI variables");

const xml2 = simpackResult.modelDescription2Xml;
assert.ok(xml2.includes('fmiVersion="2.0"'));
assert.ok(xml2.includes('modelName="QuarterCarMbs"'));
assert.ok(xml2.includes("<CoSimulation"));
assert.ok(xml2.includes('name="b_chassis_f_ext_z"'));
assert.ok(xml2.includes('name="b_chassis_z"'));
assert.ok(xml2.includes('name="b_chassis_mass"'));
assert.ok(xml2.includes('name="j_slide_violation_norm"'));
console.log(`✔ SIMPACK FMU export succeeded with ${simpackResult.variableCount} scalar variables!`);

// 2. Test GENSYS Railway Vehicle FMU Export
console.log("2. Testing GENSYS Railway Vehicle FMI 2.0 Co-Simulation FMU export...");
const gensysDeck = `
body carbody 32000.0 25000.0 180000.0 190000.0 0 0 1.8
spring sec_susp carbody ground 180000 180000 420000 15000 15000 35000
`;

const gensysModel = parseGensysDeck(gensysDeck, "CoachVehicle");
const gensysResult = exportGensysFmu(gensysModel, {
  modelIdentifier: "CoachVehicleFmu",
  startTime: 0.0,
  stepSize: 0.001,
});

assert.strictEqual(gensysResult.modelIdentifier, "CoachVehicleFmu");
assert.ok(gensysResult.archive.length > 100);
assert.ok(gensysResult.files.includes("modelDescription.xml"));
assert.ok(gensysResult.files.includes("sources/CoachVehicleFmu_cosim.c"));

const gXml = gensysResult.modelDescription2Xml;
assert.ok(gXml.includes('name="track_lateral_perturbation"'));
assert.ok(gXml.includes('name="derailment_quotient_yq"'));
assert.ok(gXml.includes('name="prudhomme_lateral_force"'));
assert.ok(gXml.includes('name="carbody_z"'));
assert.ok(gXml.includes('name="sec_susp_kz"'));
console.log(`✔ GENSYS FMU export succeeded with ${gensysResult.variableCount} scalar variables!`);

console.log("=== All Multibody FMU Exporter Tests Passed! ===");
