// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagramDispatch } from "../src/diagramApi.js";
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

  it("supports diagram dispatch operations (getData, getComponentProperties, applyEdits, drillDown, getPalette) for PSCAD", async () => {
    const phase8Pscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Phase8_Offshore_Wind_DFIG" version="5.0.2" type="case">
  <paramlist name="Settings">
    <param name="time_step" value="40.0"/>
    <param name="time_duration" value="0.06"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame">
        <Bus classid="Bus" id="Bus1" name="Onshore_132" x="100" y="100">
          <paramlist><param name="BaseKV" value="132.0"/></paramlist>
        </Bus>
        <Bus classid="Bus" id="Bus2" name="Offshore_132" x="300" y="100">
          <paramlist><param name="BaseKV" value="132.0"/></paramlist>
        </Bus>
        <User classid="UserCmp" name="master:source_3" id="GridSrc" x="64" y="100" orient="0">
          <paramlist>
            <param name="V" value="132.0"/>
            <param name="f" value="60.0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:cable" id="SubCable1" x="200" y="100" orient="0">
          <paramlist>
            <param name="length" value="45.0"/>
            <param name="model_type" value="fd"/>
            <param name="core_radius" value="0.022"/>
            <param name="insulation_radius" value="0.052"/>
            <param name="eps_r" value="2.3"/>
            <param name="burial_depth" value="1.5"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:ind_machine" id="AuxPumpMotor" x="100" y="136" orient="0">
          <paramlist>
            <param name="MVA" value="5.0"/>
            <param name="V" value="132.0"/>
            <param name="H" value="0.6"/>
            <param name="slip" value="0.03"/>
            <param name="Tm" value="0.45"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:dfig" id="WindDFIG1" x="336" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="120.0"/>
            <param name="V" value="132.0"/>
            <param name="H" value="1.8"/>
            <param name="slip" value="-0.10"/>
            <param name="Tm" value="-0.80"/>
            <param name="Vdr" value="0.06"/>
            <param name="Vqr" value="-0.08"/>
            <param name="I_crowbar" value="1.8"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="OffshoreCollector" id="SubModInst1" x="300" y="180" orient="0">
          <paramlist><param name="RatingMVA" value="120.0"/></paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="100" y="100"/><vertex x="164" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="236" y="100"/><vertex x="300" y="100"/></Wire>
      </schematic>
    </Definition>
    <Definition classid="UserCmpDefn" name="OffshoreCollector">
      <schematic classid="GraphFrame">
        <Bus classid="Bus" id="SubBus1" name="Collector_33kV" x="120" y="120">
          <paramlist><param name="BaseKV" value="33.0"/></paramlist>
        </Bus>
        <User classid="UserCmp" name="master:breaker3" id="SubBrk1" x="180" y="120" orient="0">
          <paramlist><param name="t_open" value="0.05"/></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    let liveXmlBuffer = phase8Pscx;
    const testUri = "file:///workspace/Phase8_Offshore_Wind_DFIG.pscx";
    const dispatch = createDiagramDispatch({
      generic: {
        deps: {
          getDocumentText: (u: string) => (u === testUri ? liveXmlBuffer : undefined),
        },
      } as any,
    });

    const mainDiag = await dispatch.getData({ uri: testUri });
    assert.ok(
      mainDiag && mainDiag.nodes.length >= 6,
      "Expected dispatch.getData() to return PSCAD Main canvas nodes from in-memory buffer",
    );

    const props = await dispatch.getComponentProperties({ uri: testUri, componentName: "WindDFIG1" });
    assert.ok(
      props && props.className === "master:dfig" && props.parameters.some((p) => p.name === "MVA" && p.value === "120"),
      "Expected dispatch.getComponentProperties() to inspect WindDFIG1 XML parameters",
    );

    const editRes = await dispatch.applyEdits({
      uri: testUri,
      seq: 1,
      actions: [
        { type: "move", items: [{ name: "WindDFIG1", x: 540, y: 300, width: 60, height: 60 }] },
        { type: "updateParameter", name: "WindDFIG1", parameter: "MVA", value: "160.0" },
      ],
    });
    assert.ok(
      editRes.edits && editRes.edits.length >= 2,
      `Expected dispatch.applyEdits() to return two-way XML text edits (got ${editRes.edits?.length ?? 0})`,
    );

    const drillRes = await dispatch.drillDown({ uri: testUri, componentId: "SubModInst1" });
    assert.ok(
      drillRes &&
        drillRes.targetClassName === "OffshoreCollector" &&
        drillRes.data.nodes.some((n: any) => n.id === "SubBrk1"),
      "Expected dispatch.drillDown() on SubModInst1 to render OffshoreCollector sub-module schematic",
    );

    const palette = await dispatch.getPalette({ uri: testUri });
    assert.ok(
      palette &&
        palette.categories.length >= 4 &&
        palette.categories.some((c) => c.items.some((i) => i.className === "master:mmc_thevenin")),
      "Expected dispatch.getPalette() to return PSCAD Master Library apparatus categories",
    );
  });
});
