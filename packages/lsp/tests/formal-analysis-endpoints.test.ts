// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanonicalTraceRecord } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

test("LSP Analysis Endpoints: Formal MC/DC, Counterexample Diff, and Contract Hierarchy", async (t) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const docUri = "file:///workspace/Governor.sysml";
  const docContent = `
action def SpeedGovernor {
  in item speed : Real;
  out item brakePower : Real;
  if (speed <= 50.0) {
    assign brakePower := 0.0;
  } else {
    assign brakePower := 1.0;
  }
}
`;

  const doc = TextDocument.create(docUri, "sysml2", 1, docContent);
  const mockDocuments: any = {
    get: (uri: string) => (uri === docUri ? doc : undefined),
  };

  const mockContext: any = {
    connection: mockConnection,
    documents: mockDocuments,
    workspaceManager: {},
    validationService: {
      validateTextDocument: async () => {},
    },
  };

  registerAnalysisEndpoints(mockContext);

  await t.test("should execute modelscript/runMcdcTests endpoint and produce execution report", async () => {
    const handler = handlers.get("modelscript/runMcdcTests");
    assert.ok(handler, "modelscript/runMcdcTests handler must be registered");

    const result = await handler({
      uri: docUri,
      actionName: "SpeedGovernor",
      domainBounds: { speed: [0, 100] },
      outputVarName: "brakePower",
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.report, "Must return execution report");
    assert.ok(result.report.totalTests > 0, "Must have synthesized test cases");
    assert.strictEqual(result.report.failed, 0, "All tests should pass");
    assert.strictEqual(result.report.passed, result.report.totalTests);
    assert.ok(result.coverageMetrics.totalRegions >= 2);
  });

  await t.test(
    "should compute counterexample divergence and sync traces in modelscript/getCounterexampleDiff",
    async () => {
      const handler = handlers.get("modelscript/getCounterexampleDiff");
      assert.ok(handler, "modelscript/getCounterexampleDiff handler must be registered");

      const times = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
      const cexTrace: CanonicalTraceRecord = {
        id: "cex-01",
        source: "falsification",
        status: "FALSIFIED",
        times,
        continuousSignals: {
          speed: [10, 20, 30, 42, 65, 88, 110], // Diverges past t = 1.5
        },
        violatingTimeIndex: 4, // t = 2.0s
        violatingProperty: "speed <= 50.0",
      };

      const nomTrace: CanonicalTraceRecord = {
        id: "nom-01",
        source: "falsification",
        status: "CERTIFIED_SAFE",
        times,
        continuousSignals: {
          speed: [10, 20, 30, 40, 45, 48, 50],
        },
      };

      const result = await handler({
        counterexample: cexTrace,
        nominal: nomTrace,
        tolerance: 1.0,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.divergingVariable, "speed");
      assert.ok(result.divergenceTime !== undefined && result.divergenceTime >= 1.5);
      assert.ok(result.maxDivergence.delta >= 60.0);
      assert.ok(result.diffSignals["speed"].length === times.length);
    },
  );

  await t.test(
    "should compute compositional contract refinement tree in modelscript/getContractHierarchy",
    async () => {
      const handler = handlers.get("modelscript/getContractHierarchy");
      assert.ok(handler, "modelscript/getContractHierarchy handler must be registered");

      const result = await handler({
        uri: docUri,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.hierarchy, "Must return hierarchy");
      assert.strictEqual(result.hierarchy.isRefined, true);
      assert.strictEqual(result.hierarchy.isCompatible, true);
      assert.ok(result.hierarchy.system.name.includes("Powertrain"));
      assert.strictEqual(result.hierarchy.components.length, 2);
    },
  );
});
