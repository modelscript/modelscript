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
import { getMergedPsseCase, psseLanguage } from "@modelscript/psse";
import { EqKind, UnifiedWorkspace, Variability } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerClassQueryEndpoints } from "../src/handlers/classqueryEndpoints.js";
import { registerMiscEndpoints } from "../src/handlers/miscEndpoints.js";
import { registerTreeHandlers } from "../src/handlers/treeHandler.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";
import { loadDependencyFromRegistry } from "../src/vfs/library-loader.js";

const require = createRequire(import.meta.url);

function countUnknowns(dae: any): number {
  let unknowns = 0;
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const v = dae.getVarVariability(i);
    if (v !== Variability.Parameter && v !== Variability.Constant) {
      unknowns++;
    }
  }
  return unknowns;
}

function countActiveEquations(dae: any): number {
  let eqs = 0;
  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i) || dae.isEqInitial(i) || dae.getEqKind(i) === EqKind.Connect) continue;
    eqs++;
  }
  return eqs;
}

test("Unified DSL Workspace Indexing: psseLanguage builtins, .raw/.dyr indexing, and companion linking", () => {
  const uw = new UnifiedWorkspace(psseLanguage);

  const idx = uw.getIndex();
  assert.ok(
    idx.byName.has("PSSEDynamics"),
    "PSSEDynamics root package must be materialized from psseLanguage.indexing.builtins",
  );
  assert.ok(idx.byName.has("GENROU"), "GENROU model must be materialized in UnifiedWorkspace.getIndex()");
  assert.ok(idx.byName.has("TGOV1"), "TGOV1 governor model must be materialized in UnifiedWorkspace.getIndex()");
  assert.ok(idx.byName.has("EXST1"), "EXST1 exciter model must be materialized in UnifiedWorkspace.getIndex()");
  assert.ok(idx.byName.has("REGCA1"), "REGCA1 inverter model must be materialized in UnifiedWorkspace.getIndex()");

  const rawText = [
    "0, 100.0, 33, 0, 0, 60.0 / PSS/E-33 TEST CASE",
    "TEST SYSTEM",
    "1, 'SLACK_BUS', 230.0, 3, 1, 1, 1, 1.02, 0.0",
    "0 / END OF BUS DATA, BEGIN LOAD DATA",
    "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
    "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
    "1, '1 ', 120.0, 25.0, 100.0, -50.0, 1.02, 0, 200.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 180.0, 20.0",
    "0 / END OF GENERATOR DATA",
  ].join("\n");

  const dyrText = "1 'GENROU' '1' 6.5 0.05 0.6 0.08 4.8 1.5 1.8 1.7 0.75 0.55 0.25 0.15 0.09 0.12 /\n";

  uw.setDocument("file:///grid/ieee_test.raw", rawText);
  uw.setDocument("file:///grid/ieee_test.dyr", dyrText);

  const mergedIdx = uw.getIndex();
  assert.ok(mergedIdx.byName.has("Bus_1"), "Indexed .raw bus symbol Bus_1 must appear in UnifiedWorkspace.getIndex()");
  assert.ok(
    mergedIdx.byName.has("Gen_1_1"),
    "Indexed .raw generator symbol Gen_1_1 must appear in UnifiedWorkspace.getIndex()",
  );
  assert.ok(
    mergedIdx.byName.has("Dyr_GENROU_1_1"),
    "Indexed .dyr dynamic model instance Dyr_GENROU_1_1 must appear in UnifiedWorkspace.getIndex()",
  );

  // Companion .raw <-> .dyr linking via UnifiedWorkspace.findCompanionUri + getParsedModel
  const mergedCase = getMergedPsseCase(uw, "file:///grid/ieee_test.dyr");
  assert.equal(mergedCase.buses.size, 1);
  assert.equal(mergedCase.generators.length, 1);
  assert.equal(mergedCase.dyr?.records.length, 1);
  assert.equal(mergedCase.dyr?.records[0]?.model, "GENROU");
});

test("End-to-end PSS/E-in-Modelica Morsel workflow: drag-drop (empty & existing .mo), diagram ports/icons, properties, lint, DAE balance, and transient simulation", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const latestDiags = new Map<string, any[]>();

  const connection: any = {
    onRequest: (method: string, fn: any) => handlers.set(method, fn),
    onNotification: () => {},
    sendNotification: () => {},
    sendDiagnostics: (p: any) => latestDiags.set(p.uri, p.diagnostics ?? []),
    console: {
      info: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };

  const docMap = new Map<string, TextDocument>();
  const documents: any = {
    get: (uri: string) => docMap.get(uri),
    all: () => Array.from(docMap.values()),
    keys: () => Array.from(docMap.keys()),
  };

  (globalThis as any).injectPredefinedTypes = injectPredefinedTypes;
  (globalThis as any).clearIconCache = clearIconCache;
  (globalThis as any).createModelicaQueryEngine = createModelicaQueryEngine;
  (globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
  (globalThis as any).AnnotationEvaluator = AnnotationEvaluator;
  (globalThis as any).create_modelica_workspace_index = createModelicaWorkspaceIndex;
  (globalThis as any).createModelicaWorkspaceIndex = createModelicaWorkspaceIndex;
  (globalThis as any).modelicaDiagramOps = modelicaDiagramOps;
  (globalThis as any).modelicaSyntaxNames = modelicaSyntaxNames;
  (globalThis as any).modelicaFieldNames = modelicaFieldNames;
  (globalThis as any).documents = documents;

  const sharedFs = new BrowserFileSystem();
  (globalThis as any).sharedFs = sharedFs;

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
    { modelicaDiagramOps },
  );

  registerBuiltinLanguagePlugins({ workspaceManager, parserService, connection });

  const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser, facade } = await createWasmParser(wasmPath, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: modelicaFieldNames,
  });
  Context.registerParser(".mo", parser as any);
  parserService.registerParser("modelica", parser, facade);
  workspaceManager.unifiedWorkspace.registerParser(".mo", parser);
  workspaceManager.unifiedWorkspace.registerLanguageExtension(".mo", "modelica");
  (parserService as any).ensureSharedContext();
  const loaderCtx = (parserService as any).getOrCreateLoaderContext();

  const lspCtx: any = {
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
  };

  registerTreeHandlers(lspCtx);
  registerClassQueryEndpoints(lspCtx);
  registerMiscEndpoints(lspCtx);

  // 1. Offline Add Library for PSSE-Standard-Dynamics succeeds without shadowing native ports
  await loadDependencyFromRegistry({ name: "PSSE-Standard-Dynamics", version: "1.0.0" }, loaderCtx);

  const getLibraryTree = handlers.get("modelscript/getLibraryTree")!;
  const rootTree = await getLibraryTree({ uri: "file:///workspace/GridBench.mo" });
  const psseLibNode = rootTree.find((n: any) => n.id === "__LIB__:PSSE-Standard-Dynamics");
  assert.ok(psseLibNode, "Libraries tree must expose __LIB__:PSSE-Standard-Dynamics");
  assert.equal(psseLibNode.language, "psse");

  const pssePkgChildren = await getLibraryTree({
    uri: "file:///workspace/GridBench.mo",
    parentId: "__LIB__:PSSE-Standard-Dynamics",
  });
  assert.ok(pssePkgChildren.some((n: any) => n.compositeName === "PSSEDynamics"));

  const psseModels = await getLibraryTree({
    uri: "file:///workspace/GridBench.mo",
    parentId: "PSSEDynamics",
  });
  const genrouTreeNode = psseModels.find((n: any) => n.compositeName === "PSSEDynamics.GENROU");
  assert.ok(genrouTreeNode, "PSSEDynamics tree must contain PSSEDynamics.GENROU");
  assert.ok(genrouTreeNode.iconSvg?.startsWith("<svg"), "PSSEDynamics.GENROU must carry standalone SVG icon");

  // 2. Drag-and-drop PSSEDynamics.GENROU onto an EMPTY .mo file -> auto-scaffolds model GridBench
  const docUri = "file:///workspace/GridBench.mo";
  let docVersion = 1;
  docMap.set(docUri, TextDocument.create(docUri, "modelica", docVersion, ""));
  await validationService.validateTextDocument(docMap.get(docUri)!);

  // Dropping synthetic container row must be ignored cleanly
  const containerDrop = await diagramService.getDiagramDispatch().applyEdits({
    uri: docUri,
    seq: 1,
    actions: [{ type: "addComponent", className: "__LIB__:PSSE-Standard-Dynamics", x: 0, y: 0 }],
  });
  assert.equal(containerDrop.edits.length, 0);

  // Dropping PSSEDynamics.GENROU (even if prefixed with __LIB__:PSSE-Standard-Dynamics/) onto empty .mo scaffolds model
  const emptyDrop = await diagramService.getDiagramDispatch().applyEdits({
    uri: docUri,
    seq: 2,
    actions: [
      {
        type: "addComponent",
        className: "__LIB__:PSSE-Standard-Dynamics/PSSEDynamics.GENROU",
        x: 20,
        y: -10,
      },
    ],
  });
  assert.equal(emptyDrop.edits.length, 1, "Dropping onto empty .mo must produce scaffolding TextEdit");
  let currentText = emptyDrop.edits[0]!.newText;
  assert.match(currentText, /model GridBench/);
  assert.match(currentText, /PSSEDynamics\.GENROU GENROU1/);

  docMap.set(docUri, TextDocument.create(docUri, "modelica", ++docVersion, currentText));
  await validationService.validateTextDocument(docMap.get(docUri)!);
  const pending1 = validationService.activeValidationPromises.get(docUri);
  if (pending1) await pending1;

  // 3. Drop TGOV1 and EXST1 onto the existing .mo model
  const secondDrop = await diagramService.getDiagramDispatch().applyEdits({
    uri: docUri,
    seq: 3,
    actions: [
      { type: "addComponent", className: "PSSEDynamics.TGOV1", x: -40, y: 20 },
      { type: "addComponent", className: "PSSEDynamics.EXST1", x: -40, y: -30 },
    ],
  });
  assert.ok(secondDrop.edits.length > 0, "Dropping TGOV1 and EXST1 onto existing .mo must produce TextEdits");

  // Apply line edits in reverse order
  let editedDoc = TextDocument.create(docUri, "modelica", ++docVersion, currentText);
  currentText = TextDocument.applyEdits(editedDoc, secondDrop.edits);
  docMap.set(docUri, TextDocument.create(docUri, "modelica", ++docVersion, currentText));
  await validationService.validateTextDocument(docMap.get(docUri)!);
  const pending2 = validationService.activeValidationPromises.get(docUri);
  if (pending2) await pending2;

  // Zero lint errors after dropping GENROU, TGOV1, and EXST1!
  const dropDiags = (latestDiags.get(docUri) ?? []).filter((d: any) => d.severity === 1);
  assert.deepEqual(
    dropDiags,
    [],
    `Expected 0 error diagnostics after dropping PSS/E components into Modelica, got: ${JSON.stringify(dropDiags)}`,
  );

  // 4. Diagram rendering: nodes persist with X6 icon markup AND connectable ports!
  const diagramData = await diagramService.handleGetDiagramData({
    uri: docUri,
    className: "GridBench",
    diagramType: "diagram",
    documentText: currentText,
  });
  assert.ok(diagramData, "Diagram data must be returned for GridBench");
  const nodeNames = (diagramData.nodes ?? []).map((n: any) => n.data?.componentName ?? n.id);
  assert.ok(nodeNames.includes("GENROU1"), `Diagram nodes must include GENROU1, got ${JSON.stringify(nodeNames)}`);
  assert.ok(nodeNames.includes("TGOV11"), `Diagram nodes must include TGOV11, got ${JSON.stringify(nodeNames)}`);
  assert.ok(nodeNames.includes("EXST11"), `Diagram nodes must include EXST11, got ${JSON.stringify(nodeNames)}`);

  const genNode = (diagramData.nodes ?? []).find((n: any) => (n.data?.componentName ?? n.id) === "GENROU1");
  const genPortIds = (genNode?.ports?.items ?? genNode?.ports ?? []).map((p: any) => p.id ?? p.name);
  for (const expectedPort of ["Pm_in", "Efd_in", "Vt_in", "Pe_out", "omega_out"]) {
    assert.ok(
      genPortIds.some((id: string) => id === expectedPort || id.endsWith(`.${expectedPort}`)),
      `GENROU1 diagram node must expose connectable port ${expectedPort}, got ${JSON.stringify(genPortIds)}`,
    );
  }

  // 5. Property Inspector: IEEE/WECC parameters exposed with defaults and units
  const propsData = await diagramService.getDiagramDispatch().getComponentProperties({
    uri: docUri,
    className: "GridBench",
    componentName: "GENROU1",
  });
  assert.ok(propsData, "Property inspector data must be returned for GENROU1");
  const allProps = propsData.parameters ?? [];
  const hProp = allProps.find((p: any) => p.name === "H");
  assert.ok(
    hProp,
    `Property inspector must include inertia constant H, got ${JSON.stringify(allProps.map((p: any) => p.name))}`,
  );
  assert.equal(hProp.value, "4.5");
  assert.equal(hProp.unit, "MW·s/MVA");

  // 6. Semantic Linting: valid connections + parameter overrides pass; bogus parameter triggers M2006
  const coupledModelCode = `model CoupledPsseInModelica
  PSSEDynamics.GENROU gen1(H = 6.0, D = 2.0);
  PSSEDynamics.TGOV1 gov1(R = 0.05, T1 = 0.5);
  PSSEDynamics.EXST1 avr1(KA = 100.0, TA = 0.05);
  Real loadStep;
equation
  loadStep = if time > 0.5 then 0.92 else 1.0;
  gen1.Vt_in = loadStep;
  connect(gov1.Pm_out, gen1.Pm_in);
  connect(gen1.omega_out, gov1.omega_in);
  connect(avr1.Efd_out, gen1.Efd_in);
end CoupledPsseInModelica;
`;
  const coupledUri = "file:///workspace/CoupledPsseInModelica.mo";
  docMap.set(coupledUri, TextDocument.create(coupledUri, "modelica", 1, coupledModelCode));
  await validationService.validateTextDocument(docMap.get(coupledUri)!);
  const pending3 = validationService.activeValidationPromises.get(coupledUri);
  if (pending3) await pending3;
  const coupledErrs = (latestDiags.get(coupledUri) ?? []).filter((d: any) => d.severity === 1);
  assert.deepEqual(
    coupledErrs,
    [],
    `Coupled PSS/E + Modelica model must validate with 0 errors, got: ${JSON.stringify(coupledErrs)}`,
  );

  const invalidModCode = `model InvalidPsseModifier
  PSSEDynamics.GENROU gen1(NonExistentParam = 42.0);
end InvalidPsseModifier;
`;
  const invalidUri = "file:///workspace/InvalidPsseModifier.mo";
  docMap.set(invalidUri, TextDocument.create(invalidUri, "modelica", 1, invalidModCode));
  await validationService.validateTextDocument(docMap.get(invalidUri)!);
  const pending4 = validationService.activeValidationPromises.get(invalidUri);
  if (pending4) await pending4;
  const invalidDiags = latestDiags.get(invalidUri) ?? [];
  assert.ok(
    invalidDiags.some(
      (d: any) =>
        d.severity === 1 &&
        (String(d.code).includes("2006") || String(d.code).includes("2004")) &&
        String(d.message).includes("NonExistentParam"),
    ),
    `Expected M2006 modified-element-not-found on NonExistentParam, got: ${JSON.stringify(invalidDiags)}`,
  );

  // 7. Standalone Context + DAEBuilder flattening + numerical transient simulation
  const compilerCtx = new Context(sharedFs as any);
  compilerCtx.registerLanguage("psse", psseLanguage);

  // 7a. Standalone GENROU (all input ports unconnected -> deferred defaults keep DAE square!)
  const standaloneCode = `model StandaloneGenrou
  PSSEDynamics.GENROU gen1(H = 5.0);
end StandaloneGenrou;
`;
  compilerCtx.load(standaloneCode, "StandaloneGenrou.mo");
  const standaloneDae = compilerCtx.flattenArena("StandaloneGenrou", undefined, "StandaloneGenrou.mo");
  assert.ok(standaloneDae, "StandaloneGenrou must flatten to DAEBuilder");
  assert.equal(
    countUnknowns(standaloneDae),
    countActiveEquations(standaloneDae),
    `StandaloneGenrou DAE must be square: unknowns=${countUnknowns(standaloneDae)} vs eqs=${countActiveEquations(standaloneDae)}`,
  );

  // 7b. Coupled GENROU + TGOV1 + EXST1 + Modelica disturbance equation -> square DAE + transient simulation!
  compilerCtx.load(coupledModelCode, "CoupledPsseInModelica.mo");
  const coupledDae = compilerCtx.flattenArena("CoupledPsseInModelica", undefined, "CoupledPsseInModelica.mo");
  assert.ok(coupledDae, "CoupledPsseInModelica must flatten to DAEBuilder");
  assert.equal(
    countUnknowns(coupledDae),
    countActiveEquations(coupledDae),
    `CoupledPsseInModelica DAE must be square: unknowns=${countUnknowns(coupledDae)} vs eqs=${countActiveEquations(coupledDae)}\n${compilerCtx.flatten("CoupledPsseInModelica")}`,
  );

  const simResult = simulateArena(coupledDae, {
    startTime: 0,
    stopTime: 2.0,
    step: 0.02,
    solver: "rk4",
  });
  assert.ok(simResult && simResult.t.length > 50, "Transient simulation must complete across [0, 2.0]s");
  const getCol = (...names: string[]) => {
    for (const name of names) {
      const idx = simResult.states.indexOf(name);
      if (idx >= 0) return simResult.y.map((row) => row[idx]!);
    }
    return undefined;
  };
  const omegaSeries = getCol("gen1.omega", "gen1.omega_out");
  const pmSeries = getCol("gov1.Pm", "gov1.Pm_out", "gen1.Pm_in");
  assert.ok(
    omegaSeries && omegaSeries.length === simResult.t.length,
    `Simulation must record gen1.omega trajectory, states=${JSON.stringify(simResult.states)}`,
  );
  assert.ok(
    pmSeries && pmSeries.length === simResult.t.length,
    `Simulation must record governor mechanical power trajectory, states=${JSON.stringify(simResult.states)}`,
  );
  for (const v of omegaSeries) {
    assert.ok(Number.isFinite(v), `Expected finite rotor speed, got ${v}`);
  }
  // Voltage dip at t=0.5s alters electrical air-gap power Pe and triggers rotor speed + governor response!
  const omegaInit = omegaSeries[0]!;
  const maxOmegaExcursion = Math.max(...omegaSeries.map((v: number) => Math.abs(v - omegaInit)));
  assert.ok(
    maxOmegaExcursion > 1e-4,
    `Expected non-trivial dynamic rotor speed excursion after disturbance, got max |omega(t) - omega(0)| = ${maxOmegaExcursion}`,
  );
});
