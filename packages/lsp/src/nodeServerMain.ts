// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { ArenaQueryFlattener, deriveSimplification } from "@modelscript/modelica";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { AnnotationEvaluator, clearIconCache } from "@modelscript/modelica/diagram";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import { createOWL2QueryEngine, createOWL2WorkspaceIndex } from "@modelscript/owl2/factory";
import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import {
  buildSysML2DiagramData,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
} from "@modelscript/sysml2/factory";
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
import { LspContext } from "./lsp-context.js";
import { legend } from "./providers/semanticTokensProvider.js";
import { registerBuiltinLanguagePlugins } from "./registry/builtin-plugins.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import { registerAllLspEndpoints, registerAllLspProviders } from "./router.js";
import { CadMetricsService } from "./services/cad-metrics-service.js";
import { DiagramService } from "./services/diagram-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { HierarchyService } from "./services/hierarchy-service.js";
import { ParserService } from "./services/parser-service.js";
import { deduplicateAllDiagnostics, ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";
import { computeTreeEdit } from "./utils/ast-utils.js";
import { LspWorkDoneProgressReporter } from "./utils/progress-reporter.js";
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
  const diagramService = new DiagramService(
    connection,
    documentManager,
    workspaceManager,
    validationService,
    parserService,
    {
      modelicaDiagramOps,
      sysml2DiagramOps: { ...sysml2DiagramOps, buildSysML2DiagramData },
    },
  );
  const cadMetricsService = new CadMetricsService();

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
  (globalThis as any).deriveSimplification = deriveSimplification;

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

  // Register all 44 built-in domain language plugins & workspace indices
  registerBuiltinLanguagePlugins({
    workspaceManager,
    parserService,
    connection,
  });

  // Initialize built-in WASM parsers
  const require = createRequire(import.meta.url);
  const builtInPkgs = [
    { id: "modelica", pkg: "@modelscript/modelica", name: "Modelica" },
    { id: "sysml", pkg: "@modelscript/sysml2", name: "SysML v2" },
    { id: "sysml2", pkg: "@modelscript/sysml2", name: "SysML v2" },
    { id: "step", pkg: "@modelscript/step", name: "STEP" },
    { id: "owl2", pkg: "@modelscript/owl2", name: "OWL2" },
    { id: "csv", pkg: "@modelscript/csv", name: "CSV" },
    { id: "pscad", pkg: "@modelscript/pscad", name: "PSCAD" },
    { id: "psse", pkg: "@modelscript/psse", name: "PSSE" },
    { id: "scad", pkg: "@modelscript/scad", name: "OpenSCAD" },
    { id: "modelscript", pkg: "@modelscript/modelscript", name: "ModelScript" },
    { id: "fea", pkg: "@modelscript/fea", name: "FEA" },
    { id: "cfd", pkg: "@modelscript/cfd", name: "CFD" },
    { id: "sima", pkg: "@modelscript/sima", name: "SIMA" },
    { id: "gtsuite", pkg: "@modelscript/gtsuite", name: "GT-SUITE" },
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
            const plugin = globalLanguageRegistry.getPluginById(item.id);
            const exts = plugin?.extensions ?? [`.${item.id}`];
            if (workspaceManager?.unifiedWorkspace && parser) {
              for (const ext of exts) {
                workspaceManager.unifiedWorkspace.registerParser(ext, parser);
                workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, item.id);
              }
            }
            if (item.id === "modelica") {
              (globalThis as any).modelicaParser = parser;
            }
            // Re-validate any open documents now that this parser is registered
            for (const doc of documents.all()) {
              validationService.validateTextDocument(doc).catch(() => {});
            }
          })
          .catch((err) => {
            connection.console.warn(`[NodeServer] Could not load ${item.name} WASM parser: ${err.message}`);
          });
      }
    } catch {}
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

      for (const [rawId, entry] of Object.entries<any>(languages)) {
        const id = rawId.toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
          connection.console.warn(`[NodeServer] Ignoring invalid custom language identifier: '${rawId}'`);
          continue;
        }
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
            const exts = entry.extensions || [`.${id}`];
            if (workspaceManager?.unifiedWorkspace && parser) {
              for (const ext of exts) {
                workspaceManager.unifiedWorkspace.registerParser(ext, parser);
                workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, id);
              }
            }
            globalLanguageRegistry.register({
              id,
              name: entry.name || id,
              extensions: exts,
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
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: {
          includeText: true,
        },
      },
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
      documentRangeFormattingProvider: true,
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
        codeActionKinds: [
          CodeActionKind.QuickFix,
          CodeActionKind.Refactor,
          CodeActionKind.RefactorRewrite,
          CodeActionKind.Source,
          CodeActionKind.SourceFixAll,
        ],
      },
      codeLensProvider: {
        resolveProvider: false,
      },
      inlayHintProvider: {
        resolveProvider: false,
      },
      workspaceSymbolProvider: true,
    };

    return { capabilities };
  });

  connection.onInitialized(() => {
    LspWorkDoneProgressReporter.registerCancelHandler(connection);
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

  documents.onDidSave(async (e) => {
    try {
      await validationService.validateTextDocument(e.document);
      const progressReporter = await LspWorkDoneProgressReporter.create(
        connection,
        "ModelScript Formal Verification",
        { message: "Verifying requirements & invariants..." },
      );
      await validationService.runVerificationForUri(e.document.uri, progressReporter);
    } catch (err: any) {
      connection.console.warn(`[onDidSave] Verification error for ${e.document.uri}: ${err?.message}`);
    }
  });

  let projectTreeChangedTimer: ReturnType<typeof setTimeout> | null = null;
  let projectTreeChangedPending = false;

  Object.defineProperty(globalThis, "projectTreeChangedTimer", {
    get: () => projectTreeChangedTimer,
    set: (v) => (projectTreeChangedTimer = v),
    configurable: true,
  });
  Object.defineProperty(globalThis, "projectTreeChangedPending", {
    get: () => projectTreeChangedPending,
    set: (v) => (projectTreeChangedPending = v),
    configurable: true,
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
          const classCache = oldCached && oldCached.text === text ? oldCached.classCache : new Map();
          documentManager.documentTrees.set(uri, { text, tree, classCache });
          workspaceManager.unifiedWorkspace.setDocumentTree(uri, tree);
          const uDoc = workspaceManager.unifiedWorkspace.getDocument(uri);
          if (uDoc) {
            uDoc.text = text;
            uDoc.tree = tree;
          }
          const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(
            tree.rootNode,
            change.document,
            plugin,
          );
          const wasmLspDiags = validationService.convertWasmLintDiagnostics(
            wasmLintDiags,
            change.document,
            plugin,
            text,
          );
          const fastDiags = deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags]);
          const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;

          // Surface fast syntax and WASM CST lint errors: clear immediately when 0, debounce by 180ms when editing
          if (fastDiags.length === 0 && lastCount > 0) {
            lastSyntaxErrorsCount.set(uri, 0);
            const cachedSemantic = (validationService.lastSemanticDiagnostics.get(uri) || []).filter(
              (d) => typeof d.code !== "number" || d.code < 1000 || d.code >= 6000,
            );
            validationService.lastSemanticDiagnostics.set(uri, cachedSemantic);
            connection.sendDiagnostics({ uri, diagnostics: cachedSemantic });
          } else if (fastDiags.length > 0) {
            activeSyntaxDebounceTimers.set(
              uri,
              setTimeout(() => {
                activeSyntaxDebounceTimers.delete(uri);
                if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;
                lastSyntaxErrorsCount.set(uri, fastDiags.length);
                const cachedSemantic = (validationService.lastSemanticDiagnostics.get(uri) || []).filter(
                  (d) => typeof d.code !== "number" || d.code < 1000 || d.code >= 6000,
                );
                const allDiags = deduplicateAllDiagnostics([...fastDiags, ...cachedSemantic]);
                validationService.lastSemanticDiagnostics.set(uri, allDiags);
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

    // === TIER 2: Short Debounce (~60ms) — Local File Index, QueryEngine Swap & Outline Update ===
    activeShortDebounceTimers.set(
      uri,
      setTimeout(() => {
        activeShortDebounceTimers.delete(uri);
        if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;

        void validationService.syncDocumentForDiagram(uri).then((didSync) => {
          if (didSync && (validationService.documentRevisions.get(uri) ?? 0) === currentRevision) {
            validationService.sendProjectTreeChanged(uri);
          }
        });
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

    cadMetricsService.disposeDocument(uri);
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
    cadMetricsService,
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

  // 3. Register Language Feature Providers & Custom Domain Handlers
  registerAllLspProviders(lspContext);
  registerAllLspEndpoints(lspContext);

  connection.onDidChangeConfiguration((change: any) => {
    const raw = change?.settings?.modelscript ?? change?.settings;
    if (raw && typeof raw === "object") {
      lspContext.settings = {
        ...lspContext.settings,
        ...raw,
      };
      if (raw.languages) {
        globalLanguageRegistry.setLanguageConfig(raw.languages);
      }
      if (raw.diagnostics && validationService) {
        validationService.diagnosticsConfig = {
          ...validationService.diagnosticsConfig,
          ...raw.diagnostics,
        };
      }
      for (const doc of documents.all()) {
        validationService.validateTextDocument(doc);
      }
    }
  });

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
