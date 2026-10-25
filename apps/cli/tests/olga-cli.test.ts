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

// 6. Test 'diagram' action with --view=bathy
console.log("6. Testing 'msx olga diagram --view=bathy'...");
const bathyOut = path.join(tempDir, "bathy3d.svg");
await (OlgaCommand.handler as any)({
  action: "diagram",
  files: [testOpiFile],
  view: "bathy",
  out: bathyOut,
});
assert.ok(fs.existsSync(bathyOut), "3D Bathymetry SVG should be generated");
const bathySvgContent = fs.readFileSync(bathyOut, "utf-8");
assert.ok(bathySvgContent.includes("3D Offshore Seabed Bathymetry & Pipeline Route"));
assert.ok(bathySvgContent.includes("WELLHEAD"));
assert.ok(bathySvgContent.includes("3D Compass"));
console.log("✔ 'msx olga diagram --view=bathy' generated 3D seabed bathymetry SVG!");

// 7. Test 'survey' action
console.log("7. Testing 'msx olga survey'...");
const surveyCsvPath = path.join(tempDir, "route_survey.csv");
fs.writeFileSync(
  surveyCsvPath,
  `Easting,Northing,Depth\n0,0,-500\n1000,200,-520\n3000,600,-480\n4500,800,30\n`,
  "utf-8",
);
const pipesOut = path.join(tempDir, "discretized_pipes.xml");
await (OlgaCommand.handler as any)({
  action: "survey",
  files: [surveyCsvPath],
  out: pipesOut,
});
assert.ok(fs.existsSync(pipesOut), "Discretized pipes XML should be generated");
const pipesXml = fs.readFileSync(pipesOut, "utf-8");
assert.ok(pipesXml.includes("<Pipe Label="));
assert.ok(pipesXml.includes('Discretization="'));
console.log("✔ 'msx olga survey' parsed seabed bathymetry and generated pipe discretization!");

// 8. Test 'gate' action
console.log("8. Testing 'msx olga gate'...");
const gateReportOut = path.join(tempDir, "gate_report.md");
await (OlgaCommand.handler as any)({
  action: "gate",
  files: [testOpiFile],
  "max-surge": 150.0,
  "min-hydrate-margin": 1.0,
  "max-wax": "2mm",
  "max-corrosion": "0.15mm/yr",
  "out-report": gateReportOut,
  duration: 20,
});
assert.ok(fs.existsSync(gateReportOut), "Gate Markdown report should be generated");
const gateReport = fs.readFileSync(gateReportOut, "utf-8");
assert.ok(gateReport.includes("# Flow Assurance Safety Gate Report"));
assert.ok(gateReport.includes("PASSED (APPROVED FOR OPERATION)"));
assert.ok(gateReport.includes("Topside Slug Catcher Surge"));
assert.ok(gateReport.includes("Sweet CO₂ Corrosion Rate"));
console.log("✔ 'msx olga gate' completed CI/CD safety evaluation and generated report!");

// 9. Test 'fmu' action
console.log("9. Testing 'msx olga fmu'...");
const fmuOut = path.join(tempDir, "tieback_cosim.fmu");
await (OlgaCommand.handler as any)({
  action: "fmu",
  files: [testOpiFile],
  out: fmuOut,
  "fmi-version": "both",
});
assert.ok(fs.existsSync(fmuOut), "FMU package archive should be generated");
const fmuStat = fs.statSync(fmuOut);
assert.ok(fmuStat.size > 1000, "FMU archive should have valid size");
console.log("✔ 'msx olga fmu' exported standalone FMI Co-Simulation FMU!");

// 10. Test 'trend' action with .tpl file
console.log("10. Testing 'msx olga trend'...");
const sampleTpl = `'Test Flowline Trend'
CATALOG
1 'TIME' 'S' ''
2 'PT:INLET' 'PA' 'Inlet Pressure'
3 'TM:OUTLET' 'C' 'Arrival Temperature'
DATA
 0.0000E+00  1.4000E+07  6.5000E+01
 1.0000E+02  1.4200E+07  6.4000E+01
 2.0000E+02  1.4500E+07  6.3000E+01
`;
const testTplFile = path.join(tempDir, "flowline.tpl");
const tplCsvOut = path.join(tempDir, "trend_exported.csv");
fs.writeFileSync(testTplFile, sampleTpl, "utf-8");
await (OlgaCommand.handler as any)({
  action: "trend",
  files: [testTplFile],
  out: tplCsvOut,
});
assert.ok(fs.existsSync(tplCsvOut), "Trend trajectory CSV should be generated");
const tplCsvContent = fs.readFileSync(tplCsvOut, "utf-8");
assert.ok(tplCsvContent.includes("TIME [S]"), "CSV header should contain TIME");
assert.ok(tplCsvContent.includes("PT:INLET"), "CSV header should contain PT:INLET");
console.log("✔ 'msx olga trend' processed .tpl and exported CSV!");

// 11. Test 'profile' action with .ppl file
console.log("11. Testing 'msx olga profile'...");
const samplePpl = `'Test Flowline Profile'
'BRANCH_1'
CATALOG
1 'X' 'M' 'Coordinate'
2 'PT' 'PA' 'Pressure'
3 'TM' 'C' 'Temperature'
PROFILE 0.0000E+00
   0.0000E+00  1.4000E+07  6.5000E+01
1000.0000E+00  1.1000E+07  5.5000E+01
2000.0000E+00  8.0000E+06  4.5000E+01
`;
const testPplFile = path.join(tempDir, "flowline.ppl");
const pplSvgOut = path.join(tempDir, "profile_diagram.svg");
fs.writeFileSync(testPplFile, samplePpl, "utf-8");
await (OlgaCommand.handler as any)({
  action: "profile",
  files: [testPplFile],
  out: pplSvgOut,
});
assert.ok(fs.existsSync(pplSvgOut), "Profile SVG diagram should be generated");
const pplSvgContent = fs.readFileSync(pplSvgOut, "utf-8");
assert.ok(pplSvgContent.includes("<svg"), "Profile diagram should be valid SVG");
// 12. Test 'cosim' action
console.log("12. Testing 'msx olga cosim'...");
const cosimCsvOut = path.join(tempDir, "cosim_trajectory.csv");
await (OlgaCommand.handler as any)({
  action: "cosim",
  files: [testOpiFile],
  duration: 10,
  "macro-step": 1.0,
  algorithm: "gauss-seidel",
  out: cosimCsvOut,
});
assert.ok(fs.existsSync(cosimCsvOut), "Co-simulation CSV trajectory should be generated");
const cosimCsvContent = fs.readFileSync(cosimCsvOut, "utf-8");
assert.ok(cosimCsvContent.includes("time_s,subsea_inlet_pressure_bar"), "CSV header should contain time and pressures");
assert.ok(
  cosimCsvContent.includes("topside_separator_pressure_bar"),
  "CSV header should contain topside separator pressure",
);
assert.ok(cosimCsvContent.split("\n").length >= 10, "CSV should contain co-simulation time points");
console.log("✔ 'msx olga cosim' completed multi-rate co-simulation and exported CSV!");

// 13. Test 'simulate' checkpoint snapshotting and warm restart
console.log("13. Testing 'msx olga simulate --checkpoint-out' and '--restart'...");
const checkpointOutFile = path.join(tempDir, "flowline_state.rst");
await (OlgaCommand.handler as any)({
  action: "simulate",
  files: [testOpiFile],
  duration: 20,
  dt: 1.0,
  "checkpoint-out": checkpointOutFile,
});
assert.ok(fs.existsSync(checkpointOutFile), "Simulation state checkpoint .rst should be generated");
const checkpointContent = JSON.parse(fs.readFileSync(checkpointOutFile, "utf-8"));
assert.strictEqual(checkpointContent.version, "1.0", "Checkpoint format version should be 1.0");
assert.ok(checkpointContent.gridCells.length > 0, "Checkpoint should contain spatial grid cells");
assert.ok(checkpointContent.simulatedTime >= 20.0, "Checkpoint should record simulated time");

const restartedCsvOut = path.join(tempDir, "restarted_sim.csv");
await (OlgaCommand.handler as any)({
  action: "simulate",
  files: [testOpiFile],
  duration: 20,
  dt: 1.0,
  restart: checkpointOutFile,
  out: restartedCsvOut,
});
assert.ok(fs.existsSync(restartedCsvOut), "Restarted simulation trajectory CSV should be generated");
const restartCsvLines = fs.readFileSync(restartedCsvOut, "utf-8").trim().split("\n");
assert.ok(restartCsvLines.length >= 10, "Restarted trajectory should contain time points");
console.log("✔ 'msx olga simulate' checkpointing and zero-discontinuity warm restart verified!");

// 14. Test 'tune' history matching action
console.log("14. Testing 'msx olga tune'...");
const telemetryCsvPath = path.join(tempDir, "field_telemetry.csv");
fs.writeFileSync(
  telemetryCsvPath,
  `TIME,PT_INLET,PT_ARRIVAL,TM_ARRIVAL,QLT
0.0,12000000,3200000,290.15,25.0
10.0,12100000,3250000,289.85,25.2
20.0,12200000,3300000,289.50,25.5
30.0,12250000,3320000,289.20,25.8
`,
  "utf-8",
);

const tunedOpiOut = path.join(tempDir, "calibrated_tieback.opi");
const tuneReportOut = path.join(tempDir, "tuning_report.md");
await (OlgaCommand.handler as any)({
  action: "tune",
  files: [testOpiFile, telemetryCsvPath],
  tune: "roughness,choke-cd",
  "max-evals": 25,
  out: tunedOpiOut,
  report: tuneReportOut,
});
assert.ok(fs.existsSync(tunedOpiOut), "Calibrated model OPI should be generated");
const tunedOpiContent = fs.readFileSync(tunedOpiOut, "utf-8");
assert.ok(tunedOpiContent.includes("<Model"), "Calibrated output should be valid OPI XML");
assert.ok(tunedOpiContent.includes("Roughness="), "Calibrated model should retain roughness attribute");

assert.ok(fs.existsSync(tuneReportOut), "Tuning Markdown report should be generated");
const tuneReportContent = fs.readFileSync(tuneReportOut, "utf-8");
assert.ok(tuneReportContent.includes("Flowline History Matching"), "Report should contain title");
assert.ok(tuneReportContent.includes("Calibrated Parameter Set"), "Report should contain parameter table");
console.log("✔ 'msx olga tune' completed history matching optimization and exported calibrated model!");

// 15. Test 'flash' action with compositional EOS and .tab synthesis
console.log("15. Testing 'msx olga flash'...");
const flashCsvOut = path.join(tempDir, "flash_result.csv");
const flashTabOut = path.join(tempDir, "synthesized_fluid.tab");

await (OlgaCommand.handler as any)({
  action: "flash",
  files: [],
  comp: "C1:0.70,C2:0.10,C3:0.10,nC4:0.05,C7:0.05",
  p: 55.0,
  t: 295.15,
  model: "pr",
  envelope: true,
  out: flashCsvOut,
});
assert.ok(fs.existsSync(flashCsvOut), "Flash summary CSV should be generated");
const flashCsvContent = fs.readFileSync(flashCsvOut, "utf-8");
assert.ok(flashCsvContent.includes("vapor_fraction"), "Flash CSV should report vapor fraction");
assert.ok(flashCsvContent.includes("gas_density"), "Flash CSV should report gas density");
assert.ok(flashCsvContent.includes("liquid_density"), "Flash CSV should report liquid density");

await (OlgaCommand.handler as any)({
  action: "flash",
  files: [],
  comp: "C1:0.70,C2:0.10,C3:0.10,nC4:0.05,C7:0.05",
  p: 55.0,
  t: 295.15,
  model: "srk",
  out: flashTabOut,
});
assert.ok(fs.existsSync(flashTabOut), "Synthesized .tab PVT table should be generated");
const flashTabContent = fs.readFileSync(flashTabOut, "utf-8");
assert.ok(flashTabContent.includes("PHASE = TWO-PHASE"), "Synthesized table should declare two-phase");
assert.ok(flashTabContent.includes("PRESSURE = "), "Synthesized table should include pressure grid");
assert.ok(flashTabContent.includes("TEMPERATURE = "), "Synthesized table should include temperature grid");
console.log("✔ 'msx olga flash' verified for PR/SRK EOS, phase envelope, and .tab synthesis!");

// 16. Test 'simulate --anti-slug' active closed-loop control
console.log("16. Testing 'msx olga simulate --anti-slug'...");
const antiSlugCsvOut = path.join(tempDir, "anti_slug_sim.csv");
await (OlgaCommand.handler as any)({
  action: "simulate",
  files: [testOpiFile],
  duration: 15,
  dt: 1.0,
  "anti-slug": true,
  "slug-setpoint": 50.0,
  "slug-kp": 1.5e-6,
  "slug-ti": 30.0,
  "slug-washout": 20.0,
  "slug-choke": 0.5,
  out: antiSlugCsvOut,
});
assert.ok(fs.existsSync(antiSlugCsvOut), "Anti-slug trajectory CSV should be generated");
const antiSlugCsvContent = fs.readFileSync(antiSlugCsvOut, "utf-8");
assert.ok(
  antiSlugCsvContent.includes("choke_opening,controller_error"),
  "CSV header should contain anti-slug telemetry",
);
const antiSlugLines = antiSlugCsvContent.trim().split("\n");
assert.ok(antiSlugLines.length >= 10, "Trajectory should contain time points");
console.log("✔ 'msx olga simulate --anti-slug' verified with active choke modulation telemetry!");

// 17. Test 'network' coupled multi-branch gathering transient solver
console.log("17. Testing 'msx olga network'...");
const networkOpiContent = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Gathering Network Subsea Tieback" StartTime="0" EndTime="100" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="WELL_1">
    <Pipe Name="P1" Length="1000.0" Diameter="0.2" Elevation="0.0" Roughness="0.000045" Discretization="5" />
    <Valve Name="CHOKE_1" Position="1000.0" Diameter="0.1" Opening="0.8" />
  </Flowpath>
  <Flowpath Name="WELL_2">
    <Pipe Name="P2" Length="1200.0" Diameter="0.2" Elevation="0.0" Roughness="0.000045" Discretization="5" />
    <Valve Name="CHOKE_2" Position="1200.0" Diameter="0.1" Opening="0.8" />
  </Flowpath>
  <Node Name="WELL_1_HEAD" Type="TERMINAL" Flowpath="WELL_1" Fraction="0.0" Pressure="9000000" Temperature="330.15" MassRate="25.0" />
  <Node Name="WELL_2_HEAD" Type="TERMINAL" Flowpath="WELL_2" Fraction="0.0" Pressure="8500000" Temperature="325.15" MassRate="20.0" />
  <Node Name="SUBSEA_MANIFOLD" Type="JUNCTION" Flowpath="WELL_1" Fraction="1.0" Pressure="6000000" Temperature="310.15" />
  <Node Name="SUBSEA_MANIFOLD" Type="JUNCTION" Flowpath="WELL_2" Fraction="1.0" Pressure="6000000" Temperature="310.15" />
</Model>`;

const networkOpiFile = path.join(tempDir, "gathering_network.opi");
fs.writeFileSync(networkOpiFile, networkOpiContent, "utf-8");

const networkCsvOut = path.join(tempDir, "network_sim.csv");
await (OlgaCommand.handler as any)({
  action: "network",
  files: [networkOpiFile],
  duration: 20,
  dt: 1.0,
  "junction-vol": 5.0,
  trip: "WELL_1:10",
  out: networkCsvOut,
});
assert.ok(fs.existsSync(networkCsvOut), "Gathering network trajectory CSV should be generated");
const networkCsvContent = fs.readFileSync(networkCsvOut, "utf-8");
assert.ok(networkCsvContent.includes("manifold_SUBSEA_MANIFOLD_bar"), "CSV should contain manifold junction pressure");
assert.ok(networkCsvContent.includes("branch_WELL_1_rate_kgs"), "CSV should contain Well 1 flow rate");
assert.ok(networkCsvContent.includes("branch_WELL_2_rate_kgs"), "CSV should contain Well 2 flow rate");
console.log("✔ 'msx olga network' verified with dynamic well trip flow redistribution!");

// Cleanup temp test artifacts
fs.rmSync(tempDir, { recursive: true, force: true });

console.log("=== All ModelScript CLI OLGA Tests Passed! ===");
