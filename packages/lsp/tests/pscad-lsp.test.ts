// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { ValidationService } from "../src/services/validation-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/IEEE9Bus_IBR.pscx");

describe("PSCAD LSP Integration Suite", () => {
  it("resolves PSCAD language plugin for .pscx, .pslx, and .pswx files", async () => {
    const { pscadLanguage } = await import("@modelscript/pscad");
    globalLanguageRegistry.register({
      id: "pscad",
      name: "PSCAD",
      extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
      languageDef: pscadLanguage,
    });

    const pluginPscx = globalLanguageRegistry.getPluginForUri("file:///path/to/grid.pscx");
    assert.ok(pluginPscx, "Should find plugin for .pscx");
    assert.equal(pluginPscx.id, "pscad");

    const pluginPslx = globalLanguageRegistry.getPluginForUri("file:///path/to/Component_Lib.pslx");
    assert.ok(pluginPslx, "Should find plugin for .pslx");
    assert.equal(pluginPslx.id, "pscad");

    const pluginPswx = globalLanguageRegistry.getPluginForUri("file:///path/to/workspace.pswx");
    assert.ok(pluginPswx, "Should find plugin for .pswx");
    assert.equal(pluginPswx.id, "pscad");
  });

  it("validates PSCAD text documents and emits diagnostic squiggles", async () => {
    let sentDiagnostics: any[] = [];
    const mockConnection: any = {
      console: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics = params.diagnostics;
      },
    };

    const docManager: any = {
      documents: {
        get: () => null,
      },
      documentTrees: new Map(),
    };
    const wsManager: any = {};
    const parserService: any = {
      getParser: () => null,
    };

    const validationService = new ValidationService(mockConnection, docManager, wsManager, parserService);

    // Invalid XML / PSCAD content with floating node
    const invalidXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="BrokenGrid" version="5.0.0">
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <User classid="UserCmp" defn="source_3p" id="G1" x="100" y="100">
          <port name="out" pos="[20, 0]"/>
        </User>
        <Bus name="FloatingBus" id="B1" x="100" y="100"/>
      </schematic>
    </definition>
  </definitions>
</project>`;

    const doc = TextDocument.create("file:///test/broken.pscx", "pscad", 1, invalidXml);
    await (validationService as any).validatePscadDocument(doc);

    assert.ok(sentDiagnostics.length > 0, "Should emit diagnostic for floating terminal");
    const floatingDiag = sentDiagnostics.find((d) => d.code === "M6001");
    assert.ok(floatingDiag, "Should flag M6001 floating terminal");
    assert.equal(floatingDiag.source, "pscad");
  });

  it("builds AntV X6 diagram data for PSCAD project URI", async () => {
    const mockConnection: any = {
      console: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const docManager: any = {
      documents: {
        get: () => null,
      },
    };
    const wsManager: any = {};

    const diagramService = new DiagramService(mockConnection, docManager, wsManager);

    const uri = `file://${fixturePath}`;
    const diagram = await diagramService.handleGetDiagramData({ uri });

    assert.ok(diagram, "Should return diagram data");
    assert.ok(Array.isArray(diagram.nodes), "Should have nodes array");
    assert.ok(Array.isArray(diagram.edges), "Should have edges array");
    assert.ok(diagram.nodes.length >= 3, "Should have bus and component nodes");
    assert.ok(diagram.coordinateSystem);

    const pslxFixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Component_Lib.pslx");
    const pslxUri = `file://${pslxFixturePath}`;
    const pslxDiagram = await diagramService.handleGetDiagramData({ uri: pslxUri });

    assert.ok(pslxDiagram, "Should return diagram data for .pslx library");
    assert.ok(Array.isArray(pslxDiagram.nodes), "Should have nodes array for .pslx");
    assert.ok(pslxDiagram.nodes.length >= 3, "Should have component nodes in library");
    assert.ok(pslxDiagram.coordinateSystem);
  });

  it("returns library tree nodes with iconSvg and valid icons for .pslx library", async () => {
    const fs = await import("node:fs");
    const pslxFixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Component_Lib.pslx");
    const text = fs.readFileSync(pslxFixturePath, "utf-8");

    const { PscadWorkspaceIndex } = await import("@modelscript/pscad");
    const wsIndex = new PscadWorkspaceIndex();
    const index = wsIndex.indexFile("file:///Component_Lib.pslx", text);

    const { getTreeChildrenFast } = await import("../src/utils/hierarchy-utils.js");

    // Root level: should return Component_Lib package
    const rootNodes = await getTreeChildrenFast(index, undefined);
    assert.equal(rootNodes.length, 1);
    assert.equal(rootNodes[0].name, "Component_Lib");
    assert.equal(rootNodes[0].classKind, "package");
    assert.equal(rootNodes[0].hasChildren, true);

    // Children under Component_Lib: should return all 4 components (Flag, Main, PF_Meter, Rational_Operator)
    const childNodes = await getTreeChildrenFast(index, "Component_Lib");
    assert.equal(childNodes.length, 4, "Should return all 4 components under Component_Lib");

    const names = childNodes.map((n) => n.name);
    assert.ok(names.includes("Flag"), "Should include Flag");
    assert.ok(names.includes("Main"), "Should include Main");
    assert.ok(names.includes("PF_Meter"), "Should include PF_Meter");
    assert.ok(names.includes("Rational_Operator"), "Should include Rational_Operator");

    for (const node of childNodes) {
      assert.notEqual(node.icon, "class", `${node.name} icon must not be 'class' (which renders blank)`);
      assert.ok(node.iconSvg, `${node.name} must have iconSvg`);
      assert.ok(node.iconSvg?.startsWith("<svg"), `${node.name} iconSvg must be valid SVG markup`);
    }
  });
});
