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
import { DAEBuilder, initBltWasm, type WorkspaceCstTree, type WorkspaceParser } from "@modelscript/runtime";
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
  type Connection,
  createConnection,
  InitializeParams,
  InitializeResult,
  PositionEncodingKind,
  ProposedFeatures,
  ServerCapabilities,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import {
  getSharedLspPolyglotEngine,
  LspContext,
  type ModelScriptLspSettings,
  type SharedCompilerContextLike,
} from "./lsp-context.js";
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
import { parseTreeWithXmlGuard } from "./utils/ast-utils.js";
import { LspWorkDoneProgressReporter } from "./utils/progress-reporter.js";
import { BrowserFileSystem } from "./vfs/browser-file-system.js";

interface FlattenableClassInstanceLike {
  id: number;
  name?: string | undefined;
  compositeName?: string | undefined;
}

interface UserLanguageCatalogEntry {
  wasmPath?: string | undefined;
  extensions?: string[] | undefined;
  name?: string | undefined;
}

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
export function startNodeServer(input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream) {
  // Select transport mode based on explicit streams or CLI flags (--stdio, --node-ipc, --socket)
  let connection: Connection;
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
  const documentManager: DocumentManager = new DocumentManager(documents, () =>
    parserService.getSharedCstTreeWrapper(),
  );
  const workspaceManager = new WorkspaceManager(documentManager);
  const parserService: ParserService = new ParserService(connection, documentManager, workspaceManager, documents);
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
  function flattenArenaFromInstance(classInstance: FlattenableClassInstanceLike, _context?: unknown): DAEBuilder {
    const className = classInstance.compositeName || classInstance.name;
    if (!className) throw new Error("Class instance has no name");

    if (!workspaceManager.globalModelicaQueryEngine) throw new Error("Query engine not initialized");
    const flattener = new ArenaQueryFlattener(workspaceManager.globalModelicaQueryEngine.toQueryDB());
    const arena = flattener.flatten(classInstance.id);
    if (!arena) throw new Error(`Failed to flatten class '${className}'`);
    return arena as unknown as DAEBuilder;
  }

  const globals = globalThis as unknown as Record<string, unknown>;
  globalThis.flattenArenaFromInstance = flattenArenaFromInstance;
  globalThis.clearIconCache = clearIconCache;
  Object.assign(globals, {
    create_modelica_workspace_index: createModelicaWorkspaceIndex,
    create_sysml2_workspace_index: createSysML2WorkspaceIndex,
    create_owl2_workspace_index: createOWL2WorkspaceIndex,
    create_modelica_query_engine: createModelicaQueryEngine,
    create_sysml2_query_engine: createSysML2QueryEngine,
    create_owl2_query_engine: createOWL2QueryEngine,
    createModelicaWorkspaceIndex,
    createSysML2WorkspaceIndex,
    createOWL2WorkspaceIndex,
    createModelicaQueryEngine,
    createSysML2QueryEngine,
    createOWL2QueryEngine,
    injectPredefinedTypes,
    AnnotationEvaluator,
    modelicaDiagramOps,
    sysml2DiagramOps: { ...sysml2DiagramOps, buildSysML2DiagramData },
    deriveSimplification,
  });

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
  const diagramCache = new Map<string, { version: number | string; data: unknown }>();
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

  const cosimSimulators = new Map<string, unknown>();
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
  globalThis.validateTextDocument = async (doc: TextDocument) => {
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
    { id: "las", pkg: "@modelscript/las", name: "LAS Well Log" },
    { id: "pscad", pkg: "@modelscript/pscad", name: "PSCAD" },
    { id: "psse", pkg: "@modelscript/psse", name: "PSSE" },
    { id: "scad", pkg: "@modelscript/scad", name: "OpenSCAD" },
    { id: "modelscript", pkg: "@modelscript/modelscript", name: "ModelScript" },
    { id: "fea", pkg: "@modelscript/fea", name: "FEA" },
    { id: "cfd", pkg: "@modelscript/cfd", name: "CFD" },
    { id: "fortran", pkg: "@modelscript/fortran", name: "Fortran" },
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
        } catch {
          // Optional built-in language parser package not built or installed.
        }
      }
      if (wasmPath) {
        createWasmParser(wasmPath)
          .then(({ parser, facade }) => {
            parserService.registerParser(item.id, parser, facade);
            const plugin = globalLanguageRegistry.getPluginById(item.id);
            const exts = plugin?.extensions ?? [`.${item.id}`];
            if (workspaceManager?.unifiedWorkspace && parser) {
              for (const ext of exts) {
                workspaceManager.unifiedWorkspace.registerParser(ext, parser as unknown as WorkspaceParser);
                workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, item.id);
              }
            }
            if (item.id === "modelica") {
              globals["modelicaParser"] = parser;
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
    } catch {
      // Optional built-in parser package unavailable; continue loading remaining parsers.
    }
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
      const catalog = JSON.parse(fs.readFileSync(regPath, "utf-8")) as {
        languages?: Record<string, UserLanguageCatalogEntry> | undefined;
      };
      const languages = catalog.languages || {};

      for (const [rawId, entry] of Object.entries(languages)) {
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
                workspaceManager.unifiedWorkspace.registerParser(ext, parser as unknown as WorkspaceParser);
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
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            connection.console.warn(`[NodeServer] Failed to load custom language '${id}': ${msg}`);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      connection.console.warn(`[NodeServer] Failed to read user languages registry: ${msg}`);
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
    } catch {
      // Optional directory watcher may fail on unsupported filesystems; continue without live reload.
    }
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
        } catch {
          // Fallback to default initBltWasm() loader path below.
        }
      }
      if (wasmPath) {
        await initBltWasm(wasmPath);
      } else {
        await initBltWasm();
      }
      connection.console.info("[blt] BLT wasm initialized successfully");
    } catch (bltErr: unknown) {
      const msg = bltErr instanceof Error ? bltErr.message : String(bltErr);
      connection.console.warn(`[blt] initBltWasm warning/deferred: ${msg}`);
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
        resolveProvider: true,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      connection.console.warn(`[onDidOpen] Validation error for ${e.document.uri}: ${msg}`);
    }
  });

  documents.onDidSave(async (e) => {
    try {
      await validationService.validateTextDocument(e.document, { isSave: true });
      const uri = e.document.uri;
      const langId = (e.document.languageId || "").toLowerCase();
      if (langId === "sysml2" || langId === "sysml" || /\.(sysml|sysml2|kerml)$/i.test(uri)) {
        const progressReporter = await LspWorkDoneProgressReporter.create(
          connection,
          "ModelScript Formal Verification",
          {
            message: "Verifying requirements & invariants...",
          },
        );
        await validationService.runVerificationForUri(uri, progressReporter);
      }
      await validationService.runLiveDigitalThreadValidation(uri);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      connection.console.warn(`[onDidSave] Verification error for ${e.document.uri}: ${msg}`);
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
    validationService.lastAutoVerifiedText.delete(uri);

    // Invalidate digital thread slots associated with this URI
    const threadEntries = workspaceManager.getThreadsForUri(uri);
    for (const entry of threadEntries) {
      workspaceManager.hypergraph.markStale(entry.slot);
    }
    validationService.scheduleDigitalThreadValidation(uri);

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
    const isLargeStep =
      (plugin?.id === "step" || /\.(step|stp|p21)$/i.test(uri)) && change.document.getText().length > 32_768;
    const hasCustomValidator = Boolean(plugin?.customHandlers?.validate);
    if (isCfd || isFea || isLargeStep || hasCustomValidator) {
      activeSyntaxDebounceTimers.set(
        uri,
        setTimeout(
          async () => {
            activeSyntaxDebounceTimers.delete(uri);
            if ((validationService.documentRevisions.get(uri) ?? 0) !== currentRevision) return;
            const latestDoc = documents.get(uri);
            await validationService.validateTextDocument(latestDoc ?? change.document);
          },
          hasCustomValidator ? 60 : 100,
        ),
      );
      return;
    }
    const parser =
      plugin?.parser ??
      parserService.getParserForUri(uri) ??
      ((uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim")) && parserService.isParserReady("modelica")
        ? parserService.getParser("modelica")
        : undefined);

    if (parser && !validationService.isWasmParserBusy()) {
      try {
        const text = change.document.getText();
        const oldCached = documentManager.documentTrees.get(uri);
        const tree = parseTreeWithXmlGuard({
          uri,
          text,
          plugin,
          parser,
          oldCached,
          onIncrementalEdit: (edit) => validationService.adjustDiagnostics(uri, edit),
        });

        if (tree) {
          if (oldCached?.tree && oldCached.tree !== tree) {
            oldCached.tree.delete?.();
          }
          const classCache = oldCached && oldCached.text === text ? oldCached.classCache : new Map<string, unknown>();
          documentManager.documentTrees.set(uri, { text, tree, classCache });
          const wsTree = tree as unknown as WorkspaceCstTree;
          workspaceManager.unifiedWorkspace.setDocumentTree(uri, wsTree);
          const uDoc = workspaceManager.unifiedWorkspace.getDocument(uri);
          if (uDoc) {
            uDoc.text = text;
            uDoc.tree = wsTree;
          }
          const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(
            tree.rootNode,
            change.document,
            plugin,
          );
          const wasmLspDiags = validationService
            .convertWasmLintDiagnostics(wasmLintDiags, change.document, plugin, text)
            .filter((d) => {
              const codeStr = String(d.code ?? "").toLowerCase();
              return (
                codeStr !== "2002" &&
                codeStr !== "2003" &&
                codeStr !== "m2002" &&
                codeStr !== "m2003" &&
                codeStr !== "variable-not-found" &&
                codeStr !== "class-not-found"
              );
            });
          const fastDiags = deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags]);
          const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;

          // Surface fast syntax and WASM CST lint errors: clear immediately when 0, debounce by 40ms when editing
          if (fastDiags.length === 0 && lastCount > 0) {
            lastSyntaxErrorsCount.set(uri, 0);
            const cachedSemantic = validationService.applyDiagnosticFilters(
              (validationService.lastSemanticDiagnostics.get(uri) || []).filter(
                (d) =>
                  d.source !== "sysml2-verifier" && (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
              ),
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
                  (d) =>
                    d.source !== "sysml2-verifier" && (typeof d.code !== "number" || d.code < 1000 || d.code >= 6000),
                );
                const allDiags = validationService.applyDiagnosticFilters(
                  deduplicateAllDiagnostics([...fastDiags, ...cachedSemantic]),
                );
                validationService.lastSemanticDiagnostics.set(uri, allDiags);
                connection.sendDiagnostics({ uri, diagnostics: allDiags });
              }, 40),
            );
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        connection.console.warn(`[instant-parse] Error for ${uri}: ${msg}`);
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
          } catch {
            // Previous validation failure is already handled; proceed to re-validate current revision.
          }
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
    const closedLangId = (e.document.languageId || globalLanguageRegistry.getPluginForUri(uri)?.id || "").toLowerCase();
    const linkedThreadUris = new Set<string>();
    for (const entry of workspaceManager.getThreadsForUri(uri)) {
      for (const aligned of workspaceManager.findAlignedElementsBySlot(entry.slot)) {
        if (aligned.uri && aligned.uri !== uri) linkedThreadUris.add(aligned.uri);
      }
    }
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
        oldTree.tree?.facade?.removeDocument?.(u);
        oldTree.tree?.delete?.();
        documentManager.documentTrees.delete(u);
      }
    }
    if (closedLangId) {
      parserService.getFacade(closedLangId)?.removeDocument?.(uri);
    }
    connection.sendDiagnostics({ uri, diagnostics: [] });

    cadMetricsService.disposeDocument(uri);
    // Re-validate only remaining open documents that share the closed language or are linked via digital threads
    const isCrossDomainPeer = (langA: string, langB: string): boolean =>
      (langA === "modelica" && (langB === "sysml2" || langB === "sysml")) ||
      ((langA === "sysml2" || langA === "sysml") && langB === "modelica") ||
      (langA === "psse" && langB === "pscad") ||
      (langA === "pscad" && langB === "psse");
    for (const doc of documents.all()) {
      const docLangId = (doc.languageId || globalLanguageRegistry.getPluginForUri(doc.uri)?.id || "").toLowerCase();
      if (
        linkedThreadUris.has(doc.uri) ||
        (closedLangId && (docLangId === closedLangId || isCrossDomainPeer(closedLangId, docLangId)))
      ) {
        validationService.validateTextDocument(doc).catch(() => {});
      }
    }
  });

  // Construct complete LspContext
  const polyglotEngine = getSharedLspPolyglotEngine();
  const polyglotContext = polyglotEngine.createContext({
    contextId: `lsp-node-${process.pid}`,
  });

  const lspContext: LspContext = {
    connection,
    documents,
    workspaceManager,
    documentManager,
    validationService,
    parserService,
    diagramService,
    cadMetricsService,
    polyglotEngine,
    polyglotContext,
    state: {
      activeValidationPromises: validationService.activeValidationPromises,
      get sharedContext() {
        return (parserService.sharedContext ??
          (globals["sharedContext"] as SharedCompilerContextLike | null | undefined) ??
          null) as SharedCompilerContextLike | null;
      },
      set sharedContext(v: SharedCompilerContextLike | null) {
        parserService.sharedContext = v;
        globals["sharedContext"] = v;
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

  connection.onDidChangeConfiguration((change) => {
    const settingsObj =
      change?.settings && typeof change.settings === "object"
        ? (change.settings as { modelscript?: ModelScriptLspSettings } & ModelScriptLspSettings)
        : undefined;
    const raw = settingsObj?.modelscript ?? settingsObj;
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
      validationService.requestCodeLensRefresh();
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
