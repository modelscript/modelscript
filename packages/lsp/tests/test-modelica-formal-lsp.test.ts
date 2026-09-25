// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { registerHoverProvider } from "../src/providers/hoverProvider.js";
import { ValidationService } from "../src/services/ValidationService.js";

test("LSP Formal Verification: Polyspace-Style 4-Color Diagnostics, CodeLens, and Hovers", async (t) => {
  const modelicaUri = "file:///workspace/FormalControl.mo";
  const modelicaContent = `
package FormalControl
  function safeFilter
    input Real u;
    output Real y;
  algorithm
    y := u * 2.0;
  end safeFilter;

  function dangerousDivision
    input Real x;
    output Real y;
  algorithm
    y := 100.0 / 0.0;
  end dangerousDivision;

  function unprovenSqrt
    input Real s;
    output Real r;
  algorithm
    r := sqrt(s);
  end unprovenSqrt;
end FormalControl;
`;

  const doc = TextDocument.create(modelicaUri, "modelica", 1, modelicaContent);

  const mockConnection: any = {
    console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} },
    sendDiagnostics: () => {},
    sendNotification: () => {},
    onRequest: () => {},
    onHover: () => {},
  };

  const mockDocManager: any = {
    documents: new Map([[modelicaUri, doc]]),
    documentTrees: new Map(),
  };

  const mockWorkspaceManager: any = {
    unifiedWorkspace: {
      owl2Store: {
        getAxioms: () => [],
        setAxioms: () => {},
      },
    },
    globalWorkspaceIndex: {
      getFileIndex: (uri: string) => {
        if (uri === modelicaUri) {
          return {
            symbols: new Map([
              [
                1,
                {
                  id: 1,
                  name: "safeFilter",
                  classKind: "function",
                  selectionRange: { start: { line: 2, character: 11 }, end: { line: 2, character: 21 } },
                },
              ],
              [
                2,
                {
                  id: 2,
                  name: "dangerousDivision",
                  classKind: "function",
                  selectionRange: { start: { line: 9, character: 11 }, end: { line: 9, character: 28 } },
                },
              ],
              [
                3,
                {
                  id: 3,
                  name: "unprovenSqrt",
                  classKind: "function",
                  selectionRange: { start: { line: 16, character: 11 }, end: { line: 16, character: 23 } },
                },
              ],
            ]),
          };
        }
        return undefined;
      },
    },
  };

  const mockParserService: any = {};

  const validationService = new ValidationService(
    mockConnection,
    mockDocManager,
    mockWorkspaceManager,
    mockParserService,
  );

  await t.test("should run abstract interpretation and emit Red/Orange 4-color LSP diagnostics", async () => {
    const diagnostics: any[] = [];
    await validationService.postValidateModelicaAbstractInterpretation(modelicaUri, doc, diagnostics);

    assert.ok(diagnostics.length >= 2, `Expected at least 2 diagnostics, got ${diagnostics.length}`);

    // 1. Red Error for dangerousDivision: division by zero
    const divError = diagnostics.find((d) => d.severity === DiagnosticSeverity.Error && d.code === "division_by_zero");
    assert.ok(divError, "Must emit DiagnosticSeverity.Error for definite division by zero");
    assert.strictEqual(divError.source, "modelscript-prover");
    assert.ok(divError.message.includes("[Formal Proof Defect]"));

    // 2. Orange Warning for unprovenSqrt: potential sqrt domain violation
    const sqrtWarning = diagnostics.find((d) => d.severity === DiagnosticSeverity.Warning && d.code === "math_domain");
    assert.ok(sqrtWarning, "Must emit DiagnosticSeverity.Warning for unproven sqrt domain");
    assert.strictEqual(sqrtWarning.source, "modelscript-prover");
    assert.ok(sqrtWarning.message.includes("[Formal Proof Unproven]"));

    // 3. Check cached proof results for all 3 functions
    const proofMap = validationService.modelicaProofResultsByUri.get(modelicaUri);
    assert.ok(proofMap, "Must cache proofMap in validationService");
    assert.strictEqual(proofMap.get("safeFilter")?.isCertifiedSafe, true);
    assert.strictEqual(proofMap.get("dangerousDivision")?.isCertifiedSafe, false);
    assert.strictEqual(proofMap.get("unprovenSqrt")?.isCertifiedSafe, false);
  });

  await t.test("should generate Polyspace-style CodeLens proof badges for verified and defective functions", () => {
    let codeLensHandler: any = null;
    const codeLensConnection: any = {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/codeLens") {
          codeLensHandler = handler;
        }
      },
    };

    const mockContext: any = {
      connection: codeLensConnection,
      documents: { get: (uri: string) => (uri === modelicaUri ? doc : undefined) },
      workspaceManager: mockWorkspaceManager,
      validationService,
    };

    registerCodeLensProvider(mockContext);
    assert.ok(codeLensHandler, "CodeLens handler must be registered");

    const lenses = codeLensHandler({ textDocument: { uri: modelicaUri } });
    assert.ok(lenses.length >= 3, `Expected at least 3 lenses, got ${lenses.length}`);

    // 1. safeFilter: 100% Proven Safe Green badge
    const safeLens = lenses.find((l: any) => l.command.title.includes("Formally Verified"));
    assert.ok(safeLens, "Must have '✓ Formally Verified' badge for safeFilter");
    assert.strictEqual(safeLens.command.command, "modelscript.showProofDetails");
    assert.strictEqual(safeLens.command.arguments[1], "safeFilter");

    // 2. dangerousDivision: Formal Defect Red badge
    const defectLens = lenses.find((l: any) => l.command.title.includes("Formal Defect"));
    assert.ok(defectLens, "Must have '✗ Formal Defect' badge for dangerousDivision");
    assert.strictEqual(defectLens.command.arguments[1], "dangerousDivision");

    // 3. unprovenSqrt: Formal Proof Unproven Orange badge
    const unprovenLens = lenses.find((l: any) => l.command.title.includes("unproven condition"));
    assert.ok(unprovenLens, "Must have '⚠ Formal Proof' badge for unprovenSqrt");
    assert.strictEqual(unprovenLens.command.arguments[1], "unprovenSqrt");
  });

  await t.test("should display formal interval invariants on variable hover", () => {
    let hoverHandler: any = null;
    const hoverConnection: any = {
      onHover: (handler: any) => {
        hoverHandler = handler;
      },
    };

    const mockDocs: any = {
      get: (uri: string) => (uri === modelicaUri ? doc : undefined),
    };

    // Mock bridge with hover definition
    const mockBridge: any = {
      hover: () => ({
        contents: "```modelica\nReal u\n```",
        range: { start: { line: 3, character: 15 }, end: { line: 3, character: 16 } },
      }),
    };
    validationService.documentLSPBridges.set(modelicaUri, mockBridge);

    registerHoverProvider(hoverConnection, mockDocs, validationService);
    assert.ok(hoverHandler, "Hover handler must be registered");

    // Hover on 'u' at line 6 (inside safeFilter algorithm: y := u * 2.0;)
    const hoverPos = doc.positionAt(modelicaContent.indexOf("u * 2.0"));
    const hoverResult = hoverHandler({
      textDocument: { uri: modelicaUri },
      position: hoverPos,
    });

    assert.ok(hoverResult, "Must return hover result");
    assert.ok(
      hoverResult.contents.value.includes("Formal Invariant") || hoverResult.contents.value.includes("Real u"),
      "Hover must display variable documentation and formal invariant context",
    );
  });
});
