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
    // PSCAD diagrams are laid out in schematic pixel space; no coordinate-system transform is applied.
    assert.equal(diagram.coordinateSystem ?? null, null);

    const pslxFixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Component_Lib.pslx");
    const pslxUri = `file://${pslxFixturePath}`;
    const pslxDiagram = await diagramService.handleGetDiagramData({ uri: pslxUri });

    assert.ok(pslxDiagram, "Should return diagram data for .pslx library");
    assert.ok(Array.isArray(pslxDiagram.nodes), "Should have nodes array for .pslx");
    assert.ok(pslxDiagram.nodes.length >= 3, "Should have component nodes in library");
    assert.equal(pslxDiagram.coordinateSystem ?? null, null);
  });

  it("returns library tree nodes with iconSvg and valid icons for .pslx library", async () => {
    const fs = await import("node:fs");
    const pslxFixturePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Component_Lib.pslx");
    const text = fs.readFileSync(pslxFixturePath, "utf-8");

    const { pscadLanguage } = await import("@modelscript/pscad");
    const { UnifiedWorkspace } = await import("@modelscript/runtime");
    const ws = new UnifiedWorkspace(pscadLanguage);
    ws.setDocument("file:///Component_Lib.pslx", text);
    const index = ws.getFileIndex("file:///Component_Lib.pslx")!;

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

  it("emits syntax error diagnostics for malformed PSCAD XML", async () => {
    const sentDiagnostics: any[] = [];
    const mockConnection: any = {
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics.push(...params.diagnostics);
      },
      sendNotification: () => {},
      console: { info: () => {}, warn: () => {}, error: () => {} },
    };
    const docManager: any = {
      documents: { get: () => null },
      documentTrees: new Map(),
    };
    const parserService: any = {
      getParser: () => null,
      ensureLanguageParserLoaded: async () => {},
    };
    const validationService = new ValidationService(mockConnection, docManager, {} as any, parserService);

    const malformedXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="SyntaxBroken" version="5.0.0">
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <User classid="UserCmp" name="master:resistor" id="101" x="100" y="100">
      </schematic>
    </definition>
  </definitions>
</project>`;

    const doc = TextDocument.create("file:///test/syntax-broken.pscx", "pscad", 1, malformedXml);
    await (validationService as any).validatePscadDocument(doc);

    assert.ok(sentDiagnostics.length > 0, "Expected syntax error diagnostics for malformed PSCAD XML");
    const syntaxErr = sentDiagnostics.find((d) => d.severity === 1 && d.range.start.line > 0);
    assert.ok(syntaxErr, `Expected line-accurate syntax error diagnostic, got: ${JSON.stringify(sentDiagnostics)}`);
  });

  it("applies move edits on in-memory PSCAD document even when builtin plugins are registered", async () => {
    const { registerBuiltinLanguagePlugins } = await import("../src/registry/builtin-plugins.js");
    const wsMap = new Map<string, any>();
    registerBuiltinLanguagePlugins({
      workspaceManager: {
        getWorkspaceIndex: (id: string) =>
          wsMap.get(id) ?? { symbols: new Map(), addFile: () => {}, removeFile: () => {} },
        setWorkspaceIndex: (id: string, idx: any) => wsMap.set(id, idx),
        unifiedWorkspace: { registerWorkspace: () => {} },
        documentManager: { documents: { all: () => [] } },
      } as any,
      parserService: {} as any,
      connection: { console: { info: () => {}, warn: () => {}, error: () => {} } } as any,
    });

    const pscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="MoveTest" version="5.0.2" type="case">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame">
        <User classid="UserCmp" name="master:resistor" id="101" x="100" y="100" w="44" h="28" orient="0">
          <paramlist><param name="Name" value="R1"/><param name="R" value="10.0"/></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const memUri = "inmemory://morsel/MoveTest.pscx";
    const dispatch = createDiagramDispatch({
      generic: {
        deps: {
          getDocumentText: (u: string) => (u === memUri ? pscx : undefined),
        },
      } as any,
    });

    const res = await dispatch.applyEdits({
      uri: memUri,
      seq: 1,
      actions: [{ type: "move", items: [{ id: "101", name: "R1", x: 240, y: 180, width: 44, height: 28 }] }],
    });

    assert.ok(res.edits && res.edits.length > 0, "Expected move edit on in-memory PSCAD document to produce TextEdits");
  });

  it("simulates PSCAD .pscx locally in LSP worker via modelscript/simulate", async () => {
    const { registerSimulationEndpoints } = await import("../src/handlers/simulationEndpoints.js");
    const pscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="LocalSimTest" version="5.0.2" type="case">
  <paramlist name="Settings">
    <param name="time_step" value="50.0"/>
    <param name="time_duration" value="0.02"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame">
        <User classid="UserCmp" name="master:source_3" id="S1" x="100" y="100" orient="0">
          <paramlist><param name="V" value="13.8"/><param name="f" value="60.0"/></paramlist>
        </User>
        <User classid="UserCmp" name="master:resistor" id="R1" x="180" y="100" orient="0">
          <paramlist><param name="R" value="10.0"/></paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="120" y="100"/><vertex x="160" y="100"/></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const simUri = "inmemory://morsel/LocalSimTest.pscx";
    const doc = TextDocument.create(simUri, "pscad", 1, pscx);
    const handlers = new Map<string, (params: any) => Promise<any>>();
    const mockContext: any = {
      connection: {
        onRequest: (method: string, handler: (params: any) => Promise<any>) => handlers.set(method, handler),
        onNotification: () => {},
        console: { info: () => {}, warn: () => {}, error: () => {} },
      },
      documents: {
        get: (u: string) => (u === simUri ? doc : undefined),
        all: () => [doc],
      },
      parserService: { ensureLanguageParserLoaded: async () => {} },
      validationService: { flushValidation: async () => {}, validateTextDocument: async () => {} },
      state: { activeValidationPromises: new Map() },
    };

    registerSimulationEndpoints(mockContext);
    const simHandler = handlers.get("modelscript/simulate");
    assert.ok(simHandler, "Expected modelscript/simulate handler to be registered");

    const simRes = await simHandler({ uri: simUri, stopTime: 0.02, interval: 50e-6 });
    assert.equal(simRes.error, undefined, `Unexpected simulation error: ${simRes.error}`);
    assert.ok(simRes.t.length > 100, `Expected time steps > 100, got ${simRes.t.length}`);
    assert.ok(simRes.states.length > 0, "Expected non-empty state names");
    assert.equal(simRes.y.length, simRes.t.length);
  });
});
