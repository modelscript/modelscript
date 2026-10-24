// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert";
import {
  interpolatePvt,
  lintOlgaModel,
  lowerFlowpathToDae,
  olgaToSysml2,
  OlgaWorkspaceIndex,
  parseKeyDeck,
  parseOlga,
  parseOlgaTpl,
  parseOpi,
  parsePvtTable,
  runOlgaEngine,
  serializeKeyDeck,
  simulateDriftFlux,
  verifyFlowAssuranceTrajectory,
  verifyOperatingProcedureStateTransitions,
} from "../src/index.js";

console.log("=== Running @modelscript/olga Unit Tests ===");

const sampleOpiXml = `<?xml version="1.0" encoding="utf-8"?>
<Model Title="Deepwater Flowline Riser" Author="FlowAssuranceTeam">
  <Integration StartTime="0" EndTime="3600" MinDt="0.001" MaxDt="0.5" />
  
  <Flowpath Name="PRODUCTION_LOOP">
    <Pipe Label="SEABED_TIEBACK" Length="3500" Diameter="0.254" Elevation="-1200" Roughness="4.5e-5" Discretization="10" />
    <Pipe Label="CATENARY_RISER" Length="1400" Diameter="0.254" Elevation="1220" Roughness="4.5e-5" Discretization="8" />
    <Valve Name="TOPSIDE_CHOKE" AbsolutePosition="4850" Diameter="0.15" Opening="0.85" Cd="0.82" />
    <Source Name="WELL_A" Position="0" TotalMassRate="45.0" GasMassFraction="0.22" WaterCut="0.08" Temperature="75C" Pressure="180bar" />
    <HeatTransfer Type="WATER" AmbientTemperature="4C" AmbientHeatTransferCoeff="250">
      <Layer Material="STEEL" Thickness="0.022" Conductivity="45.0" />
      <Layer Material="POLYURETHANE" Thickness="0.045" Conductivity="0.16" />
    </HeatTransfer>
  </Flowpath>

  <Node Name="WELLHEAD_MANIFOLD" Type="TERMINAL" Flowpath="PRODUCTION_LOOP" BoundaryPosition="0.0" MassRate="45.0" Temperature="75C" Pressure="180bar" />
  <Node Name="TOPSIDE_SEPARATOR" Type="PRESSURE" Flowpath="PRODUCTION_LOOP" BoundaryPosition="1.0" Pressure="32bar" Temperature="25C" />
</Model>`;

// 1. Test XML Ingestion (.opi)
console.log("1. Testing XML .opi Parser...");
const model = parseOpi(sampleOpiXml);
assert.strictEqual(model.title, "Deepwater Flowline Riser");
assert.strictEqual(model.flowpaths.length, 1);
const fp = model.flowpaths[0]!;
assert.strictEqual(fp.name, "PRODUCTION_LOOP");
assert.strictEqual(fp.pipes.length, 2);
assert.strictEqual(fp.pipes[0]!.label, "SEABED_TIEBACK");
assert.strictEqual(fp.pipes[0]!.length, 3500);
assert.strictEqual(fp.pipes[1]!.label, "CATENARY_RISER");
assert.strictEqual(fp.pipes[1]!.length, 1400);
assert.strictEqual(fp.valves.length, 1);
assert.strictEqual(fp.valves[0]!.name, "TOPSIDE_CHOKE");
assert.strictEqual(fp.valves[0]!.opening, 0.85);
assert.strictEqual(model.nodes.length, 2);
console.log("✔ XML .opi parsing passed!");

// 2. Test In-WASM DAE Lowering (DAEBuilder)
console.log("2. Testing In-WASM DAEBuilder Lowering...");
const builder = new DAEBuilder();
const { varIndices, cellCount } = lowerFlowpathToDae(builder, model, fp);
assert.strictEqual(cellCount, 18, "Should discretize 10 + 8 = 18 cells");
assert.ok(varIndices.length >= 18 * 4, "Should register P, alpha_g, T, and j variables in arena");
console.log(`✔ DAEBuilder lowering passed (${varIndices.length} arena variables registered)!`);

// 3. Test 1D Drift-Flux Transient Simulation
console.log("3. Testing 1D Drift-Flux Transient Simulation...");
const simResult = simulateDriftFlux(model, { durationSeconds: 60, timeStepSeconds: 1.0 });
assert.ok(simResult.times.length > 0);
assert.ok(simResult.profiles.length > 0);
assert.ok(simResult.trends.inletPressure.length > 0);
assert.ok(simResult.trends.arrivalPressure.length > 0);
assert.ok(simResult.trends.peakLiquidSurgeVolume >= 0);
const lastProfile = simResult.profiles[simResult.profiles.length - 1]!;
assert.strictEqual(lastProfile.x.length, 18);
console.log(
  `✔ 1D Drift-Flux simulated ${simResult.times.length} steps (Peak surge: ${simResult.trends.peakLiquidSurgeVolume.toFixed(2)} m^3)!`,
);

// 4. Test SysML v2 Polyglot Projection
console.log("4. Testing OLGA -> SysML v2 Projection...");
const sysmlCode = olgaToSysml2(model);
assert.ok(sysmlCode.includes("package Deepwater_Flowline_Riser"));
assert.ok(sysmlCode.includes("part def FlowlineRiserSystem"));
assert.ok(sysmlCode.includes("requirement def HydrateAvoidanceRequirement"));
assert.ok(sysmlCode.includes("requirement def TopsideSlugCapacityRequirement"));
assert.ok(sysmlCode.includes("requirement def PipelineMaopRequirement"));
assert.ok(sysmlCode.includes("state def SubseaFlowlineOperatingProcedure"));
assert.ok(sysmlCode.includes("state SteadyProduction"));
assert.ok(sysmlCode.includes("state EmergencyShutIn"));
console.log("✔ SysML v2 projection generated cleanly!");

// 5. Test Flow Assurance Verification
console.log("5. Testing Flow Assurance Limits Verification...");
const verification = verifyFlowAssuranceTrajectory(simResult, {
  maop: 250e5, // 250 bar
  hydrateMarginKelvin: 2.0,
  slugCatcherLiquidCapacity: 120.0,
  minGasVelocity: 1.0,
});
assert.ok(typeof verification.passed === "boolean");
assert.ok(verification.checks.hydrateAvoidance.minMarginObserved !== undefined);
assert.ok(verification.checks.slugCatcherSurge.peakArrivalLiquidVolume >= 0);
console.log(`✔ Flow assurance verification completed: passed=${verification.passed}`);

// 6. Test Flow Assurance Linter
console.log("6. Testing Flow Assurance Linter (M7001-M7005)...");
const diags = lintOlgaModel(model);
console.log(`✔ Linter returned ${diags.length} diagnostics for baseline case.`);

// 7. Test SysML v2 Operating Procedure State Machine Verification
console.log("7. Testing State Machine Determinism Verification...");
const smResult = verifyOperatingProcedureStateTransitions("EmergencyShutIn", [
  {
    id: "t1",
    name: "to_ControlledBlowdown",
    source: "EmergencyShutIn",
    target: "ControlledBlowdown",
    guardText: "wallTemperature > 18.0",
  },
  {
    id: "t2",
    name: "to_ChemicalInhibitionFlushing",
    source: "EmergencyShutIn",
    target: "ChemicalInhibitionFlushing",
    guardText: "wallTemperature <= 18.0",
  },
]);
assert.ok(smResult.isDeterministic, "Transitions with mutually exclusive guards should be deterministic");
console.log(
  `✔ State machine transition verification passed (isDeterministic=${smResult.isDeterministic}, isComplete=${smResult.isComplete})!`,
);

// 8. Test Tabular PVT Table Parsing & Bilinear Interpolation
console.log("8. Testing PVT Table Ingestion & Bilinear Interpolation...");
const sampleTab = `
TITLE = "Gulf of Mexico Subsea Fluid"
PRESSURE = 20, 50, 100, 200 BAR
TEMPERATURE = 10, 30, 60, 90 C
COLUMNS = PRESSURE, TEMPERATURE, ROG, ROL, VISG, VISL, STG
20, 10, 16.5, 835.0, 1.25e-5, 0.0028, 0.026
50, 30, 42.0, 820.0, 1.45e-5, 0.0021, 0.024
100, 60, 89.5, 795.0, 1.80e-5, 0.0014, 0.021
200, 90, 185.0, 755.0, 2.30e-5, 0.0009, 0.017
`;
const pvtTable = parsePvtTable(sampleTab);
assert.strictEqual(pvtTable.title, "Gulf of Mexico Subsea Fluid");
assert.ok(pvtTable.pressures.length >= 4);
assert.ok(pvtTable.temperatures.length >= 4);

const interp = interpolatePvt(pvtTable, 75e5, 318.15); // 75 bar, 45 C
assert.ok(interp.rhoG > 20 && interp.rhoG < 120);
assert.ok(interp.rhoL > 750 && interp.rhoL < 850);
assert.strictEqual(interp.isExtrapolated, false);
console.log(
  `✔ PVT bilinear interpolation: rhoG=${interp.rhoG.toFixed(1)} kg/m^3, rhoL=${interp.rhoL.toFixed(1)} kg/m^3!`,
);

// 9. Test Multi-File Workspace Indexer (OlgaWorkspaceIndex)
console.log("9. Testing OlgaWorkspaceIndex Multi-File Indexing...");
const ws = new OlgaWorkspaceIndex();
const fileUri = "file:///project/subsea_tieback.opi";
const index = ws.indexFile(fileUri, sampleOpiXml);
assert.strictEqual(ws.fileCount, 1);
assert.ok(ws.has(fileUri));
assert.ok(index.byName.has("Deepwater Flowline Riser"));
assert.ok(index.byName.has("PRODUCTION_LOOP"));
assert.ok(index.byName.has("PRODUCTION_LOOP.SEABED_TIEBACK"));
assert.ok(index.byName.has("WELLHEAD_MANIFOLD"));
console.log(`✔ OlgaWorkspaceIndex indexed ${index.symbols.size} symbols across file hierarchy!`);

// 10. Test Keyword Deck Ingestion (.key / .genkey) & Universal parseOlga
console.log("10. Testing Legacy Keyword Deck Ingestion (.key / .genkey)...");
const sampleKeyDeck = `! OLGA 7.3 Benchmark Flowline
CASE TITLE = "North Sea Gas Condensate", AUTHOR = "FlowAssurance"
INTEGRATION STARTTIME = 0.0 s, ENDTIME = 7200.0 s, MINDT = 0.01 s, MAXDT = 1.0 s
FILES TABLE = "fluids.tab"

FLOWPATH NAME = CONDENSATE_LINE
HEATTRANSFER TYPE = WATER, TAMB = 277.15 K, HAMB = 250.0 W/m2-C
WALL THICKNESS = (0.02 m, 0.05 m), CONDUCTIVITY = (45.0 W/m-C, 0.18 W/m-C)
PIPE LABEL = SECTION_1, LENGTH = 4200.0 m, DIAMETER = 0.30 m, ELEVATION = -150.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 12
PIPE LABEL = RISER_1, LENGTH = 800.0 m, DIAMETER = 0.30 m, ELEVATION = 160.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 6
VALVE NAME = ESDV_TOPSIDE, POSITION = 4950.0 m, DIAMETER = 0.25 m, OPENING = 1.0, CD = 0.84, TIMEOPEN = 3.0 s, TIMECLOSE = 5.0 s
MASSSOURCE NAME = INFLOW_WELL, POSITION = 0.0 m, TOTALMASSRATE = 38.0 kg/s, GASFRACTION = 0.35, WATERCUT = 0.02, TEMPERATURE = 345.0 K, PRESSURE = 160.0 bar

NODE NAME = INLET_WELLHEAD, TYPE = MASS_SOURCE, FLOWPATH = CONDENSATE_LINE, FRACTION = 0.0, TOTALMASSRATE = 38.0 kg/s, TEMPERATURE = 345.0 K, PRESSURE = 160.0 bar
NODE NAME = OUTLET_SEP, TYPE = PRESSURE, FLOWPATH = CONDENSATE_LINE, FRACTION = 1.0, PRESSURE = 25.0 bar, TEMPERATURE = 293.15 K
`;

const keyModel = parseKeyDeck(sampleKeyDeck);
assert.strictEqual(keyModel.title, "North Sea Gas Condensate");
assert.strictEqual(keyModel.flowpaths.length, 1);
assert.strictEqual(keyModel.flowpaths[0]!.pipes.length, 2);
assert.strictEqual(keyModel.flowpaths[0]!.pipes[0]!.label, "SECTION_1");
assert.strictEqual(keyModel.flowpaths[0]!.pipes[0]!.length, 4200);
assert.strictEqual(keyModel.flowpaths[0]!.valves.length, 1);
assert.strictEqual(keyModel.flowpaths[0]!.sources.length, 1);
assert.strictEqual(keyModel.nodes.length, 2);

// Test universal parseOlga auto-detection
const autoModel = parseOlga(sampleKeyDeck);
assert.strictEqual(autoModel.title, "North Sea Gas Condensate");
const autoXmlModel = parseOlga(sampleOpiXml);
assert.strictEqual(autoXmlModel.title, "Deepwater Flowline Riser");
console.log("✔ OLGA .key parser & universal parseOlga passed!");

// 11. Test Keyword Deck Serialization (.genkey)
console.log("11. Testing .genkey Serialization & Round-trip...");
const serializedDeck = serializeKeyDeck(keyModel);
assert.ok(serializedDeck.includes('CASE TITLE = "North Sea Gas Condensate"'));
assert.ok(serializedDeck.includes("FLOWPATH NAME = CONDENSATE_LINE"));
assert.ok(serializedDeck.includes("PIPE LABEL = SECTION_1"));
assert.ok(serializedDeck.includes("PIPE LABEL = RISER_1"));
assert.ok(serializedDeck.includes("VALVE NAME = ESDV_TOPSIDE"));
assert.ok(serializedDeck.includes("MASSSOURCE NAME = INFLOW_WELL"));
assert.ok(serializedDeck.includes("NODE NAME = INLET_WELLHEAD"));

const roundtripModel = parseKeyDeck(serializedDeck);
assert.strictEqual(roundtripModel.title, keyModel.title);
assert.strictEqual(roundtripModel.flowpaths[0]!.pipes.length, 2);
assert.strictEqual(roundtripModel.flowpaths[0]!.pipes[0]!.length, 4200);
console.log("✔ .genkey serialization round-trip passed!");

// 12. Test OLGA Output Trend Plot (.tpl) Parsing
console.log("12. Testing OLGA .tpl Trend Plot Parser...");
const sampleTpl = `
OLGA 7.3 TREND PLOT FILE
CATALOG
  PT:CONDENSATE_LINE(1) [PA]
  PT:CONDENSATE_LINE(18) [PA]
  TM:CONDENSATE_LINE(18) [C]
  HOL:CONDENSATE_LINE(18) [-]
  QLT:CONDENSATE_LINE(18) [KG/S]
TIME   PT_INLET   PT_OUTLET   TM_OUTLET   HOL_OUTLET   QLT_OUTLET
[S]    [PA]       [PA]        [C]         [-]          [KG/S]
0.0    150.0e5    25.0e5      65.0        0.20         24.5
10.0   152.0e5    25.0e5      64.8        0.22         25.1
20.0   155.0e5    25.0e5      64.2        0.28         28.4
30.0   160.0e5    25.0e5      63.5        0.35         32.0
`;
const tplResult = parseOlgaTpl(sampleTpl);
assert.strictEqual(tplResult.times.length, 4);
assert.strictEqual(tplResult.trends.inletPressure[0], 150.0e5);
assert.strictEqual(tplResult.trends.arrivalPressure[0], 25.0e5);
assert.ok(tplResult.trends.arrivalTemperature[0]! > 300); // 65 C -> ~338.15 K
assert.strictEqual(tplResult.trends.arrivalLiquidHoldup[3], 0.35);
console.log(`✔ .tpl trend parsing passed (${tplResult.times.length} time points extracted)!`);

// 13. Test Tier 3 OLGA Engine Batch Orchestrator
console.log("13. Testing Tier 3 OLGA Engine Runner (with in-WASM fallback)...");
const engineResult = await runOlgaEngine(keyModel, { forceWasmFallback: true, durationSeconds: 20 });
assert.ok(engineResult.times.length > 0);
assert.ok(engineResult.trends.inletPressure.length > 0);
assert.ok(engineResult.trends.arrivalPressure.length > 0);
console.log(`✔ Tier 3 OLGA engine runner passed (${engineResult.times.length} steps simulated)!`);

console.log("=== All @modelscript/olga Unit Tests Passed! ===");
