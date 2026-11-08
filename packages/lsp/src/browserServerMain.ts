// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser.js";

Error.stackTraceLimit = Infinity;

import {
  CodeActionKind,
  Diagnostic,
  InitializeResult,
  PositionEncodingKind,
  ServerCapabilities,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver";

import { type SysML2Layout } from "@modelscript/sysml2/diagram";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagramDispatch } from "./diagramApi.js";

import type { SyntaxNode, Tree as TreeSitterTree } from "./utils/cst-facade.js";

import { ArenaQueryFlattener, deriveSimplification } from "@modelscript/modelica";
import { DAEBuilder, QueryEngine, initBltWasm } from "@modelscript/runtime";
import { LineIndex } from "./utils/line-index.js";

import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";

import { createOWL2QueryEngine, createOWL2WorkspaceIndex } from "@modelscript/owl2/factory";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";

import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";

import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { AnnotationEvaluator, clearIconCache } from "@modelscript/modelica/diagram";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import { buildSysML2DiagramData } from "@modelscript/sysml2/factory";

import { FIELD_NAMES as csvFieldNames, SYNTAX_NAMES as csvSyntaxNames } from "@modelscript/csv/parser";
import { FIELD_NAMES as modelicaFieldNames, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import { FIELD_NAMES as owl2FieldNames, SYNTAX_NAMES as owl2SyntaxNames } from "@modelscript/owl2/parser";
import { FIELD_NAMES as scadFieldNames, SYNTAX_NAMES as scadSyntaxNames } from "@modelscript/scad/parser";
import { FIELD_NAMES as stepFieldNames, SYNTAX_NAMES as stepSyntaxNames } from "@modelscript/step/parser";
import { FIELD_NAMES as sysml2FieldNames, SYNTAX_NAMES as sysml2SyntaxNames } from "@modelscript/sysml2/parser";
import { legend } from "./providers/semanticTokensProvider.js";
import { registerBuiltinLanguagePlugins } from "./registry/builtin-plugins.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import { registerAllLspEndpoints, registerAllLspProviders } from "./router.js";
import { DiagramService } from "./services/diagram-service.js";
import { HierarchyService } from "./services/hierarchy-service.js";
import { ParserService } from "./services/parser-service.js";
import { ValidationService, deduplicateAllDiagnostics } from "./services/validation-service.js";
import { computeTreeEdit } from "./utils/ast-utils.js";
import { BrowserFileSystem } from "./vfs/browser-file-system.js";
import { type LoaderContext, loadRegistryPackages } from "./vfs/library-loader.js";

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

/* Browser-specific connection setup */

const globalScope = typeof self !== "undefined" ? self : globalThis;
const messageReader = new BrowserMessageReader(globalScope as any);
const messageWriter = new BrowserMessageWriter(globalScope as any);
const connection = createConnection(messageReader, messageWriter);
connection.console.info("ModelScript language server starting...");

/* Shared filesystem + context (populated with MSL during init) */

const sharedFs = new BrowserFileSystem();
let sharedContext: any | null = null;

/* Loader context — saved from initWasmParsers so notification handlers can reuse it */
let savedLoaderCtx: LoaderContext | null = null;
Object.defineProperty(globalThis, "savedLoaderCtx", { get: () => savedLoaderCtx, set: (v) => (savedLoaderCtx = v) });
globalThis.flattenArenaFromInstance = flattenArenaFromInstance;
globalThis.injectPredefinedTypes = injectPredefinedTypes;
globalThis.clearIconCache = clearIconCache;
globalThis.loadRegistryPackages = loadRegistryPackages;
globalThis.createModelicaQueryEngine = createModelicaQueryEngine;
globalThis.createSysML2QueryEngine = createSysML2QueryEngine;
(globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
(globalThis as any).create_sysml2_query_engine = createSysML2QueryEngine;
(globalThis as any).injectPredefinedTypes = injectPredefinedTypes;
(globalThis as any).AnnotationEvaluator = AnnotationEvaluator;
(globalThis as any).create_modelica_workspace_index = createModelicaWorkspaceIndex;
(globalThis as any).create_sysml2_workspace_index = createSysML2WorkspaceIndex;
(globalThis as any).create_owl2_workspace_index = createOWL2WorkspaceIndex;
(globalThis as any).createModelicaWorkspaceIndex = createModelicaWorkspaceIndex;
(globalThis as any).createSysML2WorkspaceIndex = createSysML2WorkspaceIndex;
(globalThis as any).createOWL2WorkspaceIndex = createOWL2WorkspaceIndex;
(globalThis as any).create_owl2_query_engine = createOWL2QueryEngine;
(globalThis as any).createOWL2QueryEngine = createOWL2QueryEngine;
(globalThis as any).modelicaDiagramOps = modelicaDiagramOps;
(globalThis as any).sysml2DiagramOps = { ...sysml2DiagramOps, buildSysML2DiagramData };
(globalThis as any).deriveSimplification = deriveSimplification;

(globalThis as any).modelicaSyntaxNames = modelicaSyntaxNames;
(globalThis as any).modelicaFieldNames = modelicaFieldNames;
(globalThis as any).sysml2SyntaxNames = sysml2SyntaxNames;
(globalThis as any).sysml2FieldNames = sysml2FieldNames;
(globalThis as any).stepSyntaxNames = stepSyntaxNames;
(globalThis as any).stepFieldNames = stepFieldNames;
(globalThis as any).owl2SyntaxNames = owl2SyntaxNames;
(globalThis as any).owl2FieldNames = owl2FieldNames;
(globalThis as any).csvSyntaxNames = csvSyntaxNames;
(globalThis as any).csvFieldNames = csvFieldNames;
(globalThis as any).scadSyntaxNames = scadSyntaxNames;
(globalThis as any).scadFieldNames = scadFieldNames;

/* WASM Parser state */

/* Incremental parsing — cache last tree per document for reuse */

/**
 * Cached instantiation and diagnostic entry for a single class within a parsed document.
 */
interface CachedClassEntry {
  /** Parsed CST or symbol definition reference for the class. */
  classDef: any;
  /** Flattened or instantiated class representation. */
  instance: any;
  /** Semantic diagnostics associated with this class definition. */
  diagnostics: Diagnostic[];
}

/**
 * Per-document incremental parse cache storing the latest CST, source text, and line index.
 */
export interface CachedTree {
  /** Full source text corresponding to the cached parse tree. */
  text: string;
  /** Parsed WebAssembly GLR syntax tree. */
  tree: TreeSitterTree;
  /** Per-class instantiation cache keyed by class name. */
  classCache: Map<string, CachedClassEntry>;
  /** Optional precomputed line offset index for fast UTF-16 position lookups. */
  lineIndex?: LineIndex | undefined;
  /** Optional cached list of leaf syntax tokens. */
  tokens?: SyntaxNode[] | undefined;
}

import { DocumentManager } from "./services/document-manager.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
const workspaceManager = new WorkspaceManager(documentManager);
const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
const hierarchyService = new HierarchyService(connection, documentManager, workspaceManager);
void hierarchyService;

// Expose state to globalThis for loosely-coupled extracted services
globalThis.documents = documents;

Object.defineProperty(globalThis, "sharedContext", { get: () => sharedContext, set: (v) => (sharedContext = v) });
Object.defineProperty(globalThis, "parserReady", {
  get: () => parserService.parserReady,
  set: (v) => (parserService.parserReady = v),
});
Object.defineProperty(globalThis, "parser", {
  get: () => parserService.parser,
  set: (v) => (parserService.parser = v),
});
Object.defineProperty(globalThis, "modelicaParser", {
  get: () => parserService.parser,
  set: (v) => (parserService.parser = v),
});
Object.defineProperty(globalThis, "sysml2ParserReady", {
  get: () => parserService.sysml2ParserReady,
  set: (v) => (parserService.sysml2ParserReady = v),
});
Object.defineProperty(globalThis, "sysml2Parser", {
  get: () => parserService.sysml2Parser,
  set: (v) => (parserService.sysml2Parser = v),
});
Object.defineProperty(globalThis, "stepParserReady", {
  get: () => parserService.stepParserReady,
  set: (v) => (parserService.stepParserReady = v),
});
Object.defineProperty(globalThis, "stepParser", {
  get: () => parserService.stepParser,
  set: (v) => (parserService.stepParser = v),
});
Object.defineProperty(globalThis, "owl2ParserReady", {
  get: () => parserService.owl2ParserReady,
  set: (v) => (parserService.owl2ParserReady = v),
});
Object.defineProperty(globalThis, "owl2Parser", {
  get: () => parserService.owl2Parser,
  set: (v) => (parserService.owl2Parser = v),
});
let fqnCacheIndex = new Map();
let fqnCache = new Map();
Object.defineProperty(globalThis, "fqnCacheIndex", { get: () => fqnCacheIndex, set: (v) => (fqnCacheIndex = v) });
Object.defineProperty(globalThis, "fqnCache", { get: () => fqnCache, set: (v: any) => (fqnCache = v) });

// Expose validateTextDocument as a global function so extracted handlers can call it
globalThis.validateTextDocument = async (doc: any) => {
  await validationService.validateTextDocument(doc);
  const promise = validationService.activeValidationPromises.get(doc.uri);
  if (promise) await promise;
};
globalThis.runVerificationForUri = (uri: string) => validationService.runVerificationForUri(uri);
globalThis.getSharedCstTreeWrapper = () => parserService.getSharedCstTreeWrapper();
globalThis.sharedFs = sharedFs;
globalThis.connection = connection;

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
// Register all 44 built-in domain language plugins & workspace indices
registerBuiltinLanguagePlugins({
  workspaceManager,
  parserService,
  connection,
});

/**
 * Formats a status bar readiness summary string showing loaded MSL and SysML v2 file counts.
 */
const getReadyMessage = () => {
  const parts = [];
  const mslCount = workspaceManager.getWorkspaceIndex("modelica")?.fileCount ?? 0;
  if (mslCount > 0) parts.push(`${mslCount} MSL`);
  const sysmlCount = workspaceManager.getWorkspaceIndex("sysml2")?.fileCount ?? 0;
  if (sysmlCount > 0) parts.push(`${sysmlCount} SysML2`);
  return parts.length > 0 ? `ModelScript (${parts.join(", ")})` : "ModelScript";
};
globalThis.getReadyMessage = getReadyMessage;

// ── Multi-Body generation from STEP ───────────────────────────────
globalThis.documentLSPBridges = validationService.documentLSPBridges;
(globalThis as any).documents = documents;

/** Global QueryEngines for cross-file dependency tracking and memoization */
// Global Query Engines are now managed by workspaceManager
let globalOWL2QueryEngine: QueryEngine | null = null;
void globalOWL2QueryEngine;

Object.defineProperty(globalThis, "csvParser", {
  get: () => parserService.csvParser,
  set: (v) => (parserService.csvParser = v),
  configurable: true,
});
Object.defineProperty(globalThis, "csvParserReady", {
  get: () => parserService.csvParserReady,
  set: (v) => (parserService.csvParserReady = v),
  configurable: true,
});

/* Whether dependencies have loaded */
Object.defineProperty(globalThis, "dependenciesReady", { get: () => validationService.dependenciesReady });

/* Registry URL — read from client initializationOptions or default */
let registryUrl = "https://api.modelscript.org";
Object.defineProperty(globalThis, "registryUrl", {
  get: () => registryUrl,
  set: (v) => (registryUrl = v),
  configurable: true,
});

/* SysML2 layout data — stores diagram positions in-memory (sidecar to .sysml files) */
const sysml2Layouts = new Map<string, SysML2Layout>();
void sysml2Layouts;

/* Resolve a modification/annotation path element to its named element */

/* Initialize tree-sitter parser */
/* Modelica keyword lists (matching morsel's code.tsx) */

/* Semantic token legend — matches morsel's code.tsx exactly */

/* Language server initialization */

connection.onInitialize(async (params): Promise<InitializeResult> => {
  connection.console.info("[lsp] onInitialize called");
  // Get the extension URI from initializationOptions
  const extensionUri = params.initializationOptions?.extensionUri as string;

  let serverDistBase = `${extensionUri}/server/dist`;
  if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
    const origin = (globalThis as unknown as { location?: { origin?: string | undefined } | undefined }).location
      ?.origin;
    if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
      serverDistBase = `${origin}/static/devextensions/server/dist`;
    }
  }
  (globalThis as any).serverDistBase = serverDistBase;
  const stepWs = workspaceManager.getWorkspaceIndex("step");
  if (stepWs) stepWs.serverDistBase = serverDistBase;

  try {
    await initBltWasm(`${serverDistBase}/release.wasm`);
    connection.console.info(`[blt] BLT wasm initialized from ${serverDistBase}/release.wasm`);
  } catch (bltErr) {
    connection.console.warn(`[blt] initBltWasm warning/deferred: ${bltErr}`);
  }

  // Read the registry URL from client settings (sent via initializationOptions)
  if (params.initializationOptions?.registryUrl) {
    registryUrl = params.initializationOptions.registryUrl as string;
    connection.console.info(`[lsp] Using registry URL: ${registryUrl}`);
  }

  const projectDependencies = params.initializationOptions?.projectDependencies as
    | { name: string; version: string }[]
    | undefined;

  const useLocalMsl = (params.initializationOptions?.useLocalMsl as boolean) ?? false;

  const registerBuiltinLanguages = () => {
    registerBuiltinLanguagePlugins({
      workspaceManager,
      parserService,
      connection,
    });
  };

  if (extensionUri) {
    const lazyLoadParsers = Boolean(params.initializationOptions?.lazyLoadParsers);
    const initialLanguageId = params.initializationOptions?.initialLanguageId as string | undefined;
    connection.console.info(
      `[lsp] Triggering initWasmParsers with extensionUri=${extensionUri}, lazyLoadParsers=${lazyLoadParsers}, initialLanguageId=${initialLanguageId ?? "none"}`,
    );
    registerBuiltinLanguages();
    parserService
      .initWasmParsers(extensionUri, validationService, projectDependencies, useLocalMsl, registerBuiltinLanguages, {
        lazyLoadParsers,
        initialLanguageId,
      })
      .then(async () => {
        registerBuiltinLanguages();

        // Revalidate open documents now that parsers are ready
        for (const doc of documents.all()) {
          try {
            await validationService.validateTextDocument(doc);
          } catch (e: any) {
            connection.console.warn(`[lsp] Post-init validation failed for ${doc.uri}: ${e?.message}`);
          }
        }

        // Attempt to fetch user-registered languages from Web IDE express endpoint
        try {
          const origin = (globalThis as unknown as { location?: { origin?: string | undefined } | undefined }).location
            ?.origin;
          if (origin) {
            const resp = await fetch(`${origin}/api/languages/user`);
            if (resp.ok) {
              const catalog = await resp.json();
              const languages = catalog.languages || {};
              for (const [id, entry] of Object.entries<any>(languages)) {
                if (globalLanguageRegistry.getPluginById(id)) continue;
                const wasmUrl = `${origin}/api/languages/user/${id}/parser.wasm`;
                try {
                  const { parser, facade } = await createWasmParser(wasmUrl);
                  parserService.registerParser(id, parser, facade);
                  globalLanguageRegistry.register({
                    id,
                    name: entry.name || id,
                    extensions: entry.extensions || [`.${id}`],
                    parser,
                    facade,
                    disposables: [],
                  });
                  connection.console.info(`[lsp-browser] Loaded user-registered language '${id}'`);
                } catch (wasmErr) {
                  connection.console.warn(`[lsp-browser] Could not load user language '${id}': ${wasmErr}`);
                }
              }
            }
          }
        } catch {
          // optional in non-express or offline contexts
        }
      })
      .catch((e) => {
        connection.console.error(`[lsp] initWasmParsers threw an error: ${e}\n${e.stack}`);
      });
  } else {
    connection.console.warn("No extensionUri provided — WASM parsers disabled");
  }

  const capabilities: ServerCapabilities = {
    positionEncoding: PositionEncodingKind.UTF16,
    textDocumentSync: TextDocumentSyncKind.Full,
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

// Track open, change and close text document events

documents.listen(connection);

// Validate documents when they change, and re-validate other open docs for cross-file resolution
let verificationTimer: ReturnType<typeof setTimeout> | null = null;
let activeVerification: AbortController | null = null;
// (Moved to ValidationService)
// Track deferred semantic work so it can be cancelled when new edits arrive
const activeSemanticTimers = new Map<string, ReturnType<typeof setTimeout>>();
globalThis.activeSemanticTimers = activeSemanticTimers;
const activeShortDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeSyntaxDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastSyntaxErrorsCount = new Map<string, number>();
// Per-URI revision counter: incremented on every edit, checked before semantic work
// Track last-indexed text per URI to avoid re-marking dirty when text hasn't changed
// Track the last semantic diagnostics to avoid flashing when sending early syntax diagnostics
// Throttle projectTreeChanged notifications so the diagram editor isn't rebuilt
// on every keystroke. Uses a leading-edge throttle: the first call fires
// immediately; subsequent calls within the cooldown window are coalesced
// into a single trailing fire.
let projectTreeChangedTimer: ReturnType<typeof setTimeout> | null = null;
let projectTreeChangedPending = false;

// Expose validation/revision state to globalThis for extracted services/handlers
globalThis.activeValidationTimers = validationService.activeValidationTimers;
globalThis.activeValidationPromises = validationService.activeValidationPromises;
globalThis.documentRevisions = validationService.documentRevisions;
globalThis.lastIndexedText = validationService.lastIndexedText;
globalThis.lastSemanticDiagnostics = validationService.lastSemanticDiagnostics;
globalThis.verificationDiagnosticsByUri = validationService.verificationDiagnosticsByUri;
Object.defineProperty(globalThis, "revalidationTimer", {
  get: () => validationService.revalidationTimer,
  set: (v) => (validationService.revalidationTimer = v),
  configurable: true,
});
Object.defineProperty(globalThis, "verificationTimer", {
  get: () => verificationTimer,
  set: (v) => (verificationTimer = v),
  configurable: true,
});
Object.defineProperty(globalThis, "activeVerification", {
  get: () => activeVerification,
  set: (v) => (activeVerification = v),
  configurable: true,
});
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
documents.onDidOpen(async (event) => {
  connection.console.info(`[documents] onDidOpen: ${event.document.uri} (${event.document.languageId})`);
  try {
    await parserService.ensureLanguageParserLoaded(event.document.languageId || event.document.uri);
    await validationService.validateTextDocument(event.document);
  } catch (e: any) {
    connection.console.warn(`[onDidOpen] Validation error for ${event.document.uri}: ${e?.message}`);
  }
});

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
        const wasmLspDiags = validationService.convertWasmLintDiagnostics(wasmLintDiags, change.document, plugin, text);
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

// Clean up when a document is closed
documents.onDidClose((event) => {
  const uri = event.document.uri;
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
    validationService.validateTextDocument(doc);
  }
});

// Custom request: get diagram data for the webview
// Cache to avoid rebuilding diagram data when nothing has changed.
// Key: `${uri}|${className}|${diagramType}|${version}`
const diagramCache = new Map<string, { version: number | string; data: any }>();
globalThis.diagramCache = diagramCache;

/** Fast non-cryptographic hash (djb2) for cache key generation. */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
globalThis.simpleHash = simpleHash;

// Legacy handler — delegates to shared implementation
// Custom request: get component properties on-demand (lazy loading for diagram panel)
// Custom request: get CAD components for the webview
import { cadComponentsCache } from "./handlers/diagramHandler.js";
// ── Unified Diagram API (dispatch-based) ──

// Lazy-initialized dispatch — backends require runtime state that isn't available at import time.
let diagramDispatch: ReturnType<typeof createDiagramDispatch> | null = null;
void diagramDispatch;
// New unified methods — clients should migrate to these
// Custom request: simulate a model
// Custom request: train a surrogate ROM from a Modelica model
// Custom request: optimize a model
// Custom request: calibrate a model against measurement data
// Custom request: discover experiment-annotated classes across the workspace
// ── Monte Carlo uncertainty estimation ──
// ── Step-by-step co-simulation API ──

/** Stored simulator instances for step-by-step co-simulation. */
const cosimSimulators = new Map<
  string,
  {
    arena: DAEBuilder;
    currentValues: Map<string, number>;
    stepSize: number;
  }
>();
// ── Co-simulation graph extraction from Modelica wrapper model ──

/**
 * Metadata for an individual participant in a co-simulation topology.
 */
interface CosimParticipantInfo {
  /** Unique identifier of the participant component instance. */
  id: string;
  /** Participant execution type (`"modelica"` sub-model or imported `"fmu"`). */
  type: "modelica" | "fmu";
  /** Fully qualified Modelica class name of the participant. */
  className: string;
  /** For FMU participants, the fileName parameter value. */
  fileName?: string | undefined;
}

/**
 * Directed signal coupling between two co-simulation participants.
 */
interface CosimCouplingInfo {
  /** Source participant and output port/variable name. */
  from: { participantId: string; variable: string };
  /** Target participant and input port/variable name. */
  to: { participantId: string; variable: string };
}

/**
 * Extracted co-simulation architecture graph from a composite Modelica model.
 */
export interface CosimGraphResult {
  /** Whether extraction succeeded. */
  ok: boolean;
  /** Discovered co-simulation participants. */
  participants?: CosimParticipantInfo[] | undefined;
  /** Directed couplings connecting participant inputs and outputs. */
  couplings?: CosimCouplingInfo[] | undefined;
  /** Error message if graph extraction failed. */
  error?: string | undefined;
}

// Custom request: get library tree children (lazy loading)
/**
 * Node descriptor for lazy-loaded library tree explorer views.
 */
export interface TreeNodeInfo {
  /** Unique symbol or node identifier. */
  id: string;
  /** Unqualified display name of the package or class. */
  name: string;
  /** Fully qualified dot-separated composite name. */
  compositeName: string;
  /** Restricted class kind (e.g., `"package"`, `"model"`, `"block"`). */
  classKind: string;
  /** Whether this node contains nested child classes or packages. */
  hasChildren: boolean;
  /** Optional rendered SVG icon markup. */
  iconSvg?: string | undefined;
  /** Source modeling language identifier. */
  language?: string | undefined;
  /** Optional descriptive text or status. */
  description?: string | null | undefined;
  /** True when the icon is pending. */
  pendingIcon?: boolean | undefined;
}

// ── Fast library tree: works directly from SymbolIndex metadata ──
// No ModelicaClassInstance creation, no instantiation, no icon rendering.
// Uses childrenOf map for O(1) parent-child lookups.

/** Known Modelica class kind keywords — order matters (last match wins in classPrefixes text). */
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

/** Map SysML2 grammar rule names to human-readable class kinds for the tree view. */
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

/** Visible SysML2 symbol kinds in the library tree. */
const SYSML2_TREE_KINDS = new Set(["Definition", "Package", "Enumeration"]);

// Expose constants for extracted handlers
globalThis.CLASS_KIND_KEYWORDS = CLASS_KIND_KEYWORDS;
globalThis.SYSML2_RULE_TO_KIND = SYSML2_RULE_TO_KIND;
globalThis.SYSML2_TREE_KINDS = SYSML2_TREE_KINDS;

// Custom request: search classes by name across the workspace index
// Custom request: get project tree (workspace files and their classes)
/**
 * Node descriptor for workspace project tree views (files and their declared classes).
 */
export interface ProjectTreeNodeInfo {
  /** Unique node identifier. */
  id: string;
  /** File basename or class identifier. */
  name: string;
  /** Document URI associated with the node. */
  uri?: string | undefined;
  /** Fully qualified class name when `isFile` is false. */
  compositeName?: string | undefined;
  /** Class restriction kind when `isFile` is false. */
  classKind?: string | undefined;
  /** Whether the file or class has nested children. */
  hasChildren: boolean;
  /** True if this node represents a workspace file; false if it represents a class. */
  isFile: boolean;
  /** Optional rendered SVG icon markup. */
  iconSvg?: string | undefined;
  /** 0-based line number of the class definition */
  line?: number | undefined;
}

// Custom request: get class icon SVG
// Custom request: get source code of a class
// Custom request: run a .mos script file
// ── Notebook API: session-scoped cell execution ──
const notebookSessions = new Map<string, ArenaScriptInterpreter>();
void notebookSessions;
// Custom request: add a component to a model (drag-drop from library tree)
// ── MCP Bridge: custom requests for AI chat integration ──
// List all top-level classes across all loaded documents (for AI chat context)
// ── FMU generation capability ──────────────────────────────────────
// ── STEP 3D mesh retrieval ──────────────────────────────────────
// ── FMU registration (binary data via custom request) ──────────────────
// Custom request: import an FMU and generate a Modelica wrapper block source
// ── Code Lens Provider ──
// ── Inlay Hints Provider ──
// ── Class Hierarchy RPC ──

/**
 * Recursive node representing an inheritance hierarchy entry (`extends` tree).
 */
export interface ClassHierarchyNode {
  /** Class name. */
  name: string;
  /** Restricted class kind (e.g., `"model"`, `"block"`, `"connector"`). */
  kind: string;
  /** Optional documentation string attached to the class. */
  description: string | null;
  /** Base classes or derived classes in the hierarchy tree. */
  children: ClassHierarchyNode[];
}

// ── BLT Analysis RPC ──

/**
 * Block Lower Triangular (BLT) causalization and structural diagnostics result.
 */
export interface BltAnalysisResult {
  /** Name of the flattened class analyzed. */
  className: string;
  /** Ordered list of unknown state and algebraic variable names. */
  variables: string[];
  /** Formatted equation strings in causal execution order. */
  equations: string[];
  /** Coupled algebraic loop blocks (strongly connected components with size > 1). */
  algebraicLoops: { variables: string[]; equations: string[] }[];
  /** Total scalar equation count. */
  equationCount: number;
  /** Total scalar unknown variable count. */
  unknownCount: number;
}

// ── Component Tree RPC ──

/**
 * Hierarchical component instance node within an instantiated model.
 */
export interface ComponentTreeNode {
  /** Component instance identifier. */
  name: string;
  /** Declared type or class name of the component. */
  typeName: string;
  /** Element kind (`"component"`, `"parameter"`, `"connector"`, etc.). */
  kind: string;
  /** Variability prefix (`"constant"`, `"parameter"`, `"discrete"`, `"continuous"`). */
  variability: string | null;
  /** Causality prefix (`"input"`, `"output"`, or `null`). */
  causality: string | null;
  /** Description comment string if present. */
  description: string | null;
  /** Nested sub-components of this component instance. */
  children: ComponentTreeNode[];
}

// ── Interval Analysis RPC ──

/**
 * Computed or declared interval enclosure `[lower, upper]` for a single model variable.
 */
interface IntervalBound {
  /** Variable name. */
  variable: string;
  /** Lower interval bound. */
  lower: number;
  /** Upper interval bound. */
  upper: number;
  /** Whether the bound was derived via interval propagation rather than explicitly declared. */
  isComputed: boolean;
}

/**
 * Result of static interval abstract interpretation over a flattened model.
 */
export interface IntervalAnalysisResult {
  /** Analyzed class name. */
  className: string;
  /** Variable interval enclosures. */
  bounds: IntervalBound[];
  /** Total number of variables inspected. */
  totalVariables: number;
  /** Number of variables with finite lower and upper bounds. */
  boundedCount: number;
}

// ── Optimization RPC ──

/**
 * Result of a numerical design optimization or trajectory optimization run.
 */
export interface OptimizationResult {
  /** Target class name. */
  className: string;
  /** Termination status of the optimizer. */
  status: "optimal" | "infeasible" | "error";
  /** Final objective cost value, or `null` if infeasible/errored. */
  objectiveValue: number | null;
  /** Optimal decision variable assignments. */
  parameters: { name: string; value: number }[];
  /** Number of solver iterations executed. */
  iterations: number;
  /** Human-readable solver convergence summary. */
  message: string;
}

// ── Model Calibration RPC ──
// ── System Identification RPC ──

/**
 * Result of system identification / parameter estimation against measured time series.
 */
export interface SysIdResult {
  /** Target class name. */
  className: string;
  /** Convergence status of the parameter fitting solver. */
  status: "converged" | "failed" | "error";
  /** Estimated parameters with their initial guesses and fitted values. */
  fittedParameters: { name: string; initial: number; fitted: number }[];
  /** Final L2 residual norm between simulated and measured trajectories. */
  residualNorm: number;
  /** Number of optimizer iterations performed. */
  iterations: number;
  /** Solver status message. */
  message: string;
}

// ── Symbolic Trace RPC ──

/**
 * Single algebraic term-rewriting step applied during symbolic equation simplification.
 */
interface SymbolicRewriteStep {
  /** Expression string before rewriting. */
  from: string;
  /** Expression string after rewriting. */
  to: string;
  /** Name of the algebraic rewrite rule applied. */
  rule: string;
}

/**
 * Complete trace of symbolic transformations applied to an equation.
 */
export interface SymbolicTraceResult {
  /** Enclosing class name. */
  className: string;
  /** Original un-simplified equation string. */
  equation: string;
  /** Sequence of intermediate rewrite steps. */
  steps: SymbolicRewriteStep[];
  /** Final simplified canonical equation string. */
  simplified: string;
}

// Listen on the connection
import { LspContext } from "./lsp-context.js";
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

registerAllLspProviders(lspContext);
registerAllLspEndpoints(lspContext);
connection.listen();

let debuggerResumeCallback: (() => void) | undefined;
let currentDebugEnv: Map<string, number> | undefined;
let stepMode = true; // Initially true to stop on first statement
const breakpointsMap = new Map<string, { line: number; column?: number | undefined }[]>();

// Expose debugger and co-sim state to extracted handlers
globalThis.cosimSimulators = cosimSimulators;
globalThis.breakpointsMap = breakpointsMap;
Object.defineProperty(globalThis, "debuggerResumeCallback", {
  get: () => debuggerResumeCallback,
  set: (v) => (debuggerResumeCallback = v),
});
Object.defineProperty(globalThis, "currentDebugEnv", { get: () => currentDebugEnv, set: (v) => (currentDebugEnv = v) });
Object.defineProperty(globalThis, "stepMode", { get: () => stepMode, set: (v) => (stepMode = v) });

/**
 * Formats a runtime debugger value (scalar or array wrapper) into a human-readable string.
 */
export function formatDebugValue(val: unknown): string {
  if (val !== null && typeof val === "object" && "elements" in val) {
    const arrVal = val as { elements: unknown[] };
    if (Array.isArray(arrVal.elements)) {
      return `[${arrVal.elements.map(formatDebugValue).join(", ")}]`;
    }
  }
  return String(val);
}

// ── Requirements Management: spreadsheet data for webview editors ──
// ── Markdown Variable Resolution: resolve {{ Pkg.Def.attr }} from the index ──

/**
 * Rule names that commonly carry initializer values (= expr).
 * Covers both SysML2 and Modelica entries.
 */
const VALUE_CARRYING_RULES = new Set([
  // SysML2
  "AttributeUsage",
  "ReferenceUsage",
  "DefaultReferenceUsage",
  "PartUsage",
  "PortUsage",
  "ItemUsage",
  "EnumerationUsage",
  "ConstraintUsage",
  // Modelica (PascalCase rule names from the Modelica grammar)
  "ComponentDeclaration",
  "ShortClassDefinition",
]);
void VALUE_CARRYING_RULES;

// Cache for resolveMarkdownVars — avoids re-iterating all symbols on repeated calls.
let markdownVarsCache: { version: string; result: { values: Record<string, string> } } | null = null;
void markdownVarsCache;
// Cache for resolveMarkdownContent — avoids re-iterating all symbols on repeated calls.
let markdownContentCache: { version: string; result: any } | null = null;
void markdownContentCache;

/**
 * Semantic AST diff entry describing an insertion, deletion, update, or move between model revisions.
 */
export interface FlatSemanticEdit {
  /** Diff operation kind. */
  action: "insert" | "delete" | "update" | "none" | "move";
  /** Human-readable summary of the semantic change. */
  description: string;
  /** Source range in the prior revision, if applicable. */
  oldRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined;
  /** Source range in the updated revision, if applicable. */
  newRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined;
  /** Optional AST node or declaration kind affected by the edit. */
  kind?: string | undefined;
}

// Auto-generated exports for extracted handlers
export { cadComponentsCache, documents, flattenArenaFromInstance, sharedContext, simpleHash };

// --- Zero-Copy WebGPU Visualization Pipeline ---
import { WebGPUSimulationRunner } from "@modelscript/simulate";

if (typeof self !== "undefined") {
  self.addEventListener("message", async (e: MessageEvent) => {
    if (e.data && e.data.type === "START_ZERO_COPY") {
      const { canvas, uri, className } = e.data;
      connection.console.info(`[ZeroCopy] Initializing OffscreenCanvas WebGPU pipeline for ${uri}`);

      try {
        let instances = workspaceManager.documentInstances.get(uri);
        if (!instances || instances.length === 0) {
          throw new Error("No class instances found for this document.");
        }
        let classInstance = instances[0];
        if (className) {
          const found = instances.find((i) => i.name === className);
          if (found) classInstance = found;
        }

        const docContext = workspaceManager.documentContexts.get(uri);
        if (!docContext) throw new Error("No Modelica context found");

        const arena = flattenArenaFromInstance(classInstance, docContext);
        const { performBltTransformationArena } = await import("@modelscript/runtime");
        const { serializeArenaForGPU } = await import("@modelscript/simulate");
        const stateVars = new Set<number>();
        const bltResult = performBltTransformationArena(arena, stateVars, new Set<number>());
        const buffers = serializeArenaForGPU(arena, bltResult, stateVars);

        const runner = new WebGPUSimulationRunner(arena, buffers);
        const initialized = await runner.initialize();
        if (!initialized) {
          throw new Error("WebGPU initialization failed on worker");
        }

        const context = canvas.getContext("webgpu");
        if (!context) throw new Error("WebGPU context not available on offscreen canvas");

        const format = "bgra8unorm"; // Standard format for offscreen WebGPU
        context.configure({
          device: runner.device,
          format,
          alphaMode: "premultiplied",
        });

        const SHADER_CODE = `
        @group(0) @binding(0) var<storage, read> sim_state: array<f32>;

        struct VertexOutput {
            @builtin(position) position: vec4<f32>,
            @location(0) color: vec3<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            var out: VertexOutput;
            let total_states = f32(arrayLength(&sim_state));
            let x = (f32(vertexIndex) / max(total_states - 1.0, 1.0)) * 2.0 - 1.0;
            let y = sim_state[vertexIndex] * 0.1;
            out.position = vec4<f32>(x, y, 0.0, 1.0);
            let r = clamp(y + 0.5, 0.0, 1.0);
            let b = clamp(0.5 - y, 0.0, 1.0);
            out.color = vec3<f32>(r, 0.5, b);
            return out;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
            return vec4<f32>(in.color, 1.0);
        }
        `;

        const shaderModule = runner.device.createShaderModule({ code: SHADER_CODE });
        const pipeline = runner.device.createRenderPipeline({
          layout: "auto",
          vertex: { module: shaderModule, entryPoint: "vs_main" },
          fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
          primitive: { topology: "line-strip" },
        });

        const bindGroup = runner.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: runner.stateBuffer } }],
        });

        const numVars = runner.buffers.varCount;
        let currentTime = 0;
        const dt = 0.001;

        const loop = () => {
          for (let i = 0; i < 10; i++) {
            runner.stepSimulation(dt, currentTime);
            currentTime += dt;
          }

          const commandEncoder = runner.device.createCommandEncoder();
          const textureView = context.getCurrentTexture().createView();
          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
              {
                view: textureView,
                clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          renderPass.setPipeline(pipeline);
          renderPass.setBindGroup(0, bindGroup);
          renderPass.draw(numVars, 1, 0, 0);
          renderPass.end();

          runner.device.queue.submit([commandEncoder.finish()]);

          if (typeof requestAnimationFrame !== "undefined") {
            requestAnimationFrame(loop);
          } else {
            setTimeout(loop, 16);
          }
        };
        loop();

        connection.console.info(`[ZeroCopy] Pipeline running successfully!`);
      } catch (e) {
        connection.console.error(`[ZeroCopy] Error: ${e}`);
      }
    }
  });
}
