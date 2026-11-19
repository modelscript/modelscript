// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CodeActionKind,
  DiagnosticSeverity,
  type CodeAction,
  type CodeActionParams,
  type Connection,
  type TextDocuments,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";

function setupCodeActionHarness(docsByUri: Map<string, TextDocument>): (params: CodeActionParams) => CodeAction[] {
  let codeActionHandler: ((params: CodeActionParams) => CodeAction[]) | null = null;
  const mockConnection = {
    onReferences: () => {},
    onDefinition: () => {},
    onRenameRequest: () => {},
    onWorkspaceSymbol: () => {},
    onCodeAction: (handler: (params: CodeActionParams) => CodeAction[]) => {
      codeActionHandler = handler;
    },
  } as unknown as Connection;

  const mockDocuments = {
    get: (uri: string) => docsByUri.get(uri),
    all: () => Array.from(docsByUri.values()),
  } as unknown as TextDocuments<TextDocument>;

  registerWorkspaceFeaturesProvider(
    mockConnection,
    mockDocuments,
    new Map(),
    async () => {},
    async () => null,
  );

  assert.ok(codeActionHandler, "Expected onCodeAction handler to be registered");
  return codeActionHandler!;
}

describe("SysML v2 LSP QuickFix CodeActions (S6002, S2010, S2011, S4021)", () => {
  it("S6002: inserts synthesized Craig interpolant constraint before requirement closing '}'", () => {
    const uri = "file:///workspace/ThermalRequirements.sysml";
    const source = [
      "package ThermalRequirements {",
      "  requirement def SystemThermalLimit {",
      "    require constraint { temp <= 80.0 }",
      "    requirement subThermal {",
      "      require constraint { temp <= 95.0 }",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");

    const doc = TextDocument.create(uri, "sysml2", 1, source);
    const runCodeActions = setupCodeActionHarness(new Map([[uri, doc]]));

    const actions = runCodeActions({
      textDocument: { uri },
      range: { start: { line: 3, character: 4 }, end: { line: 3, character: 26 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 3, character: 4 }, end: { line: 3, character: 26 } },
            severity: DiagnosticSeverity.Warning,
            code: "S6002",
            source: "sysml2",
            message:
              "Requirement decomposition gap on 'SystemThermalLimit': sub-requirements do not entail parent [Craig interpolant hint: require constraint { temp <= 80.0 }].",
          },
        ],
      },
    });

    const quickFix = actions.find(
      (a) => a.kind === CodeActionKind.QuickFix && a.title === "Insert synthesized Craig interpolant constraint",
    );
    assert.ok(quickFix, `Expected S6002 Craig interpolant QuickFix, got: ${JSON.stringify(actions)}`);
    const edits = quickFix.edit?.changes?.[uri];
    assert.ok(edits && edits.length === 1, "Expected single WorkspaceEdit text change");

    const updated = TextDocument.applyEdits(doc, edits);
    assert.ok(
      updated.includes(
        "    requirement subThermal {\n      require constraint { temp <= 95.0 }\n      require constraint { temp <= 80.0 }\n    }",
      ),
      `Expected synthesized constraint inserted before closing '}', got:\n${updated}`,
    );
  });

  it("S2010: prefixes top-level import with 'private '", () => {
    const uri = "file:///workspace/TopLevelImports.sysml";
    const source = ["import ScalarValues::*;", "package TopLevelImports {}", ""].join("\n");

    const doc = TextDocument.create(uri, "sysml2", 1, source);
    const runCodeActions = setupCodeActionHarness(new Map([[uri, doc]]));

    const actions = runCodeActions({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            severity: DiagnosticSeverity.Warning,
            code: 2010,
            source: "sysml2",
            message: "Top-level import 'ScalarValues::*' should be declared 'private'.",
          },
        ],
      },
    });

    const quickFix = actions.find(
      (a) => a.kind === CodeActionKind.QuickFix && a.title === "Make top-level import 'private'",
    );
    assert.ok(quickFix, `Expected S2010 QuickFix, got: ${JSON.stringify(actions)}`);
    const edits = quickFix.edit?.changes?.[uri];
    assert.ok(edits && edits.length === 1);

    const updated = TextDocument.applyEdits(doc, edits);
    assert.ok(
      updated.startsWith("private import ScalarValues::*;"),
      `Expected 'private import ScalarValues::*;', got:\n${updated}`,
    );
  });

  it("S2011: inserts ':>> ' before shadowed inherited member name", () => {
    const uri = "file:///workspace/VehicleShadowing.sysml";
    const source = [
      "package VehicleShadowing {",
      "  part def BaseVehicle {",
      "    attribute mass : Real;",
      "  }",
      "  part def SportsCar :> BaseVehicle {",
      "    attribute mass : Real = 1250.0;",
      "  }",
      "}",
      "",
    ].join("\n");

    const doc = TextDocument.create(uri, "sysml2", 1, source);
    const runCodeActions = setupCodeActionHarness(new Map([[uri, doc]]));

    const actions = runCodeActions({
      textDocument: { uri },
      range: { start: { line: 5, character: 14 }, end: { line: 5, character: 18 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 5, character: 14 }, end: { line: 5, character: 18 } },
            severity: DiagnosticSeverity.Warning,
            code: "S2011",
            source: "sysml2",
            message: "Member 'mass' shadows inherited feature from 'BaseVehicle' without ':>>' ('redefines').",
          },
        ],
      },
    });

    const quickFix = actions.find(
      (a) => a.kind === CodeActionKind.QuickFix && a.title === "Add ':>>' ('redefines') to shadowed member",
    );
    assert.ok(quickFix, `Expected S2011 QuickFix, got: ${JSON.stringify(actions)}`);
    const edits = quickFix.edit?.changes?.[uri];
    assert.ok(edits && edits.length === 1);

    const updated = TextDocument.applyEdits(doc, edits);
    assert.ok(
      updated.includes("    attribute :>> mass : Real = 1250.0;"),
      `Expected 'attribute :>> mass : Real = 1250.0;', got:\n${updated}`,
    );
  });

  it("S4021: replaces 'to <port>' with 'via <port>' in send action", () => {
    const uri = "file:///workspace/TelemetrySend.sysml";
    const source = [
      "package TelemetrySend {",
      "  port def CommandPort;",
      "  part def Controller {",
      "    port cmdOut : CommandPort;",
      "    action sendAlert {",
      "      send AlertSignal() to cmdOut;",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");

    const doc = TextDocument.create(uri, "sysml2", 1, source);
    const runCodeActions = setupCodeActionHarness(new Map([[uri, doc]]));

    const actions = runCodeActions({
      textDocument: { uri },
      range: { start: { line: 5, character: 28 }, end: { line: 5, character: 34 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 5, character: 28 }, end: { line: 5, character: 34 } },
            severity: DiagnosticSeverity.Warning,
            code: 4021,
            source: "sysml2",
            message: "Sending to port 'cmdOut' should use 'via cmdOut' instead of 'to cmdOut'.",
          },
        ],
      },
    });

    const quickFix = actions.find(
      (a) => a.kind === CodeActionKind.QuickFix && a.title === "Replace 'to' with 'via' for port send",
    );
    assert.ok(quickFix, `Expected S4021 QuickFix, got: ${JSON.stringify(actions)}`);
    const edits = quickFix.edit?.changes?.[uri];
    assert.ok(edits && edits.length === 1);

    const updated = TextDocument.applyEdits(doc, edits);
    assert.ok(
      updated.includes("      send AlertSignal() via cmdOut;"),
      `Expected 'send AlertSignal() via cmdOut;', got:\n${updated}`,
    );
  });
});
