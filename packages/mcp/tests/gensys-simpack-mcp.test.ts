// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

const sampleGensysDeck = `
# Sample Bogie Vehicle
body carbody 30000 60000 1500000 1400000 0 0 1.2
body bogie1  2500  2000  2500    4000    8 0 0.4
spring sec_susp carbody bogie1 100000 100000 300000 15000 15000 25000
`;

const sampleSimpackXml = `
<simpack_model name="DoublePendulum">
  <body id="link1" name="Link 1" mass="1.5" ixx="0.02" iyy="0.02" izz="0.01" />
  <body id="link2" name="Link 2" mass="1.0" ixx="0.01" iyy="0.01" izz="0.005" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m1_base" body="link1" x="0" y="0" z="0" />
  <marker id="m1_tip" body="link1" x="0.5" y="0" z="0" />
  <marker id="m2_base" body="link2" x="0" y="0" z="0" />
  <joint id="j1" type="revolute" from="m_ground" to="m1_base" />
  <joint id="j2" type="revolute" from="m1_tip" to="m2_base" />
</simpack_model>
`;

describe("GENSYS and SIMPACK MCP Tools Integration Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (server as any)._registeredTools;

  it("registers gensys tools: gensys_lint, gensys_verify_en14363, gensys_fastsim", () => {
    assert.ok(tools["gensys_lint"], "gensys_lint should be registered");
    assert.ok(tools["gensys_verify_en14363"], "gensys_verify_en14363 should be registered");
    assert.ok(tools["gensys_fastsim"], "gensys_fastsim should be registered");
  });

  it("registers simpack tools: simpack_lint, simpack_mobility", () => {
    assert.ok(tools["simpack_lint"], "simpack_lint should be registered");
    assert.ok(tools["simpack_mobility"], "simpack_mobility should be registered");
  });

  it("gensys_lint validates vehicle parameters and couplings", async () => {
    const tool = tools["gensys_lint"];
    const res = await tool.handler({ source: sampleGensysDeck });
    assert.ok(!res.isError);
    const diags = JSON.parse(res.content[0].text);
    assert.equal(diags.length, 0);
  });

  it("gensys_verify_en14363 evaluates derailment quotient and Prud'homme limit", async () => {
    const tool = tools["gensys_verify_en14363"];
    const res = await tool.handler({
      lateralForceY: 30,
      verticalForceQ: 80,
      nominalAxleLoadQ0: 160,
    });
    assert.ok(!res.isError);
    const result = JSON.parse(res.content[0].text);
    assert.ok(result.derailmentRiskPassed);
    assert.ok(result.prudhommeLimitPassed);
  });

  it("simpack_mobility verifies double pendulum degrees of freedom", async () => {
    const tool = tools["simpack_mobility"];
    const res = await tool.handler({ source: sampleSimpackXml });
    assert.ok(!res.isError);
    const mobility = JSON.parse(res.content[0].text);
    assert.equal(mobility.numBodies, 2);
    assert.equal(mobility.calculatedMobility, 2);
    assert.equal(mobility.isOverconstrained, false);
  });
});
