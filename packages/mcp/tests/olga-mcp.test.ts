// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

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

describe("OLGA MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (server as any)._registeredTools;

  it("registers olga tools: simulate, lint, verify, diagram, parse_tpl, parse_ppl, tune, gate, survey", () => {
    assert.ok(tools["olga_simulate"], "olga_simulate should be registered");
    assert.ok(tools["olga_lint"], "olga_lint should be registered");
    assert.ok(tools["olga_verify"], "olga_verify should be registered");
    assert.ok(tools["olga_diagram"], "olga_diagram should be registered");
    assert.ok(tools["olga_parse_tpl"], "olga_parse_tpl should be registered");
    assert.ok(tools["olga_parse_ppl"], "olga_parse_ppl should be registered");
    assert.ok(tools["olga_tune"], "olga_tune should be registered");
    assert.ok(tools["olga_gate"], "olga_gate should be registered");
    assert.ok(tools["olga_survey"], "olga_survey should be registered");
  });

  it("olga_lint validates flow assurance rules and stability criteria", async () => {
    const tool = tools["olga_lint"];
    const res = await tool.handler({ source: sampleOpiContent });
    assert.ok(!res.isError, "Linting should not return an error");
    const diagnostics = JSON.parse(res.content[0].text);
    assert.ok(Array.isArray(diagnostics), "Diagnostics should be an array");
  });

  it("olga_simulate runs drift-flux multiphase simulation with JSON output", async () => {
    const tool = tools["olga_simulate"];
    const res = await tool.handler({
      source: sampleOpiContent,
      durationSeconds: 10,
      timeStepSeconds: 1.0,
      format: "json",
    });
    assert.ok(!res.isError, "Simulation should succeed");
    const summary = JSON.parse(res.content[0].text);
    assert.equal(summary.title, "Subsea Tieback Riser System");
    assert.ok(summary.stepsSimulated > 0);
    assert.ok(typeof summary.arrivalPressureBar === "number");
    assert.ok(typeof summary.arrivalTemperatureC === "number");
  });

  it("olga_simulate runs drift-flux simulation with CSV output", async () => {
    const tool = tools["olga_simulate"];
    const res = await tool.handler({
      source: sampleOpiContent,
      durationSeconds: 5,
      timeStepSeconds: 1.0,
      format: "csv",
    });
    assert.ok(!res.isError, "Simulation should succeed");
    assert.ok(res.content[0].text.includes("time,inlet_pressure_bar,arrival_pressure_bar"));
  });

  it("olga_verify checks flow assurance limits on pressure and surge volume", async () => {
    const tool = tools["olga_verify"];
    const res = await tool.handler({
      source: sampleOpiContent,
      maopBar: 250,
      hydrateMarginK: 3.0,
      slugCatcherCapacityM3: 150,
      minGasVelocityMs: 0.1,
    });
    assert.ok(!res.isError, "Verification should succeed");
    const data = JSON.parse(res.content[0].text);
    assert.ok(typeof data.passed === "boolean");
    assert.ok(data.checks.hydrateAvoidance);
    assert.ok(data.checks.slugCatcherSurge);
    assert.ok(data.checks.maopOverpressure);
  });

  it("olga_diagram generates standalone SVG diagrams (schematic and profile)", async () => {
    const tool = tools["olga_diagram"];

    // Schematic
    const resSchematic = await tool.handler({
      source: sampleOpiContent,
      view: "schematic",
    });
    assert.ok(!resSchematic.isError);
    assert.ok(resSchematic.content[0].text.includes("<svg"));
    assert.ok(resSchematic.content[0].text.includes("Flowline Schematic"));

    // Elevation Profile
    const resProfile = await tool.handler({
      source: sampleOpiContent,
      view: "profile",
    });
    assert.ok(!resProfile.isError);
    assert.ok(resProfile.content[0].text.includes("<svg"));
    assert.ok(resProfile.content[0].text.includes("Pipeline Elevation Bathymetry"));
  });

  it("olga_parse_tpl parses .tpl content and extracts variable catalog with statistics", async () => {
    const tool = tools["olga_parse_tpl"];
    const sampleTpl = `'Test Trend'
CATALOG
1 'TIME' 'S' ''
2 'PT:INLET' 'PA' 'Inlet Pressure'
3 'TM:OUTLET' 'C' 'Arrival Temp'
DATA
 0.0000E+00  1.4000E+07  6.5000E+01
 1.0000E+02  1.4200E+07  6.4000E+01
`;
    const res = await tool.handler({ source: sampleTpl, includeData: true });
    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.timestepsCount, 2);
    assert.equal(parsed.channelsCount, 2);
    assert.equal(parsed.variables[0].id, "PT:INLET");
    assert.equal(parsed.variables[0].unit, "PA");
    assert.equal(parsed.variables[0].min, 14000000);
    assert.equal(parsed.variables[0].max, 14200000);
  });

  it("olga_parse_ppl parses .ppl spatial snapshots and identifies spatial bounds", async () => {
    const tool = tools["olga_parse_ppl"];
    const samplePpl = `'Test Profile'
'BRANCH_1'
CATALOG
1 'X' 'M' 'Coordinate'
2 'PT' 'PA' 'Pressure'
3 'TM' 'C' 'Temperature'
PROFILE 0.0000E+00
   0.0000E+00  1.4000E+07  6.5000E+01
1000.0000E+00  1.1000E+07  5.5000E+01
`;
    const res = await tool.handler({ source: samplePpl, snapshotIndex: 0 });
    assert.ok(!res.isError);
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.snapshotsCount, 1);
    assert.equal(parsed.snapshots[0].xSpan.sectionsCount, 2);
    assert.ok(parsed.detailedSnapshot);
    assert.equal(parsed.detailedSnapshot.x[1], 1000);
  });

  it("olga_simulate supports state checkpointing and warm restart", async () => {
    const tool = tools["olga_simulate"];
    const tempDir = path.resolve(process.cwd(), "data/test-mcp-olga");
    fs.mkdirSync(tempDir, { recursive: true });
    const cpFile = path.join(tempDir, "state.rst");

    const res1 = await tool.handler({
      source: sampleOpiContent,
      durationSeconds: 10,
      timeStepSeconds: 1.0,
      checkpointOut: cpFile,
    });
    assert.ok(!res1.isError, "Simulation with checkpoint output should succeed");
    assert.ok(fs.existsSync(cpFile), "Checkpoint file should be written to disk");

    const res2 = await tool.handler({
      source: sampleOpiContent,
      durationSeconds: 10,
      timeStepSeconds: 1.0,
      restart: cpFile,
    });
    assert.ok(!res2.isError, "Warm restart simulation should succeed");
    const summary2 = JSON.parse(res2.content[0].text);
    assert.ok(summary2.restartedFrom);
    assert.ok(summary2.restartedFrom.time >= 10.0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("olga_tune performs autonomous field history matching", async () => {
    const tool = tools["olga_tune"];
    const telemetryCsv = `TIME,PT_INLET,PT_ARRIVAL,TM_ARRIVAL,QLT
0.0,12000000,3200000,290.15,25.0
10.0,12100000,3250000,289.85,25.2
20.0,12200000,3300000,289.50,25.5
`;
    const res = await tool.handler({
      source: sampleOpiContent,
      observations: telemetryCsv,
      parameters: ["roughness", "choke-cd"],
      maxEvaluations: 15,
    });
    assert.ok(!res.isError, "Tuning should execute cleanly");
    const data = JSON.parse(res.content[0].text);
    assert.ok(typeof data.success === "boolean");
    assert.ok(data.evaluations > 0);
    assert.ok(Array.isArray(data.calibratedParameters));
    assert.ok(data.markdownReport.includes("Flowline History Matching"));
  });

  it("olga_gate evaluates CI/CD safety gate rules", async () => {
    const tool = tools["olga_gate"];
    const res = await tool.handler({
      source: sampleOpiContent,
      maxSurgeM3: 150.0,
      minHydrateMarginK: 1.0,
      durationSeconds: 15,
    });
    assert.ok(!res.isError, "Gate evaluation should execute cleanly");
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.passed, true);
    assert.equal(data.verdict, "APPROVED (PASSED)");
    assert.ok(data.checks.slugSurge);
    assert.ok(data.markdownReport.includes("Flow Assurance Safety Gate"));
  });

  it("olga_survey ingests bathymetry coordinates into discretized pipes", async () => {
    const tool = tools["olga_survey"];
    const surveyCsv = `Easting,Northing,Depth
0,0,-500
1000,200,-520
3000,600,-480
`;
    const res = await tool.handler({
      source: surveyCsv,
      defaultDiameter: 0.254,
      targetCellLength: 100.0,
    });
    assert.ok(!res.isError, "Survey ingestion should succeed");
    const data = JSON.parse(res.content[0].text);
    assert.ok(data.totalLengthM > 1000);
    assert.ok(data.discretizedPipesCount > 0);
    assert.ok(data.opiXmlSnippet.includes("<Pipe"));
  });
});
