// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
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

  it("registers olga_simulate, olga_lint, olga_verify, olga_diagram", () => {
    assert.ok(tools["olga_simulate"], "olga_simulate should be registered");
    assert.ok(tools["olga_lint"], "olga_lint should be registered");
    assert.ok(tools["olga_verify"], "olga_verify should be registered");
    assert.ok(tools["olga_diagram"], "olga_diagram should be registered");
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
});
