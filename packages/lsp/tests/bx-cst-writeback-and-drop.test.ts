// SPDX-License-Identifier: AGPL-3.0-or-later

import { SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import { CstUnparser } from "@modelscript/dsl";
import { computeComponentInsert } from "@modelscript/modelica/diagram";
import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { computeModelicaComponentDropEdits } from "../src/cross-language-drop.js";
import { GenericDSLDiagramBackend } from "../src/diagramApi.js";
import { createSimulinkDiagramBackend } from "../src/diagrams/simulink-backend.js";
import { registerPolyglotEndpoints } from "../src/handlers/polyglotEndpoints.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { computeWritebackEdit } from "../src/services/writeback-service.js";
import { isWasmTreeActiveInFacade } from "../src/utils/ast-utils.js";

function applyEdits(
  text: string,
  edits: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>,
): string {
  const doc = TextDocument.create("file:///test.txt", "text", 1, text);
  return TextDocument.applyEdits(doc, edits as any);
}

describe("Phase 3: Standardized CstUnparser Writeback, GenericDSL Mutations & Modelica Icon Drop", () => {
  it("WritebackService routes field writes through CstUnparser.patchWritebackValue when rootCst is available", async () => {
    const source = `part engine {\n  attribute mass = 12;\n}\n`;
    const eqIdx = source.indexOf("mass = 12");
    const valIdx = source.indexOf("12");
    const attrEnd = source.indexOf(";", valIdx) + 1;

    const fakeRootNode = {
      type: "SourceFile",
      text: source,
      startIndex: 0,
      endIndex: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 3, column: 0 },
      children: [
        {
          type: "AttributeUsage",
          text: source.slice(eqIdx - 10, attrEnd),
          startIndex: eqIdx - 10,
          endIndex: attrEnd,
          startPosition: { row: 1, column: 2 },
          endPosition: { row: 1, column: 22 },
          children: [],
          childForFieldName(field: string) {
            if (field === "value") {
              return {
                type: "NUMBER",
                text: "12",
                startIndex: valIdx,
                endIndex: valIdx + 2,
                startPosition: { row: 1, column: 19 },
                endPosition: { row: 1, column: 21 },
                children: [],
              };
            }
            return null;
          },
        },
      ],
    };

    const uri = "file:///test/model.custom";
    const doc = TextDocument.create(uri, "custom", 1, source);
    const mockContext: any = {
      documents: new Map([[uri, doc]]),
      documentManager: {
        documents: new Map([[uri, doc]]),
        documentTrees: new Map([[uri, { tree: { rootNode: fakeRootNode } }]]),
      },
      workspaceManager: {
        plugins: new Map(),
        unifiedWorkspace: {
          getIndex: () => ({
            symbols: new Map([
              [
                1,
                {
                  id: 1,
                  name: "mass",
                  kind: "Attribute",
                  resourceId: uri,
                  startOffset: eqIdx - 10,
                  endOffset: attrEnd,
                },
              ],
            ]),
            byName: new Map([["mass", [1]]]),
            childrenOf: new Map(),
          }),
        },
      },
    };

    const result = await computeWritebackEdit(mockContext, { documentUri: uri, target: "mass", newValue: "42.5" });
    assert.strictEqual(result.success, true);
    const patched = applyEdits(source, result.workspaceEdit!.changes![uri]!);
    assert.ok(patched.includes("attribute mass = 42.5;"), `Expected patched value, got:\n${patched}`);

    // Direct CstUnparser test for deleteDeclaration multiline cleanup
    const delRes = CstUnparser.deleteDeclaration(source, fakeRootNode as any, {
      startOffset: eqIdx - 10,
      endOffset: attrEnd,
    });
    assert.ok(delRes);
    const deleted = applyEdits(source, [{ range: delRes.edit.range, newText: delRes.edit.newText }]);
    assert.strictEqual(deleted, `part engine {\n}\n`);
  });

  it("GenericDSLDiagramBackend uses SymbolIndex + CstUnparser for multi-line deletes and parent-scoped renames", async () => {
    let source = [
      "system Alpha {",
      "  block controller {",
      "    gain = 2;",
      "  }",
      "  controller -> plant;",
      "}",
      "system Beta {",
      "  block controller {",
      "    gain = 9;",
      "  }",
      "}",
      "",
    ].join("\n");

    const alphaStart = source.indexOf("system Alpha");
    const alphaEnd = source.indexOf("}\nsystem Beta") + 1;
    const ctrlAlphaStart = source.indexOf("  block controller");
    const ctrlAlphaEnd = source.indexOf("\n  }", ctrlAlphaStart) + 4;
    const gainStart = source.indexOf("    gain = 2;");
    const gainEnd = gainStart + "    gain = 2;".length;
    const valStart = source.indexOf("2", gainStart);

    const uri = "file:///test/generic.flow";
    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (u) => (u === uri ? source : undefined),
      layoutStorage: new SidecarLayoutStorage(),
      getSymbolIndex: () => ({
        symbols: new Map([
          [1, { id: 1, name: "Alpha", startOffset: alphaStart, endOffset: alphaEnd, parentId: null }],
          [2, { id: 2, name: "controller", startOffset: ctrlAlphaStart, endOffset: ctrlAlphaEnd, parentId: 1 }],
          [
            3,
            {
              id: 3,
              name: "gain",
              startOffset: gainStart,
              endOffset: gainEnd,
              parentId: 2,
              fieldRanges: { value: { startOffset: valStart, endOffset: valStart + 1 } },
            },
          ],
        ]),
        byName: new Map([
          ["Alpha", [1]],
          ["controller", [2]],
          ["gain", [3]],
        ]),
        childrenOf: new Map([
          [1, [2]],
          [2, [3]],
        ]),
      }),
    });

    // 1. Update property via SymbolIndex child fieldRanges + CstUnparser
    const propRes = await backend.applyEdits({
      uri,
      seq: 1,
      actions: [{ type: "updateProperty", name: "controller", key: "gain", value: "7.5" }],
    });
    source = applyEdits(source, propRes.edits);
    assert.ok(source.includes("    gain = 7.5;\n  }\n  controller -> plant;"));
    assert.ok(source.includes("    gain = 9;"), "Sibling system Beta gain must stay untouched");

    // 2. Rename scoped cleanly within parent Alpha (does not touch Beta.controller!)
    const renameRes = await backend.applyEdits({
      uri,
      seq: 2,
      actions: [{ type: "updateName", oldName: "controller", newName: "pid" }],
    });
    const renamed = applyEdits(source, renameRes.edits);
    assert.ok(renamed.includes("  block pid {\n    gain = 7.5;\n  }\n  pid -> plant;"));
    assert.ok(renamed.includes("system Beta {\n  block controller {"), "Sibling system Beta must not be renamed");

    // 3. Delete multiline declaration via CstUnparser.deleteDeclaration
    const delBackend = new GenericDSLDiagramBackend({
      getDocumentText: () => source,
      layoutStorage: new SidecarLayoutStorage(),
      getSymbolIndex: () => ({
        symbols: new Map([[2, { id: 2, name: "controller", startOffset: ctrlAlphaStart, endOffset: ctrlAlphaEnd }]]),
        byName: new Map([["controller", [2]]]),
        childrenOf: new Map(),
      }),
    });
    const delRes = await delBackend.applyEdits({
      uri,
      seq: 3,
      actions: [{ type: "deleteComponents", names: ["controller"] }],
    });
    const afterDelete = applyEdits(source, delRes.edits);
    assert.ok(!afterDelete.includes("gain = 7.5;"), "Entire multiline controller block must be deleted cleanly");
    assert.ok(afterDelete.includes("controller -> plant;"));
  });

  it("computeModelicaComponentDropEdits resolves dropped class Icon coordinateSystem rather than parent Diagram extent", () => {
    const libDoc = [
      "package Lib",
      "  model WideSensor",
      "    annotation(Icon(coordinateSystem(extent={{-50,-25},{50,25}}, initialScale=0.2)));",
      "  end WideSensor;",
      "end Lib;",
    ].join("\n");
    const targetDoc = [
      "model Circuit",
      "  annotation(Diagram(coordinateSystem(extent={{-1000,-1000},{1000,1000}}, initialScale=0.5)));",
      "end Circuit;",
    ].join("\n");

    const libUri = "file:///test/Lib.mo";
    const targetUri = "file:///test/Circuit.mo";
    const clsStart = libDoc.indexOf("model WideSensor");
    const clsEnd = libDoc.indexOf("end WideSensor;") + "end WideSensor;".length;

    const edits = computeModelicaComponentDropEdits({
      docText: targetDoc,
      uri: targetUri,
      rawClassName: "Lib.WideSensor",
      x: 40,
      y: -30,
      classInstance: {
        name: "Circuit",
        annotation: (name: string) =>
          name === "Diagram"
            ? {
                coordinateSystem: {
                  extent: [
                    [-1000, -1000],
                    [1000, 1000],
                  ],
                  initialScale: 0.5,
                },
              }
            : null,
      } as any,
      computeComponentInsert: computeComponentInsert as any,
      getResourceText: (u) => (u === libUri ? libDoc : targetDoc),
      unifiedIndex: {
        symbols: new Map([
          [1, { id: 1, name: "Lib", kind: "Package", parentId: null, resourceId: libUri }],
          [
            2,
            {
              id: 2,
              name: "WideSensor",
              kind: "Class",
              namePath: "Lib.WideSensor",
              parentId: 1,
              resourceId: libUri,
              startOffset: clsStart,
              endOffset: clsEnd,
            },
          ],
        ]),
        byName: new Map([
          ["Lib", [1]],
          ["WideSensor", [2]],
        ]),
        childrenOf: new Map([[1, [2]]]),
      } as any,
    });

    const result = applyEdits(targetDoc, edits);
    // WideSensor Icon is 100x50 with initialScale 0.2 -> 20x10 -> extent={{-10,-5},{10,5}} (NOT 1000x1000 from parent Diagram!)
    assert.ok(
      result.includes("origin={40,30}, extent={{-10,-5},{10,5}}"),
      `Expected Icon extent {{-10,-5},{10,5}}, got:\n${result}`,
    );
  });

  it("isWasmTreeActiveInFacade honors per-URI documentRoots even after facade.lastAstRoot moves to another file", () => {
    const uriA = "file:///test/A.mo";
    const uriB = "file:///test/B.mo";
    const docRoots = new Map<string, number>([
      [uriA, 1001],
      [uriB, 2002],
    ]);
    const facade = {
      lastAstRoot: 2002,
      getDocumentRoot: (u?: string | number) => (typeof u === "string" ? (docRoots.get(u) ?? 0) : facade.lastAstRoot),
    };
    const treeA = { rootPtr: 1001 };

    // Without URI, single-slot check sees lastAstRoot=2002 and rejects treeA; with URI, documentRoots preserves incrementality.
    assert.strictEqual(isWasmTreeActiveInFacade(treeA, facade), false);
    assert.strictEqual(isWasmTreeActiveInFacade(treeA, facade, uriA), true);
    assert.strictEqual(isWasmTreeActiveInFacade({ rootPtr: 9999 }, facade, uriA), false);
  });

  it("polyglotEndpoints resolves UnifiedWorkspace.queryEngine registered via registerQueryEngine", async () => {
    const uw = new UnifiedWorkspace();
    const handlers = new Map<string, (...args: any[]) => any>();
    const sentDiagnostics: any[] = [];
    const mockConn: any = {
      onRequest: (m: string, h: (...args: any[]) => any) => handlers.set(m, h),
      sendDiagnostics: (p: any) => sentDiagnostics.push(p),
      console: { info() {}, warn() {}, error() {} },
    };

    const mockCorr = {
      count: 1,
      isConflicted: (s: number) => s === 0,
      isRemoved: () => false,
      getSource: () => 41,
      getTarget: () => 82,
      getRule: () => 3,
      reconcileAll: () => 1,
    };
    uw.registerQueryEngine("modelica", {
      getCorrespondenceIndex: () => mockCorr,
      setCorrespondenceIndex: () => {},
    });

    registerPolyglotEndpoints(mockConn, { get: () => null }, {}, {}, { unifiedWorkspace: uw });

    const check = handlers.get("modelscript/checkCorrespondenceConflicts");
    assert.ok(check);
    const res = await check!({ uri: "file:///test/system.mo" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 1);
    assert.strictEqual(res.conflicts[0].source, 41);
    assert.strictEqual(sentDiagnostics.length, 1);

    const rec = handlers.get("modelscript/reconcileConflicts");
    const recRes = await rec!({ strategy: 0, uri: "file:///test/system.mo" });
    assert.strictEqual(recRes.success, true);
    assert.strictEqual(recRes.resolvedCount, 1);
  });

  it("URDF plugin exposes modelscript/getCadComponents with procedural meshes", async () => {
    const conn: any = { console: { info() {}, warn() {}, error() {}, log() {} } };
    const docMgr = new DocumentManager();
    const uw = new UnifiedWorkspace();
    const wm = new WorkspaceManager(conn, docMgr, uw);
    registerBuiltinLanguagePlugins({
      workspaceManager: wm as any,
      parserService: {} as any,
      documentManager: docMgr,
      connection: conn,
    } as any);
    const urdfPlugin = globalLanguageRegistry.getPluginById("urdf");
    const cadHandler = urdfPlugin?.handlers?.["modelscript/getCadComponents"];
    assert.ok(cadHandler, "urdf plugin must register modelscript/getCadComponents");

    const urdfXml = `<robot name="Arm">
      <link name="base_link">
        <visual>
          <origin xyz="0 0 0.25"/>
          <geometry><cylinder radius="0.1" length="0.5"/></geometry>
          <material name="blue"><color rgba="0.1 0.3 0.9 1.0"/></material>
        </visual>
      </link>
    </robot>`;
    const comps = await cadHandler!({} as any, { uri: "file:///test/arm.urdf", documentText: urdfXml });
    assert.strictEqual(comps.length, 1);
    assert.strictEqual(comps[0].name, "base_link");
    assert.strictEqual(comps[0].shapeType, "cylinder");
    assert.deepStrictEqual(comps[0].cad.position, [0, 0, 0.25]);
    assert.ok(comps[0].proceduralMesh.vertices.length > 0);
    assert.ok(comps[0].proceduralMesh.indices.length > 0);
  });

  it("WorkspaceManager applies extends (redeclare ...) overrides when resolving component classInstance", () => {
    const conn: any = {
      console: { info() {}, warn() {}, error() {} },
    };
    const docMgr = new DocumentManager();
    const uw = new UnifiedWorkspace();
    const wm = new WorkspaceManager(conn, docMgr, uw);

    const symbols = new Map<number, any>([
      [1, { id: 1, name: "BaseCircuit", kind: "Class", resourceId: "file:///test/Circuit.mo" }],
      [2, { id: 2, name: "DefaultResistor", kind: "Class", resourceId: "file:///test/Circuit.mo" }],
      [3, { id: 3, name: "PreciseResistor", kind: "Class", resourceId: "file:///test/Circuit.mo" }],
      [4, { id: 4, name: "SubCircuit", kind: "Class", resourceId: "file:///test/Circuit.mo" }],
      [
        10,
        {
          id: 10,
          name: "r1",
          kind: "Component",
          parentId: 1,
          resourceId: "file:///test/Circuit.mo",
          metadata: { typeSpecifier: "DefaultResistor" },
        },
      ],
      [20, { id: 20, name: "BaseCircuit", kind: "Extends", parentId: 4, resourceId: "file:///test/Circuit.mo" }],
    ]);
    const byNameMap = new Map<string, number[]>();
    const childrenOfMap = new Map<number | null, number[]>();
    for (const s of symbols.values()) {
      const nList = byNameMap.get(s.name) ?? [];
      nList.push(s.id);
      byNameMap.set(s.name, nList);
      const pKey = s.parentId ?? null;
      const cList = childrenOfMap.get(pKey) ?? [];
      cList.push(s.id);
      childrenOfMap.set(pKey, cList);
    }

    const mockIndex = { symbols, byName: byNameMap, childrenOf: childrenOfMap };
    const mockDb = {
      symbols,
      symbol: (id: number) => symbols.get(id),
      byName: (name: string) => (byNameMap.get(name) ?? []).map((id) => symbols.get(id)).filter(Boolean),
      childrenOf: (id: number) => (childrenOfMap.get(id) ?? []).map((cid) => symbols.get(cid)).filter(Boolean),
      query: (qName: string, id: number) => {
        if (qName === "typeSpecifier" && id === 10) return "DefaultResistor";
        if (qName === "classInstance" && id === 10) return 2;
        if (qName === "extendsModificationParsed" && id === 20) {
          return {
            args: [
              {
                name: "r1",
                isRedeclaration: true,
                redeclaredKind: "component",
                redeclaredTypeSpecifier: "PreciseResistor",
              },
            ],
          };
        }
        return null;
      },
      cstNode: () => null,
    };

    (wm as any).unifiedWorkspace = {
      getQueryEngine: () => ({ toQueryDB: () => mockDb }),
      getIndex: () => mockIndex,
      getDocumentText: () => "",
    };
    wm.setQueryEngine("modelica", { toQueryDB: () => mockDb } as any);

    const resolved = wm.resolveModelicaClassInstance("file:///test/Circuit.mo", "SubCircuit");
    assert.ok(resolved, "SubCircuit adapter must resolve");
    const baseExt = resolved.extendsClassInstances?.[0]?.classInstance;
    assert.ok(baseExt, "BaseCircuit extends adapter must exist");
    const r1 = baseExt.components?.find((c: any) => c.name === "r1");
    assert.ok(r1, "Component r1 must exist on inherited base adapter");
    assert.strictEqual(r1.typeSpecifier, "PreciseResistor");
    assert.strictEqual(r1.classInstance?.name, "PreciseResistor");
  });

  it("SimulinkDiagramBackend guards binary .slx / legacy .mdl files and emits minimal diff hunks for XML", async () => {
    const docs = new Map<string, string>();
    const makeBackend = () =>
      createSimulinkDiagramBackend({
        generic: { deps: { getDocumentText: (u: string) => docs.get(u) } } as any,
      } as any);

    const slxXmlUri = "file:///test/system.slx";
    const slxXml = `<ModelInformation>
  <Model>
    <System>
      <Block BlockType="Gain" Name="Gain1" SID="1"/>
      <Block BlockType="Outport" Name="Out1" SID="2"/>
      <Line>
        <P Name="SrcBlock">Gain1</P>
        <P Name="DstBlock">Out1</P>
      </Line>
    </System>
  </Model>
</ModelInformation>
`;
    docs.set(slxXmlUri, slxXml);
    const backend = makeBackend();
    const disconnectRes = await backend.applyEdits({
      uri: slxXmlUri,
      seq: 1,
      actions: [{ type: "disconnect", source: "block_Gain1", target: "block_Out1" }],
    });
    assert.strictEqual(disconnectRes.edits.length, 1);
    const edit = disconnectRes.edits[0]!;
    assert.ok(edit.range.start.line > 0, "Minimal hunk must not start at line 0 when only <Line> changed");
    assert.strictEqual(edit.newText, "");
    const updatedXml = applyEdits(slxXml, disconnectRes.edits);
    assert.ok(!updatedXml.includes("<Line>"));
    assert.ok(updatedXml.includes('<Block BlockType="Gain" Name="Gain1" SID="1"/>'));

    // Binary .slx ZIP header ("PK...") must be refused safely
    const binUri = "file:///test/archive.slx";
    docs.set(binUri, "PK\x03\x04binary-archive-payload");
    const binRes = await backend.applyEdits({
      uri: binUri,
      seq: 2,
      actions: [{ type: "connect", source: "block_A", target: "block_B" }],
    });
    assert.deepStrictEqual(binRes.edits, []);

    // Legacy curly-brace .mdl must not have XML tags injected
    const mdlUri = "file:///test/legacy.mdl";
    docs.set(mdlUri, `Model {\n  Name "legacy"\n  System {\n    Name "legacy"\n  }\n}\n`);
    const mdlRes = await backend.applyEdits({
      uri: mdlUri,
      seq: 3,
      actions: [{ type: "connect", source: "block_A", target: "block_B" }],
    });
    assert.deepStrictEqual(mdlRes.edits, []);
  });
});
