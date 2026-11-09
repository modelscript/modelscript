// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerTools } from "../src/tools.js";

describe("MCP Surface Wiring for Bifurcation & Jump Processes", () => {
  it("registers and executes modelscript_bifurcation_continuation and modelscript_stochastic_jump MCP tools", async () => {
    const registeredTools = new Map<
      string,
      { description: string; schema: Record<string, any>; handler: (args: any) => Promise<any> }
    >();

    const mockServer = {
      tool(name: string, description: string, schema: Record<string, any>, handler: (args: any) => Promise<any>) {
        registeredTools.set(name, { description, schema, handler });
      },
    };

    registerTools(mockServer as any, { current: null } as any);

    // 1. Check modelica_simulate solver schema
    const simTool = registeredTools.get("modelica_simulate");
    assert.ok(simTool, "modelica_simulate tool must be registered");
    assert.ok(simTool.schema.linearSolver, "modelica_simulate must expose linearSolver");

    // 2. Execute modelscript_bifurcation_continuation on Hopf normal form
    const bifTool = registeredTools.get("modelscript_bifurcation_continuation");
    assert.ok(bifTool, "modelscript_bifurcation_continuation tool must be registered");
    const bifRes = await bifTool.handler({
      normalForm: "hopf",
      p0: -0.5,
      pMin: -1.0,
      pMax: 1.0,
      ds: 0.05,
      maxSteps: 60,
    });
    assert.ok(!bifRes.isError);
    const bifJson = JSON.parse(bifRes.content[0].text);
    assert.equal(bifJson.success, true);
    const hopfPt = bifJson.bifurcations.find((b: any) => String(b.type).toLowerCase() === "hopf");
    assert.ok(hopfPt, "Expected Hopf bifurcation point");
    assert.ok(Math.abs(hopfPt.p) < 1e-3);

    // 3. Execute modelscript_stochastic_jump on birth-death process
    const jumpTool = registeredTools.get("modelscript_stochastic_jump");
    assert.ok(jumpTool, "modelscript_stochastic_jump tool must be registered");
    const jumpRes = await jumpTool.handler({
      method: "direct",
      u0: [100],
      tEnd: 1.0,
      reactions: [
        {
          name: "decay",
          rate: 0.5,
          reactants: [{ speciesIndex: 0, count: 1 }],
          products: [],
        },
      ],
      numTrajectories: 20,
      seed: 12345,
    });
    assert.ok(!jumpRes.isError);
    const jumpJson = JSON.parse(jumpRes.content[0].text);
    assert.equal(jumpJson.success, true);
    assert.equal(jumpJson.numTrajectories, 20);
    // Expected mean around 100 * exp(-0.5) = 60.65
    assert.ok(jumpJson.finalMean[0] > 45 && jumpJson.finalMean[0] < 75);
  });
});
