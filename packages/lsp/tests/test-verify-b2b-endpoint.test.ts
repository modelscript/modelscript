// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  EqKind,
  initBltWasm,
  StringInterner,
  UnaryOp,
  Variability,
  VarType,
} from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

function buildTestArena(): DAEBuilder {
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, "LspB2BTestModel");
  arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Output, 1.0);
  arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  arena.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  arena.addVariable("der(y)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  // der(x) = -y
  const negY = arena.addUnaryExpr(UnaryOp.Negate, arena.addNameExpr("y"));
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("x")), negY);

  // der(y) = x
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("y")), arena.addNameExpr("x"));

  arena.experiment = { startTime: 0, stopTime: 0.1, interval: 0.001 };
  return arena;
}

test("LSP Analysis Endpoints: B2B Equivalence and Unified verifyAll", async (t) => {
  await initBltWasm();

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

  const docUri = "file:///workspace/LspB2BTestModel.mo";
  const docContent = `
model LspB2BTestModel
  Real x(start=1.0);
  Real y(start=0.0);
equation
  der(x) = -y;
  der(y) = x;
end LspB2BTestModel;
`;

  const doc = TextDocument.create(docUri, "modelica", 1, docContent);
  const mockDocuments: any = {
    get: (uri: string) => (uri === docUri ? doc : undefined),
  };

  const testArena = buildTestArena();

  const mockContext: any = {
    connection: mockConnection,
    documents: mockDocuments,
    workspaceManager: {
      getDocument: (uri: string) => (uri === docUri ? doc : undefined),
      getQueryEngine: () => undefined,
      unifiedWorkspace: {
        toUnifiedPartial: () => ({
          symbols: new Map(),
          byName: new Map(),
          childrenOf: new Map(),
        }),
      },
    },
    parserService: {
      sharedContext: {
        flattenArena: () => testArena,
      },
    },
    validationService: {
      validateTextDocument: async () => {},
    },
  };

  registerAnalysisEndpoints(mockContext);

  await t.test("modelscript/verifyB2B handler executes Back-to-Back MiL-vs-SiL equivalence", async () => {
    const handler = handlers.get("modelscript/verifyB2B");
    assert.ok(handler, "modelscript/verifyB2B must be registered");

    const result = await handler({
      uri: docUri,
      target: "LspB2BTestModel",
      tolerance: 1e-4,
      compiler: "gcc",
      fixedStepDt: 0.001,
      format: "dhf",
    });

    assert.strictEqual(result.success, true, "B2B verification must pass");
    assert.strictEqual(result.stage.passed, true);
    assert.strictEqual(result.stage.certified, true);
    assert.ok(result.maxDiscrepancy < 1e-4, `Max discrepancy ${result.maxDiscrepancy} must be < 1e-4`);
    assert.strictEqual(result.sha256CSource.length, 64, "Must compute valid SHA-256 hash");
    assert.ok(result.formattedOutput.includes("# ISO 26262 Design History File (DHF)"));
    assert.ok(result.formattedOutput.includes("Tool Qualification (TCL1)"));
  });

  await t.test("modelscript/verifyAll handler passes arena and runs B2B stage", async () => {
    const handler = handlers.get("modelscript/verifyAll");
    assert.ok(handler, "modelscript/verifyAll must be registered");

    const report = await handler({
      uri: docUri,
      target: "LspB2BTestModel",
      options: {
        all: false,
        decisions: false,
        contracts: false,
        stateMachines: false,
        trajectories: false,
        b2b: true,
        b2bTol: 1e-4,
        b2bCompiler: "gcc",
        b2bDt: 0.001,
      },
      format: "dhf",
    });

    assert.strictEqual(report.summary.overallPassed, true);
    assert.ok(report.stages.b2b, "Stages must contain b2b");
    assert.strictEqual(report.stages.b2b.passed, true);
    assert.ok(report.artifacts?.formattedOutput?.includes("ISO 26262 Design History File"));
  });
});
