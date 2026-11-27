// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser.js";

if ((globalThis as { __DEBUG_LSP__?: unknown }).__DEBUG_LSP__) {
  Error.stackTraceLimit = Infinity;
}

import {
  CodeActionKind,
  Diagnostic,
  InitializeResult,
  PositionEncodingKind,
  ServerCapabilities,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagramDispatch } from "./diagramApi.js";

import type { ModelScriptLspSettings, SharedCompilerContextLike } from "./lsp-context.js";
import type { Tree as ParsedCstTree, SyntaxNode } from "./utils/cst-facade.js";

import { initBltWasm, type WorkspaceParser } from "@modelscript/runtime";
import { LineIndex } from "./utils/line-index.js";

import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import { buildSysML2DiagramData } from "@modelscript/sysml2/factory";

import { FIELD_NAMES as csvFieldNames, SYNTAX_NAMES as csvSyntaxNames } from "@modelscript/csv/parser";
import { FIELD_NAMES as lasFieldNames, SYNTAX_NAMES as lasSyntaxNames } from "@modelscript/las/parser";
import { FIELD_NAMES as modelicaFieldNames, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import { FIELD_NAMES as owl2FieldNames, SYNTAX_NAMES as owl2SyntaxNames } from "@modelscript/owl2/parser";
import { FIELD_NAMES as scadFieldNames, SYNTAX_NAMES as scadSyntaxNames } from "@modelscript/scad/parser";
import { FIELD_NAMES as stepFieldNames, SYNTAX_NAMES as stepSyntaxNames } from "@modelscript/step/parser";
import { FIELD_NAMES as sysml2FieldNames, SYNTAX_NAMES as sysml2SyntaxNames } from "@modelscript/sysml2/parser";
import { legend } from "./providers/semanticTokensProvider.js";
import { ensureLazyLanguagePluginLoaded, registerCoreLanguagePlugins } from "./registry/core-plugins.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import { registerAllLspEndpoints, registerAllLspProviders } from "./router.js";
import { DiagramService } from "./services/diagram-service.js";
import { ParserService } from "./services/parser-service.js";
import {
  createDocumentLifecycleTimers,
  createFlattenArenaFromInstance,
  registerDocumentLifecycleHandlers,
  simpleHash,
} from "./services/server-lifecycle.js";
import { ValidationService } from "./services/validation-service.js";
import { LspWorkDoneProgressReporter } from "./utils/progress-reporter.js";
import { BrowserFileSystem } from "./vfs/browser-file-system.js";

interface UserLanguageCatalogEntry {
  extensions?: string[] | undefined;
  name?: string | undefined;
}

/* Browser-specific connection setup */

const globalScope = (typeof self !== "undefined" ? self : globalThis) as unknown as ConstructorParameters<
  typeof BrowserMessageReader
>[0];
const messageReader = new BrowserMessageReader(globalScope);
const messageWriter = new BrowserMessageWriter(globalScope);
const connection = createConnection(messageReader, messageWriter);
connection.console.info("ModelScript language server starting...");

/* Shared filesystem + context (populated with MSL during init) */

const sharedFs = new BrowserFileSystem();
let sharedContext: SharedCompilerContextLike | null = null;

/* Registry URL — read from client initializationOptions or default */
let registryUrl = "https://api.modelscript.org";

/**
 * Minimal external-package bridge on `globalThis` for packages outside `@modelscript/lsp`
 * that read `serverDistBase` (`@modelscript/runtime/analysis/wasm_blt`, `@modelscript/modelica/diagram`,
 * `@modelscript/fortran`, `@modelscript/scad`), `modelicaDiagramOps` (`@modelscript/modelica/diagram`),
 * or `documents` (`LanguageRegistry`).
 */
const externalGlobalBridge = globalThis as {
  serverDistBase?: string;
  modelicaDiagramOps?: typeof modelicaDiagramOps;
  documents?: TextDocuments<TextDocument>;
};

/* WASM Parser state */

/* Incremental parsing — cache last tree per document for reuse */

/**
 * Cached instantiation and diagnostic entry for a single class within a parsed document.
 */
interface CachedClassEntry {
  /** Parsed CST or symbol definition reference for the class. */
  classDef: unknown;
  /** Flattened or instantiated class representation. */
  instance: unknown;
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
  tree: ParsedCstTree;
  /** Per-class instantiation cache keyed by class name. */
  classCache: Map<string, CachedClassEntry>;
  /** Optional precomputed line offset index for fast UTF-16 position lookups. */
  lineIndex?: LineIndex | undefined;
  /** Optional cached list of leaf syntax tokens. */
  tokens?: SyntaxNode[] | undefined;
}

import { CadMetricsService } from "./services/cad-metrics-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

const documents = new TextDocuments(TextDocument);
const documentManager: DocumentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
const workspaceManager = new WorkspaceManager(documentManager);
workspaceManager.sharedFs = sharedFs;
const flattenArenaFromInstance = createFlattenArenaFromInstance(workspaceManager);
const parserService: ParserService = new ParserService(connection, documentManager, workspaceManager, documents);
workspaceManager.parserService = parserService;
parserService.sharedFs = sharedFs;
parserService.registryUrl = registryUrl;
parserService.registerSyntaxTables({
  modelica: { syntaxNames: modelicaSyntaxNames, fieldNames: modelicaFieldNames },
  sysml2: { syntaxNames: sysml2SyntaxNames, fieldNames: sysml2FieldNames },
  step: { syntaxNames: stepSyntaxNames, fieldNames: stepFieldNames },
  owl2: { syntaxNames: owl2SyntaxNames, fieldNames: owl2FieldNames },
  csv: { syntaxNames: csvSyntaxNames, fieldNames: csvFieldNames },
  las: { syntaxNames: lasSyntaxNames, fieldNames: lasFieldNames },
  scad: { syntaxNames: scadSyntaxNames, fieldNames: scadFieldNames },
});
const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
parserService.setValidationService(validationService);
const cadMetricsService = new CadMetricsService();

// Minimal external-package bridge (read by @modelscript/modelica/diagram & LanguageRegistry)
externalGlobalBridge.documents = documents;
externalGlobalBridge.modelicaDiagramOps = modelicaDiagramOps;

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
// Register core language plugins eagerly; non-core domain & heritage plugins are lazy-loaded on demand
registerCoreLanguagePlugins({
  workspaceManager,
  parserService,
  connection,
});

/* Resolve a modification/annotation path element to its named element */

/* Initialize WASM parser */
/* Modelica keyword lists (matching ansatz's code.tsx) */

/* Semantic token legend — matches ansatz's code.tsx exactly */

/* Language server initialization */

connection.onInitialize(async (params): Promise<InitializeResult> => {
  connection.console.info("[lsp] onInitialize called");
  // Get the extension URI from initializationOptions
  const extensionUri = params.initializationOptions?.extensionUri as string;

  let serverDistBase = `${extensionUri}/server/dist`;
  if (!serverDistBase.startsWith("http://") && !serverDistBase.startsWith("https://")) {
    const origin = typeof self !== "undefined" ? self.location?.origin : undefined;
    if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
      serverDistBase = `${origin}/static/devextensions/server/dist`;
    }
  }
  parserService.serverDistBase = serverDistBase;
  externalGlobalBridge.serverDistBase = serverDistBase;

  try {
    await initBltWasm(`${serverDistBase}/release.wasm`);
    connection.console.info(`[blt] BLT wasm initialized from ${serverDistBase}/release.wasm`);
  } catch (bltErr) {
    connection.console.warn(`[blt] initBltWasm warning/deferred: ${bltErr}`);
  }

  // Read the registry URL from client settings (sent via initializationOptions)
  if (params.initializationOptions?.registryUrl) {
    registryUrl = params.initializationOptions.registryUrl as string;
    parserService.registryUrl = registryUrl;
    connection.console.info(`[lsp] Using registry URL: ${registryUrl}`);
  }

  const projectDependencies = params.initializationOptions?.projectDependencies as
    { name: string; version: string }[] | undefined;

  const useLocalMsl = (params.initializationOptions?.useLocalMsl as boolean) ?? false;

  const registerBuiltinLanguages = () => {
    registerCoreLanguagePlugins({
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
    if (!lazyLoadParsers) {
      void ensureLazyLanguagePluginLoaded("__all__", { workspaceManager, parserService, connection });
    } else if (initialLanguageId) {
      void ensureLazyLanguagePluginLoaded(initialLanguageId, { workspaceManager, parserService, connection });
    }
    parserService
      .initWasmParsers(extensionUri, validationService, projectDependencies, useLocalMsl, registerBuiltinLanguages, {
        lazyLoadParsers,
        initialLanguageId,
      })
      .then(async () => {
        registerBuiltinLanguages();

        // In lazyLoadParsers mode, initWasmParsers already ran the early validation pass and
        // each ensureStdlibForLanguage() revalidates its own matching documents once loaded.
        // Skip the redundant full-workspace revalidation sweep here to avoid validating every
        // companion file multiple times during startup.
        if (!lazyLoadParsers) {
          for (const doc of documents.all()) {
            try {
              await validationService.validateTextDocument(doc);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              connection.console.warn(`[lsp] Post-init validation failed for ${doc.uri}: ${msg}`);
            }
          }
        }

        // Attempt to fetch user-registered languages from Web IDE express endpoint
        try {
          const origin = typeof self !== "undefined" ? self.location?.origin : undefined;
          if (origin) {
            const resp = await fetch(`${origin}/api/languages/user`);
            if (resp.ok) {
              const catalog = (await resp.json()) as {
                languages?: Record<string, UserLanguageCatalogEntry> | undefined;
              };
              const languages = catalog.languages || {};
              for (const [rawId, entry] of Object.entries(languages)) {
                const id = rawId.toLowerCase();
                if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
                  connection.console.warn(`[lsp-browser] Ignoring invalid custom language identifier: '${rawId}'`);
                  continue;
                }
                if (globalLanguageRegistry.getPluginById(id)) continue;
                const wasmUrl = `${origin}/api/languages/user/${encodeURIComponent(id)}/parser.wasm`;
                try {
                  const { parser, facade } = await createWasmParser(wasmUrl);
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
      .catch((e: unknown) => {
        const stack = e instanceof Error ? (e.stack ?? "") : "";
        connection.console.error(`[lsp] initWasmParsers threw an error: ${e}\n${stack}`);
      });
  } else {
    connection.console.warn("No extensionUri provided — WASM parsers disabled");
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
  connection.console.info("ModelScript Browser Language Server initialized.");
});

// Track open, change and close text document events

documents.listen(connection);

// Track deferred semantic work so it can be cancelled when new edits arrive
const lifecycleTimers = createDocumentLifecycleTimers();
documents.onDidOpen(async (event) => {
  connection.console.info(`[documents] onDidOpen: ${event.document.uri} (${event.document.languageId})`);
  try {
    await parserService.ensureLanguageParserLoaded(event.document.languageId || event.document.uri);
    await validationService.validateTextDocument(event.document);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    connection.console.warn(`[onDidOpen] Validation error for ${event.document.uri}: ${msg}`);
  }
});

documents.onDidSave(async (event) => {
  try {
    await validationService.validateTextDocument(event.document, { isSave: true });
    const uri = event.document.uri;
    const langId = (event.document.languageId || "").toLowerCase();
    if (langId === "sysml2" || langId === "sysml" || /\.(sysml|sysml2|kerml)$/i.test(uri)) {
      const progressReporter = await LspWorkDoneProgressReporter.create(connection, "ModelScript Formal Verification", {
        message: "Verifying requirements & invariants...",
      });
      await validationService.runVerificationForUri(uri, progressReporter);
    }
    await validationService.runLiveDigitalThreadValidation(uri);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    connection.console.warn(`[onDidSave] Error verifying ${event.document.uri}: ${msg}`);
  }
});

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
  debounceMs: 250,
});

// Custom request: get CAD components for the webview
import { cadComponentsCache } from "./handlers/diagramHandler.js";
// ── Unified Diagram API (dispatch-based) ──

// Lazy-initialized dispatch — backends require runtime state that isn't available at import time.
let diagramDispatch: ReturnType<typeof createDiagramDispatch> | null = null;
void diagramDispatch;
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
import { LspContext, getSharedLspPolyglotEngine } from "./lsp-context.js";
const polyglotEngine = getSharedLspPolyglotEngine();
const polyglotContext = polyglotEngine.createContext({
  contextId: `lsp-browser-${Date.now().toString(36)}`,
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
      return parserService.sharedContext ?? sharedContext ?? null;
    },
    set sharedContext(v: SharedCompilerContextLike | null) {
      sharedContext = v;
      parserService.sharedContext = v;
    },
    documentRevisions: validationService.documentRevisions,
    documentLSPBridges: validationService.documentLSPBridges,
    lastSemanticDiagnostics: validationService.lastSemanticDiagnostics,
    dependenciesReady: validationService.dependenciesReady,
  },
};

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

connection.listen();

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
let markdownContentCache: { version: string; result: unknown } | null = null;
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
