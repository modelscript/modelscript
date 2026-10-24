// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { OlgaCommand } from "../src/commands/olga.js";

console.log("=== Testing ModelScript CLI: OLGA Subcommand ===");

const sampleOpiContent = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Subsea Tieback Riser System" StartTime="0" EndTime="3600" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_1">
    <Pipe Name="SEABED_LINE" Length="3500.0" Diameter="0.254" Elevation="-120.0" Roughness="0.000045" Discretization="10" />
    <Pipe Name="CATENARY_RISER" Length="950.0" Diameter="0.254" Elevation="140.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="TOPSIDE_CHOKE" Position="4450.0" Diameter="0.15" Opening="0.75" Cd="0.84" />
    <Pig Name="BATCH_PIG_01" LaunchTime="30.0" Mass="90.0" FrictionForce="2200.0" />
  </Flowpath>
  <Node Name="WELL_MANIFOLD" Type="TERMINAL" Flowpath="FLOWLINE_1" Fraction="0.0" Pressure="12000000" Temperature="335.15" MassRate="32.0" />
  <Node Name="PLATFORM_SEP" Type="SEPARATOR" Flowpath="FLOWLINE_1" Fraction="1.0" Pressure="3200000" Temperature="290.15" />
</Model>`;

const tempDir = path.resolve(process.cwd(), "data/test-olga-cli");
fs.mkdirSync(tempDir, { recursive: true });

const testOpiFile = path.join(tempDir, "tieback.opi");
fs.writeFileSync(testOpiFile, sampleOpiContent, "utf-8");

// 1. Test 'lint' action
console.log("1. Testing 'msx olga lint'...");
await (OlgaCommand.handler as any)({
  action: "lint",
  files: [testOpiFile],
});
console.log("✔ 'msx olga lint' executed cleanly!");

// 2. Test 'simulate' action with CSV export
console.log("2. Testing 'msx olga simulate'...");
const csvOut = path.join(tempDir, "sim_output.csv");
await (OlgaCommand.handler as any)({
  action: "simulate",
  files: [testOpiFile],
  duration: 15,
  dt: 1.0,
  out: csvOut,
});
assert.ok(fs.existsSync(csvOut), "Simulation trajectory CSV should be generated");
const csvContent = fs.readFileSync(csvOut, "utf-8");
assert.ok(csvContent.includes("time,inlet_pressure_bar"), "CSV header should be present");
assert.ok(csvContent.split("\n").length >= 10, "CSV should contain multiple time steps");
console.log("✔ 'msx olga simulate' generated valid trajectory CSV!");

// 3. Test 'verify' action
console.log("3. Testing 'msx olga verify'...");
await (OlgaCommand.handler as any)({
  action: "verify",
  files: [testOpiFile],
  maop: 250,
  margin: 3.0,
  capacity: 150.0,
  "min-vel": 0.1,
});
console.log("✔ 'msx olga verify' completed verification report!");

// 4. Test 'diagram' action (elevation bathymetry SVG)
console.log("4. Testing 'msx olga diagram'...");
const svgOut = path.join(tempDir, "bathymetry.svg");
await (OlgaCommand.handler as any)({
  action: "diagram",
  files: [testOpiFile],
  view: "profile",
  out: svgOut,
});
assert.ok(fs.existsSync(svgOut), "Bathymetry SVG should be generated");
const svgContent = fs.readFileSync(svgOut, "utf-8");
assert.ok(svgContent.includes("<svg"), "Output should be SVG markup");
assert.ok(svgContent.includes("Pipeline Elevation Bathymetry Z(X)"));
console.log("✔ 'msx olga diagram' generated valid bathymetry SVG!");

// 5. Test 'convert' action to .genkey and SysML v2
console.log("5. Testing 'msx olga convert'...");
const genkeyOut = path.join(tempDir, "converted.genkey");
await (OlgaCommand.handler as any)({
  action: "convert",
  files: [testOpiFile],
  to: "genkey",
  out: genkeyOut,
});
assert.ok(fs.existsSync(genkeyOut), "Keyword deck should be generated");
const keyContent = fs.readFileSync(genkeyOut, "utf-8");
assert.ok(keyContent.includes("CASE"), "Deck should contain CASE keyword");
assert.ok(keyContent.includes("PIPE"), "Deck should contain PIPE keyword");

const sysmlOut = path.join(tempDir, "converted.sysml");
await (OlgaCommand.handler as any)({
  action: "convert",
  files: [testOpiFile],
  to: "sysml2",
  out: sysmlOut,
});
assert.ok(fs.existsSync(sysmlOut), "SysML v2 projection should be generated");
const sysmlContent = fs.readFileSync(sysmlOut, "utf-8");
assert.ok(sysmlContent.includes("package Subsea_Tieback_Riser_System"), "SysML package definition should be present");
assert.ok(
  sysmlContent.includes("state def SubseaFlowlineOperatingProcedure"),
  "Operational state machine should be present",
);
console.log("✔ 'msx olga convert' generated valid .genkey and SysML v2 models!");

// Cleanup temp test artifacts
fs.rmSync(tempDir, { recursive: true, force: true });

console.log("=== All ModelScript CLI OLGA Tests Passed! ===");
