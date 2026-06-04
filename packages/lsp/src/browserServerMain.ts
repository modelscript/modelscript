/* eslint-disable */
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";

Error.stackTraceLimit = Infinity;

import {
  CodeActionKind,
  Diagnostic,
  InitializeResult,
  ServerCapabilities,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagramDispatch } from "./diagramApi";
import { type SysML2Layout } from "./sysml2-layout";

// @ts-ignore
// @ts-ignore
// @ts-ignore
// @ts-ignore
// @ts-ignore
// @ts-ignore
// @ts-ignore
// @ts-ignore

import { Node as SyntaxNode, Tree as TreeSitterTree } from "web-tree-sitter";

import { ArenaDAEBuilder, Context, LineIndex, QueryEngine } from "@modelscript/compiler";
import { ArenaQueryFlattener } from "@modelscript/modelica/flattener-query";

import { ModelicaClassDefinitionSyntaxNode } from "@modelscript/modelica/ast";

import { ModelicaClassInstance } from "@modelscript/modelica/semantic-model";

import {
  createModelicaQueryEngine,
  createModelicaScopeResolver,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";

import { createSysML2QueryEngine, createSysML2ScopeResolver } from "@modelscript/sysml2/factory";

import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";

// @ts-ignore
// @ts-ignore
// @ts-ignore
import owl2LangFallback from "@modelscript/owl2/language";
import { clearIconCache } from "./diagramData";
import { registerColorProvider } from "./providers/colorProvider";
import { registerCompletionProvider } from "./providers/completionProvider";
import { registerDefinitionProvider } from "./providers/definitionProvider";
import { registerDocumentFeaturesProvider } from "./providers/documentFeaturesProvider";
import { registerFormattingProvider } from "./providers/formattingProvider";
import { registerHoverProvider } from "./providers/hoverProvider";
import { legend, registerSemanticTokensProvider } from "./providers/semanticTokensProvider";
import { registerWorkspaceFeaturesProvider } from "./providers/workspaceFeaturesProvider";
import { computeTreeEdit } from "./utils/astUtils";
import {
  getCompositeName as _getCompositeName,
  buildClassHierarchy,
  buildComponentTree,
  classKindFromEntry,
  getTreeChildrenFast,
  hasClassChildren,
  isTreeVisible,
} from "./utils/hierarchyUtils";
import { BrowserFileSystem } from "./vfs/browser-file-system";
import { type LoaderContext, loadRegistryPackages } from "./vfs/library-loader";

/**
 * Flatten a class instance using the arena-native pipeline.
 * Bridges the LSP's ModelicaClassInstance world with Context.flattenArena().
 */
function flattenArenaFromInstance(classInstance: ModelicaClassInstance, context: Context): ArenaDAEBuilder {
  const className = classInstance.compositeName || classInstance.name;
  if (!className) throw new Error("Class instance has no name");

  if (!workspaceManager.globalModelicaQueryEngine) throw new Error("Query engine not initialized");
  const flattener = new ArenaQueryFlattener(workspaceManager.globalModelicaQueryEngine.toQueryDB());
  const arena = flattener.flatten(classInstance.id);
  if (!arena) throw new Error(`Failed to flatten class '${className}'`);
  return arena;
}

console.log("ModelScript language server starting...");

/* Browser-specific connection setup */

const globalScope = typeof self !== "undefined" ? self : globalThis;
const messageReader = new BrowserMessageReader(globalScope as any);
const messageWriter = new BrowserMessageWriter(globalScope as any);
const connection = createConnection(messageReader, messageWriter);

/* Shared filesystem + context (populated with MSL during init) */

const sharedFs = new BrowserFileSystem();
let sharedContext: Context | null = null;

/* Loader context — saved from initTreeSitter so notification handlers can reuse it */
let savedLoaderCtx: LoaderContext | null = null;
Object.defineProperty(globalThis, "savedLoaderCtx", { get: () => savedLoaderCtx, set: (v) => (savedLoaderCtx = v) });
globalThis.flattenArenaFromInstance = flattenArenaFromInstance;
globalThis.injectPredefinedTypes = injectPredefinedTypes;

// Expose hierarchy utility functions for extracted handlers
globalThis.getTreeChildrenFast = getTreeChildrenFast;
globalThis.classKindFromEntry = classKindFromEntry;
globalThis.isTreeVisible = isTreeVisible;
globalThis.getCompositeName = _getCompositeName;
globalThis.hasClassChildren = hasClassChildren;
globalThis.buildClassHierarchy = buildClassHierarchy;
globalThis.buildComponentTree = buildComponentTree;
globalThis.clearIconCache = clearIconCache;
globalThis.loadRegistryPackages = loadRegistryPackages;
globalThis.ModelicaClassInstance = ModelicaClassInstance;
globalThis.createModelicaQueryEngine = createModelicaQueryEngine;
globalThis.createSysML2QueryEngine = createSysML2QueryEngine;

/* Tree-sitter state */

/* Incremental parsing — cache last tree per document for reuse */

interface CachedClassEntry {
  classDef: ModelicaClassDefinitionSyntaxNode;
  instance: ModelicaClassInstance;
  diagnostics: Diagnostic[];
}

interface CachedTree {
  text: string;
  tree: TreeSitterTree;
  classCache: Map<string, CachedClassEntry>;
  lineIndex?: LineIndex;
  tokens?: SyntaxNode[];
}

import { DocumentManager } from "./services/DocumentManager";
import { WorkspaceManager } from "./services/WorkspaceManager";

const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
const workspaceManager = new WorkspaceManager(documentManager);
const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
const hierarchyService = new HierarchyService(connection, documentManager, workspaceManager);

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

const diagramService = new DiagramService(connection, documentManager, workspaceManager);
/* Per-document state for hover resolution */
workspaceManager.stepWorkspaceIndex = new StepWorkspaceIndex();
workspaceManager.unifiedWorkspace.registerWorkspace("step", workspaceManager.stepWorkspaceIndex, { priority: 2 });

import { UnifiedWorkspace } from "@modelscript/compiler";
import modelicaLangFallback from "@modelscript/modelica/language";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { registerAnalysisEndpoints } from "./handlers/analysisEndpoints";
import { registerAnalysisHandlers } from "./handlers/analysisHandler";
import { registerClassQueryEndpoints } from "./handlers/classqueryEndpoints";
import { registerDiagramEndpoints } from "./handlers/diagramEndpoints";
import { registerDiagramHandlers } from "./handlers/diagramHandler";
import { registerInteropEndpoints } from "./handlers/interopEndpoints";
import { registerMiscEndpoints } from "./handlers/miscEndpoints";
import { registerSimulationEndpoints } from "./handlers/simulationEndpoints";
import { registerSimulationHandlers } from "./handlers/simulationHandler";
import { registerTreeHandlers } from "./handlers/treeHandler";
import { registerCodeLensProvider } from "./providers/codeLensProvider";
import { registerInlayHintProvider } from "./providers/inlayHintProvider";
import { registerSignatureHelpProvider } from "./providers/signatureHelpProvider";
import { DiagramService } from "./services/DiagramService";
import { HierarchyService } from "./services/HierarchyService";
import { ParserService } from "./services/ParserService";
import { ValidationService } from "./services/ValidationService";
import { StepWorkspaceIndex } from "./step-workspace-index";

const unifiedWorkspace = new UnifiedWorkspace();
const stepWorkspaceIndex = new StepWorkspaceIndex();
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
workspaceManager.unifiedWorkspace.registerWorkspace("owl2", workspaceManager.owl2WorkspaceIndex, owl2LangFallback);

const getReadyMessage = () => {
  const parts = [];
  const mslCount = workspaceManager.globalWorkspaceIndex.fileCount;
  if (mslCount > 0) parts.push(`${mslCount} MSL`);
  const sysmlCount = workspaceManager.sysml2WorkspaceIndex.fileCount;
  if (sysmlCount > 0) parts.push(`${sysmlCount} SysML2`);
  return parts.length > 0 ? `ModelScript (${parts.join(", ")})` : "ModelScript";
};
globalThis.getReadyMessage = getReadyMessage;
workspaceManager.unifiedWorkspace.registerWorkspace("step", workspaceManager.stepWorkspaceIndex, {
  name: "step",
  adapters: {
    sysml2: {
      EntityInstance: (_db: any, foreignNode: any) => ({
        target: "PackageMember",
        props: {
          name: foreignNode.name,
          entityType: (foreignNode.metadata as any)?.entityType,
        },
      }),
    },
  },
});

// ── Multi-Body generation from STEP ───────────────────────────────
globalThis.documentLSPBridges = validationService.documentLSPBridges;

/** Global QueryEngines for cross-file dependency tracking and memoization */
// Global Query Engines are now managed by workspaceManager
let globalOWL2QueryEngine: QueryEngine | null = null;

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

/* Resolve a modification/annotation path element to its named element */

/* Initialize tree-sitter parser */
/* Modelica keyword lists (matching morsel's code.tsx) */

/* Semantic token legend — matches morsel's code.tsx exactly */

/* Language server initialization */

connection.onInitialize((params): InitializeResult => {
  connection.console.info("[lsp] onInitialize called");
  // Get the extension URI from initializationOptions
  const extensionUri = params.initializationOptions?.extensionUri as string;

  // Read the registry URL from client settings (sent via initializationOptions)
  if (params.initializationOptions?.registryUrl) {
    registryUrl = params.initializationOptions.registryUrl as string;
    connection.console.info(`[lsp] Using registry URL: ${registryUrl}`);
  }

  const projectDependencies = params.initializationOptions?.projectDependencies as
    | { name: string; version: string }[]
    | undefined;

  const useLocalMsl = (params.initializationOptions?.useLocalMsl as boolean) ?? false;

  if (extensionUri) {
    connection.console.info(`[lsp] Triggering initTreeSitter with extensionUri=${extensionUri}`);
    parserService.initTreeSitter(extensionUri, validationService, projectDependencies, useLocalMsl).catch((e) => {
      connection.console.error(`[lsp] initTreeSitter threw an error: ${e}\n${e.stack}`);
    });
  } else {
    connection.console.warn("No extensionUri provided — tree-sitter disabled");
  }

  const capabilities: ServerCapabilities = {
    textDocumentSync: TextDocumentSyncKind.Full,
    completionProvider: {
      triggerCharacters: ["."],
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

// Track open, change and close text document events

documents.listen(connection);

// Validate documents when they change, and re-validate other open docs for cross-file resolution
let verificationTimer: ReturnType<typeof setTimeout> | null = null;
let activeVerification: AbortController | null = null;
// (Moved to ValidationService)
// Track deferred semantic work so it can be cancelled when new edits arrive
const activeSemanticTimers = new Map<string, ReturnType<typeof setTimeout>>();
globalThis.activeSemanticTimers = activeSemanticTimers;
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
documents.onDidChangeContent((change) => {
  const tKeypressStart = performance.now();
  const uri = change.document.uri;
  connection.console.info(`[perf][keypress] onDidChangeContent started for ${uri}`);
  validationService.verificationDiagnosticsByUri.delete(uri);
  validationService.verificationResultsByUri.delete(uri);

  // Bump revision — any in-flight deferred semantic work for an older revision
  // will check this and bail out before doing expensive linting.
  validationService.documentRevisions.set(uri, (validationService.documentRevisions.get(uri) ?? 0) + 1);

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

  // === TIER 1: Instant parse + syntax errors (0ms) ===
  // Parse and send syntax errors immediately — before any debounce.
  // Tree-sitter incremental parse is ~2ms even for large files.
  const isModelica = uri.endsWith(".mo") || uri.endsWith(".mos") || uri.endsWith(".msim");
  const isSysml = uri.endsWith(".sysml");
  const isStep = /\.(step|stp|p21)$/i.test(uri);

  if (isModelica && parserService.parserReady && parserService.parser) {
    try {
      const tTextStart = performance.now();
      const text = change.document.getText();
      const tTextEnd = performance.now();
      connection.console.info(`[perf][keypress] getText: ${(tTextEnd - tTextStart).toFixed(2)}ms`);

      const tTreeStart = performance.now();
      const tree = parserService.updateDocumentTree(uri, text);
      const tTreeEnd = performance.now();
      connection.console.info(`[perf][keypress] updateDocumentTree: ${(tTreeEnd - tTreeStart).toFixed(2)}ms`);

      const tErrorsStart = performance.now();
      const syntaxDiags = validationService.collectSyntaxErrors(tree.rootNode, change.document);
      const tErrorsEnd = performance.now();
      connection.console.info(`[perf][keypress] collectSyntaxErrors: ${(tErrorsEnd - tErrorsStart).toFixed(2)}ms`);

      connection.console.info(
        `[instant] Tier 1 fired for ${uri}. text=${text.length}B, syntaxDiags=${syntaxDiags.length}`,
      );

      // Merge with last known semantic diagnostics to prevent flashing —
      // semantic squigglies stay visible until the next semantic pass replaces them.
      const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
      const tDiagsStart = performance.now();
      const allDiags = [...syntaxDiags, ...cachedSemantic];
      if (allDiags.length > 1000) allDiags.length = 1000;
      connection.sendDiagnostics({ uri, diagnostics: allDiags });
      const tDiagsEnd = performance.now();
      connection.console.info(`[perf][keypress] sendDiagnostics: ${(tDiagsEnd - tDiagsStart).toFixed(2)}ms`);
    } catch (e: any) {
      connection.console.warn(`[instant-parse] Error for ${uri}: ${e.message}`);
    }
  } else if (isSysml && parserService.sysml2ParserReady && parserService.sysml2Parser) {
    try {
      const text = change.document.getText();
      const oldCached = documentManager.documentTrees.get(uri);
      let tree: any;
      if (oldCached && oldCached.text !== text) {
        const edit = computeTreeEdit(oldCached.text, text);
        oldCached.tree.edit(edit as never);
        tree = parserService.sysml2Parser.parse(text, oldCached.tree);
      } else if (oldCached) {
        tree = oldCached.tree;
      } else {
        tree = parserService.sysml2Parser.parse(text);
      }
      if (tree) {
        documentManager.documentTrees.set(uri, { text, tree, classCache: new Map() });
        const syntaxDiags = validationService.collectSyntaxErrors(tree.rootNode, change.document);
        const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
        const allDiags = [...syntaxDiags, ...cachedSemantic];
        if (allDiags.length > 1000) allDiags.length = 1000;
        connection.sendDiagnostics({ uri, diagnostics: allDiags });
      }
    } catch (e: any) {
      connection.console.warn(`[instant-parse] Error for ${uri}: ${e.message}`);
    }
  } else if (isStep && parserService.stepParserReady && parserService.stepParser) {
    try {
      const text = change.document.getText();
      const tree = parserService.stepParser.parse(text);
      if (tree) {
        documentManager.documentTrees.set(uri, { text, tree, classCache: new Map() });
        const syntaxDiags = validationService.collectSyntaxErrors(tree.rootNode, change.document);
        const cachedSemantic = validationService.lastSemanticDiagnostics.get(uri) || [];
        connection.sendDiagnostics({ uri, diagnostics: [...syntaxDiags, ...cachedSemantic] });
      }
    } catch (e: any) {
      connection.console.warn(`[instant-parse] Error for ${uri}: ${e.message}`);
    }
  }

  // === TIER 2: Debounced semantic analysis (300ms) ===
  const existingTimer = validationService.activeValidationTimers.get(uri);
  if (existingTimer) clearTimeout(existingTimer);

  const tKeypressEnd = performance.now();
  connection.console.info(`[perf][keypress] Total synchronous work: ${(tKeypressEnd - tKeypressStart).toFixed(2)}ms`);

  const expectedRevision = validationService.documentRevisions.get(uri) ?? 0;
  validationService.activeValidationTimers.set(
    uri,
    setTimeout(async () => {
      connection.console.info(`[timer] 300ms elapsed for ${uri}`);
      validationService.activeValidationTimers.delete(uri);
      // Wait for any in-flight validation to finish before starting a new one.
      // This prevents concurrent pipelines for the same URI from stacking up.
      const inflight = validationService.activeValidationPromises.get(uri);
      connection.console.info(`[timer] inflight is ${!!inflight}`);
      if (inflight) {
        try {
          connection.console.info(`[timer] awaiting inflight`);
          await inflight;
          connection.console.info(`[timer] inflight resolved`);
        } catch {
          connection.console.info(`[timer] inflight rejected`);
        }
      }
      // Re-check staleness: if another edit arrived while we waited, bail out.
      if ((validationService.documentRevisions.get(uri) ?? 0) !== expectedRevision) {
        connection.console.info(`[timer] bailed out due to new edit`);
        return;
      }
      const doc = documents.get(uri);
      connection.console.info(`[timer] doc exists: ${!!doc}`);
      if (doc) validationService.validateTextDocument(doc);
    }, 300),
  );
});

// Clean up when a document is closed
documents.onDidClose((event) => {
  workspaceManager.workspaceInstances.delete(event.document.uri);
  workspaceManager.documentInstances.delete(event.document.uri);
  workspaceManager.documentContexts.delete(event.document.uri);
  const oldTree = documentManager.documentTrees.get(event.document.uri);
  if (oldTree) {
    oldTree.tree.delete();
    documentManager.documentTrees.delete(event.document.uri);
  }
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });

  // Re-validate remaining open documents
  for (const doc of documents.all()) {
    validationService.validateTextDocument(doc);
  }
});
registerSemanticTokensProvider(
  connection,
  documents,
  parserService.getDocumentTree.bind(parserService),
  () => parserService.sysml2Parser,
  () => parserService.sysml2ParserReady,
  (ext, text) => sharedContext?.parse(ext, text),
);

// Completion provider — polyglot-driven scoped completion + keyword fallback
registerCompletionProvider(connection, documents, validationService.documentLSPBridges);

registerHoverProvider(connection, documents, validationService);

/* Go to Definition — reuses hover's resolution logic to locate declarations */

registerDefinitionProvider(connection, documents, validationService.documentLSPBridges, documentManager.documentTrees);
/* Document formatting — uses tree-sitter parse + format() */

registerFormattingProvider(
  connection,
  documents,
  parserService.getDocumentTree.bind(parserService),
  () => parserService.parserReady && !!parserService.parser,
);

/* Document color provider — detects Modelica color fields (color, lineColor, etc.) */

registerColorProvider(
  connection,
  documents,
  parserService.getDocumentTree.bind(parserService),
  () => parserService.parserReady && !!parserService.parser,
);

/* Document symbols — enables Outline panel and breadcrumb navigation */

registerDocumentFeaturesProvider(
  connection,
  documents,
  validationService.documentLSPBridges,
  parserService.getDocumentTree.bind(parserService),
  parserService.getLineIndexForDoc.bind(parserService),
  () => parserService.parserReady && !!parserService.parser,
  () => parserService.sysml2ParserReady && !!parserService.sysml2Parser,
  () => parserService.sysml2Parser,
);

/* Signature Help — shows function parameter info on ( and , */
/* Find References — locates all occurrences of a symbol across open documents */

registerWorkspaceFeaturesProvider(
  connection,
  documents,
  documentManager.documentTrees,
  validationService.flushValidation.bind(validationService),
  async (isSysML2) =>
    isSysML2
      ? await workspaceManager.sysml2WorkspaceIndex.toUnifiedAsync()
      : await workspaceManager.globalWorkspaceIndex.toUnifiedAsync(),
  (isSysML2, unifiedIndex) =>
    isSysML2 ? createSysML2ScopeResolver(unifiedIndex) : createModelicaScopeResolver(unifiedIndex),
  () => workspaceManager.globalWorkspaceIndex,
);

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
// Cache for CAD components — avoids re-flattening on every keystroke.
const cadComponentsCache = new Map<string, { version: string; data: any }>();
// ── Unified Diagram API (dispatch-based) ──

// Lazy-initialized dispatch — backends require runtime state that isn't available at import time.
let diagramDispatch: ReturnType<typeof createDiagramDispatch> | null = null;
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
    arena: ArenaDAEBuilder;
    currentValues: Map<string, number>;
    stepSize: number;
  }
>();
// ── Co-simulation graph extraction from Modelica wrapper model ──

interface CosimParticipantInfo {
  id: string;
  type: "modelica" | "fmu";
  className: string;
  /** For FMU participants, the fileName parameter value. */
  fileName?: string;
}

interface CosimCouplingInfo {
  from: { participantId: string; variable: string };
  to: { participantId: string; variable: string };
}

interface CosimGraphResult {
  ok: boolean;
  participants?: CosimParticipantInfo[];
  couplings?: CosimCouplingInfo[];
  error?: string;
}

// Custom request: get library tree children (lazy loading)
interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName: string;
  classKind: string;
  hasChildren: boolean;
  iconSvg?: string;
  language?: string;
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

/** FQN → SymbolId cache — avoids O(n) scans on repeated getTreeChildren calls. */
let fqnCache = new Map<string, number>();
/** The unified index revision this cache was built against. */
let fqnCacheIndex: any = null;
// Custom request: search classes by name across the workspace index
// Custom request: get project tree (workspace files and their classes)
interface ProjectTreeNodeInfo {
  id: string;
  name: string;
  uri?: string;
  compositeName?: string;
  classKind?: string;
  hasChildren: boolean;
  isFile: boolean;
  iconSvg?: string;
  /** 0-based line number of the class definition */
  line?: number;
}

// Custom request: get class icon SVG
// Custom request: get source code of a class
// Custom request: run a .mos script file
// ── Notebook API: session-scoped cell execution ──
const notebookSessions = new Map<string, ArenaScriptInterpreter>();
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

interface ClassHierarchyNode {
  name: string;
  kind: string;
  description: string | null;
  children: ClassHierarchyNode[];
}

// ── BLT Analysis RPC ──

interface BltAnalysisResult {
  className: string;
  variables: string[];
  equations: string[];
  algebraicLoops: { variables: string[]; equations: string[] }[];
  equationCount: number;
  unknownCount: number;
}

// ── Component Tree RPC ──

interface ComponentTreeNode {
  name: string;
  typeName: string;
  kind: string;
  variability: string | null;
  causality: string | null;
  description: string | null;
  children: ComponentTreeNode[];
}

// ── Interval Analysis RPC ──

interface IntervalBound {
  variable: string;
  lower: number;
  upper: number;
  isComputed: boolean;
}

interface IntervalAnalysisResult {
  className: string;
  bounds: IntervalBound[];
  totalVariables: number;
  boundedCount: number;
}

// ── Optimization RPC ──

interface OptimizationResult {
  className: string;
  status: "optimal" | "infeasible" | "error";
  objectiveValue: number | null;
  parameters: { name: string; value: number }[];
  iterations: number;
  message: string;
}

// ── Model Calibration RPC ──
// ── System Identification RPC ──

interface SysIdResult {
  className: string;
  status: "converged" | "failed" | "error";
  fittedParameters: { name: string; initial: number; fitted: number }[];
  residualNorm: number;
  iterations: number;
  message: string;
}

// ── Symbolic Trace RPC ──

interface SymbolicRewriteStep {
  from: string;
  to: string;
  rule: string;
}

interface SymbolicTraceResult {
  className: string;
  equation: string;
  steps: SymbolicRewriteStep[];
  simplified: string;
}

// Listen on the connection
import { LspContext } from "./LspContext";
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
    sharedContext: (globalThis as any).sharedContext,
    fqnCache: new Map(),
    fqnCacheIndex: new Map(),
    documentRevisions: validationService.documentRevisions,
    documentLSPBridges: validationService.documentLSPBridges,
    lastSemanticDiagnostics: validationService.lastSemanticDiagnostics,
    dependenciesReady: validationService.dependenciesReady,
  },
};

registerDiagramHandlers(lspContext);
registerSimulationHandlers(lspContext);
registerTreeHandlers(lspContext);
registerAnalysisHandlers(lspContext);
registerSimulationEndpoints(lspContext);
registerAnalysisEndpoints(lspContext);
registerInteropEndpoints(lspContext);
registerClassQueryEndpoints(lspContext);
registerMiscEndpoints(lspContext);
registerDiagramEndpoints(lspContext);

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
registerInlayHintProvider(connection);
connection.listen();

let debuggerResumeCallback: (() => void) | undefined;
let currentDebugEnv: Map<string, number> | undefined;
let stepMode = true; // Initially true to stop on first statement
const breakpointsMap = new Map<string, { line: number; column?: number }[]>();

// Expose debugger and co-sim state to extracted handlers
globalThis.cosimSimulators = cosimSimulators;
globalThis.breakpointsMap = breakpointsMap;
Object.defineProperty(globalThis, "debuggerResumeCallback", {
  get: () => debuggerResumeCallback,
  set: (v) => (debuggerResumeCallback = v),
});
Object.defineProperty(globalThis, "currentDebugEnv", { get: () => currentDebugEnv, set: (v) => (currentDebugEnv = v) });
Object.defineProperty(globalThis, "stepMode", { get: () => stepMode, set: (v) => (stepMode = v) });

function formatDebugValue(val: unknown): string {
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

// Cache for resolveMarkdownVars — avoids re-iterating all symbols on repeated calls.
let markdownVarsCache: { version: string; result: { values: Record<string, string> } } | null = null;
// Cache for resolveMarkdownContent — avoids re-iterating all symbols on repeated calls.
let markdownContentCache: { version: string; result: any } | null = null;

export interface FlatSemanticEdit {
  action: "insert" | "delete" | "update" | "none" | "move";
  description: string;
  oldRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  newRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  kind?: string;
}

// Auto-generated exports for extracted handlers
export { cadComponentsCache, documents, flattenArenaFromInstance, sharedContext, simpleHash };

// --- Zero-Copy WebGPU Visualization Pipeline ---
import { WebGPUSimulationRunner } from "../../compiler/src/simulator/core/webgpu-simulation-runner.js";

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
        const { serializeArenaForGPU } = await import("@modelscript/compiler/src/arena-gpu-buffers.js");
        const buffers = serializeArenaForGPU(arena);

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
