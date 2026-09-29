// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";

test("LSP Formal Verification: CodeLens & QuickFix Integration", async (t) => {
  await t.test("should generate CodeLens actions for SysML v2 action, part, and state defs", async () => {
    let codeLensHandler: any = null;
    const mockConnection: any = {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/codeLens") {
          codeLensHandler = handler;
        }
      },
    };

    const sysmlUri = "file:///workspace/Autopilot.sysml";
    const sysmlContent = `
package AutopilotSystem {
  action def SpeedControl {
    in item speed : Real;
    out item throttle : Real;
  }

  part def Powertrain {
    port powerIn;
  }

  state def FlightMode {
    entry;
  }
}
`;
    const doc = TextDocument.create(sysmlUri, "sysml2", 1, sysmlContent);
    const mockDocuments: any = {
      get: (uri: string) => (uri === sysmlUri ? doc : undefined),
    };

    const mockContext: any = {
      connection: mockConnection,
      documents: mockDocuments,
      workspaceManager: {
        globalWorkspaceIndex: { getFileIndex: () => undefined },
        sysml2WorkspaceIndex: { getFileIndex: () => undefined },
      },
    };

    registerCodeLensProvider(mockContext);
    assert.ok(codeLensHandler, "CodeLens handler must be registered");

    const lenses = codeLensHandler({ textDocument: { uri: sysmlUri } });
    assert.ok(lenses.length >= 3, `Expected at least 3 lenses, got ${lenses.length}`);

    // Check for MC/DC test runner lens
    const mcdcLens = lenses.find((l: any) => l.command.title.includes("MC/DC Tests"));
    assert.ok(mcdcLens, "Must have MC/DC test runner lens");
    assert.strictEqual(mcdcLens.command.command, "modelscript.runMcdcTests");

    // Check for Region Decomposition lens
    const decompLens = lenses.find((l: any) => l.command.title.includes("Decompose Regions"));
    assert.ok(decompLens, "Must have region decomposition lens");
    assert.strictEqual(decompLens.command.command, "modelscript.decomposeRegions");

    // Check for Contract Hierarchy lens
    const contractLens = lenses.find((l: any) => l.command.title.includes("Verify Contracts"));
    assert.ok(contractLens, "Must have contract hierarchy lens");
    assert.strictEqual(contractLens.command.command, "modelscript.openContractExplorer");

    // Check for Candidate Trade Study & Tier-3 Confirmation lens
    const tradeStudyLens = lenses.find((l: any) => l.command.title.includes("Tier 1: Validated"));
    assert.ok(tradeStudyLens, "Must have Candidate Trade Study CodeLens");
    assert.strictEqual(tradeStudyLens.command.command, "modelscript.openCandidateTradeStudy");

    // Check for Trace Replay lens
    const replayLens = lenses.find((l: any) => l.command.title.includes("Replay Trace"));
    assert.ok(replayLens, "Must have trace replay lens");
    assert.strictEqual(replayLens.command.command, "modelscript.openTraceReplay");
  });

  await t.test("should generate QuickFix for unhandled decision table gap diagnostic", async () => {
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

    const docUri = "file:///workspace/SpeedDecide.sysml";
    const docContent = `
action def DecideController {
  if (speed <= 50) {
    assign mode := 1;
  }
}
`;
    const doc = TextDocument.create(docUri, "sysml2", 1, docContent);
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

    assert.ok(codeActionHandler, "onCodeAction handler must be registered");

    const diagnostic = {
      source: "modelscript",
      code: "DECISION_TABLE_GAP",
      range: {
        start: { line: 2, character: 2 },
        end: { line: 4, character: 3 },
      },
      message:
        "Decision table is non-exhaustive. Unhandled input domain scenario: speed >= 50.01 && speed <= 100. QuickFix: else if (speed > 50)",
      severity: DiagnosticSeverity.Warning,
    };

    const actions = codeActionHandler({
      textDocument: { uri: docUri },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    });

    assert.ok(actions.length > 0, "Should generate at least one code action");
    const quickFix = actions.find((a: any) => a.kind === CodeActionKind.QuickFix);
    assert.ok(quickFix, "Must offer a QuickFix action");
    assert.ok(quickFix.title.includes("missing guard scenario"));
    assert.ok(quickFix.edit.changes[docUri][0].newText.includes("else if"));
  });
});
