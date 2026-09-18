// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";

test("LSP QuickFix for Homotopy Recommendation", async (t) => {
  await t.test("should generate QuickFix for nonlinear T^4 diagnostic", async () => {
    let codeActionHandler: any = null;

    const mockConnection: any = {
      onReferences: () => {},
      onDefinition: () => {},
      onRenameRequest: () => {},
      onWorkspaceSymbol: () => {},
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
    };

    const docUri = "file:///workspace/RadiationTest.mo";
    const docContent = `model RadiationTest
  Real T(start=300);
  Real Q;
  parameter Real sigma = 5.67e-8;
equation
  Q = sigma * T^4;
end RadiationTest;`;

    const doc = TextDocument.create(docUri, "modelica", 1, docContent);
    const mockDocuments: any = {
      get: (uri: string) => (uri === docUri ? doc : undefined),
    };

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocuments,
      new Map(),
      async () => {},
      async () => ({ symbols: new Map() }),
    );

    assert.ok(codeActionHandler, "onCodeAction handler should be registered");

    // Position of T^4 in line 5
    const startOffset = docContent.indexOf("T^4");
    const endOffset = startOffset + 3;
    const startPos = doc.positionAt(startOffset);
    const endPos = doc.positionAt(endOffset);

    const diagnostic = {
      source: "modelscript",
      code: 5010,
      range: { start: startPos, end: endPos },
      message:
        "Equation contains steep nonlinearity 'T^4' without homotopy. Consider wrapping with homotopy(actual, simplified).",
      severity: DiagnosticSeverity.Information,
    };

    const actions = codeActionHandler({
      textDocument: { uri: docUri },
      range: { start: startPos, end: endPos },
      context: { diagnostics: [diagnostic] },
    });

    assert.strictEqual(actions.length, 1, "Should generate exactly 1 QuickFix code action");
    const action = actions[0];

    assert.strictEqual(action.kind, CodeActionKind.QuickFix);
    assert.strictEqual(action.isPreferred, true);
    assert.ok(action.title.includes("Wrap 'T^4' with homotopy"));

    const edits = action.edit.changes[docUri];
    assert.ok(edits && edits.length === 1);
    assert.ok(edits[0].newText.startsWith("homotopy(T^4,"));
    assert.ok(edits[0].newText.includes("108000000 * T"));

    console.log("QuickFix action generated:", action.title);
    console.log("Replacement edit:", edits[0].newText);
  });

  await t.test("should generate QuickFix for quadratic drag and exponential", async () => {
    let codeActionHandler: any = null;
    const mockConnection: any = {
      onReferences: () => {},
      onDefinition: () => {},
      onRenameRequest: () => {},
      onWorkspaceSymbol: () => {},
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
    };

    const docUri = "file:///workspace/FluidTest.mo";
    const docContent = `model FluidTest
  Real m_flow(start=1.0);
  Real dp;
  Real v(start=0.7);
  Real i;
equation
  dp = 0.5 * m_flow * abs(m_flow);
  i = 1e-12 * (exp(v / 0.026) - 1.0);
end FluidTest;`;

    const doc = TextDocument.create(docUri, "modelica", 1, docContent);
    const mockDocuments: any = {
      get: (uri: string) => (uri === docUri ? doc : undefined),
    };

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocuments,
      new Map(),
      async () => {},
      async () => ({ symbols: new Map() }),
    );

    // Test drag diagnostic
    const dragOffset = docContent.indexOf("m_flow * abs(m_flow)");
    const dragDiag = {
      source: "modelscript",
      code: 5010,
      range: {
        start: doc.positionAt(dragOffset),
        end: doc.positionAt(dragOffset + "m_flow * abs(m_flow)".length),
      },
      message: "Equation contains steep nonlinearity 'm_flow * abs(m_flow)' without homotopy.",
      severity: DiagnosticSeverity.Information,
    };

    const dragActions = codeActionHandler({
      textDocument: { uri: docUri },
      range: dragDiag.range,
      context: { diagnostics: [dragDiag] },
    });

    assert.strictEqual(dragActions.length, 1);
    assert.ok(dragActions[0].edit.changes[docUri][0].newText.includes("homotopy(m_flow * abs(m_flow), (m_flow *"));

    // Test exp diagnostic
    const expOffset = docContent.indexOf("exp(v / 0.026)");
    const expDiag = {
      source: "modelscript",
      code: 5010,
      range: {
        start: doc.positionAt(expOffset),
        end: doc.positionAt(expOffset + "exp(v / 0.026)".length),
      },
      message: "Equation contains steep nonlinearity 'exp(v / 0.026)' without homotopy.",
      severity: DiagnosticSeverity.Information,
    };

    const expActions = codeActionHandler({
      textDocument: { uri: docUri },
      range: expDiag.range,
      context: { diagnostics: [expDiag] },
    });

    assert.strictEqual(expActions.length, 1);
    assert.ok(expActions[0].edit.changes[docUri][0].newText.includes("homotopy(exp(v / 0.026), (1.0 + (v / 0.026)))"));
  });
});
