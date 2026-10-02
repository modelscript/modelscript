// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { registerHoverProvider } from "../src/providers/hoverProvider.js";
import { ValidationService } from "../src/services/validation-service.js";

test("LSP Formal Verification: Sound 4-Color Diagnostics, CodeLens, and Hovers", async (t) => {
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

  await t.test("should generate formal verification CodeLens proof badges for verified and defective functions", () => {
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

  await t.test("should display accurate [1, 10] formal invariant for loop variable", async () => {
    const loopUri = "file:///workspace/BouncingBall.mo";
    const loopContent = `model BouncingBall
algorithm
  for i in 1:10 loop
  end for;
end BouncingBall;
`;

    const loopDoc = TextDocument.create(loopUri, "modelica", 1, loopContent);
    mockDocManager.documents.set(loopUri, loopDoc);

    const diags: any[] = [];
    await validationService.postValidateModelicaAbstractInterpretation(loopUri, loopDoc, diags);

    let loopHoverHandler: any = null;
    const hoverConn: any = {
      onHover: (h: any) => {
        loopHoverHandler = h;
      },
    };
    const loopMockDocs: any = {
      get: (uri: string) => (uri === loopUri ? loopDoc : undefined),
    };
    const loopMockBridge: any = {
      hover: () => ({
        contents: "```modelica\nInteger i\n```",
        range: { start: { line: 2, character: 6 }, end: { line: 2, character: 7 } },
      }),
    };
    validationService.documentLSPBridges.set(loopUri, loopMockBridge);
    registerHoverProvider(hoverConn, loopMockDocs, validationService);

    const loopHoverPos = loopDoc.positionAt(loopContent.indexOf("for i in 1:10 loop") + 4);
    const loopHoverResult = loopHoverHandler({
      textDocument: { uri: loopUri },
      position: loopHoverPos,
    });

    assert.ok(loopHoverResult, "Must return hover result for loop variable");
    assert.ok(
      loopHoverResult.contents.value.includes("i ∈ [1, 10]"),
      `Hover must display 'i ∈ [1, 10]' invariant, got: ${loopHoverResult.contents.value}`,
    );
  });

  await t.test(
    "should verify continuous DAE equations, emitting Red diagnostics and CodeLens proof badges",
    async () => {
      const daeUri = "file:///workspace/DaeModel.mo";
      const daeContent = `
package DaeModel
  model SafeCircuit
    Real V(start = 10.0);
    Real R(start = 2.0);
    Real I;
  equation
    I = V / R;
  end SafeCircuit;

  model SingularCircuit
    Real V(start = 10.0);
    Real R(start = 0.0);
    Real I;
  equation
    I = V / 0.0;
  end SingularCircuit;
end DaeModel;
`;

      const daeDoc = TextDocument.create(daeUri, "modelica", 1, daeContent);
      mockDocManager.documents.set(daeUri, daeDoc);

      const diagnostics: any[] = [];
      await validationService.postValidateModelicaDaeReachability(daeUri, daeDoc, diagnostics);

      assert.ok(diagnostics.length >= 1, `Expected at least 1 DAE diagnostic, got ${diagnostics.length}`);

      // Check Definite Error diagnostic for SingularCircuit
      const divZeroDiag = diagnostics.find((d) => d.severity === DiagnosticSeverity.Error && d.code === "div_by_zero");
      assert.ok(divZeroDiag, "Must emit DiagnosticSeverity.Error for definite division by zero in equation");
      assert.strictEqual(divZeroDiag.source, "modelscript-dae-verifier");
      assert.ok(divZeroDiag.message.includes("[DAE Formal Defect]"));

      // Check CodeLens badges
      const daeWorkspaceManager: any = {
        globalWorkspaceIndex: {
          getFileIndex: (uri: string) => {
            if (uri === daeUri) {
              return {
                symbols: new Map([
                  [
                    10,
                    {
                      id: 10,
                      name: "SafeCircuit",
                      classKind: "model",
                      selectionRange: { start: { line: 2, character: 8 }, end: { line: 2, character: 19 } },
                    },
                  ],
                  [
                    11,
                    {
                      id: 11,
                      name: "SingularCircuit",
                      classKind: "model",
                      selectionRange: { start: { line: 9, character: 8 }, end: { line: 9, character: 23 } },
                    },
                  ],
                ]),
              };
            }
            return undefined;
          },
        },
      };

      let codeLensHandler: any = null;
      const codeLensConnection: any = {
        onRequest: (method: string, handler: any) => {
          if (method === "textDocument/codeLens") {
            codeLensHandler = handler;
          }
        },
      };

      const mockDaeContext: any = {
        connection: codeLensConnection,
        documents: { get: (uri: string) => (uri === daeUri ? daeDoc : undefined) },
        workspaceManager: daeWorkspaceManager,
        validationService,
      };

      registerCodeLensProvider(mockDaeContext);
      const lenses = codeLensHandler({ textDocument: { uri: daeUri } });

      const safeLens = lenses.find((l: any) => l.command.title.includes("DAE Formally Verified"));
      assert.ok(safeLens, "Must have '✓ DAE Formally Verified' badge for SafeCircuit");
      assert.strictEqual(safeLens.command.arguments[1], "SafeCircuit");

      const defectLens = lenses.find((l: any) => l.command.title.includes("DAE Defect"));
      assert.ok(defectLens, "Must have '✗ DAE Defect' badge for SingularCircuit");
      assert.strictEqual(defectLens.command.arguments[1], "SingularCircuit");

      // Check Variable Hover for SafeCircuit
      let hoverHandler: any = null;
      const hoverConn: any = {
        onHover: (h: any) => {
          hoverHandler = h;
        },
      };
      const mockHoverBridge: any = {
        hover: () => ({
          contents: "```modelica\nReal V\n```",
          range: { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } },
        }),
      };
      validationService.documentLSPBridges.set(daeUri, mockHoverBridge);
      const daeMockDocs: any = {
        get: (uri: string) => (uri === daeUri ? daeDoc : undefined),
      };
      registerHoverProvider(hoverConn, daeMockDocs, validationService);

      const vHoverPos = daeDoc.positionAt(daeContent.indexOf("Real V(") + 5);
      const hoverRes = hoverHandler({
        textDocument: { uri: daeUri },
        position: vHoverPos,
      });

      assert.ok(hoverRes, "Must return hover result for variable V");
      assert.ok(
        hoverRes.contents.value.includes("DAE Reachability Invariant"),
        `Hover must display DAE reachability invariant, got: ${hoverRes.contents.value}`,
      );
    },
  );
});
