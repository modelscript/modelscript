// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CodeActionKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";

test("LSP OLGA Multiphase: CodeLens & QuickFix Integration", async (t) => {
  const olgaUri = "file:///workspace/TiebackSystem.opi";
  const olgaContent = `<OlgaCase name="TiebackSystem" tableFile="fluids/black_oil.csv" maxDt="1.0">
  <Flowpath name="FlowlineA">
    <Pipe label="SeabedPipe" length="5000" diameter="0.3048" discretization="50" elevation="-300" roughness="0.000045" />
    <Valve name="SubseaChoke" position="4800" opening="0.0" cv="150" />
    <Source name="WellHead" boundaryPosition="0" totalMassRate="35" />
    <Node name="PlatformSeparator" boundaryPosition="1" type="PRESSURE" pressure="25bar" />
  </Flowpath>
</OlgaCase>`;

  const doc = TextDocument.create(olgaUri, "xml", 1, olgaContent);
  const mockDocuments: any = {
    get: (uri: string) => (uri === olgaUri ? doc : undefined),
  };

  await t.test("should register and generate rich OLGA CodeLenses for pipeline, valves, and flowpaths", () => {
    let codeLensHandler: any = null;
    const mockConnection: any = {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/codeLens") {
          codeLensHandler = handler;
        }
      },
    };

    const mockContext: any = {
      connection: mockConnection,
      documents: mockDocuments,
    };

    registerCodeLensProvider(mockContext);
    assert.ok(codeLensHandler, "CodeLens handler must be registered");

    const lenses = codeLensHandler({ textDocument: { uri: olgaUri } });
    assert.ok(lenses.length >= 4, `Expected at least 4 lenses, got ${lenses.length}`);

    // Verify simulation & dashboard header lenses
    const simLens = lenses.find((l: any) => l.command.title.includes("Simulate Multiphase Flow"));
    assert.ok(simLens, "Must have Simulate Multiphase Flow lens");

    const dashLens = lenses.find((l: any) => l.command.title.includes("Flow Assurance Dashboard"));
    assert.ok(dashLens, "Must have Flow Assurance Dashboard lens");

    const bathyLens = lenses.find((l: any) => l.command.title.includes("3D Seabed Bathymetry"));
    assert.ok(bathyLens, "Must have 3D Seabed Bathymetry lens");

    // Verify entity-level inline lenses
    const pipeLens = lenses.find((l: any) => l.command.title.includes("SeabedPipe"));
    assert.ok(pipeLens, "Must have Pipe SeabedPipe profile lens");

    const chokeLens = lenses.find((l: any) => l.command.title.includes("SubseaChoke"));
    assert.ok(chokeLens, "Must have Valve SubseaChoke lens");
  });

  await t.test("should provide automated QuickFixes for OLGA diagnostics in onCodeAction", () => {
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

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocuments,
      new Map(),
      async () => {},
      async () => ({ symbols: new Map() }),
    );

    assert.ok(codeActionHandler, "onCodeAction handler should be registered");

    const actions = codeActionHandler({
      textDocument: { uri: olgaUri },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: { diagnostics: [] },
    });

    assert.ok(actions.length > 0, "Should generate quick-fixes for OLGA model");
    const m7008Action = actions.find((a: any) => a.title.includes("Change fluid table extension"));
    assert.ok(m7008Action, "Should include M7008 .csv to .tab QuickFix");
    assert.equal(m7008Action.kind, CodeActionKind.QuickFix);

    const m7005Action = actions.find((a: any) => a.title.includes("Crack valve 'SubseaChoke'"));
    assert.ok(m7005Action, "Should include M7005 closed choke QuickFix");
    assert.equal(m7005Action.kind, CodeActionKind.QuickFix);
  });
});
