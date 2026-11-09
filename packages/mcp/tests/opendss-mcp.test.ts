// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

const SAMPLE_DSS = `
  Clear
  New Circuit.TestGrid basekv=12.47 pu=1.0 phases=3 bus1=SubBus
  New Line.Line1 bus1=SubBus bus2=MidBus phases=3 length=2.0 r1=0.2 x1=0.4 normamps=400
  New Line.Line2 bus1=MidBus bus2=LoadBus phases=3 length=1.5 r1=0.2 x1=0.4 normamps=400
  New Load.LoadMid bus1=MidBus phases=3 kv=12.47 kw=300 kvar=100
  New Load.Load1 bus1=LoadBus phases=3 kv=12.47 kw=600 kvar=200
`;

describe("OpenDSS MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }
      >;
    }
  )._registeredTools;

  it("registers all 7 OpenDSS MCP tools", () => {
    assert.ok(tools["opendss_solve_powerflow"], "opendss_solve_powerflow should be registered");
    assert.ok(tools["opendss_solve_faults"], "opendss_solve_faults should be registered");
    assert.ok(tools["opendss_evaluate_harmonics"], "opendss_evaluate_harmonics should be registered");
    assert.ok(tools["opendss_analyze_reliability"], "opendss_analyze_reliability should be registered");
    assert.ok(tools["opendss_solve_gic"], "opendss_solve_gic should be registered");
    assert.ok(tools["opendss_hosting_capacity"], "opendss_hosting_capacity should be registered");
    assert.ok(tools["opendss_simulate_flisr"], "opendss_simulate_flisr should be registered");
  });

  it("opendss_solve_powerflow computes nodal voltages and loss report", async () => {
    const tool = tools["opendss_solve_powerflow"];
    assert.ok(tool);
    const res = await tool.handler({ circuitContent: SAMPLE_DSS });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.equal(data.converged, true);
    assert.ok(data.totalLoadKw >= 600);
    assert.ok(data.buses["SubBus"] !== undefined);
    assert.ok(data.buses["LoadBus"] !== undefined);
  });

  it("opendss_solve_faults calculates symmetrical and asymmetrical short circuit levels", async () => {
    const tool = tools["opendss_solve_faults"];
    assert.ok(tool);
    const res = await tool.handler({ circuitContent: SAMPLE_DSS });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.ok(data.maxFaultCurrentAmps > 0);
    assert.ok(data.buses["SubBus"] !== undefined);
  });

  it("opendss_evaluate_harmonics evaluates THD across frequency spectrum", async () => {
    const tool = tools["opendss_evaluate_harmonics"];
    assert.ok(tool);
    const res = await tool.handler({ circuitContent: SAMPLE_DSS, harmonicOrders: [3, 5, 7] });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.ok(data.maxThdPercent >= 0);
    assert.deepEqual(data.harmonicOrders, [3, 5, 7]);
  });

  it("opendss_analyze_reliability returns IEEE 1366 reliability indices", async () => {
    const tool = tools["opendss_analyze_reliability"];
    assert.ok(tool);
    const res = await tool.handler({ circuitContent: SAMPLE_DSS });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.ok(data.system.saifi > 0);
    assert.ok(data.system.saidi > 0);
    assert.ok(data.system.asai > 0.99);
  });

  it("opendss_solve_gic computes space weather DC neutral currents", async () => {
    const tool = tools["opendss_solve_gic"];
    assert.ok(tool);
    const res = await tool.handler({ circuitContent: SAMPLE_DSS, eEastVPerKm: 1.5 });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.ok(data.buses !== undefined);
  });

  it("opendss_hosting_capacity evaluates DER penetration limits", async () => {
    const tool = tools["opendss_hosting_capacity"];
    assert.ok(tool);
    const res = await tool.handler({
      circuitContent: SAMPLE_DSS,
      targetBus: "LoadBus",
      voltageMaxPu: 1.03,
      stepKw: 100,
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.equal(data.targetBus, "LoadBus");
    assert.ok(data.hostingCapacityKw > 0);
  });

  it("opendss_simulate_flisr automates service restoration and hours saved", async () => {
    const tool = tools["opendss_simulate_flisr"];
    assert.ok(tool);
    const res = await tool.handler({
      circuitContent: SAMPLE_DSS,
      faultedLine: "Line2",
      tieLineName: "TieFeeder2",
    });
    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.equal(data.success, true);
    assert.equal(data.faultedLine, "Line2");
    assert.equal(data.restorationSuccess, true);
    assert.ok(data.customersRestoredUpstream > 0);
  });
});
