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
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import { FIELD_NAMES as sysml2FieldNames, SYNTAX_NAMES as sysml2SyntaxNames } from "@modelscript/sysml2/parser";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { describe } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerClassQueryEndpoints } from "../src/handlers/classqueryEndpoints.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";

const require = createRequire(import.meta.url);

async function createPolyglotHarness() {
  type HandlerFn = (...args: unknown[]) => unknown;
  type DiagEntry = { severity?: number; message?: string; code?: string | number; source?: string };
  const handlers = new Map<string, HandlerFn>();
  const latestDiags = new Map<string, DiagEntry[]>();
  const docMap = new Map<string, TextDocument>();

  const connection = {
    onRequest: (method: string, fn: HandlerFn) => handlers.set(method, fn),
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
  const diagramService = new DiagramService(
    connection,
    documentManager,
    workspaceManager,
    validationService,
    parserService,
    { modelicaDiagramOps, sysml2DiagramOps },
  );

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

  const lspCtx = {
    connection,
    documents,
    documentManager,
    workspaceManager,
    parserService,
    validationService,
    diagramService,
    state: {
      get sharedContext() {
        return parserService.sharedContext;
      },
      get parser() {
        return parserService.parser;
      },
      get parserReady() {
        return parserService.parserReady;
      },
      get facade() {
        return parserService.facade;
      },
    },
  } as unknown as Parameters<typeof registerClassQueryEndpoints>[0];
  registerClassQueryEndpoints(lspCtx);

  let nextVer = 1;
  async function setAndValidate(uri: string, languageId: string, text: string): Promise<DiagEntry[]> {
    const doc = TextDocument.create(uri, languageId, nextVer++, text);
    docMap.set(uri, doc);
    await validationService.validateTextDocument(doc);
    const pending = validationService.activeValidationPromises.get(uri);
    if (pending) await pending;
    return latestDiags.get(uri) ?? [];
  }

  async function waitForAllPendingValidations(): Promise<void> {
    const pending = Array.from(validationService.activeValidationPromises.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  return {
    handlers,
    latestDiags,
    docMap,
    workspaceManager,
    validationService,
    diagramService,
    setAndValidate,
    waitForAllPendingValidations,
  };
}

describe("Seamless Cross-Language Linting & Diagram Integration", () => {
  test("1 & 2. SysML2 <-> Modelica bidirectional resolution clears false M2002/M2003 while keeping real errors and port mismatches", async () => {
    const h = await createPolyglotHarness();

    const propulsionUri = "file:///workspace/Propulsion.sysml";
    const propulsionText = [
      "package Propulsion {",
      "  import ScalarValues::*;",
      "  port def TorquePort {",
      "    out item torque : Real;",
      "  }",
      "  part def Motor {",
      "    attribute rpm : Real = 1500.0;",
      "    port shaft : TorquePort;",
      "  }",
      "}",
      "",
    ].join("\n");

    const powerPlantUri = "file:///workspace/PowerPlant.mo";
    const powerPlantText = [
      "package PowerPlant",
      "  connector Pin",
      "    Real v;",
      "    flow Real i;",
      "  end Pin;",
      "  model Turbine",
      "    parameter Real gain = 2.0;",
      "    Pin p;",
      "  equation",
      "    p.i = 0;",
      "  end Turbine;",
      "end PowerPlant;",
      "",
    ].join("\n");

    const sysmlDiags = await h.setAndValidate(propulsionUri, "sysml2", propulsionText);
    assert.deepEqual(
      sysmlDiags.filter((d) => d.severity === 1),
      [],
      `Propulsion.sysml should have 0 errors, got: ${JSON.stringify(sysmlDiags)}`,
    );

    const powerDiags = await h.setAndValidate(powerPlantUri, "modelica", powerPlantText);
    assert.deepEqual(
      powerDiags.filter((d) => d.severity === 1),
      [],
      `PowerPlant.mo should have 0 errors, got: ${JSON.stringify(powerDiags)}`,
    );

    // Modelica model importing & referencing SysML2 definition and member
    const droneUri = "file:///workspace/DroneDrive.mo";
    const validDroneText = [
      "model DroneDrive",
      "  import Propulsion.Motor;",
      "  Propulsion.Motor m;",
      "  Real measuredRpm;",
      "equation",
      "  measuredRpm = m.rpm;",
      "end DroneDrive;",
      "",
    ].join("\n");
    const droneDiags = await h.setAndValidate(droneUri, "modelica", validDroneText);
    assert.deepEqual(
      droneDiags.filter((d) => d.severity === 1),
      [],
      `DroneDrive.mo referencing Propulsion.Motor must have 0 errors, got: ${JSON.stringify(droneDiags)}`,
    );

    // SysML2 package importing & typing against Modelica definitions
    const archUri = "file:///workspace/SystemArch.sysml";
    const validArchText = [
      "package SystemArch {",
      "  import PowerPlant::Turbine;",
      "  import PowerPlant::Pin;",
      "  part t1 : PowerPlant::Turbine;",
      "  port p1 : PowerPlant::Pin;",
      "}",
      "",
    ].join("\n");
    const archDiags = await h.setAndValidate(archUri, "sysml2", validArchText);
    assert.deepEqual(
      archDiags.filter((d) => d.severity === 1),
      [],
      `SystemArch.sysml referencing PowerPlant::Turbine/Pin must have 0 errors, got: ${JSON.stringify(archDiags)}`,
    );

    // Requirement 2: True unresolved cross-language reference & incompatible port connection STILL emit errors
    const brokenDroneUri = "file:///workspace/BrokenDrone.mo";
    const brokenDroneText = [
      "model BrokenDrone",
      "  connector ElectricalPin",
      "    Real v;",
      "    flow Real i;",
      "  end ElectricalPin;",
      "  connector ThermalPort",
      "    Real T;",
      "    flow Real Q_flow;",
      "  end ThermalPort;",
      "  ElectricalPin ePin;",
      "  ThermalPort tPort;",
      "  NonExistentPkg.GhostType ghost;",
      "equation",
      "  connect(ePin, tPort);",
      "end BrokenDrone;",
      "",
    ].join("\n");
    const brokenDiags = await h.setAndValidate(brokenDroneUri, "modelica", brokenDroneText);
    const brokenErrors = brokenDiags.filter((d) => d.severity === 1);
    assert.ok(
      brokenErrors.some((d) => String(d.code).includes("2003") || /GhostType|NonExistentPkg/.test(d.message)),
      `Real unresolved symbol GhostType must still trigger M2003, got: ${JSON.stringify(brokenErrors)}`,
    );
    assert.ok(
      brokenErrors.some((d) => String(d.code).includes("3003") || /connect|compatible|connector/i.test(d.message)),
      `Incompatible connector connect(ePin, tPort) must still trigger M3003, got: ${JSON.stringify(brokenErrors)}`,
    );

    // Real unresolved import in SysML2 still errors
    const brokenSysmlUri = "file:///workspace/BrokenSysml.sysml";
    const brokenSysmlDiags = await h.setAndValidate(
      brokenSysmlUri,
      "sysml2",
      "package BrokenSysml {\n  import MissingExternalPkg::Nope;\n}\n",
    );
    assert.ok(
      brokenSysmlDiags.some(
        (d) => d.severity === 1 && (String(d.code).includes("2005") || /Nope|MissingExternalPkg/.test(d.message)),
      ),
      `Real unresolved SysML2 import must still error, got: ${JSON.stringify(brokenSysmlDiags)}`,
    );
  });

  test("3. Live TGG correspondence conformance reports warnings for port/param drift and error on unresolved @twin target", async () => {
    const h = await createPolyglotHarness();

    const specUri = "file:///workspace/PumpSpec.sysml";
    const specText = [
      "package PumpDomain {",
      "  import ScalarValues::*;",
      "  part def CentrifugalPump {",
      "    attribute flowRate : Real = 10.0;",
      "    port inlet;",
      "    port outlet;",
      "  }",
      "}",
      "",
    ].join("\n");
    await h.setAndValidate(specUri, "sysml2", specText);

    // Unresolved @twin target -> error (M4143 / CONFORMANCE_UNRESOLVED_TARGET)
    const missingTwinUri = "file:///workspace/MissingTwinPump.mo";
    const missingTwinText = [
      "model MissingTwinPump",
      "  Real head;",
      '  annotation(twin = "SysML2::PumpDomain::NonExistentPump");',
      "equation",
      "  head = 1.0;",
      "end MissingTwinPump;",
      "",
    ].join("\n");
    const missingTwinDiags = await h.setAndValidate(missingTwinUri, "modelica", missingTwinText);
    assert.ok(
      missingTwinDiags.some(
        (d) => d.severity === 1 && (Number(d.code) === 4143 || /twin|NonExistentPump|target/i.test(d.message)),
      ),
      `Unresolved @twin target must emit error diagnostic, got: ${JSON.stringify(missingTwinDiags)}`,
    );

    // Existing @twin target with missing ports & differing parameter -> warning (4140..4142)
    const driftUri = "file:///workspace/DriftedPump.mo";
    const driftText = [
      "model DriftedPump",
      "  parameter Real flowRate = 99.0;",
      '  annotation(twin = "SysML2::PumpDomain::CentrifugalPump");',
      "equation",
      "end DriftedPump;",
      "",
    ].join("\n");
    const driftDiags = await h.setAndValidate(driftUri, "modelica", driftText);
    const warnings = driftDiags.filter((d) => d.severity === 2);
    assert.ok(
      warnings.some(
        (d) => [4140, 4141, 4142].includes(Number(d.code)) || /port|parameter|conformance/i.test(d.message),
      ),
      `Drifted @twin model must emit TGG conformance warning, got: ${JSON.stringify(driftDiags)}`,
    );
  });

  test("4. Auto-discovered digital thread detects requirement contradiction without manual seeding and clears when resolved", async () => {
    const h = await createPolyglotHarness();

    const safetyUri = "file:///workspace/SafetySpec.sysml";
    const safetyText = [
      "package SafetySpec {",
      "  import ScalarValues::*;",
      "  part def DroneSpec {",
      "    attribute totalMass : Real = 12.0;",
      "  }",
      "  requirement def MaxMassReq {",
      "    subject drone : DroneSpec;",
      "    attribute massLimit = 5.0;",
      "    require constraint {",
      "      drone.totalMass <= massLimit",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    await h.setAndValidate(safetyUri, "sysml2", safetyText);

    const physUri = "file:///workspace/DronePhysics.mo";
    const violatingText = [
      "model DronePhysics",
      '  parameter Real totalMass = 12.0 annotation(twin = "SysML2::SafetySpec::DroneSpec::totalMass");',
      "equation",
      "end DronePhysics;",
      "",
    ].join("\n");

    // Deliberately do NOT call workspaceManager.bindThreadSlot(...) manually!
    const diagsConflict = await h.setAndValidate(physUri, "modelica", violatingText);
    await h.waitForAllPendingValidations();

    const autoThreads = h.workspaceManager.getThreadsForUri(physUri);
    assert.ok(autoThreads.length > 0, "WorkspaceManager must auto-discover digital threads without manual seeding");
    assert.ok(
      diagsConflict.some((d) => /THREAD|THEORY|CONFLICT|massLimit|5|12/i.test(`${d.code ?? ""} ${d.message}`)),
      `Expected auto-discovered digital thread conflict diagnostic when totalMass=12 > 5, got: ${JSON.stringify(diagsConflict)}`,
    );

    // Fix contradiction on both artifacts -> thread conflict must clear!
    await h.setAndValidate(
      safetyUri,
      "sysml2",
      safetyText.replace("totalMass : Real = 12.0", "totalMass : Real = 4.0"),
    );
    const clearedDiags = await h.setAndValidate(
      physUri,
      "modelica",
      violatingText.replace("totalMass = 12.0", "totalMass = 4.0"),
    );
    await h.waitForAllPendingValidations();

    assert.ok(
      !clearedDiags.some((d) => /THREAD_THEORY_CONFLICT|THREAD_CONFLICT/i.test(String(d.code ?? ""))),
      `Thread conflict diagnostic must clear when totalMass=4 <= 5, got: ${JSON.stringify(clearedDiags)}`,
    );
  });

  test("5 & 6. Live .pscx and .raw/.dyr indexing syncs UnifiedWorkspace and cascades cross-language revalidation", async () => {
    const h = await createPolyglotHarness();

    const pscxUri = "file:///workspace/Microgrid.pscx";
    const pscxText = [
      '<project name="Microgrid">',
      "  <definitions>",
      '    <Definition name="IbrInverter" classid="UserCmpDefn">',
      '      <port name="P_ref" type="Real" dir="input" />',
      '      <port name="V_pcc" type="Real" dir="output" />',
      "      <paramlist>",
      '        <param name="Vbase" type="Real" value="13.8" />',
      '        <param name="Sbase" type="Real" value="5.0" />',
      "      </paramlist>",
      "    </Definition>",
      "  </definitions>",
      "</project>",
      "",
    ].join("\n");

    const pscxDiags = await h.setAndValidate(pscxUri, "pscad", pscxText);
    assert.ok(Array.isArray(pscxDiags));

    const idxAfterPscx = h.workspaceManager.unifiedWorkspace.getIndex({ eager: true });
    assert.ok(
      idxAfterPscx.byName.has("IbrInverter"),
      "Live .pscx validation must index IbrInverter in UnifiedWorkspace",
    );

    const rawUri = "file:///workspace/Grid.raw";
    const rawText = [
      "0, 100.0, 33, 0, 0, 60.0 / PSS/E-33 TEST CASE",
      "GRID CASE",
      "1, 'SLACK', 230.0, 3, 1, 1, 1, 1.02, 0.0",
      "0 / END OF BUS DATA, BEGIN LOAD DATA",
      "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
      "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
      "1, '1 ', 120.0, 25.0, 100.0, -50.0, 1.02, 0, 200.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 180.0, 20.0",
      "0 / END OF GENERATOR DATA",
      "",
    ].join("\n");
    const dyrUri = "file:///workspace/Grid.dyr";
    const dyrText = "1 'GENROU' '1' 6.5 0.05 0.6 0.08 4.8 1.5 1.8 1.7 0.75 0.55 0.25 0.15 0.09 0.12 /\n";

    await h.setAndValidate(rawUri, "psse", rawText);
    await h.setAndValidate(dyrUri, "psse", dyrText);
    const idxAfterPsse = h.workspaceManager.unifiedWorkspace.getIndex({ eager: true });
    assert.ok(idxAfterPsse.byName.has("Bus_1"), "Live .raw validation must index Bus_1 in UnifiedWorkspace");
    assert.ok(
      idxAfterPsse.byName.has("Dyr_GENROU_1_1"),
      "Live .dyr validation must index Dyr_GENROU_1_1 in UnifiedWorkspace",
    );

    // Cascading cross-language revalidation: dependent .mo initially unresolved until SysML2 supplier defines the class
    const consumerUri = "file:///workspace/Consumer.mo";
    const consumerText = [
      "model Consumer",
      "  import NewSupplierPkg.Converter;",
      "  NewSupplierPkg.Converter conv;",
      "equation",
      "end Consumer;",
      "",
    ].join("\n");

    const beforeSupplier = await h.setAndValidate(consumerUri, "modelica", consumerText);
    assert.ok(
      beforeSupplier.some((d) => d.severity === 1),
      "Consumer.mo referencing missing NewSupplierPkg.Converter must fail before supplier is created",
    );

    // Validate NewSupplier.sysml WITHOUT manually re-validating Consumer.mo -> cascade must clear Consumer.mo error!
    const supplierUri = "file:///workspace/NewSupplier.sysml";
    await h.setAndValidate(
      supplierUri,
      "sysml2",
      "package NewSupplierPkg {\n  import ScalarValues::*;\n  part def Converter {\n    attribute eta : Real = 0.98;\n  }\n}\n",
    );
    await h.waitForAllPendingValidations();

    const afterCascade = h.latestDiags.get(consumerUri) ?? [];
    assert.deepEqual(
      afterCascade.filter((d) => d.severity === 1),
      [],
      `Cascading cross-language revalidation must clear Consumer.mo M2003 once NewSupplierPkg.Converter appears, got: ${JSON.stringify(afterCascade)}`,
    );
  });

  test("7. Bidirectional modelscript/addComponent (Modelica <-> SysML2, PSCAD/PSSE -> Modelica/.sysml) produces valid, error-free edits", async () => {
    const h = await createPolyglotHarness();
    const addComponent = h.handlers.get("modelscript/addComponent")!;
    assert.ok(addComponent, "modelscript/addComponent request handler must be registered");

    // Seed workspace definitions across Modelica, SysML2, PSCAD, and PSSE
    await h.setAndValidate(
      "file:///workspace/PowerPlant.mo",
      "modelica",
      [
        "package PowerPlant",
        "  connector Pin",
        "    Real v;",
        "    flow Real i;",
        "  end Pin;",
        "  model Turbine",
        "    parameter Real gain = 2.0;",
        "    Pin p;",
        "  equation",
        "    p.i = 0;",
        "  end Turbine;",
        "end PowerPlant;",
        "",
      ].join("\n"),
    );

    await h.setAndValidate(
      "file:///workspace/Propulsion.sysml",
      "sysml2",
      [
        "package Propulsion {",
        "  import ScalarValues::*;",
        "  part def Motor {",
        "    attribute rpm : Real = 1500.0;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    await h.setAndValidate(
      "file:///workspace/Microgrid.pscx",
      "pscad",
      [
        '<project name="Microgrid">',
        "  <definitions>",
        '    <Definition name="IbrInverter" classid="UserCmpDefn">',
        '      <port name="P_ref" type="Real" dir="input" />',
        '      <port name="V_pcc" type="Real" dir="output" />',
        "      <paramlist>",
        '        <param name="Vbase" type="Real" value="13.8" />',
        "      </paramlist>",
        "    </Definition>",
        "  </definitions>",
        "</project>",
        "",
      ].join("\n"),
    );

    await h.setAndValidate(
      "file:///workspace/Grid.raw",
      "psse",
      [
        "0, 100.0, 33, 0, 0, 60.0 / PSS/E-33",
        "CASE",
        "1, 'SLACK', 230.0, 3, 1, 1, 1, 1.02, 0.0",
        "0 / END OF BUS DATA, BEGIN LOAD DATA",
        "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
        "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
        "0 / END OF GENERATOR DATA",
        "",
      ].join("\n"),
    );

    // A. Modelica -> SysML2 (model + connector)
    const sysmlUri = "file:///workspace/TargetArch.sysml";
    let sysmlText = "package TargetArch {\n}\n";
    await h.setAndValidate(sysmlUri, "sysml2", sysmlText);

    const dropTurbineEdits = await addComponent({ uri: sysmlUri, className: "PowerPlant.Turbine", x: 10, y: 20 });
    assert.ok(dropTurbineEdits.length > 0, "Dropping PowerPlant.Turbine onto .sysml must return TextEdits");
    sysmlText = TextDocument.applyEdits(TextDocument.create(sysmlUri, "sysml2", 1, sysmlText), dropTurbineEdits);
    assert.match(sysmlText, /import PowerPlant::Turbine;/);
    assert.match(sysmlText, /part\s+turbine\d*\s*:\s*PowerPlant::Turbine;/);

    const dropPinEdits = await addComponent({ uri: sysmlUri, className: "PowerPlant.Pin", x: 30, y: 40 });
    sysmlText = TextDocument.applyEdits(TextDocument.create(sysmlUri, "sysml2", 2, sysmlText), dropPinEdits);
    assert.match(sysmlText, /import PowerPlant::Pin;/);
    assert.match(sysmlText, /port\s+pin\d*\s*:\s*PowerPlant::Pin;/);

    // PSCAD & PSSE -> SysML2 (direct name-based linking)
    const dropPscadOnSysml = await addComponent({ uri: sysmlUri, className: "Microgrid.IbrInverter", x: 50, y: 60 });
    sysmlText = TextDocument.applyEdits(TextDocument.create(sysmlUri, "sysml2", 3, sysmlText), dropPscadOnSysml);
    assert.match(sysmlText, /part\s+\S+\s*:\s*Microgrid::IbrInverter;/);
    assert.ok(!sysmlText.includes("_BlackBox"), "Must not synthesize _BlackBox stubs");

    await h.setAndValidate(sysmlUri, "sysml2", sysmlText);
    const dropPscadTwiceOnSysml = await addComponent({
      uri: sysmlUri,
      className: "Microgrid.IbrInverter",
      x: 70,
      y: 80,
    });
    sysmlText = TextDocument.applyEdits(TextDocument.create(sysmlUri, "sysml2", 4, sysmlText), dropPscadTwiceOnSysml);
    assert.equal(
      (sysmlText.match(/Microgrid::IbrInverter;/g) ?? []).length,
      2,
      "Repeated PSCAD drops onto .sysml must emit direct Microgrid::IbrInverter usages",
    );

    const dropPsseOnSysml = await addComponent({ uri: sysmlUri, className: "Bus_1", x: 90, y: 100 });
    sysmlText = TextDocument.applyEdits(TextDocument.create(sysmlUri, "sysml2", 5, sysmlText), dropPsseOnSysml);
    assert.match(sysmlText, /part\s+\S+\s*:\s*(?:GRID_CASE::)?Bus_1;/);

    const finalSysmlDiags = await h.setAndValidate(sysmlUri, "sysml2", sysmlText);
    assert.deepEqual(
      finalSysmlDiags.filter((d) => d.severity === 1),
      [],
      `TargetArch.sysml after Modelica/PSCAD/PSSE drops must have 0 errors, got: ${JSON.stringify(finalSysmlDiags)}\nText:\n${sysmlText}`,
    );

    // B. SysML2 + PSCAD + PSSE -> Modelica (populated .mo)
    const moUri = "file:///workspace/TargetSystem.mo";
    let moText = "model TargetSystem\nequation\nend TargetSystem;\n";
    await h.setAndValidate(moUri, "modelica", moText);

    const dropMotorOnMo = await addComponent({ uri: moUri, className: "Propulsion::Motor", x: 10, y: 10 });
    moText = TextDocument.applyEdits(TextDocument.create(moUri, "modelica", 1, moText), dropMotorOnMo);
    assert.match(moText, /import Propulsion\.Motor;/);
    assert.match(moText, /Propulsion\.Motor\s+\S+/);

    await h.setAndValidate(moUri, "modelica", moText);
    const dropPscadOnMo = await addComponent({ uri: moUri, className: "Microgrid.IbrInverter", x: 30, y: 20 });
    moText = TextDocument.applyEdits(TextDocument.create(moUri, "modelica", 2, moText), dropPscadOnMo);
    assert.match(moText, /Microgrid\.IbrInverter\s+\S+/);
    assert.ok(!moText.includes("_BlackBox"), "Must not synthesize _BlackBox wrappers");
    assert.ok(!moText.includes("__modelscript_blackbox"), "Must not emit __modelscript_blackbox annotations");

    await h.setAndValidate(moUri, "modelica", moText);
    const dropPsseOnMo = await addComponent({ uri: moUri, className: "Bus_1", x: 50, y: 30 });
    moText = TextDocument.applyEdits(TextDocument.create(moUri, "modelica", 3, moText), dropPsseOnMo);
    assert.match(moText, /(?:GRID_CASE\.)?Bus_1\s+\S+/);

    const finalMoDiags = await h.setAndValidate(moUri, "modelica", moText);
    assert.deepEqual(
      finalMoDiags.filter((d) => d.severity === 1),
      [],
      `TargetSystem.mo after SysML2/PSCAD/PSSE drops must have 0 errors, got: ${JSON.stringify(finalMoDiags)}\nText:\n${moText}`,
    );

    // C. SysML2 -> Empty .mo via DiagramDispatch.applyEdits
    const emptyMoUri = "file:///workspace/EmptyScaffold.mo";
    await h.setAndValidate(emptyMoUri, "modelica", "");
    const emptyMoRes = await h.diagramService.getDiagramDispatch().applyEdits({
      uri: emptyMoUri,
      seq: 1,
      actions: [{ type: "addComponent", className: "Propulsion::Motor", x: 0, y: 0 }],
    });
    assert.ok(emptyMoRes.edits.length > 0, "Empty .mo scaffold must accept SysML2 Propulsion::Motor drop");
    const scaffoldedMo = TextDocument.applyEdits(TextDocument.create(emptyMoUri, "modelica", 1, ""), emptyMoRes.edits);
    assert.match(scaffoldedMo, /model EmptyScaffold/);
    assert.match(scaffoldedMo, /import Propulsion\.Motor;/);
    assert.match(scaffoldedMo, /Propulsion\.Motor/);
    const emptyMoDiags = await h.setAndValidate(emptyMoUri, "modelica", scaffoldedMo);
    assert.deepEqual(
      emptyMoDiags.filter((d) => d.severity === 1),
      [],
      `Scaffolded EmptyScaffold.mo must have 0 errors, got: ${JSON.stringify(emptyMoDiags)}`,
    );
  });
});
