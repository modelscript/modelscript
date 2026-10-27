// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";
import { LanguageRegistry } from "../src/registry/LanguageRegistry.js";

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

  await t.test("should NOT emit fake Drone digital-thread CodeLenses on unannotated Modelica parameters", async () => {
    let codeLensHandler: any = null;
    const mockConnection: any = {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/codeLens") {
          codeLensHandler = handler;
        }
      },
    };

    const plainUri = "file:///workspace/SpringDamper.mo";
    const plainContent = `
model SpringDamper
  parameter Real m = 2.5 "Mass";
  parameter Real Cd = 0.4 "Damping";
  parameter Real A = 1.2 "Area";
equation
end SpringDamper;
`;
    const annotatedUri = "file:///workspace/AnnotatedTwin.mo";
    const annotatedContent = `
model AnnotatedTwin
  parameter Real m = 1.25 annotation(twin = "fea://chassis.inp#mass");
equation
end AnnotatedTwin;
`;

    const plainDoc = TextDocument.create(plainUri, "modelica", 1, plainContent);
    const annotatedDoc = TextDocument.create(annotatedUri, "modelica", 1, annotatedContent);
    const mockContext: any = {
      connection: mockConnection,
      documents: {
        get: (uri: string) => (uri === plainUri ? plainDoc : uri === annotatedUri ? annotatedDoc : undefined),
      },
      workspaceManager: {
        globalWorkspaceIndex: { getFileIndex: () => undefined },
        sysml2WorkspaceIndex: { getFileIndex: () => undefined },
      },
    };

    registerCodeLensProvider(mockContext);

    const plainLenses = codeLensHandler({ textDocument: { uri: plainUri } });
    const fakeTwinLens = plainLenses.find(
      (l: any) =>
        l.command?.title?.includes("drone_chassis.inp") ||
        l.command?.title?.includes("FEA Mesh") ||
        l.command?.title?.includes("CFD Surrogate"),
    );
    assert.strictEqual(fakeTwinLens, undefined, "Unannotated Modelica parameters must not get fake Drone twin lenses");

    const annotatedLenses = codeLensHandler({ textDocument: { uri: annotatedUri } });
    const realTwinLens = annotatedLenses.find((l: any) => l.command?.title?.includes("chassis.inp#mass"));
    assert.ok(realTwinLens, "Annotated parameter with annotation(twin = ...) must receive a digital thread CodeLens");

    // Verify CodeLens category settings filtering
    mockContext.settings = {
      codeLens: {
        enabled: true,
        polyglotLinks: false,
      },
    };
    const filteredLenses = codeLensHandler({ textDocument: { uri: annotatedUri } });
    assert.strictEqual(
      filteredLenses.find((l: any) => l.command?.title?.includes("chassis.inp#mass")),
      undefined,
      "Disabling modelscript.codeLens.polyglotLinks must suppress digital thread CodeLenses",
    );

    mockContext.settings = {
      codeLens: {
        enabled: false,
      },
    };
    assert.strictEqual(
      codeLensHandler({ textDocument: { uri: annotatedUri } }).length,
      0,
      "Disabling modelscript.codeLens.enabled must suppress all CodeLenses",
    );
  });

  await t.test("LanguageRegistry prioritizes maturity tiers and disambiguates .inp and .xml by content", async () => {
    const registry = new LanguageRegistry();
    // Register in reverse-maturity order to verify sorting by maturity rather than insertion order
    registry.register({
      id: "swmm",
      name: "SWMM",
      extensions: [".inp"],
      maturity: "experimental",
    });
    registry.register({
      id: "epanet",
      name: "EPANET",
      extensions: [".inp"],
      maturity: "experimental",
    });
    registry.register({
      id: "fea",
      name: "FEA",
      extensions: [".inp", ".fea"],
      maturity: "stable",
    });
    registry.register({
      id: "sbml",
      name: "SBML",
      extensions: [".xml"],
      maturity: "experimental",
    });
    registry.register({
      id: "reqif",
      name: "ReqIF",
      extensions: [".reqif", ".xml"],
      maturity: "beta",
    });

    // Without content, highest-maturity language wins (.inp -> fea, .xml -> reqif)
    assert.strictEqual(registry.getPluginForExtension(".inp")?.id, "fea");
    assert.strictEqual(registry.getPluginForExtension(".xml")?.id, "reqif");

    // With content disambiguation, header markers route to the exact domain language
    assert.strictEqual(
      registry.getPluginForUri("file:///workspace/network.inp", "[TITLE]\nWater Network\n[JUNCTIONS]\nJ1 100")?.id,
      "epanet",
    );
    assert.strictEqual(
      registry.getPluginForUri("file:///workspace/drainage.inp", "[SUBCATCHMENTS]\nS1 RG1")?.id,
      "swmm",
    );
    assert.strictEqual(
      registry.getPluginForUri("file:///workspace/mesh.inp", "*HEADING\n*NODE\n1, 0.0, 0.0, 0.0")?.id,
      "fea",
    );
    assert.strictEqual(
      registry.getPluginForUri("file:///workspace/metabolic.xml", '<?xml version="1.0"?><sbml level="3">')?.id,
      "sbml",
    );

    // Maturity tier filtering: stableOnly disables beta/experimental plugins unless overridden
    registry.setLanguageConfig({
      maturityTier: "stableOnly",
      enabledOverrides: { sbml: true },
    });
    assert.strictEqual(registry.isLanguageEnabled("fea"), true);
    assert.strictEqual(registry.isLanguageEnabled("reqif"), false);
    assert.strictEqual(registry.isLanguageEnabled("sbml"), true);
    assert.strictEqual(registry.getPluginForExtension(".xml")?.id, "sbml");
  });
});
