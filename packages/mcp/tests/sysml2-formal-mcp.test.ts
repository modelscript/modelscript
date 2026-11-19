// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

describe("MCP Tool: sysml2_verify_formal", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }
      >;
    }
  )._registeredTools;

  it("detects S7001 (#unsafe state reachability), S7003 (UQ chance constraint), and S7006 (continuous flowpipe)", async () => {
    const tool = tools["sysml2_verify_formal"];
    assert.ok(tool, "Expected sysml2_verify_formal to be registered on McpServer");

    const unsafeAndUqAndFlowpipeSysml = `
package FlightSafetyCert {
  private import ScalarValues::*;
  metadata def Unsafe;
  metadata def Normal {
    attribute mean : Real;
    attribute stdDev : Real;
  }
  metadata def MaxFailureProbability {
    attribute alpha : Real;
  }

  state def BrakeModeMachine {
    entry; then standby;
    state standby;
    #unsafe state runaway;
    transition t_fault first standby then runaway;
  }

  part def SensorAssembly {
    attribute driftMv : Real = 10.0 {
      @Normal { mean = 10.0; stdDev = 5.0; }
    }
  }

  requirement def DriftChanceReq {
    @MaxFailureProbability { alpha = 0.001; }
    require constraint { driftMv <= 12.0 }
  }

  part def ThermalRunawayPlant {
    attribute temp : Real = 20.0;
    constraint heatDyn { der(temp) == 15.0 }
    assert constraint tempCap { temp <= 30.0 }
  }
}
`;

    const res = await tool.handler({
      code: unsafeAndUqAndFlowpipeSysml,
      includeStandardLints: false,
      maxStates: 64,
      timeHorizon: 5.0,
    });
    assert.ok(!res.isError, `Unexpected MCP tool error: ${res.content[0]?.text}`);

    const payload = JSON.parse(res.content[0]!.text) as {
      passed: boolean;
      formalDiagnostics: Array<{
        code: string;
        rule: string;
        severity: string;
        engine: string;
        message: string;
        witness?: Record<string, unknown>;
      }>;
      standardDiagnostics?: unknown[];
      counts: { formalTotal: number; formalErrors: number };
    };

    assert.strictEqual(payload.passed, false);
    assert.strictEqual(payload.standardDiagnostics, undefined);

    const codes = new Set(payload.formalDiagnostics.map((d) => d.code));
    assert.ok(
      codes.has("S7001"),
      `Expected S7001 IC3/PDR unsafe state diagnostic in ${JSON.stringify(payload.formalDiagnostics)}`,
    );
    assert.ok(
      codes.has("S7003"),
      `Expected S7003 UQ chance constraint diagnostic in ${JSON.stringify(payload.formalDiagnostics)}`,
    );
    assert.ok(
      codes.has("S7006"),
      `Expected S7006 continuous flowpipe diagnostic in ${JSON.stringify(payload.formalDiagnostics)}`,
    );

    const pdrDiag = payload.formalDiagnostics.find((d) => d.code === "S7001")!;
    assert.strictEqual(pdrDiag.engine, "IC3/PDR");
    assert.ok(pdrDiag.witness, "Expected counterexample witness on S7001");
  });

  it("supports includeStandardLints=true and reports passed=true on certified safe models", async () => {
    const tool = tools["sysml2_verify_formal"]!;

    const mixedStdAndSafeFormal = `
import ScalarValues::*;
package SafeController {
  part def Controller {
    attribute gain : Real = 2.0;
  }
}
`;
    const withStdRes = await tool.handler({
      code: mixedStdAndSafeFormal,
      includeStandardLints: true,
    });
    assert.ok(!withStdRes.isError);
    const withStdPayload = JSON.parse(withStdRes.content[0]!.text) as {
      passed: boolean;
      formalDiagnostics: unknown[];
      standardDiagnostics: Array<{ code: string }>;
      counts: { formalTotal: number; standardTotal: number };
    };
    assert.strictEqual(withStdPayload.counts.formalTotal, 0);
    assert.ok(Array.isArray(withStdPayload.standardDiagnostics));
    assert.ok(
      withStdPayload.standardDiagnostics.some((d) => d.code === "S2010"),
      `Expected S2010 top-level non-private import in standardDiagnostics, got ${JSON.stringify(withStdPayload.standardDiagnostics)}`,
    );

    const cleanModel = `
package CertifiedSafe {
  private import ScalarValues::*;
  part def Actuator {
    attribute maxForce : Real = 100.0;
  }
}
`;
    const cleanRes = await tool.handler({ code: cleanModel, includeStandardLints: true });
    assert.ok(!cleanRes.isError);
    const cleanPayload = JSON.parse(cleanRes.content[0]!.text) as { passed: boolean; counts: { total: number } };
    assert.strictEqual(cleanPayload.passed, true);
    assert.strictEqual(cleanPayload.counts.total, 0);
  });
});
