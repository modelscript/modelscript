// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/IEEE9Bus_IBR.pscx");

describe("PSCAD MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (server as any)._registeredTools;

  it("registers pscad_lint, pscad_simulate, pscad_verify_ieee2800, pscad_export", () => {
    assert.ok(tools["pscad_lint"], "pscad_lint should be registered");
    assert.ok(tools["pscad_simulate"], "pscad_simulate should be registered");
    assert.ok(tools["pscad_verify_ieee2800"], "pscad_verify_ieee2800 should be registered");
    assert.ok(tools["pscad_export"], "pscad_export should be registered");
  });

  it("pscad_lint inspects IEEE 9-bus benchmark project and returns diagnostics report", async () => {
    const tool = tools["pscad_lint"];
    const res = await tool.handler({ path: fixturePath });
    assert.ok(!res.isError, "Lint should not error");
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.project, "IEEE9Bus_IBR");
    assert.ok(Array.isArray(data.diagnostics));
  });

  it("pscad_simulate solves IEEE 9-bus project with companion-circuit EMT solver", async () => {
    const tool = tools["pscad_simulate"];
    const res = await tool.handler({
      path: fixturePath,
      dt: 50e-6,
      tstop: 0.01,
      format: "summary",
    });
    assert.ok(!res.isError, "Simulation should succeed");
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.project, "IEEE9Bus_IBR");
    assert.ok(data.totalSteps > 0);
    assert.ok(data.buses.length > 0);
    assert.ok(data.busVoltagesKv["Bus1"] !== undefined);
  });

  it("pscad_simulate exports IEEE C37.111 COMTRADE format", async () => {
    const tool = tools["pscad_simulate"];
    const res = await tool.handler({
      path: fixturePath,
      dt: 50e-6,
      tstop: 0.005,
      format: "comtrade",
    });
    assert.ok(!res.isError);
    assert.ok(res.content[0].text.includes("COMTRADE"));
    assert.ok(res.content[0].text.includes("Bus1"));
  });

  it("pscad_verify_ieee2800 executes automated ride-through verification", async () => {
    const tool = tools["pscad_verify_ieee2800"];
    const res = await tool.handler({
      path: fixturePath,
      poiBus: "Bus1",
      faultDurationMs: 150,
      vSagPu: 0.05,
    });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.ok(data.overallStatus === "PASS" || data.overallStatus === "FAIL");
    assert.ok(Array.isArray(data.checks));
    assert.ok(data.checks.length >= 3);
    assert.ok(data.summary);
  });

  it("pscad_export converts PSCAD to Modelica and SSP representations", async () => {
    const tool = tools["pscad_export"];

    // Modelica export
    const resMo = await tool.handler({
      path: fixturePath,
      target: "modelica",
    });
    assert.ok(!resMo.isError);
    assert.ok(resMo.content[0].text.includes("model IEEE9Bus_IBR"));
    assert.ok(resMo.content[0].text.includes("Modelica.Electrical.Analog"));

    // SSP export
    const resSsd = await tool.handler({
      path: fixturePath,
      target: "ssp",
    });
    assert.ok(!resSsd.isError);
    assert.ok(resSsd.content[0].text.includes("<ssd:SystemStructureDescription"));
  });
});
