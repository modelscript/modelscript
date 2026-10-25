// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseOlga } from "@modelscript/olga";
import assert from "node:assert";
import { exportOlgaFmu, extractFromZip, parseFmuModelDescription } from "../src/index.js";

console.log("=== Testing OLGA FMI 2.0 / 3.0 Co-Simulation FMU Exporter ===");

const testModelOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="North Sea 12in Tieback" StartTime="0" EndTime="3600" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_01">
    <Pipe Name="SUBSEA_PIPE" Length="4200.0" Diameter="0.3048" Elevation="-150.0" Roughness="0.000045" Discretization="12" />
    <Pipe Name="RISER" Length="850.0" Diameter="0.3048" Elevation="165.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="CHOKE" Position="5050.0" Diameter="0.18" Opening="0.80" Cd="0.84" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="TERMINAL" Flowpath="FLOWLINE_01" Fraction="0.0" Pressure="14000000" Temperature="340.15" MassRate="38.0" />
  <Node Name="PLATFORM" Type="SEPARATOR" Flowpath="FLOWLINE_01" Fraction="1.0" Pressure="3500000" Temperature="295.15" />
</Model>`;

const model = parseOlga(testModelOpi);

// 1. Export as FMI 2.0 / 3.0 FMU
console.log("1. Generating OLGA FMU package...");
const fmuResult = exportOlgaFmu(model, {
  fmiVersion: "both",
  description: "North Sea Subsea Tieback Multiphase Co-Simulation FMU",
});

assert.ok(fmuResult.archive instanceof Uint8Array, "Archive should be a Uint8Array");
assert.ok(fmuResult.archive.length > 500, "Archive should contain packaged ZIP data");
assert.strictEqual(fmuResult.variableCount, 14, "Should have 14 FMI scalar variables");
console.log(`✔ FMU archive generated (${fmuResult.archive.length} bytes, ${fmuResult.files.length} files).`);

// 2. Verify modelDescription.xml extraction and parsing
console.log("2. Verifying FMI 2.0 modelDescription.xml inside FMU ZIP...");
const descBytes = extractFromZip(fmuResult.archive, "modelDescription.xml");
assert.ok(descBytes, "modelDescription.xml must exist in the FMU archive");
const descXml = new TextDecoder().decode(descBytes);
assert.ok(descXml.includes('fmiVersion="2.0"'), "Must be FMI 2.0 schema");
assert.ok(descXml.includes("<CoSimulation"), "Must have CoSimulation element");
assert.ok(descXml.includes(`modelIdentifier="${fmuResult.modelIdentifier}"`), "Must have correct modelIdentifier");

const parsed = parseFmuModelDescription(descXml);
assert.strictEqual(parsed.modelName, "North_Sea_12in_Tieback");
console.log(`Parsed ${parsed.variables.length} variables from modelDescription.xml.`);

const inputs = parsed.variables.filter((v) => v.causality === "input");
assert.ok(
  inputs.some((v) => v.name === "choke_opening"),
  "choke_opening must be an input",
);
assert.ok(
  inputs.some((v) => v.name === "inlet_mass_rate"),
  "inlet_mass_rate must be an input",
);
assert.ok(
  inputs.some((v) => v.name === "inlet_pressure"),
  "inlet_pressure must be an input",
);
assert.ok(
  inputs.some((v) => v.name === "inlet_temperature"),
  "inlet_temperature must be an input",
);

const outputs = parsed.variables.filter((v) => v.causality === "output");
assert.ok(
  outputs.some((v) => v.name === "p_inlet"),
  "p_inlet must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "p_arrival"),
  "p_arrival must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "t_arrival"),
  "t_arrival must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "holdup_arrival"),
  "holdup_arrival must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "surge_vol"),
  "surge_vol must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "mean_slug_length"),
  "mean_slug_length must be an output",
);
assert.ok(
  outputs.some((v) => v.name === "slug_frequency"),
  "slug_frequency must be an output",
);

console.log("✔ FMI 2.0 inputs and outputs validated successfully!");

// 3. Verify C Co-Simulation source code
console.log("3. Verifying C Co-Simulation solver in sources/...");
const cSourceBytes = extractFromZip(fmuResult.archive, `sources/${fmuResult.modelIdentifier}_cosim.c`);
assert.ok(cSourceBytes, "C source file must be in sources/");
const cSource = new TextDecoder().decode(cSourceBytes);
assert.ok(
  cSource.includes(`${fmuResult.modelIdentifier}_fmi2Instantiate`),
  "Must contain fmi2Instantiate implementation",
);
assert.ok(cSource.includes(`${fmuResult.modelIdentifier}_fmi2DoStep`), "Must contain fmi2DoStep implementation");
assert.ok(cSource.includes(`${fmuResult.modelIdentifier}_fmi2GetReal`), "Must contain fmi2GetReal implementation");
assert.ok(cSource.includes(`${fmuResult.modelIdentifier}_fmi2SetReal`), "Must contain fmi2SetReal implementation");
console.log("✔ C source code verified!");

// 4. Verify resources
console.log("4. Verifying embedded resources in resources/...");
const opiBytes = extractFromZip(fmuResult.archive, "resources/model.opi");
assert.ok(opiBytes, "model.opi must be present in resources/");
const opiContent = new TextDecoder().decode(opiBytes);
assert.ok(opiContent.includes('<Model Name="North Sea 12in Tieback"'));

const jsonBytes = extractFromZip(fmuResult.archive, "resources/model.json");
assert.ok(jsonBytes, "model.json must be present in resources/");
console.log("✔ Resources verified!");

// 5. Verify FMI 3.0 modelDescription3.xml (both versions bundled)
console.log("5. Verifying FMI 3.0 dual specification bundle...");
const desc3Bytes = extractFromZip(fmuResult.archive, "modelDescription3.xml");
assert.ok(desc3Bytes, "modelDescription3.xml must exist for fmiVersion='both'");
const desc3Xml = new TextDecoder().decode(desc3Bytes);
assert.ok(desc3Xml.includes('<fmiModelDescription\n  fmiVersion="3.0"'));
assert.ok(desc3Xml.includes('<Float64 name="choke_opening"'));
console.log("✔ FMI 3.0 XML verified!");

console.log("=== All OLGA FMU Exporter Tests Passed! ===");
