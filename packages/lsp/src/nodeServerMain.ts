// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adamsLanguage,
  AdamsWorkspaceIndex,
  getAdamsDocumentSymbols,
  getAdamsHover,
  validateAdams,
} from "@modelscript/adams";
import {
  aspenLanguage,
  AspenWorkspaceIndex,
  getAspenDocumentSymbols,
  getAspenHover,
  validateAspen,
} from "@modelscript/aspen";
import {
  autosarLanguage,
  AutosarWorkspaceIndex,
  getAutosarDocumentSymbols,
  getAutosarHover,
  validateAutosar,
} from "@modelscript/autosar";
import { cLanguage } from "@modelscript/c";
import {
  ccsdsLanguage,
  CcsdsWorkspaceIndex,
  getCcsdsDocumentSymbols,
  getCcsdsHover,
  validateCcsds,
} from "@modelscript/ccsds";
import { cfdLanguage, CfdWorkspaceIndex, getCfdDocumentSymbols, getCfdHover, validateCfd } from "@modelscript/cfd";
import csvLangFallback from "@modelscript/csv/language";
import { createWasmParser } from "@modelscript/dsl/bindings";
import {
  easy5Language,
  Easy5WorkspaceIndex,
  getEasy5DocumentSymbols,
  getEasy5Hover,
  validateEasy5,
} from "@modelscript/easy5";
import {
  eclipseLanguage,
  EclipseWorkspaceIndex,
  getEclipseDocumentSymbols,
  getEclipseHover,
  validateEclipse,
} from "@modelscript/eclipse";
import {
  energyplusLanguage,
  EnergyPlusWorkspaceIndex,
  getEnergyPlusDocumentSymbols,
  getEnergyPlusHover,
  validateEnergyPlus,
} from "@modelscript/energyplus";
import {
  epanetLanguage,
  EpanetWorkspaceIndex,
  getEpanetDocumentSymbols,
  getEpanetHover,
  validateEpanet,
} from "@modelscript/epanet";
import { feaLanguage, FeaWorkspaceIndex, getFeaDocumentSymbols, getFeaHover, validateFea } from "@modelscript/fea";
import { fortranLanguage } from "@modelscript/fortran";
import {
  gensysLanguage,
  GensysWorkspaceIndex,
  getGensysDocumentSymbols,
  getGensysHover,
  validateGensys,
} from "@modelscript/gensys";
import {
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  gtsuiteLanguage,
  GtSuiteWorkspaceIndex,
  validateGtsuite,
} from "@modelscript/gtsuite";
import {
  getIbisDocumentSymbols,
  getIbisHover,
  ibisLanguage,
  IbisWorkspaceIndex,
  validateIbis,
} from "@modelscript/ibis";
import {
  getJsbsimDocumentSymbols,
  getJsbsimHover,
  jsbsimLanguage,
  JsbsimWorkspaceIndex,
  validateJsbsim,
} from "@modelscript/jsbsim";
import { getLpsDocumentSymbols, getLpsHover, lpsLanguage, LpsWorkspaceIndex, validateLps } from "@modelscript/lps";
import {
  ArenaQueryFlattener,
  deriveSimplification,
  modelicaActionHandlers,
  modelicaLanguage,
} from "@modelscript/modelica";
import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { AnnotationEvaluator, clearIconCache } from "@modelscript/modelica/diagram";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import modelscriptLangFallback from "@modelscript/modelscript/language";
import {
  getOlgaDocumentSymbols,
  getOlgaHover,
  olgaLanguage,
  OlgaWorkspaceIndex,
  validateOlga,
} from "@modelscript/olga";
import {
  getOpenDriveDocumentSymbols,
  getOpenDriveHover,
  opendriveLanguage,
  OpenDriveWorkspaceIndex,
  validateOpenDrive,
} from "@modelscript/opendrive";
import {
  getOpenDssDocumentSymbols,
  getOpenDssHover,
  openDssLanguage,
  OpenDssWorkspaceIndex,
  validateOpenDss,
} from "@modelscript/opendss";
import {
  getOpenScenarioDocumentSymbols,
  getOpenScenarioHover,
  openScenarioLanguage,
  OpenScenarioWorkspaceIndex,
  validateOpenScenario,
} from "@modelscript/openscenario";
import { createOWL2QueryEngine, createOWL2WorkspaceIndex } from "@modelscript/owl2/factory";
import owl2LangFallback from "@modelscript/owl2/language";
import {
  getPlcopenDocumentSymbols,
  getPlcopenHover,
  plcopenLanguage,
  PlcopenWorkspaceIndex,
  validatePlcopen,
} from "@modelscript/plcopen";
import { pscadLanguage, PscadWorkspaceIndex } from "@modelscript/pscad";
import {
  getPsseDocumentSymbols,
  getPsseHover,
  psseLanguage,
  PsseWorkspaceIndex,
  validatePsse,
} from "@modelscript/psse";
import {
  getRelap5DocumentSymbols,
  getRelap5Hover,
  relap5Language,
  Relap5WorkspaceIndex,
  validateRelap5,
} from "@modelscript/relap5";
import {
  getReqifDocumentSymbols,
  getReqifHover,
  reqifLanguage,
  ReqIfWorkspaceIndex,
  validateReqif,
} from "@modelscript/reqif";
import {
  getRocetsDocumentSymbols,
  getRocetsHover,
  rocetsLanguage,
  RocetsWorkspaceIndex,
  validateRocets,
} from "@modelscript/rocets";
import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import {
  getSbmlDocumentSymbols,
  getSbmlHover,
  sbmlLanguage,
  SbmlWorkspaceIndex,
  validateSbml,
} from "@modelscript/sbml";
import scadLangFallback from "@modelscript/scad/language";
import {
  getSimaDocumentSymbols,
  getSimaHover,
  simaLanguage,
  SimaWorkspaceIndex,
  validateSima,
} from "@modelscript/sima";
import {
  getSimpackDocumentSymbols,
  getSimpackHover,
  simpackLanguage,
  SimpackWorkspaceIndex,
  validateSimpack,
} from "@modelscript/simpack";
import {
  getSimulinkDocumentSymbols,
  getSimulinkHover,
  simulinkLanguage,
  SimulinkWorkspaceIndex,
  validateSimulink,
} from "@modelscript/simulink";
import {
  getSpiceDocumentSymbols,
  getSpiceHover,
  spiceLanguage,
  SpiceWorkspaceIndex,
  validateSpice,
} from "@modelscript/spice";
import { stepLanguage, StepWorkspaceIndex } from "@modelscript/step";
import {
  getSwmmDocumentSymbols,
  getSwmmHover,
  swmmLanguage,
  SwmmWorkspaceIndex,
  validateSwmm,
} from "@modelscript/swmm";
import { extractSysML2Constraints, mapConstraintsToOptimizer } from "@modelscript/sysml2/constraint-extractor";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import {
  buildSysML2DiagramData,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
} from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import {
  getTouchstoneDocumentSymbols,
  getTouchstoneHover,
  touchstoneLanguage,
  TouchstoneWorkspaceIndex,
  validateTouchstone,
} from "@modelscript/touchstone";
import {
  getUrdfDocumentSymbols,
  getUrdfHover,
  urdfLanguage,
  UrdfWorkspaceIndex,
  validateUrdf,
} from "@modelscript/urdf";
import {
  getVerilogADocumentSymbols,
  getVerilogAHover,
  validateVerilogA,
  verilogALanguage,
  VerilogAWorkspaceIndex,
} from "@modelscript/verilog-a";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind,
  createConnection,
  InitializeParams,
  InitializeResult,
  PositionEncodingKind,
  ProposedFeatures,
  ServerCapabilities,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { registerActionRouter } from "./handlers/actionRouter.js";
import { registerAnalysisEndpoints } from "./handlers/analysisEndpoints.js";
import { registerClassQueryEndpoints } from "./handlers/classqueryEndpoints.js";
import { registerDiagramHandlers } from "./handlers/diagramHandler.js";
import { registerInteropEndpoints } from "./handlers/interopEndpoints.js";
import { registerMiscEndpoints } from "./handlers/miscEndpoints.js";
import { registerOwl2Endpoints } from "./handlers/owl2Endpoints.js";
import { registerPolyglotEndpoints } from "./handlers/polyglotEndpoints.js";
import { registerReplEndpoints } from "./handlers/replEndpoints.js";
import { registerRtmEndpoints } from "./handlers/rtmEndpoints.js";
import { registerSimulationEndpoints } from "./handlers/simulationEndpoints.js";
import { registerTreeHandlers } from "./handlers/treeHandler.js";
import { LspContext } from "./lsp-context.js";
import { registerCodeLensProvider } from "./providers/codeLensProvider.js";
import { registerColorProvider } from "./providers/colorProvider.js";
import { registerCompletionProvider } from "./providers/completionProvider.js";
import { registerDefinitionProvider } from "./providers/definitionProvider.js";
import { registerDocumentFeaturesProvider } from "./providers/documentFeaturesProvider.js";
import { registerFormattingProvider } from "./providers/formattingProvider.js";
import { registerHoverProvider } from "./providers/hoverProvider.js";
import { registerInlayHintProvider } from "./providers/inlayHintProvider.js";
import { legend, registerSemanticTokensProvider } from "./providers/semanticTokensProvider.js";
import { registerSignatureHelpProvider } from "./providers/signatureHelpProvider.js";
import { registerWorkspaceFeaturesProvider } from "./providers/workspaceFeaturesProvider.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import { DiagramService } from "./services/diagram-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { HierarchyService } from "./services/hierarchy-service.js";
import { ParserService } from "./services/parser-service.js";
import { ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";
import { computeTreeEdit } from "./utils/ast-utils.js";
import {
  getCompositeName as _getCompositeName,
  buildClassHierarchy,
  buildComponentTree,
  classKindFromEntry,
  getTreeChildrenFast,
  hasClassChildren,
  isTreeVisible,
} from "./utils/hierarchy-utils.js";
import { BrowserFileSystem } from "./vfs/browser-file-system.js";

/**
 * Starts a headless Language Server Protocol server over Node.js standard I/O, IPC, or custom streams.
 *
 * Initializes all language workspaces (Modelica, SysML v2, OWL2, STEP, PSCAD, CSV, OpenSCAD, FEA, CFD),
 * loads native WASM GLR parsers, configures the 3-tier incremental keystroke/index/semantic validation
 * pipeline, and registers all standard LSP feature providers and custom ModelScript JSON-RPC endpoints.
 *
 * @param input - Optional readable stream for custom JSON-RPC transport.
 * @param output - Optional writable stream for custom JSON-RPC transport.
 * @returns Server handle bundling the connection, document store, and core services.
 */
export function startNodeServer(input?: any, output?: any) {
  // Select transport mode based on explicit streams or CLI flags (--stdio, --node-ipc, --socket)
  let connection: any;
  if (input && output) {
    connection = createConnection(ProposedFeatures.all, input, output);
  } else if (process.argv.some((arg) => arg === "--stdio" || arg === "--node-ipc" || arg.startsWith("--socket="))) {
    connection = createConnection(ProposedFeatures.all);
  } else {
    connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  }
  const sharedFs = new BrowserFileSystem();
  globalThis.sharedFs = sharedFs;

  const documents = new TextDocuments(TextDocument);

  // Instantiate core LSP services
  const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
  const workspaceManager = new WorkspaceManager(documentManager);
  const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
  const hierarchyService = new HierarchyService(connection, documentManager, workspaceManager);
  const diagramService = new DiagramService(connection, documentManager, workspaceManager);

  /**
   * Flatten a class instance using the arena-native pipeline.
   *
   * @param classInstance - Resolved class instance descriptor containing a symbol `id` and `name`.
   * @param _context - Optional legacy context parameter (unused in arena-native mode).
   * @returns Populated `DAEBuilder` arena containing flattened variables and equations.
   */
  function flattenArenaFromInstance(classInstance: any, _context?: any): DAEBuilder {
    const className = classInstance.compositeName || classInstance.name;
    if (!className) throw new Error("Class instance has no name");

    if (!workspaceManager.globalModelicaQueryEngine) throw new Error("Query engine not initialized");
    const flattener = new ArenaQueryFlattener(workspaceManager.globalModelicaQueryEngine.toQueryDB());
    const arena = flattener.flatten(classInstance.id);
    if (!arena) throw new Error(`Failed to flatten class '${className}'`);
    return arena as any;
  }

  globalThis.flattenArenaFromInstance = flattenArenaFromInstance;
  globalThis.clearIconCache = clearIconCache;
  (globalThis as any).create_modelica_workspace_index = createModelicaWorkspaceIndex;
  (globalThis as any).create_sysml2_workspace_index = createSysML2WorkspaceIndex;
  (globalThis as any).create_owl2_workspace_index = createOWL2WorkspaceIndex;
  (globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
  (globalThis as any).create_sysml2_query_engine = createSysML2QueryEngine;
  (globalThis as any).create_owl2_query_engine = createOWL2QueryEngine;
  (globalThis as any).createModelicaWorkspaceIndex = createModelicaWorkspaceIndex;
  (globalThis as any).createSysML2WorkspaceIndex = createSysML2WorkspaceIndex;
  (globalThis as any).createOWL2WorkspaceIndex = createOWL2WorkspaceIndex;
  (globalThis as any).createModelicaQueryEngine = createModelicaQueryEngine;
  (globalThis as any).createSysML2QueryEngine = createSysML2QueryEngine;
  (globalThis as any).createOWL2QueryEngine = createOWL2QueryEngine;
  (globalThis as any).injectPredefinedTypes = injectPredefinedTypes;
  (globalThis as any).AnnotationEvaluator = AnnotationEvaluator;
  (globalThis as any).modelicaDiagramOps = modelicaDiagramOps;
  (globalThis as any).sysml2DiagramOps = { ...sysml2DiagramOps, buildSysML2DiagramData };
  (globalThis as any).extractSysML2Constraints = extractSysML2Constraints;
  (globalThis as any).mapConstraintsToOptimizer = mapConstraintsToOptimizer;
  (globalThis as any).ArenaScriptInterpreter = ArenaScriptInterpreter;
  (globalThis as any).ArenaQueryFlattener = ArenaQueryFlattener;
  (globalThis as any).deriveSimplification = deriveSimplification;

  // Expose hierarchy utility functions for extracted handlers
  globalThis.getTreeChildrenFast = getTreeChildrenFast;
  globalThis.classKindFromEntry = classKindFromEntry;
  globalThis.isTreeVisible = isTreeVisible;
  globalThis.getCompositeName = _getCompositeName;
  globalThis.hasClassChildren = hasClassChildren;
  globalThis.buildClassHierarchy = buildClassHierarchy;
  globalThis.buildComponentTree = buildComponentTree;

  // Expose constants for extracted handlers
  /** Ordered list of Modelica restricted class keywords used to classify symbol declarations. */
  const CLASS_KIND_KEYWORDS = [
    "class",
    "model",
    "record",
    "block",
    "connector",
    "type",
    "package",
    "function",
    "operator",
    "optimization",
  ];
  /** Mapping from SysML v2 CST rule names to human-readable definition kind labels. */
  const SYSML2_RULE_TO_KIND: Record<string, string> = {
    Package: "package",
    LibraryPackage: "package",
    PartDefinition: "part def",
    AttributeDefinition: "attribute def",
    PortDefinition: "port def",
    ItemDefinition: "item def",
    OccurrenceDefinition: "occurrence def",
    ConnectionDefinition: "connection def",
    InterfaceDefinition: "interface def",
    AllocationDefinition: "allocation def",
    FlowDefinition: "flow def",
    ActionDefinition: "action def",
    StateDefinition: "state def",
    CalculationDefinition: "calc def",
    ConstraintDefinition: "constraint def",
    RequirementDefinition: "requirement def",
    ConcernDefinition: "concern def",
    UseCaseDefinition: "use case def",
    CaseDefinition: "case def",
    AnalysisCaseDefinition: "analysis case def",
    VerificationCaseDefinition: "verification def",
    ViewDefinition: "view def",
    ViewpointDefinition: "viewpoint def",
    RenderingDefinition: "rendering def",
    MetadataDefinition: "metadata def",
    EnumerationDefinition: "enumeration",
  };
  /** Set of SysML v2 symbol kinds visible in the workspace library tree. */
  const SYSML2_TREE_KINDS = new Set(["Definition", "Package", "Enumeration"]);

  globalThis.CLASS_KIND_KEYWORDS = CLASS_KIND_KEYWORDS;
  globalThis.SYSML2_RULE_TO_KIND = SYSML2_RULE_TO_KIND;
  globalThis.SYSML2_TREE_KINDS = SYSML2_TREE_KINDS;

  /** Global diagram payload cache keyed by URI and version hash. */
  const diagramCache = new Map<string, { version: number | string; data: any }>();
  globalThis.diagramCache = diagramCache;

  /**
   * Computes an unsigned 32-bit DJB2 hash for cache key generation.
   */
  function simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }
  globalThis.simpleHash = simpleHash;

  const cosimSimulators = new Map<string, any>();
  const breakpointsMap = new Map<string, { line: number; column?: number | undefined }[]>();
  let debuggerResumeCallback: (() => void) | undefined;
  let currentDebugEnv: Map<string, number> | undefined;
  let stepMode = true;

  globalThis.cosimSimulators = cosimSimulators;
  globalThis.breakpointsMap = breakpointsMap;
  Object.defineProperty(globalThis, "debuggerResumeCallback", {
    get: () => debuggerResumeCallback,
    set: (v) => (debuggerResumeCallback = v),
  });
  Object.defineProperty(globalThis, "currentDebugEnv", {
    get: () => currentDebugEnv,
    set: (v) => (currentDebugEnv = v),
  });
  Object.defineProperty(globalThis, "stepMode", { get: () => stepMode, set: (v) => (stepMode = v) });

  globalThis.documents = documents;
  globalThis.connection = connection;
  globalThis.validateTextDocument = async (doc: any) => {
    await validationService.validateTextDocument(doc);
    const promise = validationService.activeValidationPromises.get(doc.uri);
    if (promise) await promise;
  };
  globalThis.runVerificationForUri = (uri: string) => validationService.runVerificationForUri(uri);
  globalThis.getSharedCstTreeWrapper = () => parserService.getSharedCstTreeWrapper();

  // Register built-in workspaces
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "modelica",
    workspaceManager.getWorkspaceIndex("modelica"),
    modelicaLangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "sysml2",
    workspaceManager.getWorkspaceIndex("sysml2"),
    sysml2LangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "sysml",
    workspaceManager.getWorkspaceIndex("sysml2"),
    sysml2LangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "owl2",
    workspaceManager.getWorkspaceIndex("owl2"),
    owl2LangFallback,
  );
  workspaceManager.setWorkspaceIndex("step", new StepWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("step", workspaceManager.getWorkspaceIndex("step"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("pscad", new PscadWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("pscad", workspaceManager.getWorkspaceIndex("pscad"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("psse", new PsseWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("psse", workspaceManager.getWorkspaceIndex("psse"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("aspen", new AspenWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("aspen", workspaceManager.getWorkspaceIndex("aspen"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("swmm", new SwmmWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("swmm", workspaceManager.getWorkspaceIndex("swmm"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("touchstone", new TouchstoneWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("touchstone", workspaceManager.getWorkspaceIndex("touchstone"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("ibis", new IbisWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("ibis", workspaceManager.getWorkspaceIndex("ibis"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("opendss", new OpenDssWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("opendss", workspaceManager.getWorkspaceIndex("opendss"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("openscenario", new OpenScenarioWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "openscenario",
    workspaceManager.getWorkspaceIndex("openscenario"),
    {
      priority: 2,
    },
  );
  workspaceManager.setWorkspaceIndex("relap5", new Relap5WorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("relap5", workspaceManager.getWorkspaceIndex("relap5"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("eclipse", new EclipseWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("eclipse", workspaceManager.getWorkspaceIndex("eclipse"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("sbml", new SbmlWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("sbml", workspaceManager.getWorkspaceIndex("sbml"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("jsbsim", new JsbsimWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("jsbsim", workspaceManager.getWorkspaceIndex("jsbsim"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("easy5", new Easy5WorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("easy5", workspaceManager.getWorkspaceIndex("easy5"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("rocets", new RocetsWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("rocets", workspaceManager.getWorkspaceIndex("rocets"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("sima", new SimaWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("sima", workspaceManager.getWorkspaceIndex("sima"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("gtsuite", new GtSuiteWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("gtsuite", workspaceManager.getWorkspaceIndex("gtsuite"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("cfd", new CfdWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("cfd", workspaceManager.getWorkspaceIndex("cfd"), {
    priority: 2,
  });
  workspaceManager.setWorkspaceIndex("fea", new FeaWorkspaceIndex());
  workspaceManager.unifiedWorkspace.registerWorkspace("fea", workspaceManager.getWorkspaceIndex("fea"), {
    priority: 2,
  });

  // Initialize built-in WASM parsers
  const require = createRequire(import.meta.url);
  const builtInPkgs = [
    { id: "modelica", pkg: "@modelscript/modelica", name: "Modelica", ext: [".mo", ".mos", ".msim"] },
    { id: "sysml", pkg: "@modelscript/sysml2", name: "SysML v2", ext: [".sysml", ".sysml2"] },
    { id: "sysml2", pkg: "@modelscript/sysml2", name: "SysML v2", ext: [".sysml", ".sysml2"] },
    { id: "step", pkg: "@modelscript/step", name: "STEP", ext: [".step", ".stp", ".p21"] },
    { id: "owl2", pkg: "@modelscript/owl2", name: "OWL2", ext: [".owl", ".owl2", ".ofn", ".ttl"] },
    { id: "csv", pkg: "@modelscript/csv", name: "CSV", ext: [".csv"] },
    { id: "pscad", pkg: "@modelscript/pscad", name: "PSCAD", ext: [".pscx", ".pslx", ".pswx", ".psmx"] },
    { id: "psse", pkg: "@modelscript/psse", name: "PSSE", ext: [".raw"] },
    { id: "scad", pkg: "@modelscript/scad", name: "OpenSCAD", ext: [".scad"] },
    { id: "modelscript", pkg: "@modelscript/modelscript", name: "ModelScript", ext: [".modelscript", ".msx"] },
    { id: "fea", pkg: "@modelscript/fea", name: "FEA", ext: [".inp", ".bdf"] },
    { id: "cfd", pkg: "@modelscript/cfd", name: "CFD", ext: [".cfg"] },
    { id: "sima", pkg: "@modelscript/sima", name: "SIMA", ext: [".inp", ".sima", ".sys", ".hyd"] },
    { id: "gtsuite", pkg: "@modelscript/gtsuite", name: "GT-SUITE", ext: [".gtm", ".gtd", ".gtx", ".gt"] },
  ];

  for (const item of builtInPkgs) {
    try {
      let wasmPath: string | undefined;
      try {
        wasmPath = require.resolve(`${item.pkg}/parser.wasm`);
      } catch {
        try {
          wasmPath = require.resolve(`${item.pkg}/dist/parser.wasm`);
        } catch {}
      }
      if (wasmPath) {
        createWasmParser(wasmPath)
          .then(({ parser, facade }) => {
            parserService.registerParser(item.id, parser, facade);
            if (item.id === "modelica") {
              (globalThis as any).modelicaParser = parser;
            }

            const wsIndex = workspaceManager.getWorkspaceIndex(item.id);
            const queryEngineGetter = () => workspaceManager.getQueryEngine(item.id) ?? undefined;
            const queryEngineSetter = (v: any) => workspaceManager.setQueryEngine(item.id, v ?? null);
            let langDef: any;
            let handlers: any;
            let actionHandlers: any;

            if (item.id === "modelica") {
              langDef = modelicaLanguage;
              handlers = modelicaLanguage.lsp?.handlers;
              actionHandlers = modelicaActionHandlers;
            } else if (item.id === "sysml2" || item.id === "sysml") {
              langDef = sysml2LangFallback;
              handlers = sysml2LangFallback.lsp?.handlers;
            } else if (item.id === "step") {
              langDef = stepLanguage;
              handlers = stepLanguage.lsp?.handlers;
            } else if (item.id === "owl2") {
              langDef = owl2LangFallback;
            } else if (item.id === "csv") {
              langDef = csvLangFallback;
            } else if (item.id === "scad") {
              langDef = scadLangFallback;
            } else if (item.id === "cfd") {
              langDef = cfdLanguage;
            } else if (item.id === "fea") {
              langDef = feaLanguage;
            } else if (item.id === "modelscript") {
              langDef = modelscriptLangFallback;
              handlers = modelscriptLangFallback.lsp?.handlers;
            }

            globalLanguageRegistry.register({
              id: item.id,
              name: item.name,
              extensions: item.ext,
              parser,
              facade,
              workspaceIndex: wsIndex,
              get queryEngine() {
                return queryEngineGetter ? queryEngineGetter() : undefined;
              },
              set queryEngine(val) {
                if (queryEngineSetter) queryEngineSetter(val);
              },
              createQueryEngine:
                item.id === "modelica"
                  ? (idx: any, tree?: any) => createModelicaQueryEngine(idx, tree)
                  : item.id === "sysml2" || item.id === "sysml"
                    ? (idx: any, tree?: any) => createSysML2QueryEngine(idx, tree)
                    : item.id === "owl2"
                      ? (idx: any, tree?: any) => createOWL2QueryEngine(idx, tree)
                      : undefined,
              languageDef: langDef,
              handlers,
              actionHandlers,
              disposables: [],
            });

            // Re-validate any open documents now that this parser is registered
            for (const doc of documents.all()) {
              validationService.validateTextDocument(doc).catch(() => {});
            }
          })
          .catch((err) => {
            connection.console.warn(`[NodeServer] Could not load ${item.name} WASM parser: ${err.message}`);
          });
      }
    } catch {
      // Optional in decoupled environments
    }
  }

  // Register built-in CFD and FEA language plugins
  try {
    globalLanguageRegistry.register({
      id: "cfd",
      name: "CFD",
      extensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
      languageDef: cfdLanguage,
      workspaceIndex: new CfdWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getCfdDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getCfdHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateCfd(text);
        },
      },
      actionHandlers: {
        lint_cfd_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseCfdConfig, lintCfdModel } = await import("@modelscript/cfd");
          const model = parseCfdConfig(text);
          return lintCfdModel(model);
        },
        export_cfd_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseCfdConfig, cfdToDae } = await import("@modelscript/cfd");
          const model = parseCfdConfig(text);
          const dae = cfdToDae(model);
          return {
            variables: dae.varCount,
            equations: dae.eqCount,
          };
        },
        export_cfd_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseCfdConfig, cfdToModelica } = await import("@modelscript/cfd");
          const model = parseCfdConfig(text);
          return cfdToModelica(model);
        },
        solve_cfd: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { executeCfdAction } = await import("@modelscript/cfd");
          return executeCfdAction("solve", { content: text });
        },
      },
      disposables: [],
    });
    globalLanguageRegistry.register({
      id: "fea",
      name: "FEA",
      extensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
      languageDef: feaLanguage,
      workspaceIndex: new FeaWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getFeaDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getFeaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateFea(text);
        },
      },
      actionHandlers: {
        lint_fea_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseFeaDeck, lintFeaModel } = await import("@modelscript/fea");
          const model = parseFeaDeck(text);
          return lintFeaModel(model);
        },
        export_fea_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseFeaDeck, feaToDae } = await import("@modelscript/fea");
          const model = parseFeaDeck(text);
          const dae = feaToDae(model);
          return {
            variables: dae.varCount,
            equations: dae.eqCount,
          };
        },
        export_fea_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseFeaDeck, feaToModelica } = await import("@modelscript/fea");
          const model = parseFeaDeck(text);
          return feaToModelica(model);
        },
        solve_fea: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { executeFeaAction } = await import("@modelscript/fea");
          return executeFeaAction("solve", { content: text });
        },
      },
      disposables: [],
    });
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register CFD/FEA plugins: ${err.message}`);
  }

  // Register built-in PSCAD language support
  try {
    globalLanguageRegistry.register({
      id: "pscad",
      name: "PSCAD",
      extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
      languageDef: pscadLanguage,
      actionHandlers: {
        lint_pscad_project: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parsePscx, lintPscx } = await import("@modelscript/pscad");
          const project = parsePscx(text);
          return lintPscx(project);
        },
        analyze_pscad_signal_ranges: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parsePscx, analyzePscadSignalRanges } = await import("@modelscript/pscad");
          return analyzePscadSignalRanges(parsePscx(text));
        },
        inspect_pscad_schematic: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parsePscx, extractEmtNetlist } = await import("@modelscript/pscad");
          const { buildPscadDiagram } = await import("@modelscript/diagram");
          const project = parsePscx(text);
          return {
            netlist: extractEmtNetlist(project),
            diagram: buildPscadDiagram(project, params?.definitionName),
          };
        },
        simulate_hybrid_emt: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { runPscadSimulationPipeline } = await import("@modelscript/pscad");
          let solverRunner: ((circuit: any, options: any) => any) | undefined;
          try {
            const simMod: any = await import("@modelscript/simulate" as string);
            if (simMod?.EmtSolver) {
              solverRunner = (circuit, options) => {
                const solver = new simMod.EmtSolver(circuit, {
                  timeStepSec: options.timeStepSec,
                  durationSec: options.durationSec,
                  threePhase: options.threePhase ?? true,
                  steadyStateInit: true,
                  maxNonlinearIterations: 6,
                });
                return solver.solve();
              };
            }
          } catch {
            // Fallback to built-in analytical trajectory if @modelscript/simulate is unavailable
          }
          return runPscadSimulationPipeline({
            documentText: text,
            runSimulation: true,
            durationSec: params?.durationSec,
            timeStepSec: params?.timeStepSec,
            verifyIeee2800: Boolean(params?.verifyIeee2800),
            exportComtrade: params?.exportComtrade ?? true,
            exportOut: params?.exportOut ?? true,
            solverRunner,
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered PSCAD language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register PSCAD plugin: ${err.message}`);
  }

  // Register EASY5 Simulation Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "easy5",
      name: "EASY5",
      extensions: [".ez5", ".ezm", ".ezd", ".eas"],
      languageDef: easy5Language,
      workspaceIndex: new Easy5WorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getEasy5DocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getEasy5Hover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateEasy5(text);
        },
      },
      actionHandlers: {
        lint_easy5_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseEasy5, lintEasy5 } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          return lintEasy5(model);
        },
        linearize_easy5_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEasy5, linearizeEasy5 } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          return linearizeEasy5(model, params?.operatingPoint);
        },
        inspect_easy5_bode: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEasy5, linearizeEasy5, computeEasy5FrequencyResponse } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          const sys = linearizeEasy5(model, params?.operatingPoint);
          return computeEasy5FrequencyResponse(sys, params?.options);
        },
        export_easy5_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseEasy5, easy5ToModelica } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          return easy5ToModelica(model);
        },
        export_easy5_ssp: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseEasy5, easy5ToSsp } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          return easy5ToSsp(model);
        },
        export_easy5_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEasy5, easy5ToDae } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          const dae = easy5ToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        inspect_easy5_diagram: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEasy5, buildEasy5DiagramData, renderEasy5SvgDiagram } = await import("@modelscript/easy5");
          const model = parseEasy5(text);
          return {
            graphData: buildEasy5DiagramData(model),
            svg: renderEasy5SvgDiagram(model),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered EASY5 language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register EASY5 plugin: ${err.message}`);
  }

  // Register NASA ROCETS Propulsion Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "rocets",
      name: "ROCETS",
      extensions: [".roc", ".deck"],
      languageDef: rocetsLanguage,
      workspaceIndex: new RocetsWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getRocetsDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getRocetsHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateRocets(text);
        },
      },
      actionHandlers: {
        lint_rocets_deck: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseRocetsDeck, lintRocets } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return lintRocets(model);
        },
        solve_rocets_balance: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRocetsDeck, solveRocetsBalance } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return solveRocetsBalance(model, params?.options);
        },
        simulate_rocets_transient: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRocetsDeck, simulateRocetsTransient } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return simulateRocetsTransient(model, params?.options);
        },
        export_rocets_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseRocetsDeck, rocetsToModelica } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return rocetsToModelica(model);
        },
        export_rocets_ssp: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseRocetsDeck, rocetsToSsp } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return rocetsToSsp(model);
        },
        export_rocets_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRocetsDeck, rocetsToDae } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          const dae = rocetsToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        inspect_rocets_diagram: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRocetsDeck, buildRocetsDiagramData, renderRocetsPidSvg } = await import("@modelscript/rocets");
          const model = parseRocetsDeck(text);
          return {
            graphData: buildRocetsDiagramData(model),
            svg: renderRocetsPidSvg(model),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered ROCETS language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register ROCETS plugin: ${err.message}`);
  }

  // Register PSS/E RAW Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "psse",
      name: "PSSE",
      extensions: [".raw", ".dyr", ".sav"],
      languageDef: psseLanguage,
      workspaceIndex: new PsseWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getPsseDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getPsseHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validatePsse(text);
        },
      },
      actionHandlers: {
        lint_psse_case: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseRaw, lintPsse } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          return lintPsse(parsed);
        },
        extract_powerflow_netlist: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRaw, extractPowerFlowNetlist } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          return extractPowerFlowNetlist(parsed);
        },
        export_psse_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseRaw, psseToModelica } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          return psseToModelica(parsed);
        },
        export_psse_pscad: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRaw, psseToEmtNetlist } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          return psseToEmtNetlist(parsed);
        },
        export_psse_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRaw, lowerPsseToDae } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          const dae = lowerPsseToDae(parsed);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        solve_powerflow: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRaw, solvePowerFlow } = await import("@modelscript/psse");
          const parsed = parseRaw(text);
          return solvePowerFlow(parsed, params);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered PSS/E language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register PSS/E plugin: ${err.message}`);
  }

  // Register Aspen Plus Chemical Process Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "aspen",
      name: "Aspen",
      extensions: [".in", ".inp", ".bkp"],
      languageDef: aspenLanguage,
      workspaceIndex: new AspenWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getAspenDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getAspenHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateAspen(text);
        },
      },
      actionHandlers: {
        lint_aspen_flowsheet: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseAspen, lintAspen } = await import("@modelscript/aspen");
          const deck = parseAspen(text);
          return lintAspen(deck);
        },
        aspen_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAspen, lowerAspenToDae } = await import("@modelscript/aspen");
          const deck = parseAspen(text);
          const dae = lowerAspenToDae(deck);
          return {
            modelName: "AspenFlowsheet",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        aspen_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseAspen, aspenToModelica } = await import("@modelscript/aspen");
          const deck = parseAspen(text);
          return aspenToModelica(deck);
        },
        aspen_solve_flash: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAspen, solveFlashRachfordRice } = await import("@modelscript/aspen");
          const deck = parseAspen(text);
          const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
          const s = deck.streams.get(streamId);
          const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
          const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
          return solveFlashRachfordRice({
            temperature: s?.temperature ?? 75.0,
            pressure: s?.pressure ?? 1.2,
            components: comps,
            moleFractions: fracs,
            totalFlow: s?.moleFlow ?? 100.0,
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered Aspen language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register Aspen plugin: ${err.message}`);
  }

  // Register US EPA SWMM Stormwater & Wastewater Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "swmm",
      name: "SWMM",
      extensions: [".inp"],
      languageDef: swmmLanguage,
      workspaceIndex: new SwmmWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getSwmmDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getSwmmHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSwmm(text);
        },
      },
      actionHandlers: {
        lint_swmm_network: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSwmm, lintSwmm } = await import("@modelscript/swmm");
          const deck = parseSwmm(text);
          return lintSwmm(deck);
        },
        swmm_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSwmm, lowerSwmmToDae } = await import("@modelscript/swmm");
          const deck = parseSwmm(text);
          const dae = lowerSwmmToDae(deck);
          return {
            modelName: "StormwaterNetwork",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        swmm_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSwmm, swmmToModelica } = await import("@modelscript/swmm");
          const deck = parseSwmm(text);
          return swmmToModelica(deck);
        },
        swmm_route_flow: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSwmm, routeNetworkFlow } = await import("@modelscript/swmm");
          const deck = parseSwmm(text);
          return routeNetworkFlow(deck);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered SWMM language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register SWMM plugin: ${err.message}`);
  }

  // Register Touchstone N-Port RF & Signal Integrity Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "touchstone",
      name: "Touchstone",
      extensions: [
        ".s1p",
        ".s2p",
        ".s3p",
        ".s4p",
        ".s5p",
        ".s6p",
        ".s7p",
        ".s8p",
        ".s9p",
        ".s10p",
        ".s12p",
        ".s16p",
        ".s24p",
        ".s32p",
        ".ts",
      ],
      languageDef: touchstoneLanguage,
      workspaceIndex: new TouchstoneWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getTouchstoneDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getTouchstoneHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateTouchstone(text);
        },
      },
      actionHandlers: {
        lint_touchstone: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseTouchstone, lintTouchstone } = await import("@modelscript/touchstone");
          const deck = parseTouchstone(text);
          return lintTouchstone(deck);
        },
        touchstone_passivity: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseTouchstone, verifyPassivity } = await import("@modelscript/touchstone");
          const deck = parseTouchstone(text);
          return verifyPassivity(deck);
        },
        touchstone_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseTouchstone, lowerTouchstoneToDae } = await import("@modelscript/touchstone");
          const deck = parseTouchstone(text);
          const dae = lowerTouchstoneToDae(deck);
          return {
            modelName: "NPortMacromodel",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        touchstone_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseTouchstone, touchstoneToModelica } = await import("@modelscript/touchstone");
          const deck = parseTouchstone(text);
          return touchstoneToModelica(deck);
        },
        touchstone_fit_macromodel: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseTouchstone, fitStateSpaceModel } = await import("@modelscript/touchstone");
          const deck = parseTouchstone(text);
          return fitStateSpaceModel(deck);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered Touchstone language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register Touchstone plugin: ${err.message}`);
  }

  // Register IBIS I/O Buffer Specification Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "ibis",
      name: "IBIS",
      extensions: [".ibs"],
      languageDef: ibisLanguage,
      workspaceIndex: new IbisWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getIbisDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getIbisHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateIbis(text);
        },
      },
      actionHandlers: {
        lint_ibis: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseIbis, lintIbis } = await import("@modelscript/ibis");
          const deck = parseIbis(text);
          return lintIbis(deck);
        },
        ibis_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseIbis, lowerIbisToDae } = await import("@modelscript/ibis");
          const deck = parseIbis(text);
          const dae = lowerIbisToDae(deck);
          return {
            modelName: "IbisBufferModule",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        ibis_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseIbis, ibisToModelica } = await import("@modelscript/ibis");
          const deck = parseIbis(text);
          return ibisToModelica(deck);
        },
        ibis_eval_buffer: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseIbis, calculateOutputResistance, evaluateBufferCurrent } = await import("@modelscript/ibis");
          const deck = parseIbis(text);
          const firstMod = deck.models.values().next().value;
          if (!firstMod) return null;
          return {
            modelName: firstMod.name,
            resistance: calculateOutputResistance(firstMod),
            currentSample: evaluateBufferCurrent(firstMod, 1.5, 1),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered IBIS language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register IBIS plugin: ${err.message}`);
  }

  // Register OLGA Multiphase Dynamic Flow Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "olga",
      name: "OLGA",
      extensions: [".genkey", ".key", ".opi", ".olga", ".pvt", ".tab"],
      languageDef: olgaLanguage,
      workspaceIndex: new OlgaWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getOlgaDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getOlgaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateOlga(text);
        },
      },
      actionHandlers: {
        lint_olga_case: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseOlga, lintOlgaModel } = await import("@modelscript/olga");
          const model = parseOlga(text);
          return lintOlgaModel(model);
        },
        simulate_drift_flux: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOlga, simulateDriftFlux } = await import("@modelscript/olga");
          const model = parseOlga(text);
          return simulateDriftFlux(model, { durationSeconds: params?.durationSeconds });
        },
        project_to_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseOlga, olgaToSysml2 } = await import("@modelscript/olga");
          const model = parseOlga(text);
          return olgaToSysml2(model);
        },
        export_olga_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOlga, lowerOlgaToDae } = await import("@modelscript/olga");
          const model = parseOlga(text);
          const dae = lowerOlgaToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        verify_flow_assurance: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOlga, simulateDriftFlux, verifyFlowAssuranceTrajectory } = await import("@modelscript/olga");
          const model = parseOlga(text);
          const trajectory = simulateDriftFlux(model);
          return verifyFlowAssuranceTrajectory(trajectory);
        },
        inspect_olga_elevation_profile: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOlga, simulateDriftFlux } = await import("@modelscript/olga");
          const { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } = await import("@modelscript/diagram");
          const model = parseOlga(text);
          const trajectory = simulateDriftFlux(model, { durationSeconds: 60 });
          return {
            schematicSvg: renderOlgaSchematicSvg(model),
            elevationProfileSvg: renderOlgaElevationProfileSvg(model, trajectory),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered OLGA language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register OLGA plugin: ${err.message}`);
  }

  // Register PipelineStudio (LPS) Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "lps",
      name: "PipelineStudio",
      extensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
      languageDef: lpsLanguage,
      workspaceIndex: new LpsWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getLpsDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getLpsHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateLps(text);
        },
      },
      actionHandlers: {
        lint_lps_network: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseLps, lintLpsModel } = await import("@modelscript/lps");
          const model = parseLps(text);
          return lintLpsModel(model);
        },
        solve_lps_steady: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseLps, SteadyNetworkSolver, LinePackEngine, PipelineVerifier } = await import("@modelscript/lps");
          const model = parseLps(text);
          const steady = SteadyNetworkSolver.solve(model);
          const analysis = LinePackEngine.analyze(model, steady);
          const verification = PipelineVerifier.verifySteady(model, steady);
          return { steady, analysis, verification };
        },
        simulate_lps_transient: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseLps, GasEulerDaeSolver } = await import("@modelscript/lps");
          const model = parseLps(text);
          return GasEulerDaeSolver.simulate(model, { durationSeconds: params?.durationSeconds });
        },
        project_lps_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseLps, lpsToSysml2 } = await import("@modelscript/lps");
          const model = parseLps(text);
          return lpsToSysml2(model);
        },
        export_lps_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseLps, lpsToModelica } = await import("@modelscript/lps");
          const model = parseLps(text);
          return lpsToModelica(model);
        },
        export_lps_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseLps, lowerLpsToDae } = await import("@modelscript/lps");
          const model = parseLps(text);
          const dae = lowerLpsToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered PipelineStudio (LPS) language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register PipelineStudio plugin: ${err.message}`);
  }

  // Register GENSYS Railway Dynamics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "gensys",
      name: "GENSYS",
      extensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel", ".ins"],
      languageDef: gensysLanguage,
      workspaceIndex: new GensysWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getGensysDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getGensysHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateGensys(text);
        },
      },
      actionHandlers: {
        lint_gensys_deck: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseGensysDeck, lintGensysModel } = await import("@modelscript/gensys");
          const model = parseGensysDeck(text);
          return lintGensysModel(model);
        },
        export_gensys_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseGensysDeck, gensysToModelica } = await import("@modelscript/gensys");
          const model = parseGensysDeck(text);
          return gensysToModelica(model);
        },
        evaluate_en14363: async (_ctx: any, params: any) => {
          const { evaluateEn14363 } = await import("@modelscript/gensys");
          return evaluateEn14363(params);
        },
        export_gensys_fmu: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseGensysDeck } = await import("@modelscript/gensys");
          const { exportGensysFmu } = await import("@modelscript/exchange");
          const model = parseGensysDeck(text);
          return exportGensysFmu(model, params?.options);
        },
        simulate_gensys: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseGensysDeck, lowerGensysToDae } = await import("@modelscript/gensys");
          const { initBltWasm } = await import("@modelscript/runtime");
          const { simulateArena } = await import("@modelscript/simulate");
          await initBltWasm();
          const model = parseGensysDeck(text);
          const dae = lowerGensysToDae(model);
          return simulateArena(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? 5.0,
            step: params?.step ?? 0.005,
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered GENSYS language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register GENSYS plugin: ${err.message}`);
  }

  // Register SIMPACK Multibody Dynamics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "simpack",
      name: "SIMPACK",
      extensions: [".spck", ".sim", ".mbs"],
      languageDef: simpackLanguage,
      workspaceIndex: new SimpackWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getSimpackDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getSimpackHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSimpack(text);
        },
      },
      actionHandlers: {
        lint_simpack_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSpckXml, parseSimDeck, lintSimpackModel } = await import("@modelscript/simpack");
          const isXml = text.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
          return lintSimpackModel(model);
        },
        analyze_mobility: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpckXml, parseSimDeck, analyzeMobility } = await import("@modelscript/simpack");
          const isXml = text.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
          return analyzeMobility(model);
        },
        export_simpack_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSpckXml, parseSimDeck, simpackToModelica } = await import("@modelscript/simpack");
          const isXml = text.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
          return simpackToModelica(model);
        },
        export_simpack_fmu: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpckXml, parseSimDeck } = await import("@modelscript/simpack");
          const { exportSimpackFmu } = await import("@modelscript/exchange");
          const isXml = text.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
          return exportSimpackFmu(model, params?.options);
        },
        simulate_simpack: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpckXml, parseSimDeck, lowerSimpackToDae } = await import("@modelscript/simpack");
          const { initBltWasm } = await import("@modelscript/runtime");
          const { simulateArena } = await import("@modelscript/simulate");
          await initBltWasm();
          const isXml = text.trimStart().startsWith("<");
          const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
          const dae = lowerSimpackToDae(model);
          return simulateArena(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? 5.0,
            step: params?.step ?? 0.005,
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered SIMPACK language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register SIMPACK plugin: ${err.message}`);
  }

  // Register OMG ReqIF Requirements Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "reqif",
      name: "ReqIF",
      extensions: [".reqif", ".reqifz"],
      languageDef: reqifLanguage,
      workspaceIndex: new ReqIfWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getReqifDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          let line = 0;
          let lastLineStart = 0;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === "\n") {
              line++;
              lastLineStart = i + 1;
            }
          }
          return getReqifHover(text, line, offset - lastLineStart);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateReqif(text);
        },
      },
      actionHandlers: {
        lint_reqif: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseReqIf, lintReqIf } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return lintReqIf(doc);
        },
        verify_reqif_entailment: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseReqIf, verifyReqIfEntailment } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return verifyReqIfEntailment(doc);
        },
        export_reqif_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseReqIf, reqifToSysml2 } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return reqifToSysml2(doc);
        },
        export_reqif_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseReqIf, reqifToModelicaVerifier } = await import("@modelscript/reqif");
          const doc = parseReqIf(text);
          return reqifToModelicaVerifier(doc);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered OMG ReqIF language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register ReqIF plugin: ${err.message}`);
  }

  // Register SPICE Analog Netlist Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "spice",
      name: "SPICE",
      extensions: [".cir", ".sp", ".net", ".lib"],
      languageDef: spiceLanguage,
      workspaceIndex: new SpiceWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getSpiceDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          let line = 0;
          let lastLineStart = 0;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === "\n") {
              line++;
              lastLineStart = i + 1;
            }
          }
          return getSpiceHover(text, line, offset - lastLineStart);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSpice(text);
        },
      },
      actionHandlers: {
        spice_run_op: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveOp } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveOp(circuit);
        },
        spice_run_tran: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveTran } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveTran(circuit, params);
        },
        spice_run_ac: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, solveAc } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return solveAc(circuit, params);
        },
        export_spice_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSpice, spiceToModelica } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return spiceToModelica(circuit);
        },
        export_spice_ecad: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSpice, spiceToNetlistGraph } = await import("@modelscript/spice");
          const circuit = parseSpice(text);
          return spiceToNetlistGraph(circuit);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered SPICE language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register SPICE plugin: ${err.message}`);
  }

  // Register MSC Adams Multibody Dynamics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "adams",
      name: "MSC Adams",
      extensions: [".adm", ".cmd", ".acf"],
      languageDef: adamsLanguage,
      workspaceIndex: new AdamsWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getAdamsDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getAdamsHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateAdams(text);
        },
      },
      actionHandlers: {
        lint_adams_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseAdams, lintAdamsModel } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return lintAdamsModel(dataset);
        },
        analyze_adams_mobility: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, analyzeAdamsMobility } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return analyzeAdamsMobility(dataset);
        },
        export_adams_simpack: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, adamsToSimpack } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return adamsToSimpack(dataset);
        },
        export_adams_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseAdams, adamsToModelica } = await import("@modelscript/adams");
          const dataset = parseAdams(text);
          return adamsToModelica(dataset);
        },
        simulate_adams: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseAdams, lowerAdamsToDae } = await import("@modelscript/adams");
          const { initBltWasm } = await import("@modelscript/runtime");
          const { simulateArena } = await import("@modelscript/simulate");
          await initBltWasm();
          const dataset = parseAdams(text);
          const dae = lowerAdamsToDae(dataset);
          return simulateArena(dae, {
            startTime: params?.startTime ?? 0,
            stopTime: params?.stopTime ?? dataset.simulation?.endTime ?? 5.0,
            step: params?.step ?? dataset.simulation?.dtOut ?? 0.005,
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered MSC Adams language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register MSC Adams plugin: ${err.message}`);
  }

  // Register ROS URDF & SDFormat Robotics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "urdf",
      name: "ROS URDF & SDFormat",
      extensions: [".urdf", ".sdf", ".xacro"],
      languageDef: urdfLanguage,
      workspaceIndex: new UrdfWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getUrdfDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getUrdfHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateUrdf(text);
        },
      },
      actionHandlers: {
        lint_urdf_robot: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseUrdf, lintUrdfRobot } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return lintUrdfRobot(robot);
        },
        compute_urdf_rnea: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, computeInverseDynamicsRnea } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          const q = new Map<string, number>(Object.entries(params?.q ?? {}));
          const qd = new Map<string, number>(Object.entries(params?.qd ?? {}));
          const qdd = new Map<string, number>(Object.entries(params?.qdd ?? {}));
          const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, params?.gravity);
          return Object.fromEntries(rnea.jointTorques);
        },
        export_urdf_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseUrdf, urdfToModelica } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToModelica(robot);
        },
        export_urdf_simpack: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, urdfToSimpack } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToSimpack(robot);
        },
        export_urdf_adams: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, urdfToAdams } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToAdams(robot);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered ROS URDF / SDFormat language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register ROS URDF plugin: ${err.message}`);
  }

  // Register Verilog-A / Verilog-AMS Compact Modeling Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "verilog-a",
      name: "Verilog-A / Verilog-AMS",
      extensions: [".va", ".vams"],
      languageDef: verilogALanguage,
      workspaceIndex: new VerilogAWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getVerilogADocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getVerilogAHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateVerilogA(text);
        },
      },
      actionHandlers: {
        lint_verilog_a: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintVerilogA, parseVerilogA } = await import("@modelscript/verilog-a");
          const doc = parseVerilogA(text);
          return lintVerilogA(doc);
        },
        export_verilog_a_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseVerilogA, verilogAToModelica } = await import("@modelscript/verilog-a");
          const doc = parseVerilogA(text);
          if (doc.modules.length === 0) return "";
          return verilogAToModelica(doc.modules[0]!);
        },
        export_verilog_a_spice: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseVerilogA, verilogAToSpice } = await import("@modelscript/verilog-a");
          const doc = parseVerilogA(text);
          if (doc.modules.length === 0) return "";
          return verilogAToSpice(doc.modules[0]!);
        },
        export_verilog_a_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseVerilogA, lowerVerilogAToDae } = await import("@modelscript/verilog-a");
          const doc = parseVerilogA(text);
          if (doc.modules.length === 0) return null;
          const arena = lowerVerilogAToDae(doc.modules[0]!);
          return {
            title: doc.modules[0]!.name,
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered Verilog-A language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register Verilog-A plugin: ${err.message}`);
  }

  // Register IEC 61131-3 PLCopen XML & Structured Text Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "plcopen",
      name: "IEC 61131-3 PLCopen / Structured Text",
      extensions: [".xml", ".plcopen", ".st"],
      languageDef: plcopenLanguage,
      workspaceIndex: new PlcopenWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getPlcopenDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getPlcopenHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validatePlcopen(text);
        },
      },
      actionHandlers: {
        lint_plcopen: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintPlcProject, parsePlcopen } = await import("@modelscript/plcopen");
          const project = parsePlcopen(text);
          return lintPlcProject(project);
        },
        export_plcopen_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parsePlcopen, plcopenToModelica } = await import("@modelscript/plcopen");
          const project = parsePlcopen(text);
          return plcopenToModelica(project);
        },
        export_plcopen_sysml: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parsePlcopen, plcopenToSysML } = await import("@modelscript/plcopen");
          const project = parsePlcopen(text);
          return plcopenToSysML(project);
        },
        export_plcopen_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parsePlcopen, lowerPlcopenToDae } = await import("@modelscript/plcopen");
          const project = parsePlcopen(text);
          const arena = lowerPlcopenToDae(project);
          return {
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
        run_plcopen_scan: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parsePlcopen, VirtualPlc } = await import("@modelscript/plcopen");
          const project = parsePlcopen(text);
          const plc = new VirtualPlc(project);
          const cycles = params?.cycles ?? 10;
          const dtMs = params?.dtMs ?? 10;
          return { cycles, dtMs, history: plc.runCycles(cycles, dtMs) };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered PLCopen language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register PLCopen plugin: ${err.message}`);
  }

  // Register ASAM OpenDRIVE Roadway Network Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "opendrive",
      name: "ASAM OpenDRIVE",
      extensions: [".xodr", ".xml"],
      languageDef: opendriveLanguage,
      workspaceIndex: new OpenDriveWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getOpenDriveDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getOpenDriveHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateOpenDrive(text);
        },
      },
      actionHandlers: {
        lint_opendrive: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintOpenDrive, parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          return lintOpenDrive(doc);
        },
        export_opendrive_gensys: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { opendriveToGensys, parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          const step = params?.step ?? 1.0;
          return opendriveToGensys(doc, step);
        },
        export_opendrive_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { lowerOpenDriveToDae, parseOpenDrive } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          const arena = lowerOpenDriveToDae(doc);
          return {
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
        sample_opendrive_track: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseOpenDrive, sampleRoadTrack } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          const step = params?.step ?? 1.0;
          return doc.roads.map((r) => ({
            roadId: r.id,
            name: r.name,
            points: sampleRoadTrack(r, step),
          }));
        },
        render_opendrive_svg: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseOpenDrive, renderOpenDriveSvg } = await import("@modelscript/opendrive");
          const doc = parseOpenDrive(text);
          return renderOpenDriveSvg(doc, {
            sampleStep: params?.step ?? 1.0,
            theme: params?.theme ?? "dark",
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered OpenDRIVE language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register OpenDRIVE plugin: ${err.message}`);
  }

  // Register EPRI OpenDSS Distribution Grid Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "opendss",
      name: "OpenDSS",
      extensions: [".dss"],
      languageDef: openDssLanguage,
      workspaceIndex: new OpenDssWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getOpenDssDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getOpenDssHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateOpenDss(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_opendss: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseOpenDss, lintOpenDss } = await import("@modelscript/opendss");
          return lintOpenDss(parseOpenDss(text));
        },
        opendss_powerflow: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOpenDss, solveDistributionPowerFlow } = await import("@modelscript/opendss");
          return solveDistributionPowerFlow(parseOpenDss(text));
        },
        opendss_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOpenDss, lowerOpenDssToDae } = await import("@modelscript/opendss");
          const dae = lowerOpenDssToDae(parseOpenDss(text));
          return {
            modelName: "DistributionGrid",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        opendss_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseOpenDss, openDssToModelica } = await import("@modelscript/opendss");
          return openDssToModelica(parseOpenDss(text));
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered OpenDSS language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register OpenDSS plugin: ${err.message}`);
  }

  // Register ASAM OpenSCENARIO Autonomous Driving Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "openscenario",
      name: "OpenSCENARIO",
      extensions: [".xosc", ".osc"],
      languageDef: openScenarioLanguage,
      workspaceIndex: new OpenScenarioWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getOpenScenarioDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getOpenScenarioHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateOpenScenario(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_openscenario: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseOpenScenario, lintOpenScenario } = await import("@modelscript/openscenario");
          return lintOpenScenario(parseOpenScenario(text));
        },
        openscenario_simulate: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOpenScenario, simulateScenario } = await import("@modelscript/openscenario");
          return simulateScenario(parseOpenScenario(text), params?.options);
        },
        openscenario_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseOpenScenario, lowerOpenScenarioToDae } = await import("@modelscript/openscenario");
          const dae = lowerOpenScenarioToDae(parseOpenScenario(text));
          return {
            modelName: "ScenarioSimulation",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        openscenario_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseOpenScenario, openScenarioToModelica } = await import("@modelscript/openscenario");
          return openScenarioToModelica(parseOpenScenario(text), params?.modelName);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered OpenSCENARIO language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register OpenSCENARIO plugin: ${err.message}`);
  }

  // Register US NRC RELAP5-3D Thermal-Hydraulics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "relap5",
      name: "RELAP5",
      extensions: [".i", ".inp", ".r5"],
      languageDef: relap5Language,
      workspaceIndex: new Relap5WorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getRelap5DocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getRelap5Hover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateRelap5(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_relap5: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseRelap5, lintRelap5 } = await import("@modelscript/relap5");
          return lintRelap5(parseRelap5(text));
        },
        relap5_kinetics_solve: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRelap5, solvePointKinetics } = await import("@modelscript/relap5");
          return solvePointKinetics(parseRelap5(text), params?.options);
        },
        relap5_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseRelap5, lowerRelap5ToDae } = await import("@modelscript/relap5");
          const dae = lowerRelap5ToDae(parseRelap5(text));
          return {
            modelName: "Relap5NuclearPlant",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        relap5_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseRelap5, relap5ToModelica } = await import("@modelscript/relap5");
          return relap5ToModelica(parseRelap5(text), params?.modelName);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered RELAP5 language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register RELAP5 plugin: ${err.message}`);
  }

  // Register Schlumberger ECLIPSE Reservoir Simulation Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "eclipse",
      name: "ECLIPSE",
      extensions: [".data", ".dat", ".inc"],
      languageDef: eclipseLanguage,
      workspaceIndex: new EclipseWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getEclipseDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getEclipseHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateEclipse(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_eclipse: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseEclipse, lintEclipse } = await import("@modelscript/eclipse");
          return lintEclipse(parseEclipse(text));
        },
        eclipse_reservoir_solve: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEclipse, solveReservoirDepletion } = await import("@modelscript/eclipse");
          return solveReservoirDepletion(parseEclipse(text), params?.options);
        },
        eclipse_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseEclipse, lowerEclipseToDae } = await import("@modelscript/eclipse");
          const dae = lowerEclipseToDae(parseEclipse(text));
          return {
            modelName: "EclipseReservoir",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        eclipse_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseEclipse, eclipseToModelica } = await import("@modelscript/eclipse");
          return eclipseToModelica(parseEclipse(text), params?.modelName);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered ECLIPSE language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register ECLIPSE plugin: ${err.message}`);
  }

  // Register Systems Biology Markup Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "sbml",
      name: "SBML",
      extensions: [".sbml", ".xml"],
      languageDef: sbmlLanguage,
      workspaceIndex: new SbmlWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getSbmlDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getSbmlHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateSbml(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_sbml: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSbml, lintSbml } = await import("@modelscript/sbml");
          return lintSbml(parseSbml(text));
        },
        sbml_simulate: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSbml, solveReactions } = await import("@modelscript/sbml");
          return solveReactions(parseSbml(text), params?.options);
        },
        sbml_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSbml, lowerSbmlToDae } = await import("@modelscript/sbml");
          const dae = lowerSbmlToDae(parseSbml(text));
          return {
            modelName: "SbmlModel",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        sbml_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSbml, sbmlToModelica } = await import("@modelscript/sbml");
          return sbmlToModelica(parseSbml(text), params?.modelName);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered SBML language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register SBML plugin: ${err.message}`);
  }

  // Register JSBSim 6-DOF Flight Dynamics Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "jsbsim",
      name: "JSBSim Flight Dynamics",
      extensions: [".xml"],
      languageDef: jsbsimLanguage,
      workspaceIndex: new JsbsimWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) =>
          getJsbsimDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          return getJsbsimHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
        },
        validate: (doc: any) => validateJsbsim(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        lint_jsbsim: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseJsbsim, lintJsbsim } = await import("@modelscript/jsbsim");
          return lintJsbsim(parseJsbsim(text));
        },
        jsbsim_simulate: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseJsbsim, solveFlightDynamics } = await import("@modelscript/jsbsim");
          return solveFlightDynamics(parseJsbsim(text), params?.options);
        },
        jsbsim_to_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseJsbsim, lowerJsbsimToDae } = await import("@modelscript/jsbsim");
          const dae = lowerJsbsimToDae(parseJsbsim(text));
          return {
            modelName: "JsbsimModel",
            variableCount: dae.variables().length,
            equationCount: dae.equations().length,
          };
        },
        jsbsim_to_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseJsbsim, jsbsimToModelica } = await import("@modelscript/jsbsim");
          return jsbsimToModelica(parseJsbsim(text), params?.modelName);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered JSBSim language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register JSBSim plugin: ${err.message}`);
  }

  // Register US DOE EnergyPlus Building Energy Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "energyplus",
      name: "EnergyPlus",
      extensions: [".idf", ".epjson"],
      languageDef: energyplusLanguage,
      workspaceIndex: new EnergyPlusWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getEnergyPlusDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getEnergyPlusHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateEnergyPlus(text);
        },
      },
      actionHandlers: {
        lint_energyplus: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintEnergyPlus, parseEnergyPlus } = await import("@modelscript/energyplus");
          const doc = parseEnergyPlus(text);
          return lintEnergyPlus(doc);
        },
        export_energyplus_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { energyPlusToModelica, parseEnergyPlus } = await import("@modelscript/energyplus");
          const doc = parseEnergyPlus(text);
          return energyPlusToModelica(doc);
        },
        export_energyplus_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { lowerEnergyPlusToDae, parseEnergyPlus } = await import("@modelscript/energyplus");
          const doc = parseEnergyPlus(text);
          const arena = lowerEnergyPlusToDae(doc);
          return {
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered EnergyPlus language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register EnergyPlus plugin: ${err.message}`);
  }

  // Register US EPA EPANET Water Distribution Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "epanet",
      name: "EPANET",
      extensions: [".inp"],
      languageDef: epanetLanguage,
      workspaceIndex: new EpanetWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getEpanetDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getEpanetHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateEpanet(text);
        },
      },
      actionHandlers: {
        lint_epanet: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintEpanet, parseInp } = await import("@modelscript/epanet");
          const net = parseInp(text);
          return lintEpanet(net);
        },
        solve_epanet: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
          const net = parseInp(text);
          const res = solveHydraulics(net);
          return {
            converged: res.converged,
            iterations: res.iterations,
            maxFlowChange: res.maxFlowChange,
            pressures: Object.fromEntries(res.nodePressures),
            flows: Object.fromEntries(res.linkFlows),
          };
        },
        export_epanet_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { epanetToModelica, parseInp } = await import("@modelscript/epanet");
          const net = parseInp(text);
          return epanetToModelica(net);
        },
        export_epanet_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { lowerEpanetToDae, parseInp } = await import("@modelscript/epanet");
          const net = parseInp(text);
          const arena = lowerEpanetToDae(net);
          return {
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered EPANET language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register EPANET plugin: ${err.message}`);
  }

  // Register CCSDS Spacecraft Astrodynamics & Telemetry Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "ccsds",
      name: "CCSDS",
      extensions: [".oem", ".opm", ".omm", ".xtce"],
      languageDef: ccsdsLanguage,
      workspaceIndex: new CcsdsWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getCcsdsDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          return getCcsdsHover(text, offset);
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateCcsds(text);
        },
      },
      actionHandlers: {
        lint_ccsds: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintCcsds, parseCcsds } = await import("@modelscript/ccsds");
          const doc = parseCcsds(text);
          return lintCcsds(doc);
        },
        export_ccsds_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { ccsdsToModelica, parseCcsds } = await import("@modelscript/ccsds");
          const doc = parseCcsds(text);
          return ccsdsToModelica(doc);
        },
        export_ccsds_sysml: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { ccsdsToSysml, parseCcsds } = await import("@modelscript/ccsds");
          const doc = parseCcsds(text);
          return ccsdsToSysml(doc);
        },
        export_ccsds_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { lowerCcsdsToDae, parseCcsds } = await import("@modelscript/ccsds");
          const doc = parseCcsds(text);
          const arena = lowerCcsdsToDae(doc);
          return {
            variableCount: arena.getVarCount(),
            equationCount: arena.getEqCount(),
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered CCSDS language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register CCSDS plugin: ${err.message}`);
  }

  // Register MATLAB Simulink Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "simulink",
      name: "MATLAB Simulink",
      extensions: [".slx", ".mdl"],
      languageDef: simulinkLanguage,
      workspaceIndex: new SimulinkWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getSimulinkDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getSimulinkHover(text, { line, character }, "model.mdl");
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSimulink(text);
        },
      },
      actionHandlers: {
        lint_simulink_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSimulink, lintSimulinkModel } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          return lintSimulinkModel(model);
        },
        export_simulink_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimulink, simulinkToModelica } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          return simulinkToModelica(model);
        },
        export_simulink_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSimulink, lowerSimulinkToDae } = await import("@modelscript/simulink");
          const model = parseSimulink(text);
          const dae = lowerSimulinkToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered MATLAB Simulink language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register MATLAB Simulink plugin: ${err.message}`);
  }

  // Register AUTOSAR Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "autosar",
      name: "AUTOSAR Classic & Adaptive",
      extensions: [".arxml"],
      languageDef: autosarLanguage,
      workspaceIndex: new AutosarWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getAutosarDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getAutosarHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateAutosar(text);
        },
      },
      actionHandlers: {
        lint_autosar_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseArxml, lintAutosarModel } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return lintAutosarModel(model);
        },
        export_autosar_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseArxml, autosarToModelica } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return autosarToModelica(model);
        },
        export_autosar_sysml: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseArxml, autosarToSysml } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          return autosarToSysml(model);
        },
        export_autosar_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseArxml, lowerAutosarToDae } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          const dae = lowerAutosarToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        simulate_autosar_rte: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseArxml, VirtualRte } = await import("@modelscript/autosar");
          const model = parseArxml(text);
          const rte = new VirtualRte(model);
          const duration = params?.duration ?? 0.05;
          const step = params?.step ?? 0.01;
          return rte.runUntil(duration, step);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered AUTOSAR language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register AUTOSAR plugin: ${err.message}`);
  }

  // Register Fortran Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "fortran",
      name: "Fortran",
      extensions: [".f", ".for", ".f90", ".f95", ".f03", ".f08"],
      languageDef: fortranLanguage,
      actionHandlers: {
        lint_fortran_file: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintFortran } = await import("@modelscript/fortran");
          return lintFortran(text);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered Fortran language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register Fortran plugin: ${err.message}`);
  }

  // Register C Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "c",
      name: "C",
      extensions: [".c", ".h"],
      languageDef: cLanguage,
      actionHandlers: {
        lint_c_file: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { lintC } = await import("@modelscript/c");
          return lintC(text);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered C language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register C plugin: ${err.message}`);
  }

  // Register SIMA / SIMO / RIFLEX Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "sima",
      name: "SIMA",
      extensions: [".inp", ".sima", ".sys", ".hyd"],
      languageDef: simaLanguage,
      workspaceIndex: new SimaWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getSimaDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getSimaHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateSima(text);
        },
      },
      actionHandlers: {
        lint_sima_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseSimaFile, lintSimaProject } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return lintSimaProject(model);
        },
        verify_dnv_compliance: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSimaFile, verifyDnvMooringCompliance } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return verifyDnvMooringCompliance(model, params?.consequenceClass ?? 2);
        },
        evaluate_offset_limits: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSimaFile, evaluateOffsetLimits } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return evaluateOffsetLimits(model, params?.options);
        },
        project_sima_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimaFile, simaToModelica } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return simaToModelica(model);
        },
        project_sima_ssp: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimaFile, simaToSsp } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return simaToSsp(model);
        },
        project_sima_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimaFile, simaToSysml2 } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          return simaToSysml2(model);
        },
        export_sima_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseSimaFile, lowerSimaToDae } = await import("@modelscript/sima");
          const model = parseSimaFile(text, params?.uri);
          const dae = lowerSimaToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        render_catenary_profile: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimaFile } = await import("@modelscript/sima");
          const { renderSimaCatenaryProfileSvg } = await import("@modelscript/diagram/sima-diagram-builder");
          const model = parseSimaFile(text, params?.uri);
          const firstLine = model.lines[0];
          const avgWeight = firstLine
            ? firstLine.segments.reduce((acc, s) => acc + s.submergedWeightPerMeter, 0) /
              Math.max(1, firstLine.segments.length)
            : 2500;
          return renderSimaCatenaryProfileSvg({
            title: firstLine ? `Catenary Profile: ${firstLine.name}` : "Catenary Profile Preview",
            waterDepth: model.environment.waterDepth,
            horizontalSpan: firstLine
              ? Math.hypot(
                  (firstLine.fairleadPosition?.[0] ?? 0) - firstLine.anchorPosition[0],
                  (firstLine.fairleadPosition?.[1] ?? 0) - firstLine.anchorPosition[1],
                )
              : 800,
            lineLength: firstLine ? firstLine.totalLength : 850,
            submergedWeight: avgWeight,
          });
        },
        render_mooring_spread: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseSimaFile } = await import("@modelscript/sima");
          const { renderSimaMooringSpreadSvg } = await import("@modelscript/diagram/sima-diagram-builder");
          const model = parseSimaFile(text, params?.uri);
          return renderSimaMooringSpreadSvg({
            title: "Overhead Mooring Spread & Watch Circle",
            waterDepth: model.environment.waterDepth,
            vesselName: model.vessels[0]?.name ?? "Floater Platform",
            lines: model.lines.map((l) => ({
              id: l.id,
              name: l.name,
              fairleadPos: l.fairleadPosition,
              anchorPos: l.anchorPosition,
            })),
            environment: {
              waveDir: model.environment.wave.direction,
              waveHs: model.environment.wave.hs,
              windDir: model.environment.wind.direction,
              windSpeed: model.environment.wind.speed,
              currentDir: model.environment.current.direction,
              currentSpeed: model.environment.current.surfaceSpeed,
            },
          });
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered SIMA language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register SIMA plugin: ${err.message}`);
  }

  // Register GT-SUITE / GT-POWER Language Plugin
  try {
    globalLanguageRegistry.register({
      id: "gtsuite",
      name: "GT-SUITE",
      extensions: [".gtm", ".gtd", ".gtx", ".gt"],
      languageDef: gtsuiteLanguage,
      workspaceIndex: new GtSuiteWorkspaceIndex(),
      customHandlers: {
        symbols: (treeWrapper: any) => {
          const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
          return getGtsuiteDocumentSymbols(text);
        },
        hover: (offset: number, text: string) => {
          const lines = text.slice(0, offset).split("\n");
          const line = lines.length - 1;
          const character = lines[lines.length - 1]!.length;
          return getGtsuiteHover(text, { line, character });
        },
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateGtsuite(text);
        },
      },
      actionHandlers: {
        lint_gtsuite_model: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseGtmModel, lintGtModel } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return lintGtModel(model);
        },
        simulate_gtsuite_transient: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseGtmModel, runGtSuiteSimulation } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return runGtSuiteSimulation(model, params?.options);
        },
        verify_gtsuite_gates: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseGtmModel, runGtSuiteSimulation, verifyEngineGates } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          const simResult = await runGtSuiteSimulation(model, params?.options);
          return verifyEngineGates(simResult, params?.gateOptions);
        },
        project_gtsuite_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseGtmModel, gtsuiteToModelica } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return gtsuiteToModelica(model);
        },
        project_gtsuite_sysml2: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseGtmModel, gtsuiteToSysml2 } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return gtsuiteToSysml2(model);
        },
        project_gtsuite_ssp: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseGtmModel, gtsuiteToSsp } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return gtsuiteToSsp(model);
        },
        export_gtsuite_dae: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseGtmModel, gtsuiteToDae } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          const dae = gtsuiteToDae(model);
          return {
            varCount: dae.varCount,
            eqCount: dae.eqCount,
          };
        },
        render_gtsuite_schematic: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("@modelscript/gtsuite");
          const model = parseGtmModel(text, params?.uri);
          return renderGtSuiteSchematicSvg(model);
        },
      },
      disposables: [],
    });
    connection.console.info("[NodeServer] Registered GT-SUITE language plugin");
  } catch (err: any) {
    connection.console.warn(`[NodeServer] Could not register GT-SUITE plugin: ${err.message}`);
  }

  /**
   * Resolves the filesystem directory containing user-registered custom language plugins
   * (`$MODELSCRIPT_LANGUAGES_DIR` or `~/.modelscript/languages`).
   */
  function getUserLanguagesDir(): string {
    if (process.env["MODELSCRIPT_LANGUAGES_DIR"]) {
      return path.resolve(process.env["MODELSCRIPT_LANGUAGES_DIR"]);
    }
    const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
    return path.join(home, ".modelscript", "languages");
  }

  /**
   * Reads `registry.json` from the user languages directory and dynamically loads and registers
   * any custom WASM GLR language parsers into `parserService` and `globalLanguageRegistry`.
   */
  async function loadUserRegisteredLanguages(): Promise<void> {
    const regDir = getUserLanguagesDir();
    const regPath = path.join(regDir, "registry.json");
    if (!fs.existsSync(regPath)) return;

    try {
      const catalog = JSON.parse(fs.readFileSync(regPath, "utf-8"));
      const languages = catalog.languages || {};

      for (const [id, entry] of Object.entries<any>(languages)) {
        if (globalLanguageRegistry.getPluginById(id)) continue;

        let wasmPath = entry.wasmPath;
        if (!wasmPath || !fs.existsSync(wasmPath)) {
          const langDir = path.join(regDir, id);
          const candidates = [
            path.join(langDir, "parser.wasm"),
            path.join(langDir, "dist", "parser.wasm"),
            path.join(langDir, `${id}.wasm`),
          ];
          wasmPath = candidates.find(fs.existsSync);
        }

        if (wasmPath && fs.existsSync(wasmPath)) {
          try {
            const { parser, facade } = await createWasmParser(wasmPath);
            parserService.registerParser(id, parser, facade);
            globalLanguageRegistry.register({
              id,
              name: entry.name || id,
              extensions: entry.extensions || [`.${id}`],
              parser,
              facade,
              disposables: [],
            });
            connection.console.info(`[NodeServer] Loaded custom language '${id}' from ${wasmPath}`);
          } catch (err: any) {
            connection.console.warn(`[NodeServer] Failed to load custom language '${id}': ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      connection.console.warn(`[NodeServer] Failed to read user languages registry: ${err.message}`);
    }
  }

  loadUserRegisteredLanguages().catch(() => {});

  const userLanguagesDir = getUserLanguagesDir();
  if (fs.existsSync(userLanguagesDir)) {
    try {
      fs.watch(userLanguagesDir, async (_eventType, filename) => {
        if (filename === "registry.json") {
          connection.console.info(`[NodeServer] User languages registry changed, reloading...`);
          await loadUserRegisteredLanguages();
          connection.sendNotification("modelscript/status", {
            state: "ready",
            message: "ModelScript (Languages Updated)",
          });
        }
      });
    } catch {}
  }

  // 1. Connection lifecycle handlers
  connection.onInitialize(async (_params: InitializeParams): Promise<InitializeResult> => {
    try {
      let wasmPath: string | undefined;
      try {
        wasmPath = require.resolve("@modelscript/runtime/release.wasm");
      } catch {
        try {
          wasmPath = require.resolve("@modelscript/runtime/build/release.wasm");
        } catch {}
      }
      if (wasmPath) {
        await initBltWasm(wasmPath);
      } else {
        await initBltWasm();
      }
      connection.console.info("[blt] BLT wasm initialized successfully");
    } catch (bltErr: any) {
      connection.console.warn(`[blt] initBltWasm warning/deferred: ${bltErr?.message || bltErr}`);
    }

    const capabilities: ServerCapabilities = {
      positionEncoding: PositionEncodingKind.UTF16,
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [".", ":", "$", "@"],
      },
      hoverProvider: true,
      semanticTokensProvider: {
        legend,
        full: true,
      },
      documentFormattingProvider: true,
      colorProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      documentHighlightProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
      },
      renameProvider: {
        prepareProvider: true,
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      workspaceSymbolProvider: true,
      inlayHintProvider: true,
      codeLensProvider: { resolveProvider: false },
    };

    return { capabilities };
  });

  connection.onInitialized(() => {
    connection.console.info("ModelScript Node.js Language Server initialized.");
  });

  // 2. Document events & validation
  documents.onDidOpen(async (e) => {
    try {
      await validationService.validateTextDocument(e.document);
    } catch (err: any) {
      connection.console.warn(`[onDidOpen] Validation error for ${e.document.uri}: ${err?.message}`);
    }
  });

  const activeSemanticTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const activeShortDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const activeSyntaxDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSyntaxErrorsCount = new Map<string, number>();

  documents.onDidChangeContent((change) => {
    const tKeypressStart = performance.now();
    const uri = change.document.uri;
    validationService.verificationDiagnosticsByUri.delete(uri);
    validationService.verificationResultsByUri.delete(uri);

    // Invalidate digital thread slots associated with this URI
    const threadEntries = workspaceManager.getThreadsForUri(uri);
    for (const entry of threadEntries) {
      workspaceManager.hypergraph.markStale(entry.slot);
    }

    // Bump revision — any in-flight deferred semantic work for an older revision
    // will check this and bail out before doing expensive linting.
    const currentRevision = (validationService.documentRevisions.get(uri) ?? 0) + 1;
    validationService.documentRevisions.set(uri, currentRevision);

    // Cancel any pending semantic analysis for this URI
    const semanticTimer = activeSemanticTimers.get(uri);
    if (semanticTimer) {
      clearTimeout(semanticTimer);
      activeSemanticTimers.delete(uri);
    }

    // Cancel any pending cross-file revalidation to prevent cascading
    // semantic analyses during rapid editing.
    if (validationService.revalidationTimer) {
      clearTimeout(validationService.revalidationTimer);
      validationService.revalidationTimer = null;
    }

    // Cancel active Tier 1 syntax, Tier 2, and Tier 3 timers for this URI
    const existingSyntaxTimer = activeSyntaxDebounceTimers.get(uri);
    if (existingSyntaxTimer) {
      clearTimeout(existingSyntaxTimer);
      activeSyntaxDebounceTimers.delete(uri);
    }

    const existingTier2 = activeShortDebounceTimers.get(uri);
    if (existingTier2) {
      clearTimeout(existingTier2);
      activeShortDebounceTimers.delete(uri);
    }

    const existingTier3 = validationService.activeValidationTimers.get(uri);
    if (existingTier3) {
      clearTimeout(existingTier3);
      validationService.activeValidationTimers.delete(uri);
    }

    // === TIER 1: Keystroke (0ms) — Fast WASM GLR Incremental Parse + Syntax Errors ===
    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const isCfd = plugin?.id === "cfd" || /\.(cfg|cfgt|su2|cfd)$/i.test(uri);
    const isFea = plugin?.id === "fea" || /\.(inp|inpt|bdf|fea)$/i.test(uri);
    if (isCfd || isFea) {
      activeSyntaxDebounceTimers.set(
        uri,
        setTimeout(async () => {
          activeSyntaxDebounceTimers.delete(uri);
          await validationService.validateTextDocument(change.document);
        }, 100),
      );
      return;
    }
    const parser =
      plugin?.parser ??
      parserService.getParserForUri(uri) ??
      ((uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim")) && parserService.isParserReady("modelica")
        ? parserService.getParser("modelica")
        : undefined);

    if (parser) {
      try {
        const text = change.document.getText();
        const oldCached = documentManager.documentTrees.get(uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          validationService.adjustDiagnostics(uri, edit);
          tree = parser.parse(text, oldCached.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri);
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = parser.parse(text);
        }

        if (tree) {
          if (oldCached?.tree && oldCached.tree !== tree) {
            oldCached.tree.delete?.();
          }
          documentManager.documentTrees.set(uri, { text, tree, classCache: oldCached?.classCache ?? new Map() });
          const { syntaxDiags } = validationService.collectSyntaxErrors(tree.rootNode, change.document, plugin);
          const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;

          // Surface syntax errors: clear immediately when 0, debounce by 180ms when editing
          if (syntaxDiags.length === 0 && lastCount > 0) {
            lastSyntaxErrorsCount.set(uri, 0);
            const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
            connection.sendDiagnostics({ uri, diagnostics: cachedSemantic });
          } else if (syntaxDiags.length > 0) {
            activeSyntaxDebounceTimers.set(
              uri,
              setTimeout(() => {
                activeSyntaxDebounceTimers.delete(uri);
                if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;
                lastSyntaxErrorsCount.set(uri, syntaxDiags.length);
                const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
                const allDiags = [...syntaxDiags, ...cachedSemantic];
                if (allDiags.length > 1000) allDiags.length = 1000;
                connection.sendDiagnostics({ uri, diagnostics: allDiags });
              }, 180),
            );
          }
        }
      } catch (e: any) {
        connection.console.warn(`[instant-parse] Error for ${uri}: ${e.message}`);
      }
    }

    const tKeypressEnd = performance.now();
    if (tKeypressEnd - tKeypressStart > 15) {
      connection.console.info(`[perf][keypress] Synchronous Tier 1: ${(tKeypressEnd - tKeypressStart).toFixed(2)}ms`);
    }

    // === TIER 2: Short Debounce (~60ms) — Local File Index & Outline Update ===
    activeShortDebounceTimers.set(
      uri,
      setTimeout(() => {
        activeShortDebounceTimers.delete(uri);
        if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;

        const cached = documentManager.documentTrees.get(uri);
        if (cached?.tree) {
          const langId = plugin?.id ?? (change.document.languageId || "modelica");
          const wsIndex = plugin?.workspaceIndex ?? workspaceManager.getWorkspaceIndex(langId);
          if (wsIndex && typeof wsIndex.has === "function") {
            const effectiveUri = uri.startsWith("modelscript-lib://global")
              ? "file://" + uri.substring("modelscript-lib://global".length)
              : uri;
            const prevIndexedText = validationService.lastIndexedText.get(effectiveUri);
            if (prevIndexedText !== cached.text) {
              validationService.lastIndexedText.set(effectiveUri, cached.text);
              let actualEditRanges: { startOffset: number; endOffset: number }[] | undefined;
              let totalDelta: number | undefined;
              if (prevIndexedText !== undefined) {
                const edit = computeTreeEdit(prevIndexedText, cached.text);
                actualEditRanges = [
                  {
                    startOffset: edit.startIndex,
                    endOffset: Math.max(edit.oldEndIndex, edit.newEndIndex),
                  },
                ];
                totalDelta = edit.newEndIndex - edit.oldEndIndex;
              }
              if (wsIndex.has(effectiveUri)) {
                wsIndex.reindexDocument?.(effectiveUri, () => cached.tree.rootNode, actualEditRanges, totalDelta);
              } else {
                wsIndex.register?.(effectiveUri, () => cached.tree.rootNode);
              }
              wsIndex.getFileIndex?.(effectiveUri);
              const wsInstances = workspaceManager.workspaceInstances;
              if (wsInstances) {
                for (const key of wsInstances.keys()) {
                  if (key.startsWith(effectiveUri + "#")) {
                    wsInstances.delete(key);
                  }
                }
              }
              workspaceManager.documentInstances.delete(uri);
              workspaceManager.documentInstances.delete(effectiveUri);
              const activeEngine = plugin?.queryEngine ?? workspaceManager.getQueryEngine(langId);
              if (activeEngine && typeof activeEngine.disposeDocument === "function") {
                activeEngine.disposeDocument(effectiveUri);
                if (uri !== effectiveUri) activeEngine.disposeDocument(uri);
              }
            }
          }
        }
      }, 60),
    );

    // === TIER 3: Longer Debounce (~180ms) — Salsa QueryEngine, Declarative Lints & Semantic Diagnostics ===
    validationService.activeValidationTimers.set(
      uri,
      setTimeout(async () => {
        validationService.activeValidationTimers.delete(uri);
        // Wait for any in-flight validation to finish before starting a new one.
        const inflight = validationService.activeValidationPromises.get(uri);
        if (inflight) {
          try {
            await Promise.race([inflight, new Promise((r) => setTimeout(r, 1000))]);
          } catch {}
        }
        // Re-check staleness: if another edit arrived while we waited, bail out.
        if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) {
          return;
        }
        const doc = documents.get(uri);
        if (doc) await validationService.validateTextDocument(doc);
      }, 180),
    );
  });

  documents.onDidClose((e) => {
    const uri = e.document.uri;
    const syntaxTimer = activeSyntaxDebounceTimers.get(uri);
    if (syntaxTimer) {
      clearTimeout(syntaxTimer);
      activeSyntaxDebounceTimers.delete(uri);
    }
    const shortTimer = activeShortDebounceTimers.get(uri);
    if (shortTimer) {
      clearTimeout(shortTimer);
      activeShortDebounceTimers.delete(uri);
    }
    lastSyntaxErrorsCount.delete(uri);
    validationService.disposeDocument(uri);
    workspaceManager.disposeDocument(uri);
    const normUri = uri.replace(/^file:\/\/\/+/, "file:///");
    const oneSlashUri = uri.replace(/^file:\/\/\/+/, "file:/");
    for (const u of new Set([uri, normUri, oneSlashUri])) {
      const oldTree = documentManager.documentTrees.get(u);
      if (oldTree) {
        oldTree.tree?.delete?.();
        documentManager.documentTrees.delete(u);
      }
    }
    const persistentDiags = [
      ...(validationService.reasonerDiagnosticsByUri?.get(uri) || []),
      ...(validationService.verificationDiagnosticsByUri?.get(uri) || []),
    ];
    connection.sendDiagnostics({ uri, diagnostics: persistentDiags });

    // Re-validate remaining open documents
    for (const doc of documents.all()) {
      validationService.validateTextDocument(doc).catch(() => {});
    }
  });

  // Construct complete LspContext
  const lspContext: LspContext = {
    connection,
    documents,
    workspaceManager,
    documentManager,
    validationService,
    parserService,
    diagramService,
    state: {
      activeValidationPromises: validationService.activeValidationPromises,
      get sharedContext() {
        return parserService.sharedContext ?? (globalThis as any).sharedContext;
      },
      set sharedContext(v) {
        parserService.sharedContext = v;
        (globalThis as any).sharedContext = v;
      },
      fqnCache: new Map(),
      fqnCacheIndex: new Map(),
      documentRevisions: validationService.documentRevisions,
      documentLSPBridges: validationService.documentLSPBridges,
      lastSemanticDiagnostics: validationService.lastSemanticDiagnostics,
      dependenciesReady: validationService.dependenciesReady,
    },
  };

  // 3. Register Language Feature Providers
  registerSemanticTokensProvider(
    connection,
    documents,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.getParser("sysml2"),
    () => parserService.isParserReady("sysml2"),
    (ext, text) =>
      parserService.sharedContext?.parse(ext, text) ??
      parserService.getParserForUri(ext)?.parse(text) ??
      parserService.getParser("modelica")?.parse(text),
  );

  registerCompletionProvider(connection, documents, validationService.documentLSPBridges);

  registerHoverProvider(connection, documents, validationService);

  registerDefinitionProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    documentManager.documentTrees,
    validationService,
  );

  registerFormattingProvider(connection, documents, parserService.getDocumentTree.bind(parserService), () =>
    parserService.isParserReady("modelica"),
  );

  registerColorProvider(connection, documents, parserService.getDocumentTree.bind(parserService), () =>
    parserService.isParserReady("modelica"),
  );

  registerDocumentFeaturesProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    parserService.getLineIndexForDoc.bind(parserService),
    () => parserService.isParserReady("modelica"),
    () => parserService.isParserReady("sysml2"),
    () => parserService.getParser("sysml2"),
    validationService,
  );

  registerWorkspaceFeaturesProvider(
    connection,
    documents,
    documentManager.documentTrees,
    validationService.flushValidation.bind(validationService),
    async (isSysML2) => {
      const idx = isSysML2
        ? workspaceManager.getWorkspaceIndex("sysml2")
        : workspaceManager.getWorkspaceIndex("modelica");
      return await idx?.toUnifiedAsync();
    },
    () => workspaceManager.getWorkspaceIndex("modelica"),
  );

  registerSignatureHelpProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.isParserReady("modelica"),
    () => parserService.getParser("modelica"),
    parserService.getLineIndexForDoc.bind(parserService),
  );

  registerCodeLensProvider(lspContext);
  registerInlayHintProvider(lspContext);

  // 4. Register Custom Domain Handlers & RPC Endpoints
  registerActionRouter(lspContext);
  registerDiagramHandlers(lspContext);
  registerTreeHandlers(lspContext);
  registerSimulationEndpoints(lspContext);
  registerAnalysisEndpoints(lspContext);
  registerRtmEndpoints(lspContext);
  registerInteropEndpoints(lspContext);
  registerClassQueryEndpoints(lspContext);
  registerOwl2Endpoints(lspContext);
  registerMiscEndpoints(lspContext);
  registerReplEndpoints(lspContext);
  registerPolyglotEndpoints(connection, documents, validationService, documentManager, workspaceManager);

  // Listen on the document manager and connection
  documents.listen(connection);
  connection.listen();

  return {
    connection,
    documents,
    workspaceManager,
    parserService,
    validationService,
    documentManager,
    diagramService,
    hierarchyService,
    lspContext,
  };
}

// Auto-start if executed directly via node
if (process.argv[1] && process.argv[1].endsWith("nodeServerMain.js")) {
  startNodeServer();
}
