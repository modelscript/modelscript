// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

test("LSP Analysis Endpoints: Semantic Theory Coordinator Integration in verifyAll", async (t) => {
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

  const docUri = "file:///workspace/TestTheoryModel.mo";
  const sourceText = `model TestTheoryModel
  parameter Real x = 1.0;
  parameter Real y = 2.0;
equation
  der(x) = y;
end TestTheoryModel;`;

  const doc = TextDocument.create(docUri, "modelica", 1, sourceText);
  const mockContext: any = {
    connection: mockConnection,
    workspaceManager: {
      getDocument: () => doc,
      getQueryEngine: () => undefined,
      unifiedWorkspace: undefined,
    },
    parserService: {
      sharedContext: undefined,
    },
  };

  registerAnalysisEndpoints(mockContext);

  await t.test("modelscript/verifyAll handler runs theory_coordination stage by default", async () => {
    const handler = handlers.get("modelscript/verifyAll");
    assert.ok(handler, "modelscript/verifyAll must be registered");

    const report = await handler({
      uri: docUri,
      options: {
        all: true,
      },
    });

    assert.ok(report, "Must return unified report");
    assert.ok(report.stages.theory_coordination, "Stages must contain theory_coordination");
    assert.strictEqual(report.stages.theory_coordination.passed, true);
    assert.strictEqual(report.stages.theory_coordination.certified, true);
    assert.ok(report.stages.theory_coordination.name.includes("Semantic Theory Coordinator"));
    assert.ok(report.stages.theory_coordination.summary.includes("All theory oracles mutually satisfiable"));
  });
});
