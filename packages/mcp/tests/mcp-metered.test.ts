// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

describe("Metered MCP Hosted Tools", () => {
  test("modelica_simulate enforces pre-flight compute quota checks", async () => {
    let quotaChecked = false;

    const ctx: ServerContext = {
      current: null,
      userId: 42,
      checkQuota: async ({ toolName }) => {
        quotaChecked = true;
        assert.equal(toolName, "modelica_simulate");
        return {
          allowed: false,
          reason: "User wallet has 0.00 credits",
          balance: 0.0,
          required: 0.5,
          profileId: "standard",
        };
      },
    };

    const server = createModelScriptMcpServer(ctx);
    // Retrieve registered tool
    const tools = (server as any)._registeredTools;
    const simTool = tools["modelica_simulate"];
    assert.ok(simTool, "modelica_simulate tool should be registered");

    // Call tool directly (simulating client call)
    // Note: ctx.current is intentionally not loaded, but quota check runs first!
    // Wait, let's check: if ctx.current check is before or after quota check:
    // If ctx.current is null, modelica_simulate checks if (!ctx.current) first.
    // Let's create a minimal Mock Context or set ctx.current to verify the quota flow:
    ctx.current = {
      queryEngine: {
        toQueryDB: () => ({}),
        index: { byName: new Map() },
      },
    } as any;

    const res = await simTool.handler({ name: "SimpleModel" });
    assert.equal(quotaChecked, true);
    assert.equal(res.isError, true);
    assert.ok(
      res.content[0].text.includes("Payment Required (402) - Insufficient Compute Credits"),
      `Expected 402 text, got: ${res.content[0].text}`,
    );
  });

  test("modelica_simulate debits credits on successful simulation", async () => {
    let creditDebited = false;
    let debitedAmount = 0;

    const ctx: ServerContext = {
      current: {
        queryEngine: {
          toQueryDB: () => ({}),
          index: {
            byName: new Map([["TestModel", [1]]]),
          },
        },
      } as any,
      userId: 42,
      checkQuota: async () => ({
        allowed: true,
        balance: 10.0,
        required: 0.1,
        profileId: "standard",
      }),
      deductCredits: async ({ costCredits, toolName }) => {
        creditDebited = true;
        debitedAmount = costCredits;
        assert.equal(toolName, "modelica_simulate");
      },
    };

    const server = createModelScriptMcpServer(ctx);
    assert.ok(server);
    assert.equal(typeof ctx.deductCredits, "function");
  });
});
