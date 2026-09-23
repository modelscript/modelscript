// SPDX-License-Identifier: AGPL-3.0-or-later

import csvLangFallback from "@modelscript/csv/language";
import { createWasmParser } from "@modelscript/dsl/bindings";
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
import owl2LangFallback from "@modelscript/owl2/language";
import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import { stepLanguage, StepWorkspaceIndex } from "@modelscript/step";
import { extractSysML2Constraints, mapConstraintsToOptimizer } from "@modelscript/sysml2/constraint-extractor";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import {
  buildSysML2DiagramData,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
} from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind,
  createConnection,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  ServerCapabilities,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { LspContext } from "./LspContext.js";
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
import { DiagramService } from "./services/DiagramService.js";
import { DocumentManager } from "./services/DocumentManager.js";
import { HierarchyService } from "./services/HierarchyService.js";
import { ParserService } from "./services/ParserService.js";
import { ValidationService } from "./services/ValidationService.js";
import { WorkspaceManager } from "./services/WorkspaceManager.js";
import { computeTreeEdit } from "./utils/astUtils.js";
import {
  getCompositeName as _getCompositeName,
  buildClassHierarchy,
  buildComponentTree,
  classKindFromEntry,
  getTreeChildrenFast,
  hasClassChildren,
  isTreeVisible,
} from "./utils/hierarchyUtils.js";

/**
 * Starts a headless Language Server Protocol server over Node.js standard I/O or IPC.
 */
export function startNodeServer(input?: any, output?: any) {
  let connection: any;
  if (input && output) {
    connection = createConnection(ProposedFeatures.all, input, output);
  } else if (process.argv.some((arg) => arg === "--stdio" || arg === "--node-ipc" || arg.startsWith("--socket="))) {
    connection = createConnection(ProposedFeatures.all);
  } else {
    connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  }
  const documents = new TextDocuments(TextDocument);

  const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
  const workspaceManager = new WorkspaceManager(documentManager);
  const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
  const hierarchyService = new HierarchyService(connection, documentManager, workspaceManager);
  const diagramService = new DiagramService(connection, documentManager, workspaceManager);

  /**
   * Flatten a class instance using the arena-native pipeline.
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
  (globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
  (globalThis as any).create_sysml2_query_engine = createSysML2QueryEngine;
  (globalThis as any).createModelicaQueryEngine = createModelicaQueryEngine;
  (globalThis as any).createSysML2QueryEngine = createSysML2QueryEngine;
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
  const SYSML2_TREE_KINDS = new Set(["Definition", "Package", "Enumeration"]);

  globalThis.CLASS_KIND_KEYWORDS = CLASS_KIND_KEYWORDS;
  globalThis.SYSML2_RULE_TO_KIND = SYSML2_RULE_TO_KIND;
  globalThis.SYSML2_TREE_KINDS = SYSML2_TREE_KINDS;

  const diagramCache = new Map<string, { version: number | string; data: any }>();
  globalThis.diagramCache = diagramCache;

  function simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }
  globalThis.simpleHash = simpleHash;

  const cosimSimulators = new Map<string, any>();
  const breakpointsMap = new Map<string, { line: number; column?: number }[]>();
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
    workspaceManager.globalWorkspaceIndex,
    modelicaLangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "sysml2",
    workspaceManager.sysml2WorkspaceIndex,
    sysml2LangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "sysml",
    workspaceManager.sysml2WorkspaceIndex,
    sysml2LangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace("owl2", workspaceManager.owl2WorkspaceIndex, owl2LangFallback);
  workspaceManager.stepWorkspaceIndex = new StepWorkspaceIndex();
  workspaceManager.unifiedWorkspace.registerWorkspace("step", workspaceManager.stepWorkspaceIndex, { priority: 2 });

  // Initialize built-in WASM parsers
  const require = createRequire(import.meta.url);
  const builtInPkgs = [
    { id: "modelica", pkg: "@modelscript/modelica", name: "Modelica", ext: [".mo", ".mos", ".msim"] },
    { id: "sysml2", pkg: "@modelscript/sysml2", name: "SysML v2", ext: [".sysml", ".sysml2"] },
    { id: "sysml", pkg: "@modelscript/sysml2", name: "SysML v2", ext: [".sysml", ".sysml2"] },
    { id: "step", pkg: "@modelscript/step", name: "STEP", ext: [".step", ".stp", ".p21"] },
    { id: "owl2", pkg: "@modelscript/owl2", name: "OWL2", ext: [".owl", ".owl2", ".ofn", ".ttl"] },
    { id: "csv", pkg: "@modelscript/csv", name: "CSV", ext: [".csv"] },
    { id: "scad", pkg: "@modelscript/scad", name: "OpenSCAD", ext: [".scad"] },
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
              parserService.parser = parser;
              parserService.facade = facade;
              (globalThis as any).modelicaParser = parser;
              parserService.parserReady = true;
            } else if (item.id === "sysml2" || item.id === "sysml") {
              parserService.sysml2Parser = parser;
              parserService.sysml2Facade = facade;
              parserService.sysml2ParserReady = true;
            } else if (item.id === "step") {
              parserService.stepParser = parser;
              parserService.stepParserReady = true;
            } else if (item.id === "owl2") {
              parserService.owl2Parser = parser;
              parserService.owl2Facade = facade;
              parserService.owl2ParserReady = true;
            } else if (item.id === "csv") {
              parserService.csvParser = parser;
              parserService.csvFacade = facade;
              parserService.csvParserReady = true;
            }

            let wsIndex: any;
            let queryEngineGetter: (() => any) | undefined;
            let queryEngineSetter: ((v: any) => void) | undefined;
            let langDef: any;
            let handlers: any;
            let actionHandlers: any;

            if (item.id === "modelica") {
              wsIndex = workspaceManager.globalWorkspaceIndex;
              queryEngineGetter = () => workspaceManager.globalModelicaQueryEngine ?? undefined;
              queryEngineSetter = (v) => (workspaceManager.globalModelicaQueryEngine = v ?? null);
              langDef = modelicaLanguage;
              handlers = modelicaLanguage.lsp?.handlers;
              actionHandlers = modelicaActionHandlers;
            } else if (item.id === "sysml2" || item.id === "sysml") {
              wsIndex = workspaceManager.sysml2WorkspaceIndex;
              queryEngineGetter = () => workspaceManager.globalSysML2QueryEngine ?? undefined;
              queryEngineSetter = (v) => (workspaceManager.globalSysML2QueryEngine = v ?? null);
              langDef = sysml2LangFallback;
            } else if (item.id === "step") {
              wsIndex = workspaceManager.stepWorkspaceIndex;
              queryEngineGetter = () => workspaceManager.globalStepQueryEngine ?? undefined;
              queryEngineSetter = (v) => (workspaceManager.globalStepQueryEngine = v ?? null);
              langDef = stepLanguage;
              handlers = stepLanguage.lsp?.handlers;
            } else if (item.id === "owl2") {
              wsIndex = workspaceManager.owl2WorkspaceIndex;
              queryEngineGetter = () => workspaceManager.globalOWL2QueryEngine ?? undefined;
              queryEngineSetter = (v) => (workspaceManager.globalOWL2QueryEngine = v ?? null);
              langDef = owl2LangFallback;
            } else if (item.id === "csv") {
              langDef = csvLangFallback;
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

  // Helper to load user languages from registry directory (~/.modelscript/languages/)
  function getUserLanguagesDir(): string {
    if (process.env.MODELSCRIPT_LANGUAGES_DIR) {
      return path.resolve(process.env.MODELSCRIPT_LANGUAGES_DIR);
    }
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(home, ".modelscript", "languages");
  }

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
      codeLensProvider: { resolveProvider: false },
      inlayHintProvider: true,
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
  const lastSyntaxErrorsCount = new Map<string, number>();

  documents.onDidChangeContent((change) => {
    const tKeypressStart = performance.now();
    const uri = change.document.uri;
    validationService.verificationDiagnosticsByUri.delete(uri);
    validationService.verificationResultsByUri.delete(uri);

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

    // Cancel active Tier 2 and Tier 3 timers for this URI
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
    const parser = plugin?.parser ?? (parserService.parserReady ? parserService.parser : undefined);

    if (parser) {
      try {
        const text = change.document.getText();
        const oldCached = documentManager.documentTrees.get(uri);
        let tree: any;

        if (oldCached && oldCached.text !== text) {
          const edit = computeTreeEdit(oldCached.text, text);
          tree = parser.parse(
            text,
            oldCached.tree,
            edit.startIndex * 2,
            edit.oldEndIndex * 2,
            edit.newEndIndex * 2,
            uri,
          );
        } else if (oldCached) {
          tree = oldCached.tree;
        } else {
          tree = parser.parse(text);
        }

        if (tree) {
          documentManager.documentTrees.set(uri, { text, tree, classCache: oldCached?.classCache ?? new Map() });
          const syntaxDiags = validationService.collectSyntaxErrors(tree.rootNode, change.document, plugin);
          const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;

          // Surface syntax errors if errors are present or if previous errors were just cleared
          if (syntaxDiags.length > 0 || lastCount > 0) {
            lastSyntaxErrorsCount.set(uri, syntaxDiags.length);
            const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
            const allDiags = [...syntaxDiags, ...cachedSemantic];
            if (allDiags.length > 1000) allDiags.length = 1000;
            connection.sendDiagnostics({ uri, diagnostics: allDiags });
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
          if (wsIndex) {
            const effectiveUri = uri.startsWith("modelscript-lib://global")
              ? "file://" + uri.substring("modelscript-lib://global".length)
              : uri;
            if (wsIndex.has(effectiveUri)) {
              wsIndex.markDirty(effectiveUri, () => cached.tree.rootNode);
            } else {
              wsIndex.register(effectiveUri, () => cached.tree.rootNode);
            }
            wsIndex.getFileIndex(effectiveUri);
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
    activeShortDebounceTimers.delete(e.document.uri);
    lastSyntaxErrorsCount.delete(e.document.uri);
    const timer = validationService.activeValidationTimers.get(e.document.uri);
    if (timer) {
      clearTimeout(timer);
      validationService.activeValidationTimers.delete(e.document.uri);
    }
    workspaceManager.workspaceInstances.delete(e.document.uri);
    workspaceManager.documentInstances.delete(e.document.uri);
    workspaceManager.documentContexts.delete(e.document.uri);
    const oldTree = documentManager.documentTrees.get(e.document.uri);
    if (oldTree) {
      oldTree.tree.delete();
      documentManager.documentTrees.delete(e.document.uri);
    }
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });

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
      sharedContext: parserService.sharedContext,
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
    () => parserService.sysml2Parser,
    () => parserService.sysml2ParserReady,
    (ext, text) => parserService.sharedContext?.parse(ext, text),
  );

  registerCompletionProvider(connection, documents, validationService.documentLSPBridges);

  registerHoverProvider(connection, documents, validationService);

  registerDefinitionProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    documentManager.documentTrees,
  );

  registerFormattingProvider(
    connection,
    documents,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.parserReady && !!parserService.parser,
  );

  registerColorProvider(
    connection,
    documents,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.parserReady && !!parserService.parser,
  );

  registerDocumentFeaturesProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    parserService.getLineIndexForDoc.bind(parserService),
    () => parserService.parserReady && !!parserService.parser,
    () => parserService.sysml2ParserReady && !!parserService.sysml2Parser,
    () => parserService.sysml2Parser,
    validationService,
  );

  registerWorkspaceFeaturesProvider(
    connection,
    documents,
    documentManager.documentTrees,
    validationService.flushValidation.bind(validationService),
    async (isSysML2) =>
      isSysML2
        ? await workspaceManager.sysml2WorkspaceIndex.toUnifiedAsync()
        : await workspaceManager.globalWorkspaceIndex.toUnifiedAsync(),
    () => workspaceManager.globalWorkspaceIndex,
  );

  registerSignatureHelpProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.parserReady,
    () => parserService.parser,
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
