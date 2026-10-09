// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  LanguageDomainId,
  makePolyglotSymbolId,
  QueryEngine,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../src/lsp-bridge.js";
import { registerDefinitionProvider } from "../src/providers/definitionProvider.js";
import { registerHoverProvider } from "../src/providers/hoverProvider.js";

describe("Milestone 4: Cross-Language Go to Definition & Hover in LSP", () => {
  function setupPolyglotWorkspace() {
    // 1. Documents
    const modelicaUri = "file:///workspace/Drone.mo";
    const modelicaText = `model Drone
  part motor: Propulsion::Motor;
  Real speed annotation(twin="SysML2::Propulsion::Motor::rpm");
  part rotor annotation(CAD(uri="cad://motor_chassis.step", part="rotor_assembly"));
end Drone;
`;
    const modelicaDoc = TextDocument.create(modelicaUri, "modelica", 1, modelicaText);

    const sysmlUri = "file:///workspace/Propulsion.sysml";
    const sysmlText = `package Propulsion {
  part def Motor {
    attribute rpm: Real;
    attribute cadPart = "cad://motor_chassis.step#100";
  }
}
`;
    const sysmlDoc = TextDocument.create(sysmlUri, "sysml2", 1, sysmlText);

    const stepUri = "cad://motor_chassis.step";
    const stepText = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#100 = PRODUCT('motor_chassis', 'Motor CAD Model', '', (#101));
#200 = PRODUCT('rotor_assembly', 'Rotor CAD Part', '', (#201));
ENDSEC;
END-ISO-10303-21;
`;
    const stepDoc = TextDocument.create(stepUri, "step", 1, stepText);

    // 2. Polyglot Symbol Index
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const addSymbol = (entry: SymbolEntry) => {
      symbols.set(entry.id, entry);
      const existing = byName.get(entry.name) || [];
      existing.push(entry.id);
      byName.set(entry.name, existing);

      const pKey = entry.parentId ?? null;
      const ch = childrenOf.get(pKey) || [];
      ch.push(entry.id);
      childrenOf.set(pKey, ch);
    };

    // Modelica symbols (Domain 0x01)
    const mDroneId = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
    addSymbol({
      id: mDroneId,
      name: "Drone",
      kind: "Class",
      ruleName: "class_definition",
      namePath: "Drone",
      startByte: 0,
      endByte: modelicaText.length,
      parentId: null,
      exports: [],
      inherits: [],
      resourceId: modelicaUri,
      metadata: { qualifiedName: "Drone" },
    });

    const mMotorCompId = makePolyglotSymbolId(LanguageDomainId.Modelica, 2);
    const motorByteOffset = modelicaText.indexOf("part motor");
    addSymbol({
      id: mMotorCompId,
      name: "motor",
      kind: "Component",
      ruleName: "component_declaration",
      namePath: "motor",
      startByte: motorByteOffset,
      endByte: motorByteOffset + 30,
      parentId: mDroneId,
      exports: [],
      inherits: [],
      resourceId: modelicaUri,
      metadata: {
        typeSpecifier: "Propulsion::Motor",
        twin: "SysML2::Propulsion::Motor",
      },
    });

    const mSpeedId = makePolyglotSymbolId(LanguageDomainId.Modelica, 3);
    const speedByteOffset = modelicaText.indexOf("Real speed");
    addSymbol({
      id: mSpeedId,
      name: "speed",
      kind: "Component",
      ruleName: "component_declaration",
      namePath: "speed",
      startByte: speedByteOffset,
      endByte: speedByteOffset + 50,
      parentId: mDroneId,
      exports: [],
      inherits: [],
      resourceId: modelicaUri,
      metadata: {
        unit: "rad/s",
        type: "Modelica.SIunits.AngularVelocity",
        twin: "SysML2::Propulsion::Motor::rpm",
      },
    });

    // SysML v2 symbols (Domain 0x02)
    const sPropPkgId = makePolyglotSymbolId(LanguageDomainId.SysML2, 1);
    addSymbol({
      id: sPropPkgId,
      name: "Propulsion",
      kind: "Package",
      ruleName: "PackageDefinition",
      namePath: "Propulsion",
      startByte: 0,
      endByte: sysmlText.length,
      parentId: null,
      exports: [],
      inherits: [],
      resourceId: sysmlUri,
      metadata: { qualifiedName: "Propulsion" },
    });

    const sMotorDefId = makePolyglotSymbolId(LanguageDomainId.SysML2, 2);
    const motorDefStart = sysmlText.indexOf("part def Motor");
    addSymbol({
      id: sMotorDefId,
      name: "Motor",
      kind: "Definition",
      ruleName: "part def",
      namePath: "Motor",
      startByte: motorDefStart,
      endByte: motorDefStart + 14,
      parentId: sPropPkgId,
      exports: [],
      inherits: [],
      resourceId: sysmlUri,
      metadata: {
        qualifiedName: "Propulsion::Motor",
        twin: "Modelica::Drone::motor",
        cadBinding: "cad://motor_chassis.step#100",
      },
    });

    const sRpmAttrId = makePolyglotSymbolId(LanguageDomainId.SysML2, 3);
    const rpmStart = sysmlText.indexOf("attribute rpm: Real;");
    addSymbol({
      id: sRpmAttrId,
      name: "rpm",
      kind: "Attribute",
      ruleName: "attribute",
      namePath: "rpm",
      startByte: rpmStart,
      endByte: rpmStart + 20,
      parentId: sMotorDefId,
      exports: [],
      inherits: [],
      resourceId: sysmlUri,
      metadata: {
        qualifiedName: "Propulsion::Motor::rpm",
        type: "Real",
        unit: "rad/s",
      },
    });

    // STEP symbols (Domain 0x03)
    const step100Id = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 100);
    const step100Start = stepText.indexOf("#100 = PRODUCT('motor_chassis'");
    addSymbol({
      id: step100Id,
      name: "motor_chassis",
      kind: "Product",
      ruleName: "step_product",
      namePath: "motor_chassis",
      startByte: step100Start,
      endByte: step100Start + 60,
      parentId: null,
      exports: [],
      inherits: [],
      resourceId: stepUri,
      metadata: {
        entityId: 100,
        cadPart: "motor_chassis",
      },
    });

    const step200Id = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 200);
    const step200Start = stepText.indexOf("#200 = PRODUCT('rotor_assembly'");
    addSymbol({
      id: step200Id,
      name: "rotor_assembly",
      kind: "Product",
      ruleName: "step_product",
      namePath: "rotor_assembly",
      startByte: step200Start,
      endByte: step200Start + 60,
      parentId: null,
      exports: [],
      inherits: [],
      resourceId: stepUri,
      metadata: {
        entityId: 200,
        cadPart: "rotor_assembly",
      },
    });

    const unifiedIndex: SymbolIndex = { symbols, byName, childrenOf };
    const queryEngine = new QueryEngine(unifiedIndex);

    // 3. Bridges & Position Index
    const mPos = new PositionIndex(modelicaText);
    const sPos = new PositionIndex(sysmlText);
    const stepPos = new PositionIndex(stepText);

    const mBridge = new LSPBridge(unifiedIndex, queryEngine, mPos, modelicaUri);
    const sBridge = new LSPBridge(unifiedIndex, queryEngine, sPos, sysmlUri);
    const stepBridge = new LSPBridge(unifiedIndex, queryEngine, stepPos, stepUri);

    const documentLSPBridges = new Map<string, LSPBridge>([
      [modelicaUri, mBridge],
      [sysmlUri, sBridge],
      [stepUri, stepBridge],
    ]);

    const documentTrees = new Map<string, any>([
      [modelicaUri, { text: modelicaText }],
      [sysmlUri, { text: sysmlText }],
      [stepUri, { text: stepText }],
    ]);

    const docsMap = new Map<string, TextDocument>([
      [modelicaUri, modelicaDoc],
      [sysmlUri, sysmlDoc],
      [stepUri, stepDoc],
    ]);

    const documents: any = {
      get: (u: string) => docsMap.get(u),
      all: () => Array.from(docsMap.values()),
    };

    // 4. ValidationService & Digital Thread Mock
    const validationService: any = {
      documentLSPBridges,
      workspaceManager: {
        getQueryEngine: (_lang: string) => queryEngine,
        stepWorkspaceIndex: {
          fileIndices: new Map([[stepUri, unifiedIndex]]),
          getFileIndex: (_u: string) => unifiedIndex,
        },
        getThreadsForUri: (uri: string) => {
          if (uri === stepUri) {
            return [{ slot: 1, nodeId: 100 }];
          }
          return [];
        },
        findAlignedElementsBySlot: (_slot: number) => {
          return [
            {
              domain: "modelica",
              name: "motor",
              uri: modelicaUri,
              line: 2,
              column: 8,
            },
          ];
        },
      },
    };

    return {
      modelicaDoc,
      modelicaText,
      sysmlDoc,
      sysmlText,
      stepDoc,
      stepText,
      modelicaUri,
      sysmlUri,
      stepUri,
      queryEngine,
      documentLSPBridges,
      documentTrees,
      documents,
      validationService,
    };
  }

  it("Modelica -> SysML2: navigates to SysML2 part definition when clicking component implementing part usage", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    let typeDefHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: (h: any) => {
        typeDefHandler = h;
      },
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    assert.ok(defHandler);
    assert.ok(typeDefHandler);

    // 1. Click on "Propulsion::Motor" type token in Modelica
    const typeOffset = ws.modelicaText.indexOf("Propulsion::Motor");
    const pos = ws.modelicaDoc.positionAt(typeOffset);

    const result = defHandler({
      textDocument: { uri: ws.modelicaUri },
      position: pos,
    });

    assert.ok(result, "Expected a resolved cross-language definition");
    assert.strictEqual(result.uri, ws.sysmlUri);
    // Should jump to 'part def Motor' in Propulsion.sysml
    assert.strictEqual(result.range.start.line, 1); // line 2 (0-indexed line 1) in Propulsion.sysml

    // 2. Click on component "motor" itself
    const motorOffset = ws.modelicaText.indexOf("motor:");
    const motorPos = ws.modelicaDoc.positionAt(motorOffset);

    const motorResult = defHandler({
      textDocument: { uri: ws.modelicaUri },
      position: motorPos,
    });

    assert.ok(motorResult);
    assert.strictEqual(motorResult.uri, ws.sysmlUri);

    // 3. Test onTypeDefinition on "motor"
    const typeDefResult = typeDefHandler({
      textDocument: { uri: ws.modelicaUri },
      position: motorPos,
    });

    assert.ok(typeDefResult);
    assert.strictEqual(typeDefResult.uri, ws.sysmlUri);
  });

  it("Modelica -> SysML2: navigates to SysML2 attribute definition via twin annotation", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    // Click on "SysML2::Propulsion::Motor::rpm" in twin annotation
    const twinOffset = ws.modelicaText.indexOf("SysML2::Propulsion::Motor::rpm");
    const pos = ws.modelicaDoc.positionAt(twinOffset);

    const result = defHandler({
      textDocument: { uri: ws.modelicaUri },
      position: pos,
    });

    assert.ok(result);
    assert.strictEqual(result.uri, ws.sysmlUri);
    // Should point to 'attribute rpm: Real;' (line 2 in Propulsion.sysml)
    assert.strictEqual(result.range.start.line, 2);
  });

  it("SysML2 -> STEP CAD: navigates to STEP CAD entity #100", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    // Click on "#100" in cadPart = "cad://motor_chassis.step#100"
    const cadOffset = ws.sysmlText.indexOf("#100");
    const pos = ws.sysmlDoc.positionAt(cadOffset);

    const result = defHandler({
      textDocument: { uri: ws.sysmlUri },
      position: pos,
    });

    assert.ok(result, "Expected to jump from SysML2 to STEP #100");
    assert.strictEqual(result.uri, ws.stepUri);
    // Line in step file where #100 is defined
    assert.strictEqual(result.range.start.line, 4);
  });

  it("Modelica -> STEP CAD: navigates to STEP product via CAD annotation", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    // Click on "rotor_assembly" in CAD annotation
    const rotorOffset = ws.modelicaText.indexOf("rotor_assembly");
    const pos = ws.modelicaDoc.positionAt(rotorOffset);

    const result = defHandler({
      textDocument: { uri: ws.modelicaUri },
      position: pos,
    });

    assert.ok(result, "Expected to jump to STEP CAD product rotor_assembly");
    assert.strictEqual(result.uri, ws.stepUri);
    assert.strictEqual(result.range.start.line, 5); // #200 = PRODUCT('rotor_assembly'...) is on line 5
  });

  it("STEP -> Modelica: navigates from STEP entity to Modelica component via Digital Thread Hypergraph", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    // Click on "#100" inside the STEP document
    const step100Offset = ws.stepText.indexOf("#100 =");
    const pos = ws.stepDoc.positionAt(step100Offset + 1);

    const result = defHandler({
      textDocument: { uri: ws.stepUri },
      position: pos,
    });

    assert.ok(result, "Expected STEP entity to jump to aligned Modelica element");
    assert.strictEqual(result.uri, ws.modelicaUri);
    assert.strictEqual(result.range.start.line, 1); // line 2 (0-indexed line 1) in Drone.mo
  });

  it("Hover: displays Polyglot Digital Thread Twin details, resource link, and physical quantity parity", () => {
    const ws = setupPolyglotWorkspace();

    let hoverHandler: any = null;
    const connection: any = {
      onHover: (h: any) => {
        hoverHandler = h;
      },
    };

    registerHoverProvider(connection, ws.documents, ws.validationService);
    assert.ok(hoverHandler);

    // Hover over motor component in Modelica
    const motorOffset = ws.modelicaText.indexOf("motor:");
    const motorPos = ws.modelicaDoc.positionAt(motorOffset);

    const result = hoverHandler({
      textDocument: { uri: ws.modelicaUri },
      position: motorPos,
    });

    assert.ok(result);
    const md = result.contents.value;

    assert.ok(md.includes("### 🔗 Polyglot Digital Thread Twin"), "Should contain Digital Thread Twin header");
    assert.ok(md.includes("**Domain:** SysML v2"), "Should indicate SysML v2 domain");
    assert.ok(md.includes("`Motor` (`part def`)"), "Should describe counterpart Motor");
    assert.ok(md.includes("Propulsion.sysml"), "Should link to Propulsion.sysml");
  });

  it("Hover: cross-language hover directly on external reference (Propulsion::Motor)", () => {
    const ws = setupPolyglotWorkspace();

    let hoverHandler: any = null;
    const connection: any = {
      onHover: (h: any) => {
        hoverHandler = h;
      },
    };

    registerHoverProvider(connection, ws.documents, ws.validationService);

    // Hover over Propulsion::Motor in Modelica
    const typeOffset = ws.modelicaText.indexOf("Propulsion::Motor");
    const typePos = ws.modelicaDoc.positionAt(typeOffset + 3);

    const result = hoverHandler({
      textDocument: { uri: ws.modelicaUri },
      position: typePos,
    });

    assert.ok(result);
    const md = result.contents.value;

    assert.ok(md.includes("### 🔗 Polyglot Digital Thread Twin"));
    assert.ok(md.includes("SysML v2"));
    assert.ok(md.includes("Motor"));
  });

  it("CAD Product fallback: navigates to STEP PRODUCT definition even without stepWorkspaceIndex", () => {
    const ws = setupPolyglotWorkspace();
    // Simulate empty/missing stepWorkspaceIndex
    delete ws.validationService.workspaceManager.stepWorkspaceIndex;

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    const rotorOffset = ws.modelicaText.indexOf("rotor_assembly");
    const pos = ws.modelicaDoc.positionAt(rotorOffset);

    const result = defHandler({
      textDocument: { uri: ws.modelicaUri },
      position: pos,
    });

    assert.ok(result, "Expected to resolve PRODUCT('rotor_assembly') directly from open document text");
    assert.strictEqual(result.uri, ws.stepUri);
    assert.strictEqual(result.range.start.line, 5);
  });

  it("Explicit file URI: resolves cad://motor_chassis.step#200 to exact target file entity", () => {
    const ws = setupPolyglotWorkspace();

    let defHandler: any = null;
    const connection: any = {
      onDefinition: (h: any) => {
        defHandler = h;
      },
      onTypeDefinition: () => {},
    };

    registerDefinitionProvider(connection, ws.documents, ws.documentLSPBridges, ws.documentTrees, ws.validationService);

    // Click on "#100" in cad://motor_chassis.step#100
    const cadOffset = ws.sysmlText.indexOf("cad://motor_chassis.step#100");
    const pos = ws.sysmlDoc.positionAt(cadOffset + 10);

    const result = defHandler({
      textDocument: { uri: ws.sysmlUri },
      position: pos,
    });

    assert.ok(result);
    assert.strictEqual(result.uri, ws.stepUri);
    assert.strictEqual(result.range.start.line, 4);
  });
});
