// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { Context } from "@modelscript/modelica";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { AnnotationEvaluator, clearIconCache } from "@modelscript/modelica/diagram";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import { FIELD_NAMES as modelicaFieldNames, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import { getPscadDefinitionLocation, getPscadReferences } from "@modelscript/pscad";
import { getPsseDefinition, getPsseReferences } from "@modelscript/psse";
import { getQifDefinition, getQifReferences } from "@modelscript/qif";
import { getReqifDefinition, getReqifReferences } from "@modelscript/reqif";
import { evaluateGenericDigitalThread } from "@modelscript/runtime";
import { getScadDefinition, getScadReferences } from "@modelscript/scad";
import { getStepDefinition, getStepReferences } from "@modelscript/step";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import { FIELD_NAMES as sysml2FieldNames, SYNTAX_NAMES as sysml2SyntaxNames } from "@modelscript/sysml2/parser";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { describe } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { RtmIndexEngine } from "../src/rtm/rtmIndexEngine.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";

const require = createRequire(import.meta.url);

async function create8LangHarness() {
  type DiagEntry = { severity?: number; message?: string; code?: string | number; source?: string };
  const latestDiags = new Map<string, DiagEntry[]>();
  const docMap = new Map<string, TextDocument>();

  const connection = {
    onRequest: () => {},
    onNotification: () => {},
    sendNotification: () => {},
    sendDiagnostics: (p: { uri: string; diagnostics?: DiagEntry[] }) => latestDiags.set(p.uri, p.diagnostics ?? []),
    console: {
      info: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as ConstructorParameters<typeof ParserService>[0];

  const documents = {
    get: (uri: string) => docMap.get(uri),
    all: () => Array.from(docMap.values()),
    keys: () => Array.from(docMap.keys()),
  } as unknown as ConstructorParameters<typeof DocumentManager>[0];

  const g = globalThis as Record<string, unknown>;
  g.injectPredefinedTypes = injectPredefinedTypes;
  g.clearIconCache = clearIconCache;
  g.createModelicaQueryEngine = createModelicaQueryEngine;
  g.create_modelica_query_engine = createModelicaQueryEngine;
  g.createSysML2QueryEngine = createSysML2QueryEngine;
  g.createSysML2WorkspaceIndex = createSysML2WorkspaceIndex;
  g.AnnotationEvaluator = AnnotationEvaluator;
  g.create_modelica_workspace_index = createModelicaWorkspaceIndex;
  g.createModelicaWorkspaceIndex = createModelicaWorkspaceIndex;
  g.modelicaDiagramOps = modelicaDiagramOps;
  g.sysml2DiagramOps = sysml2DiagramOps;
  g.modelicaSyntaxNames = modelicaSyntaxNames;
  g.modelicaFieldNames = modelicaFieldNames;
  g.documents = documents;
  g.sharedFs = new BrowserFileSystem();

  let parserService!: ParserService;
  const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
  const workspaceManager = new WorkspaceManager(documentManager);
  parserService = new ParserService(connection, documentManager, workspaceManager, documents);
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);

  registerBuiltinLanguagePlugins({ workspaceManager, parserService, connection });

  const moWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser: moParser, facade: moFacade } = await createWasmParser(moWasmPath, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: modelicaFieldNames,
  });
  Context.registerParser(".mo", moParser as Parameters<typeof Context.registerParser>[1]);
  parserService.registerParser("modelica", moParser, moFacade);
  workspaceManager.unifiedWorkspace.registerParser(".mo", moParser);
  workspaceManager.unifiedWorkspace.registerLanguageExtension(".mo", "modelica");
  (parserService as unknown as { ensureSharedContext(): void }).ensureSharedContext();

  const sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
  const { parser: sysmlParser, facade: sysmlFacade } = await createWasmParser(sysmlWasmPath, {
    syntaxNames: sysml2SyntaxNames,
    fieldNames: sysml2FieldNames,
  });
  parserService.registerParser("sysml2", sysmlParser, sysmlFacade);
  parserService.registerParser("sysml", sysmlParser, sysmlFacade);
  workspaceManager.unifiedWorkspace.registerParser(".sysml", sysmlParser);
  workspaceManager.unifiedWorkspace.registerParser(".sysml2", sysmlParser);
  workspaceManager.unifiedWorkspace.registerLanguageExtension(".sysml", "sysml2");
  workspaceManager.unifiedWorkspace.registerLanguageExtension(".sysml2", "sysml2");

  let nextVer = 1;
  async function openAndIndex(uri: string, languageId: string, text: string): Promise<DiagEntry[]> {
    const doc = TextDocument.create(uri, languageId, nextVer++, text);
    docMap.set(uri, doc);
    if (languageId === "modelica" || languageId === "sysml2" || languageId === "sysml") {
      await validationService.validateTextDocument(doc);
      const pending = validationService.activeValidationPromises.get(uri);
      if (pending) await pending;
    } else {
      workspaceManager.unifiedWorkspace.indexDocumentText(uri, text, languageId);
      workspaceManager.discoverThreadsForDocument(uri, text, languageId);
    }
    return latestDiags.get(uri) ?? [];
  }

  return {
    workspaceManager,
    validationService,
    openAndIndex,
  };
}

describe("TGG-Driven Cross-Language Digital Thread (8 Languages, Zero @twin Comments)", () => {
  test("1. 4-way N-ary alignment (SysML2 <-> Modelica <-> OpenSCAD <-> STEP), fieldAlias m<->mass, tag_port, and negative collision isolation", async () => {
    const { workspaceManager, openAndIndex } = await create8LangHarness();
    const uws = workspaceManager.unifiedWorkspace;

    const sysmlUri = "file:///ws/ActuatorBracket.sysml";
    const sysmlText = [
      "part def ActuatorBracket {",
      "  attribute mass : Real = 1.25;",
      "  port mount_flange;",
      "}",
      "part def ReliefValve {",
      "  attribute v : Real = 10.0;",
      "}",
    ].join("\n");

    const moUri = "file:///ws/ActuatorBracket.mo";
    const moText = [
      "model ActuatorBracket",
      "  parameter Real m = 1.25;",
      "  Real mount_flange;",
      "equation",
      "  mount_flange = m;",
      "end ActuatorBracket;",
      "",
      "model CoolantPump",
      "  parameter Real v = 25.0;",
      "end CoolantPump;",
    ].join("\n");

    const scadUri = "file:///ws/ActuatorBracket.scad";
    const scadText = [
      "module ActuatorBracket() {",
      "  mass = 1.25;",
      '  tag_port("mount_flange", "fixed") cube([10, 10, 10]);',
      "}",
      "ActuatorBracket();",
    ].join("\n");

    const stepUri = "file:///ws/ActuatorBracket.step";
    const stepText = [
      "ISO-10303-21;",
      "HEADER;",
      "ENDSEC;",
      "DATA;",
      "#10 = PRODUCT('ActuatorBracket', 'ActuatorBracket', '', (#11));",
      "#20 = PRODUCT_DEFINITION_FORMATION('', '', #10);",
      "#42 = CYLINDRICAL_SURFACE('Bore', #41, 12.5);",
      "#50 = DATUM('D1', '', #20, .F., 'A');",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");

    await openAndIndex(scadUri, "scad", scadText);
    await openAndIndex(stepUri, "step", stepText);
    await openAndIndex(moUri, "modelica", moText);
    await openAndIndex(sysmlUri, "sysml2", sysmlText);

    const uIdx = uws.getIndex();
    uws.syncTggCorrespondences(uIdx);

    // Verify 4-way alignment for ActuatorBracket across sysml2, modelica, scad, and step
    const sysmlBracket = Array.from(uIdx.symbols.values()).find(
      (s) => s.language === "sysml2" && s.name === "ActuatorBracket",
    );
    assert.ok(sysmlBracket, "SysML2 ActuatorBracket should be indexed");

    const sysmlQe = workspaceManager.getQueryEngine("sysml2");
    assert.ok(sysmlQe, "SysML2 QueryEngine should be active");
    const boundIds: Set<number> = sysmlQe.crossDomainBinding(sysmlBracket.id);
    const boundLangs = new Set(Array.from(boundIds).map((id) => uIdx.symbols.get(id)?.language));
    assert.ok(boundLangs.has("modelica"), "SysML2 ActuatorBracket should bind to Modelica ActuatorBracket");
    assert.ok(boundLangs.has("scad"), "SysML2 ActuatorBracket should bind to OpenSCAD ActuatorBracket");
    assert.ok(boundLangs.has("step"), "SysML2 ActuatorBracket should bind to STEP PRODUCT ActuatorBracket");

    // Verify contextual fieldAlias alignment: Modelica `m` <-> SysML2 `mass`
    const moMassSym = Array.from(uIdx.symbols.values()).find(
      (s) =>
        s.language === "modelica" && s.name === "m" && uIdx.symbols.get(s.parentId ?? -1)?.name === "ActuatorBracket",
    );
    assert.ok(moMassSym, "Modelica parameter m should be indexed");
    const moMassSlots = uws.tggCorrespondenceIndexer.getSlotsForSymbol(moMassSym.id);
    assert.ok(moMassSlots.size > 0, "Modelica parameter m should align with SysML2/SCAD mass via tggFieldAlias");

    // Verify OpenSCAD `tag_port("mount_flange", ...)` aligns with SysML2 `port mount_flange`
    const tagPortOffset = scadText.indexOf('tag_port("mount_flange"');
    const scadPortDef = getScadDefinition(scadText, tagPortOffset + 12, scadUri, uws);
    assert.ok(scadPortDef, "getScadDefinition on tag_port should jump to cross-language port peer");
    assert.notEqual(
      scadPortDef.uri,
      scadUri,
      "tag_port definition jump at declaration should resolve cross-language peer",
    );

    const scadRefs = getScadReferences(scadText, scadText.indexOf("ActuatorBracket();") + 3, scadUri, uws);
    const scadRefUris = new Set(scadRefs.map((r) => r.uri));
    assert.ok(scadRefUris.has(scadUri), "SCAD references should include local module decl + call");
    assert.ok(scadRefUris.has(sysmlUri) || scadRefUris.has(moUri), "SCAD references should include TGG peers");

    // Verify STEP intra-file `#10` ref jump + declaration cross-language jump
    const stepRefOffset = stepText.indexOf("#10);");
    const stepIntraDef = getStepDefinition(stepText, stepRefOffset + 1, stepUri, uws);
    assert.equal(stepIntraDef?.uri, stepUri, "Clicking #10 in STEP args should jump to #10 = PRODUCT(...) locally");
    assert.equal(stepIntraDef?.range.start.line, 4);

    const stepDeclDef = getStepDefinition(stepText, stepText.indexOf("#10 =") + 1, stepUri, uws);
    assert.ok(stepDeclDef && stepDeclDef.uri !== stepUri, "Clicking #10 at declaration should jump to TGG peer");

    // Verify negative collision isolation: CoolantPump.v (Modelica) must NOT align with ReliefValve.v (SysML2)
    const pumpV = Array.from(uIdx.symbols.values()).find(
      (s) => s.language === "modelica" && s.name === "v" && uIdx.symbols.get(s.parentId ?? -1)?.name === "CoolantPump",
    );
    assert.ok(pumpV, "CoolantPump.v should be indexed");
    assert.equal(
      uws.tggCorrespondenceIndexer.getSlotsForSymbol(pumpV.id).size,
      0,
      "Unrelated leaf variable CoolantPump.v must NOT false-positive align with ReliefValve.v",
    );
  });

  test("2. ReqIF <-> SysML2 requirement satisfaction & QIF <-> STEP #42 foreign-key alignment without annotations", async () => {
    const { workspaceManager, openAndIndex } = await create8LangHarness();
    const uws = workspaceManager.unifiedWorkspace;

    const reqifUri = "file:///ws/BracketReqs.reqif";
    const reqifText = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-1"><TITLE>BracketSpec</TITLE></REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-001" LONG-NAME="MaxBracketMass">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Bracket mass shall not exceed 1.5 kg."/>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPECIFICATIONS>
        <SPECIFICATION IDENTIFIER="SPEC-1" LONG-NAME="BracketSpec">
          <CHILDREN>
            <SPEC-HIERARCHY IDENTIFIER="SH-1">
              <OBJECT><SPEC-OBJECT-REF>REQ-001</SPEC-OBJECT-REF></OBJECT>
            </SPEC-HIERARCHY>
          </CHILDREN>
        </SPECIFICATION>
      </SPECIFICATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const stepUri = "file:///ws/Housing.step";
    const stepText = [
      "ISO-10303-21;",
      "HEADER;",
      "ENDSEC;",
      "DATA;",
      "#10 = PRODUCT('Housing', 'Housing', '', (#11));",
      "#42 = CYLINDRICAL_SURFACE('MainBore', #41, 25.0);",
      "#50 = DATUM('D1', '', #10, .F., 'A');",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");

    const qifUri = "file:///ws/HousingInspection.qif";
    const qifText = [
      'FEATURE F1 Cylinder "MainBore" size=25.0 step=#42 points=8',
      "DATUM A id=D1 feature=F1",
      'CHARACTERISTIC C1 Position "BorePosition" zone=0.05 material=MMC datums=[A] features=[F1]',
      'ACTUAL ACT1 characteristic=C1 serial="SN-01" value=0.02 status=PASS',
    ].join("\n");

    const sysmlUri = "file:///ws/VerificationModel.sysml";
    const sysmlText = [
      "requirement def MaxBracketMass {",
      "  doc /* Bracket mass shall not exceed 1.5 kg. */",
      "}",
      "requirement def BorePosition {",
      "  doc /* Bore position tolerance 0.05 mm */",
      "}",
    ].join("\n");

    await openAndIndex(reqifUri, "reqif", reqifText);
    await openAndIndex(stepUri, "step", stepText);
    await openAndIndex(qifUri, "qif", qifText);
    await openAndIndex(sysmlUri, "sysml2", sysmlText);

    // QIF `step=#42` foreign-key jump -> STEP `#42 = CYLINDRICAL_SURFACE('MainBore', ...)`
    const qifStepRefOffset = qifText.indexOf("#42") + 1;
    const qifToStepLoc = getQifDefinition(qifText, qifStepRefOffset, qifUri, uws);
    assert.ok(qifToStepLoc, "getQifDefinition on #42 should resolve foreign STEP entity");
    assert.equal(qifToStepLoc.uri, stepUri);
    assert.equal(qifToStepLoc.range.start.line, 5);

    // Reverse STEP `#42` references -> includes QIF `FEATURE F1`
    const step42Refs = getStepReferences(stepText, stepText.indexOf("#42 =") + 1, stepUri, uws);
    assert.ok(
      step42Refs.some((r) => r.uri === qifUri),
      "getStepReferences on #42 should include referencing QIF FEATURE F1",
    );

    // QIF `CHARACTERISTIC C1 "BorePosition"` -> aligns with SysML2 `requirement def BorePosition`
    const qifCharRefs = getQifReferences(qifText, qifText.indexOf("BorePosition") + 2, qifUri, uws);
    assert.ok(
      qifCharRefs.some((r) => r.uri === sysmlUri),
      "getQifReferences on BorePosition should include SysML2 requirement BorePosition",
    );

    // ReqIF `SPEC-OBJECT IDENTIFIER="REQ-001" LONG-NAME="MaxBracketMass"` -> aligns with SysML2 `MaxBracketMass`
    const reqifDeclOffset = reqifText.indexOf('IDENTIFIER="REQ-001"') + 14;
    const reqifToSysml = getReqifDefinition(reqifText, reqifDeclOffset, reqifUri, uws);
    assert.ok(reqifToSysml, "getReqifDefinition on SPEC-OBJECT should resolve SysML2 peer");
    assert.equal(reqifToSysml.uri, sysmlUri);

    const reqifRefs = getReqifReferences(reqifText, reqifDeclOffset, reqifUri, uws);
    assert.ok(
      reqifRefs.some((r) => r.uri === reqifUri),
      "ReqIF references should include SPEC-HIERARCHY ref",
    );
    assert.ok(
      reqifRefs.some((r) => r.uri === sysmlUri),
      "ReqIF references should include SysML2 MaxBracketMass",
    );

    // RTM Traceability Matrix should include TGG-derived satisfy/verify links
    const uIdx = uws.getIndex();
    const { links } = RtmIndexEngine.extractLinks(uIdx);
    assert.ok(
      links.some(
        (l) =>
          (l.sourceName === "REQ-001" || l.targetName === "REQ-001") &&
          (l.sourceName === "MaxBracketMass" || l.targetName === "MaxBracketMass"),
      ),
      "RtmIndexEngine should emit satisfy link between ReqIF REQ-001 and SysML2 MaxBracketMass",
    );
  });

  test("3. PSCAD (.pslx/.pscx) and PSS/E (.raw/.dyr) cross-language TGG resolution with Modelica & SysML2", async () => {
    const { workspaceManager, openAndIndex } = await create8LangHarness();
    const uws = workspaceManager.unifiedWorkspace;

    const pslxUri = "file:///ws/GridLib.pslx";
    const pslxText = `<project name="GridLib" type="Library">
  <definitions>
    <Definition classid="UserCmpDefn" name="GridConverter">
      <port name="v_pcc" type="Real" dir="input"/>
      <parameter name="Kp" type="Real" default="2.5"/>
    </Definition>
  </definitions>
</project>`;

    const pscxUri = "file:///ws/PlantCase.pscx";
    const pscxText = `<project name="PlantCase">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" id="u1" name="ext_lib:ExternalRegulator"/>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const rawUri = "file:///ws/ieee_mini.raw";
    const rawText = [
      "0, 100.0, 33, 0, 0, 60.0 / PSS/E-33.0",
      "IEEE MINI CASE",
      "",
      "101, 'GEN_BUS_101 ', 230.0, 3, 1, 1, 1, 1.02, 0.0",
      "0 / END OF BUS DATA, BEGIN LOAD DATA",
      "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
      "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
      "101, '1 ', 150.0, 40.0, 100.0, -50.0, 1.02, 0, 200.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 180.0, 0.0",
      "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
      "0 / END OF BRANCH DATA",
    ].join("\n");

    const dyrUri = "file:///ws/ieee_mini.dyr";
    const dyrText = "101 'SyncGenPlant' 1 6.50 0.05 1.80 0.30 /\n";

    const moUri = "file:///ws/PowerWrappers.mo";
    const moText = [
      "model GridConverter",
      "  input Real v_pcc;",
      "  parameter Real Kp = 2.5;",
      "end GridConverter;",
      "",
      "model ExternalRegulator",
      "  Real u;",
      "end ExternalRegulator;",
      "",
      "model SyncGenPlant",
      "  parameter Real H = 6.50;",
      "end SyncGenPlant;",
    ].join("\n");

    await openAndIndex(pslxUri, "pscad", pslxText);
    await openAndIndex(pscxUri, "pscad", pscxText);
    await openAndIndex(rawUri, "psse", rawText);
    await openAndIndex(dyrUri, "psse", dyrText);
    await openAndIndex(moUri, "modelica", moText);

    // PSCAD `<Definition name="GridConverter">` jumps to Modelica `model GridConverter`
    const pslxDefLoc = getPscadDefinitionLocation(
      pslxText,
      pslxText.indexOf('name="GridConverter"') + 8,
      pslxUri,
      [],
      uws,
    );
    assert.ok(pslxDefLoc, "PSCAD Definition GridConverter should jump to Modelica counterpart");
    assert.equal(pslxDefLoc.uri, moUri);

    // PSCAD `<port name="v_pcc">` inside `GridConverter` jumps to Modelica `input Real v_pcc`
    const pslxPortLoc = getPscadDefinitionLocation(pslxText, pslxText.indexOf('name="v_pcc"') + 8, pslxUri, [], uws);
    assert.ok(pslxPortLoc, "PSCAD port v_pcc should jump to aligned Modelica component");
    assert.equal(pslxPortLoc.uri, moUri);

    // PSCAD unresolved `<User name="ext_lib:ExternalRegulator"/>` jumps to Modelica `model ExternalRegulator`
    const pscxExtLoc = getPscadDefinitionLocation(
      pscxText,
      pscxText.indexOf("ExternalRegulator") + 3,
      pscxUri,
      [],
      uws,
    );
    assert.ok(pscxExtLoc, "External PSCAD <User> instance should resolve compatible Modelica class");
    assert.equal(pscxExtLoc.uri, moUri);

    const pslxRefs = getPscadReferences(pslxText, pslxText.indexOf('name="GridConverter"') + 8, pslxUri, [], uws);
    assert.ok(
      pslxRefs.some((r) => r.uri === moUri),
      "PSCAD references should include Modelica GridConverter",
    );

    // PSS/E `.dyr` clicking `'SyncGenPlant'` token (token 1) jumps to Modelica `model SyncGenPlant`
    const dyrModelLoc = getPsseDefinition(dyrText, { line: 0, character: 8 }, dyrUri, uws);
    assert.ok(dyrModelLoc, "PSS/E .dyr model token should resolve Modelica SyncGenPlant");
    assert.equal(dyrModelLoc.uri, moUri);

    const dyrRefs = getPsseReferences(dyrText, { line: 0, character: 8 }, dyrUri, uws);
    assert.ok(
      dyrRefs.some((r) => r.uri === rawUri),
      "PSS/E .dyr references should include companion .raw bus 101",
    );
    assert.ok(
      dyrRefs.some((r) => r.uri === moUri),
      "PSS/E .dyr references should include Modelica SyncGenPlant",
    );
  });

  test("4. Zero-annotation parameter drift detection via TggCorrespondenceIndexer in evaluateGenericDigitalThread", async () => {
    const { workspaceManager, openAndIndex } = await create8LangHarness();
    const uws = workspaceManager.unifiedWorkspace;

    const sysmlUri = "file:///ws/DriftBracket.sysml";
    const sysmlText = ["part def DriftBracket {", "  attribute mass : Real = 1.2;", "}"].join("\n");

    const moUri = "file:///ws/DriftBracket.mo";
    const moText = ["model DriftBracket", "  parameter Real m = 1.8;", "end DriftBracket;"].join("\n");

    await openAndIndex(sysmlUri, "sysml2", sysmlText);
    await openAndIndex(moUri, "modelica", moText);

    const result = evaluateGenericDigitalThread(
      [
        { uri: sysmlUri, fileName: "DriftBracket.sysml", content: sysmlText, lang: "sysml2" },
        { uri: moUri, fileName: "DriftBracket.mo", content: moText, lang: "modelica" },
      ],
      { symbolIndex: uws.getIndex() },
    );

    assert.equal(result.isSat, false, "Drift between SysML2 mass=1.2 and Modelica m=1.8 should be UNSAT without @twin");
    assert.ok(
      result.conflicts.some((c) => c.explanation.includes("1.2") && c.explanation.includes("1.8")),
      "Conflict explanation should report the mass=1.2 vs m=1.8 value divergence",
    );
    assert.ok(result.suggestedEdits.length > 0, "Should produce surgical writeback suggestedEdit");

    const pureTggResult = evaluateGenericDigitalThread(
      [
        {
          uri: sysmlUri,
          fileName: "DriftBracket.sysml",
          content: `${sysmlText}\n// @twin: DriftBracket.mass <-> Modelica::Fake.m`,
          lang: "sysml2",
        },
        { uri: moUri, fileName: "DriftBracket.mo", content: moText, lang: "modelica" },
      ],
      { symbolIndex: uws.getIndex(), legacyDirectivesEnabled: false },
    );
    assert.equal(
      pureTggResult.isSat,
      false,
      "Drift detection must succeed purely via TggCorrespondenceIndexer even with legacyDirectivesEnabled: false",
    );
    assert.equal(
      pureTggResult.directiveLinks.filter((d) => !d.rawText.startsWith("TGG(")).length,
      0,
      "Pure TGG mode should ignore legacy @twin comment directives",
    );
  });

  test("5. Foreign signature dot-completion projection via TggSymbolProjectionTable in LSPBridge", async () => {
    const { validationService, openAndIndex } = await create8LangHarness();

    const pslxUri = "file:///ws/ConverterLib.pslx";
    const pslxText = `<project name="ConverterLib">
  <definitions>
    <Definition classid="UserCmpDefn" name="RectifierUnit" id="rect-1">
      <ports>
        <port name="v_dc" dimension="1" type="Electrical" kind="Out"/>
      </ports>
      <parameters>
        <parameter name="k_gain" type="Real" default="1.5"/>
      </parameters>
    </Definition>
  </definitions>
</project>`;

    const moUri = "file:///ws/PlantHarness.mo";
    const moText = [
      "model PlantHarness",
      "  RectifierUnit rect;",
      "  Real y;",
      "equation",
      "  y = rect.",
      "end PlantHarness;",
    ].join("\n");

    await openAndIndex(pslxUri, "pscad", pslxText);
    await openAndIndex(moUri, "modelica", moText);

    const bridge = validationService.documentLSPBridges.get(moUri);
    assert.ok(bridge, "PlantHarness.mo should have an active LSPBridge");
    const cursorOffset = moText.indexOf("y = rect.") + "y = rect.".length;
    const completions = bridge.completion(cursorOffset, moText);
    const labels = new Set(completions.map((c) => c.label));
    assert.ok(labels.has("v_dc"), "Foreign dot-completion should project PSCAD port v_dc");
    assert.ok(labels.has("k_gain"), "Foreign dot-completion should project PSCAD parameter k_gain");
  });
});
