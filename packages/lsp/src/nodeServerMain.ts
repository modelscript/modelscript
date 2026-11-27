// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { initBltWasm, type WorkspaceParser } from "@modelscript/runtime";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import { buildSysML2DiagramData } from "@modelscript/sysml2/factory";
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
import { ParserService } from "./services/parser-service.js";
import {
  createDocumentLifecycleTimers,
  createFlattenArenaFromInstance,
  registerDocumentLifecycleHandlers,
} from "./services/server-lifecycle.js";
import { ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";
import { LspWorkDoneProgressReporter } from "./utils/progress-reporter.js";
import { BrowserFileSystem } from "./vfs/browser-file-system.js";

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

  const documents = new TextDocuments(TextDocument);

  // Instantiate core LSP services
  const documentManager: DocumentManager = new DocumentManager(documents, () =>
    parserService.getSharedCstTreeWrapper(),
  );
  const workspaceManager = new WorkspaceManager(documentManager);
  workspaceManager.sharedFs = sharedFs;
  const parserService: ParserService = new ParserService(connection, documentManager, workspaceManager, documents);
  workspaceManager.parserService = parserService;
  parserService.sharedFs = sharedFs;
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
  parserService.setValidationService(validationService);
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

  const flattenArenaFromInstance = createFlattenArenaFromInstance(workspaceManager);
  // Minimal external-package bridge (read by @modelscript/modelica/diagram & LanguageRegistry)
  const externalGlobalBridge = globalThis as {
    documents?: TextDocuments<TextDocument>;
    modelicaDiagramOps?: typeof modelicaDiagramOps;
  };
  externalGlobalBridge.documents = documents;
  externalGlobalBridge.modelicaDiagramOps = modelicaDiagramOps;

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

  // Coalesced startup re-validation scheduler so concurrent WASM parser loads
  // don't trigger a thundering herd of redundant full document validations.
  let startupRevalidateTimer: ReturnType<typeof setTimeout> | null = null;
  let isShutDown = false;
  const newlyReadyParserIds = new Set<string>();

  const clearStartupRevalidateTimer = (): void => {
    isShutDown = true;
    if (startupRevalidateTimer !== null) {
      clearTimeout(startupRevalidateTimer);
      startupRevalidateTimer = null;
    }
    newlyReadyParserIds.clear();
  };

  connection.onShutdown(clearStartupRevalidateTimer);
  connection.onExit(clearStartupRevalidateTimer);

  const scheduleStartupRevalidation = (parserId: string): void => {
    if (isShutDown) return;
    newlyReadyParserIds.add(parserId.toLowerCase());
    if (startupRevalidateTimer !== null) {
      clearTimeout(startupRevalidateTimer);
    }
    startupRevalidateTimer = setTimeout(() => {
      startupRevalidateTimer = null;
      if (isShutDown) return;
      const readyIds = new Set(newlyReadyParserIds);
      newlyReadyParserIds.clear();
      for (const doc of documents.all()) {
        const plugin = globalLanguageRegistry.getPluginForUri(doc.uri);
        const docLangId = (doc.languageId || plugin?.id || "").toLowerCase();
        const pluginId = plugin?.id.toLowerCase();
        if (!docLangId || readyIds.has(docLangId) || (pluginId !== undefined && readyIds.has(pluginId))) {
          validationService.validateTextDocument(doc).catch(() => {});
        }
      }
    }, 50);
    startupRevalidateTimer.unref?.();
  };

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
            if (isShutDown) return;
            parserService.registerParser(item.id, parser, facade);
            const plugin = globalLanguageRegistry.getPluginById(item.id);
            const exts = plugin?.extensions ?? [`.${item.id}`];
            if (workspaceManager?.unifiedWorkspace && parser) {
              for (const ext of exts) {
                workspaceManager.unifiedWorkspace.registerParser(ext, parser as unknown as WorkspaceParser);
                workspaceManager.unifiedWorkspace.registerLanguageExtension(ext, item.id);
              }
            }
            // Schedule a single coalesced re-validation pass for open documents matching newly ready parsers
            scheduleStartupRevalidation(item.id);
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

  const lifecycleTimers = createDocumentLifecycleTimers();
  registerDocumentLifecycleHandlers({
    connection,
    documents,
    documentManager,
    workspaceManager,
    parserService,
    validationService,
    diagramService,
    cadMetricsService,
    timers: lifecycleTimers,
    debounceMs: 180,
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
    sharedFs,
    flattenArenaFromInstance,
    state: {
      activeValidationPromises: validationService.activeValidationPromises,
      get sharedContext() {
        return parserService.sharedContext ?? null;
      },
      set sharedContext(v: SharedCompilerContextLike | null) {
        parserService.sharedContext = v;
      },
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
    lspContext,
  };
}

// Auto-start if executed directly via node
if (process.argv[1] && process.argv[1].endsWith("nodeServerMain.js")) {
  startNodeServer();
}
