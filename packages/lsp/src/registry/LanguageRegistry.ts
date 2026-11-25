// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LanguageAction,
  LanguageIndexingConfig,
  LanguageOptions,
  WritebackConfig,
  WritebackHandler,
} from "@modelscript/dsl";
import type { Tree } from "@modelscript/dsl/utils";
import type { LanguageDefinitionLike, QueryEngine } from "@modelscript/runtime";
import type {
  CodeAction,
  CodeLens,
  CompletionItem,
  Diagnostic,
  Disposable,
  DocumentSymbol,
  Hover,
  InlayHint,
  Location,
  Position,
  Range,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver";
import type { CstTreeLike } from "../utils/ast-utils.js";

/** Helper for bivariant function callbacks under strictFunctionTypes. */
type BivariantCallback<Args extends unknown[], Return> = {
  bivarianceHack(...args: Args): Return;
}["bivarianceHack"];

/** Minimal document shape accepted by plugin custom handlers (compatible with TextDocument and raw strings). */
export type PluginDocumentLike =
  | string
  | {
      uri?: string;
      languageId?: string;
      lineCount?: number;
      getText?: () => string;
      positionAt?: (offset: number) => Position;
      offsetAt?: (position: Position) => number;
    };

/** Structural symbol shape returned by custom language symbol handlers. */
export interface PluginDocumentSymbolLike {
  name?: string | undefined;
  detail?: unknown;
  kind?: unknown;
  range?: Range | undefined;
  selectionRange?: Range | undefined;
  children?: PluginDocumentSymbolLike[] | unknown[] | undefined;
}

/** Folding range shape returned by custom language plugins or WASM facades. */
export interface PluginFoldingRangeLike {
  startLine: number;
  endLine: number;
  startCharacter?: number | undefined;
  endCharacter?: number | undefined;
  kind?: "comment" | "imports" | "region" | undefined;
  defaultCollapsed?: boolean | undefined;
  collapsedText?: string | undefined;
}

/** CodeLens result returned by a plugin custom codeLens handler. */
export type PluginCodeLensResult = CodeLens[] | { lenses: CodeLens[]; appendUniversal?: boolean | undefined };

/** Minimal formatting options shape (compatible with LSP FormattingOptions). */
export interface PluginFormattingOptions {
  tabSize?: number | undefined;
  insertSpaces?: boolean | undefined;
  [key: string]: unknown;
}

/** Structural interface for a custom JSON-RPC protocol handler. */
export type PluginProtocolHandler = BivariantCallback<[context: unknown, params: unknown], Promise<unknown> | unknown>;

/** Structural interface for a domain action execution handler. */
export type PluginActionHandler = BivariantCallback<[context: unknown, inputs: unknown], Promise<unknown> | unknown>;

/** Structural interface for a WASM GLR parser instance attached to a language plugin. */
export interface WasmParserInstance {
  parse(
    input: string,
    oldTree?: unknown,
    startIndex?: number,
    oldEndIndex?: number,
    newEndIndex?: number,
    uri?: string,
  ): CstTreeLike | Tree | null;
  setLanguage?(language: unknown): void;
  getLanguage?(): unknown;
}

/** Structural interface for a WASM LspFacade instance attached to a language plugin. */
export interface WasmFacadeInstance {
  exports?: { lsp_clearDocuments?: () => void; [key: string]: unknown } | undefined;
  syntaxNames?: string[] | undefined;
  fieldNames?: Record<string, number> | undefined;
  lastAstRoot?: number;
  getDocumentRoot?(uriOrFileId?: string | number | undefined): number;
  loadSource?(source: string): void;
  getHover?(rootPtr: number, offset: number): string | null | undefined;
  getCompletions?(offset: number, text: string): CompletionItem[] | null | undefined;
  getDefinition?(
    rootPtr: number,
    offset: number,
  ):
    | {
        fileId?: number;
        start?: number;
        end?: number;
        startOffset?: number;
        startIndex?: number;
        endOffset?: number;
        endIndex?: number;
      }
    | null
    | undefined;
  getDocumentSymbols?(rootPtr: number): unknown[] | null | undefined;
  getFoldingRanges?(rootPtr: number):
    | Array<{
        startLine?: number;
        endLine?: number;
        start?: { line: number; character?: number };
        end?: { line: number; character?: number };
        kind?: "comment" | "imports" | "region";
        defaultCollapsed?: boolean;
        collapsedText?: string;
      }>
    | null
    | undefined;
  formatDocument?(rootPtr: number, arg?: boolean | number): string | TextEdit[] | null | undefined;
  getDiagnostics?(rootPtr: number, rangeStart?: number, rangeEnd?: number, sourceCode?: string): unknown[];
}

/** Structural interface for a symbol index returned by a workspace index. */
export interface SymbolIndexLike {
  symbols: Map<number, unknown>;
  byName?: Map<string, number[]>;
  childrenOf?: Map<number | null, number[]>;
}

/** Structural interface for a multi-file workspace symbol index attached to a language plugin. */
export interface WorkspaceIndexLike {
  readonly fileCount?: number | undefined;
  register?(uri: string, rootOrGetter: unknown): unknown;
  unregister?(uri: string): void;
  has?(uri: string): boolean;
  markDirty?(uri: string): void;
  reindexDocument?(uri: string, rootOrGetter?: unknown, editRanges?: unknown, totalDelta?: number): unknown;
  takeGlobalChangedIds?(): Set<number>;
  takeGlobalChangedNames?(): Set<string>;
  getFileIndex?(uri: string): SymbolIndexLike | undefined;
  getIndex?(options?: { eager?: boolean }): SymbolIndexLike;
  getIndexAsync?(): Promise<SymbolIndexLike>;
  symbols?: Map<number, unknown>;
}

/** Structural interface for Monaco Monarch tokenizer definitions. */
export interface MonarchLanguageDef {
  keywords?: string[] | undefined;
  typeKeywords?: string[] | undefined;
  operators?: string[] | undefined;
  tokenizer?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

/** Structural symbol metadata entry inside a language definition. */
export interface PluginSymbolConfigLike {
  kind?: string | undefined;
  name?: string | undefined;
  exports?: string | string[] | undefined;
  inherits?: string | string[] | undefined;
  attributes?: Record<string, string> | undefined;
  icon?: string | undefined;
  group?: string | undefined;
  treeVisible?: boolean | undefined;
}

/** Structural error code descriptor inside a language definition. */
export interface PluginErrorCodeEntryLike {
  code?: number | undefined;
  rule?: string | undefined;
  severity?: string | undefined;
  message?: unknown;
}

/** Structural language definition accepted by LanguagePlugin (compatible with LanguageOptions and lightweight descriptors). */
export interface LanguageDefLike {
  name?: string | undefined;
  maturity?: "stable" | "beta" | "experimental" | string | undefined;
  rules?: Record<string, BivariantCallback<[d: Record<string, unknown>], unknown> | undefined> | undefined;
  keywords?: string[] | undefined;
  symbols?: Record<string, PluginSymbolConfigLike | undefined> | undefined;
  graphics?: Record<string, unknown> | undefined;
  visual?:
    | {
        entities?: Record<string, unknown> | undefined;
        connections?: Record<string, unknown> | undefined;
      }
    | undefined;
  actions?: LanguageAction[] | undefined;
  actionHandlers?: Record<string, PluginActionHandler> | undefined;
  lints?: Record<string, unknown> | undefined;
  errorCodes?: Record<string | number, PluginErrorCodeEntryLike | undefined> | Record<string, unknown> | undefined;
  writeback?: WritebackConfig | WritebackHandler | undefined;
  diagram?: unknown;
  polyglot?: LanguageDefinitionLike["polyglot"];
  grammar?: { xmlRules?: unknown } | undefined;
  indexing?: LanguageIndexingConfig | undefined;
  lsp?:
    | {
        fileExtension?: string | undefined;
        fileExtensions?: string[] | undefined;
        folding?:
          | Array<
              | string
              | {
                  rule?: string | undefined;
                  kind?: "comment" | "imports" | "region" | undefined;
                  defaultCollapsed?: boolean | undefined;
                  collapsedText?: string | undefined;
                }
            >
          | undefined;
        outline?: string[] | undefined;
        semanticTags?: Record<string, number | undefined> | undefined;
        handlers?: Record<string, PluginProtocolHandler> | undefined;
      }
    | undefined;
}

export interface PluginCodeLensContext {
  uri: string;
  text: string;
  headerRange?: Range;
  flags?: Record<string, unknown>;
  workspaceManager?: unknown;
  documentManager?: unknown;
  validationService?: unknown;
  cadMetricsService?: unknown;
  connection?: unknown;
}

export interface PluginFormatContext {
  getDocumentTree?: (uri: string) => unknown;
  isParserReady?: () => boolean;
}

export interface PluginCustomHandlers {
  validate?:
    | BivariantCallback<
        [doc: PluginDocumentLike, cstTree?: unknown],
        Promise<Diagnostic[] | readonly unknown[]> | Diagnostic[] | readonly unknown[]
      >
    | undefined;
  postValidate?:
    | BivariantCallback<[doc: PluginDocumentLike, context: unknown, diagnostics: Diagnostic[]], Promise<void> | void>
    | undefined;
  complete?: BivariantCallback<[offset: number, text: string, uri?: string], CompletionItem[]> | undefined;
  hover?: BivariantCallback<[offset: number, text: string, uri?: string], Hover | null | undefined> | undefined;
  definition?:
    | BivariantCallback<[offset: number, text: string, uri?: string], Location | Location[] | null | undefined>
    | undefined;
  typeDefinition?:
    | BivariantCallback<[offset: number, text: string, uri?: string], Location | Location[] | null | undefined>
    | undefined;
  references?: BivariantCallback<[offset: number, text: string, uri?: string], Location[]> | undefined;
  symbols?:
    | BivariantCallback<[tree: unknown, text?: string, uri?: string], DocumentSymbol[] | PluginDocumentSymbolLike[]>
    | undefined;
  folding?: BivariantCallback<[tree: unknown, text?: string, uri?: string], PluginFoldingRangeLike[]> | undefined;
  codeActions?:
    | BivariantCallback<
        [doc: PluginDocumentLike, range: Range, diagnostics: Diagnostic[]],
        Promise<CodeAction[]> | CodeAction[]
      >
    | undefined;
  inlayHints?:
    BivariantCallback<[doc: PluginDocumentLike, range?: Range], Promise<InlayHint[]> | InlayHint[]> | undefined;
  codeLens?:
    | BivariantCallback<
        [doc: PluginDocumentLike, context?: PluginCodeLensContext],
        Promise<PluginCodeLensResult> | PluginCodeLensResult
      >
    | undefined;
  rename?:
    | BivariantCallback<
        [doc: PluginDocumentLike, position: Position, newName: string],
        Promise<WorkspaceEdit | null | undefined> | WorkspaceEdit | null | undefined
      >
    | undefined;
  semanticTokens?:
    BivariantCallback<[doc: PluginDocumentLike, tree?: unknown], Promise<number[]> | number[]> | undefined;
  format?:
    | BivariantCallback<
        [doc: PluginDocumentLike, options?: unknown, context?: PluginFormatContext],
        Promise<TextEdit[]> | TextEdit[]
      >
    | undefined;
  rangeFormat?:
    | BivariantCallback<
        [doc: PluginDocumentLike, range: Range, options?: unknown, context?: PluginFormatContext],
        Promise<TextEdit[]> | TextEdit[]
      >
    | undefined;
  buildDiagram?: BivariantCallback<[text: string, params: unknown], Promise<unknown> | unknown> | undefined;
  signatureHelp?:
    | BivariantCallback<
        [doc: PluginDocumentLike, position: Position],
        Promise<SignatureHelp | null | undefined> | SignatureHelp | null | undefined
      >
    | undefined;
  analyzeBlt?: BivariantCallback<[doc: PluginDocumentLike], Promise<unknown> | unknown> | undefined;
  getDiagramData?:
    BivariantCallback<[doc: PluginDocumentLike, params?: unknown], Promise<unknown> | unknown> | undefined;
  applyDiagramEdits?:
    BivariantCallback<[doc: PluginDocumentLike, params?: unknown], Promise<unknown> | unknown> | undefined;
  getComponentProperties?:
    BivariantCallback<[doc: PluginDocumentLike, params?: unknown], Promise<unknown> | unknown> | undefined;
}

/**
 * Descriptor and runtime handle for a registered language in ModelScript LSP.
 */
export interface LanguagePlugin {
  /** Unique language identifier (e.g. "modelica", "sysml2", "minirobot") */
  id: string;
  /** Human-readable language display name */
  name: string;
  /** Recognized file extensions including dot (e.g. [".mo", ".mos"]) */
  extensions: string[];
  /** Native WASM GLR parser instance */
  parser?: WasmParserInstance | null | undefined;
  /** WASM LspFacade providing instant symbols, completions, folding, and AST queries */
  facade?: WasmFacadeInstance | null | undefined;
  /** Monaco Monarch token definition rules for client-side syntax highlighting */
  monarch?: MonarchLanguageDef | undefined;
  /** TextMate grammar JSON structure */
  textmate?: Record<string, unknown> | undefined;
  /** Workspace index instance for multi-file cross-referencing */
  workspaceIndex?: WorkspaceIndexLike | undefined;
  /** Salsa QueryEngine for memoized semantic queries */
  queryEngine?: QueryEngine | undefined;
  /** Dynamic LSP capability registrations (client/registerCapability disposables) */
  disposables?: Disposable[] | undefined;
  /** Compiled WebAssembly bytecode buffer */
  wasmBytes?: Uint8Array | undefined;
  /** WebAssembly linear memory reference */
  memory?: WebAssembly.Memory | undefined;
  /** Custom language-specific handler overrides */
  customHandlers?: PluginCustomHandlers | undefined;
  /** Full language definition options from @modelscript/dsl */
  languageDef?: (LanguageOptions & LanguageDefLike) | LanguageDefLike | undefined;
  /** First-class declarative language actions (commands, toolbar buttons, LLM tools) */
  actions?: LanguageAction[] | undefined;
  /** Custom JSON-RPC request and notification handlers */
  handlers?: Record<string, PluginProtocolHandler> | undefined;
  /** Domain action execution handlers (decoupled from AST grammar) */
  actionHandlers?: Record<string, PluginActionHandler> | undefined;
  /** Optional source text preprocessor hook (e.g. keyword aliases) */
  preprocessText?: ((text: string) => string) | undefined;
  /** Factory for creating a Salsa QueryEngine for this language */
  createQueryEngine?: BivariantCallback<[unifiedIndex: unknown, cstTreeWrapper?: unknown], QueryEngine> | undefined;
  /** Optional typed Nelson-Oppen theory constraint extractor for digital thread verification */
  extractTheoryConstraints?:
    BivariantCallback<[text: string, uri?: string, symbolIndex?: unknown], Promise<unknown> | unknown> | undefined;
  /** Diagram backend instance */
  diagramBackend?: unknown;
  /** Annotation evaluator class or constructor */
  annotationEvaluator?: unknown;
  /** Bi-directional parameter writeback handler or configuration */
  writeback?: WritebackConfig | WritebackHandler | undefined;
  /** Language maturity tier */
  maturity?: "stable" | "beta" | "experimental" | undefined;
}

export const DEFAULT_LANGUAGE_MATURITY: Record<string, "stable" | "beta" | "experimental"> = {
  // Stable (Tier 1 — 24 languages + sysml alias)
  c: "stable",
  csv: "stable",
  epanet: "stable",
  fortran: "stable",
  gensys: "stable",
  "hec-ras": "stable",
  lps: "stable",
  modelica: "stable",
  modelscript: "stable",
  ocpp: "stable",
  olga: "stable",
  openadr: "stable",
  opendss: "stable",
  optical: "stable",
  owl2: "stable",
  pscad: "stable",
  psse: "stable",
  ran: "stable",
  reqif: "stable",
  scad: "stable",
  spice: "stable",
  ssp: "stable",
  step: "stable",
  sysml: "stable",
  sysml2: "stable",

  // Beta (Tier 2 — 57 languages + aliases)
  adams: "beta",
  ampl: "beta",
  antimony: "beta",
  aspen: "beta",
  automationml: "beta",
  autosar: "beta",
  bngl: "beta",
  bondgraph: "beta",
  cantera: "beta",
  ccsds: "beta",
  cellml: "beta",
  cfd: "beta",
  cgmes: "beta",
  "dicom-rt": "beta",
  easy5: "beta",
  eclipse: "beta",
  energyplus: "beta",
  fea: "beta",
  febio: "beta",
  fiber: "beta",
  genbank: "beta",
  gproms: "beta",
  gtfs: "beta",
  gtsuite: "beta",
  ibis: "beta",
  igtl: "beta",
  jsbsim: "beta",
  landgem: "beta",
  modflow: "beta",
  nifti: "beta",
  nmtran: "beta",
  opendrive: "beta",
  openfoam: "beta",
  openscenario: "beta",
  opensim: "beta",
  oscal: "beta",
  pdb: "beta",
  phreeqc: "beta",
  plcopen: "beta",
  powerfactory: "beta",
  pslf: "beta",
  qif: "beta",
  relap5: "beta",
  rocets: "beta",
  sbml: "beta",
  sbol: "beta",
  sedml: "beta",
  sima: "beta",
  simpack: "beta",
  simulink: "beta",
  smiles: "beta",
  smv: "beta",
  swmm: "beta",
  "three-mf": "beta",
  topas: "beta",
  touchstone: "beta",
  tough: "beta",
  twentysim: "beta",
  urdf: "beta",
  usd: "beta",
  "verilog-a": "beta",
  verilogams: "beta",
  vhdlams: "beta",
  acsl: "beta",
  apdl: "beta",
  apt: "beta",
  cea: "beta",
  chemkin: "beta",
  cif: "beta",
  "cplex-lp": "beta",
  csmp: "beta",
  datcom: "beta",
  doe2: "beta",
  dxf: "beta",
  dynamo: "beta",
  edif: "beta",
  esl: "beta",
  esterel: "beta",
  fits: "beta",
  gams: "beta",
  gaussian: "beta",
  gcode: "beta",
  gdsii: "beta",
  gerber: "beta",
  gpss: "beta",
  hec1: "beta",
  hec2: "beta",
  "ieee-cdf": "beta",
  iges: "beta",
  lsdyna: "beta",
  lustre: "beta",
  mcnp: "beta",
  melcor: "beta",
  molfile: "beta",
  mps: "beta",
  nec2: "beta",
  plot3d: "beta",
  scale: "beta",
  sdl: "beta",
  segy: "beta",
  simscript: "beta",
  sinda: "beta",
  slam: "beta",
  trasys: "beta",
  trnsys: "beta",
  verilog: "beta",
  vhdl: "beta",
  arinc429: "beta",
  asn1: "beta",
  bufr: "beta",
  endf6: "beta",
  grib: "beta",
  hdf4: "beta",
  ihex: "beta",
  irig106: "beta",
  "iucr-cif": "beta",
  "jcamp-dx": "beta",
  jedec: "beta",
  "nasa-cdf": "beta",
  netcdf: "beta",
  nmea0183: "beta",
  obj: "beta",
  rinex: "beta",
  srec: "beta",
  stl: "beta",
  "usgs-dem": "beta",

  // Experimental (External / Research formats)
  aacl: "experimental",
  canary: "experimental",
  capella: "experimental",
  comsol: "experimental",
  dsd: "experimental",
  dymola: "experimental",
  dwsim: "experimental",
  fluent: "experimental",
  htri: "experimental",
  if97: "experimental",
  kratos: "experimental",
  las: "experimental",
  maap: "experimental",
  magicdraw: "beta",
  matpower: "experimental",
  nastran: "experimental",
  omnetpp: "experimental",
  pandapower: "experimental",
  patran: "experimental",
  Petrel: "experimental",
  petrel: "experimental",
  plantuml: "experimental",
  plaxis: "experimental",
  process: "experimental",
  prometheus: "experimental",
  ptolemy: "experimental",
  ros2: "experimental",
  scade: "experimental",
  simscape: "experimental",
  structural: "experimental",
  thermoflow: "experimental",
  trace32: "experimental",
  urbansim: "experimental",
  yys: "experimental",
};

const MATURITY_RANK: Record<"stable" | "beta" | "experimental", number> = {
  stable: 3,
  beta: 2,
  experimental: 1,
};

/**
 * High-performance, thread-safe Language Registry for the ModelScript Polyglot LSP.
 * Enables zero-restart hot-loading, reloading, and unloading of language DSLs at runtime.
 */
export class LanguageRegistry {
  private plugins = new Map<string, LanguagePlugin>();
  private extMap = new Map<string, LanguagePlugin>();
  private extCandidates = new Map<string, LanguagePlugin[]>();
  private maturityTier: "stable" | "beta" | "experimental" = "experimental";
  private enabledOverrides = new Map<string, boolean>();
  private documentsStore?: { get(uri: string): { getText(): string } | undefined };

  /** Sets the documents store for content sniffing on ambiguous file extensions. */
  setDocumentsStore(store: { get(uri: string): { getText(): string } | undefined }): void {
    this.documentsStore = store;
  }

  /**
   * Configures active language maturity tier and per-language enable/disable overrides.
   */
  setLanguageConfig(config: {
    maturityTier?: "all" | "betaAndStable" | "stableOnly" | "stable" | "beta" | "experimental" | undefined;
    enabledOverrides?: Record<string, boolean> | undefined;
  }): void {
    if (config.maturityTier) {
      if (config.maturityTier === "stableOnly" || config.maturityTier === "stable") {
        this.maturityTier = "stable";
      } else if (config.maturityTier === "betaAndStable" || config.maturityTier === "beta") {
        this.maturityTier = "beta";
      } else {
        this.maturityTier = "experimental";
      }
    }
    if (config.enabledOverrides) {
      this.enabledOverrides.clear();
      for (const [k, v] of Object.entries(config.enabledOverrides)) {
        this.enabledOverrides.set(k.toLowerCase(), Boolean(v));
      }
    }
    this.rebuildExtensionRoutes();
  }

  /**
   * Checks whether a given language ID is currently enabled according to user settings.
   */
  isLanguageEnabled(id: string): boolean {
    const norm = id.toLowerCase();
    if (this.enabledOverrides.has(norm)) {
      return this.enabledOverrides.get(norm)!;
    }
    const plugin = this.plugins.get(norm);
    const maturity = plugin?.maturity ?? DEFAULT_LANGUAGE_MATURITY[norm] ?? "experimental";
    return MATURITY_RANK[maturity] >= MATURITY_RANK[this.maturityTier];
  }

  private pickBestCandidate(candidates: LanguagePlugin[]): LanguagePlugin | undefined {
    if (candidates.length === 0) return undefined;
    const enabled = candidates.filter((p) => this.isLanguageEnabled(p.id));
    const pool = enabled.length > 0 ? enabled : candidates;
    let best = pool[0]!;
    let bestRank = MATURITY_RANK[best.maturity ?? DEFAULT_LANGUAGE_MATURITY[best.id.toLowerCase()] ?? "experimental"];
    for (let i = 1; i < pool.length; i++) {
      const candidate = pool[i]!;
      const rank =
        MATURITY_RANK[candidate.maturity ?? DEFAULT_LANGUAGE_MATURITY[candidate.id.toLowerCase()] ?? "experimental"];
      if (rank > bestRank) {
        best = candidate;
        bestRank = rank;
      }
    }
    return best;
  }

  private rebuildExtensionRoutes(): void {
    this.extMap.clear();
    for (const [ext, candidates] of this.extCandidates.entries()) {
      const best = this.pickBestCandidate(candidates);
      if (best) {
        this.extMap.set(ext, best);
      }
    }
  }

  /**
   * Registers a new language plugin or updates an existing one in-place.
   */
  register(plugin: LanguagePlugin): void {
    const id = plugin.id.toLowerCase();
    if (!plugin.maturity) {
      plugin.maturity =
        (plugin.languageDef?.maturity as "stable" | "beta" | "experimental" | undefined) ??
        DEFAULT_LANGUAGE_MATURITY[id] ??
        "experimental";
    }
    const existing = this.plugins.get(id);
    if (existing) {
      if (!plugin.disposables) {
        plugin.disposables = existing.disposables;
      }
      if (!plugin.parser && existing.parser) {
        const desc = Object.getOwnPropertyDescriptor(plugin, "parser");
        if (!desc || desc.writable || typeof desc.set === "function") {
          try {
            plugin.parser = existing.parser;
          } catch {
            // Plugin object may be frozen or define a read-only getter for parser.
          }
        }
      }
      if (!plugin.facade && existing.facade) {
        const desc = Object.getOwnPropertyDescriptor(plugin, "facade");
        if (!desc || desc.writable || typeof desc.set === "function") {
          try {
            plugin.facade = existing.facade;
          } catch {
            // Plugin object may be frozen or define a read-only getter for facade.
          }
        }
      }
      if (!plugin.workspaceIndex && existing.workspaceIndex) {
        plugin.workspaceIndex = existing.workspaceIndex;
      }
      if (!plugin.queryEngine && existing.queryEngine) {
        plugin.queryEngine = existing.queryEngine;
      }
      if (!plugin.createQueryEngine && existing.createQueryEngine) {
        plugin.createQueryEngine = existing.createQueryEngine;
      }
      if (!plugin.customHandlers && existing.customHandlers) {
        plugin.customHandlers = existing.customHandlers;
      }
      if (!plugin.actionHandlers && existing.actionHandlers) {
        plugin.actionHandlers = existing.actionHandlers;
      }
      if (!plugin.languageDef && existing.languageDef) {
        plugin.languageDef = existing.languageDef;
      }
    }
    this.plugins.set(id, plugin);

    for (const ext of plugin.extensions) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      // Never allow domain plugins to hijack TypeScript (.ts)
      if (normalizedExt === ".ts") continue;
      const list = this.extCandidates.get(normalizedExt) ?? [];
      const existingIdx = list.findIndex((p) => p.id.toLowerCase() === id);
      if (existingIdx >= 0) {
        list[existingIdx] = plugin;
      } else {
        list.push(plugin);
      }
      this.extCandidates.set(normalizedExt, list);
      const best = this.pickBestCandidate(list);
      if (best) {
        this.extMap.set(normalizedExt, best);
      }
    }

    if (!plugin.writeback && plugin.languageDef?.writeback) {
      plugin.writeback = plugin.languageDef.writeback;
    }
  }

  /**
   * Unregisters a language plugin, disposes its dynamic capabilities, and clears its extension routes.
   */
  async unregister(id: string): Promise<LanguagePlugin | undefined> {
    const normId = id.toLowerCase();
    const plugin = this.plugins.get(normId);
    if (!plugin) return undefined;

    // 1. Dispose dynamic LSP capabilities (sends client/unregisterCapability)
    if (plugin.disposables && plugin.disposables.length > 0) {
      for (const d of plugin.disposables) {
        try {
          d.dispose();
        } catch {
          // Best-effort capability disposal during plugin unregistration.
        }
      }
      plugin.disposables = [];
    }

    // 2. Remove extension mappings
    for (const ext of plugin.extensions) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      const list = this.extCandidates.get(normalizedExt);
      if (list) {
        const filtered = list.filter((p) => p.id.toLowerCase() !== normId);
        if (filtered.length === 0) {
          this.extCandidates.delete(normalizedExt);
          this.extMap.delete(normalizedExt);
        } else {
          this.extCandidates.set(normalizedExt, filtered);
          const best = this.pickBestCandidate(filtered);
          if (best) this.extMap.set(normalizedExt, best);
        }
      } else if (this.extMap.get(normalizedExt) === plugin) {
        this.extMap.delete(normalizedExt);
      }
    }

    // 3. Clear linear memory documents if facade supports it
    if (plugin.facade?.exports?.lsp_clearDocuments) {
      try {
        plugin.facade.exports.lsp_clearDocuments();
      } catch {
        // Best-effort linear memory cleanup on unregistration.
      }
    }

    this.plugins.delete(normId);
    return plugin;
  }

  /**
   * Looks up a registered language plugin by its identifier.
   */
  getPluginById(id: string): LanguagePlugin | undefined {
    const norm = id.toLowerCase();
    const plugin = this.plugins.get(norm);
    if (plugin) return plugin;
    if (norm === "sysml") return this.plugins.get("sysml2");
    if (norm === "sysml2") return this.plugins.get("sysml");
    return undefined;
  }

  /**
   * Alias for getPluginById.
   */
  get(id: string): LanguagePlugin | undefined {
    return this.getPluginById(id);
  }

  /**
   * Alias for getPluginById.
   */
  getPluginByLanguageId(id: string): LanguagePlugin | undefined {
    return this.getPluginById(id);
  }

  /**
   * Resolves a language plugin by either languageId or file URI extension.
   */
  getPluginForLanguageIdOrUri(languageId?: string, uri?: string, text?: string): LanguagePlugin | undefined {
    if (languageId) {
      const byId = this.getPluginById(languageId);
      if (byId) return byId;
      if (!uri && (languageId.includes("/") || languageId.includes("."))) {
        return this.getPluginForUri(languageId, text);
      }
    }
    if (uri) {
      return this.getPluginForUri(uri, text);
    }
    return undefined;
  }

  /**
   * Resolves a language plugin by file URI extension (with optional content disambiguation for shared extensions).
   */
  getPluginForUri(uri: string, text?: string): LanguagePlugin | undefined {
    let cleanUri = uri;
    const qIdx = cleanUri.indexOf("?");
    if (qIdx !== -1) cleanUri = cleanUri.slice(0, qIdx);
    const hashIdx = cleanUri.indexOf("#");
    if (hashIdx !== -1) cleanUri = cleanUri.slice(0, hashIdx);
    const lowerUri = cleanUri.toLowerCase();

    // Check compound extensions first (e.g., .swmm.inp, .epanet.inp, .jsbsim.xml, .plcopen.xml)
    if (lowerUri.endsWith(".swmm.inp")) return this.getPluginById("swmm");
    if (lowerUri.endsWith(".epanet.inp")) return this.getPluginById("epanet");
    if (lowerUri.endsWith(".sima.inp")) return this.getPluginById("sima");
    if (lowerUri.endsWith(".relap5.inp")) return this.getPluginById("relap5");
    if (lowerUri.endsWith(".aspen.inp")) return this.getPluginById("aspen");
    if (lowerUri.endsWith(".jsbsim.xml")) return this.getPluginById("jsbsim");
    if (lowerUri.endsWith(".plcopen.xml")) return this.getPluginById("plcopen");
    if (lowerUri.endsWith(".sbml.xml")) return this.getPluginById("sbml");
    if (lowerUri.endsWith(".plus.xml")) return this.getPluginById("igtl");
    if (
      lowerUri.endsWith(".oscal.json") ||
      lowerUri.endsWith(".oscal.yaml") ||
      lowerUri.endsWith(".oscal.yml") ||
      lowerUri.endsWith(".oscal.xml")
    ) {
      return this.getPluginById("oscal");
    }
    if (lowerUri.endsWith(".dcm.json") || lowerUri.endsWith(".dcm.xml")) return this.getPluginById("dicom-rt");
    if (lowerUri.endsWith(".nii.json")) return this.getPluginById("nifti");
    if (lowerUri.endsWith(".igtl.json")) return this.getPluginById("igtl");

    for (const [candidateExt, plugin] of this.extMap.entries()) {
      if (candidateExt.indexOf(".", 1) !== -1 && lowerUri.endsWith(candidateExt)) {
        return plugin;
      }
    }

    const dotIdx = cleanUri.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const ext = cleanUri.slice(dotIdx).toLowerCase();

    // Multi-port S-parameter files (.s1p, .s2p, .s3p, etc.) belong to Touchstone
    if (/^\.s\d+p$/i.test(ext)) {
      return this.getPluginById("touchstone");
    }

    const sniffExtensions = new Set([
      ".inp",
      ".xml",
      ".net",
      ".in",
      ".i",
      ".data",
      ".inc",
      ".st",
      ".raw",
      ".cmd",
      ".sim",
      ".ts",
    ]);

    if (!text && sniffExtensions.has(ext)) {
      const globalDocs = (
        globalThis as { documents?: { get?: (targetUri: string) => { getText?: () => string } | undefined } }
      ).documents;
      const openDoc = this.documentsStore?.get?.(uri) ?? globalDocs?.get?.(uri);
      if (openDoc && typeof openDoc.getText === "function") {
        text = openDoc.getText();
      }
    }

    if (text && sniffExtensions.has(ext)) {
      const header = text.slice(0, 4096);
      if (ext === ".inp" || ext === ".net") {
        if (/^\s*\[(?:SUBCATCHMENTS|RAINGAGES|INFILTRATION|CONDUITS|OUTFALLS)\]/im.test(header)) {
          return this.getPluginById("swmm") ?? this.extMap.get(ext);
        }
        if (/^\s*\[(?:JUNCTIONS|PIPES|RESERVOIRS|TANKS)\]/im.test(header)) {
          return this.getPluginById("epanet") ?? this.extMap.get(ext);
        }
        if (/^\s*\*(?:HEADING|NODE|ELEMENT|MATERIAL|STEP|SOLID SECTION)/im.test(header)) {
          return this.getPluginById("fea") ?? this.extMap.get(ext);
        }
        if (/^\s*(?:TITLE|IN-UNITS|RUN-CONTROL|FLOWSHEET|BLOCK|DEF-STREAMS)\b/im.test(header)) {
          return this.getPluginById("aspen") ?? this.extMap.get(ext);
        }
        if (/^\s*(?:TIME-SERIES|SIMA|TASK|CONDITION)\b/im.test(header)) {
          return this.getPluginById("sima") ?? this.extMap.get(ext);
        }
        if (/^\s*(?:=|\*|\d{3,9})\s+/m.test(header) || /relap5/i.test(header)) {
          return this.getPluginById("relap5") ?? this.extMap.get(ext);
        }
      } else if (ext === ".xml") {
        if (/<REQ-IF\b/i.test(header)) return this.getPluginById("reqif") ?? this.extMap.get(ext);
        if (/<AUTOSAR\b/i.test(header)) return this.getPluginById("autosar") ?? this.extMap.get(ext);
        if (/<OpenDRIVE\b/i.test(header)) return this.getPluginById("opendrive") ?? this.extMap.get(ext);
        if (/<OpenSCENARIO\b/i.test(header)) return this.getPluginById("openscenario") ?? this.extMap.get(ext);
        if (/<sbml\b/i.test(header)) return this.getPluginById("sbml") ?? this.extMap.get(ext);
        if (/<fdm_config\b/i.test(header)) return this.getPluginById("jsbsim") ?? this.extMap.get(ext);
        if (/<project\b[^>]*plcopen/i.test(header)) return this.getPluginById("plcopen") ?? this.extMap.get(ext);
        if (/<QIFDocument\b/i.test(header)) return this.getPluginById("qif") ?? this.extMap.get(ext);
        if (/<CAEXFile\b/i.test(header)) return this.getPluginById("automationml") ?? this.extMap.get(ext);
        if (/<OpenSimDocument\b/i.test(header)) return this.getPluginById("opensim") ?? this.extMap.get(ext);
        if (/<DicomRtPlan\b/i.test(header)) return this.getPluginById("dicom-rt") ?? this.extMap.get(ext);
        if (/<febio_spec\b/i.test(header)) return this.getPluginById("febio") ?? this.extMap.get(ext);
        if (/<PlusConfiguration\b/i.test(header)) return this.getPluginById("igtl") ?? this.extMap.get(ext);
        if (/<xmi:XMI\b/i.test(header) || /xmlns:xmi=/i.test(header)) {
          return this.getPluginById("magicdraw") ?? this.extMap.get(ext);
        }
      } else if (ext === ".in") {
        if (/^\s*(?:TITLE|IN-UNITS|RUN-CONTROL|FLOWSHEET|BLOCK|PROPERTIES|DEF-STREAMS)\b/im.test(header)) {
          return this.getPluginById("aspen") ?? this.extMap.get(ext);
        }
      } else if (ext === ".i") {
        if (/^\s*(?:=|\*|\d{3,9})\s+/m.test(header) || /relap5/i.test(header)) {
          return this.getPluginById("relap5") ?? this.extMap.get(ext);
        }
      } else if (ext === ".data" || ext === ".inc") {
        if (/^\s*(?:RUNSPEC|GRID|PROPS|REGIONS|SOLUTION|SUMMARY|SCHEDULE|DIMENS|OIL|WATER|GAS)\b/im.test(header)) {
          return this.getPluginById("eclipse") ?? this.extMap.get(ext);
        }
      } else if (ext === ".st") {
        if (/^\s*(?:FUNCTION_BLOCK|PROGRAM|CONFIGURATION|TYPE|VAR|VAR_INPUT)\b/im.test(header)) {
          return this.getPluginById("plcopen") ?? this.extMap.get(ext);
        }
      } else if (ext === ".raw") {
        if (/^\s*\d+\s*,\s*[^,]+\s*,\s*[\d.]+/m.test(header) || /^\s*0\s*,\s*[\d.]+/m.test(header)) {
          return this.getPluginById("psse") ?? this.extMap.get(ext);
        }
      } else if (ext === ".cmd") {
        if (/^\s*!(?:ADAMS|MDI)|\b(?:part|marker|model)\s+create\b/im.test(header)) {
          return this.getPluginById("adams") ?? this.extMap.get(ext);
        }
      } else if (ext === ".sim") {
        if (/^\s*!\s*SIMPACK|\$(?:MODEL|SUBSTRUCTURE)\b/im.test(header)) {
          return this.getPluginById("simpack") ?? this.extMap.get(ext);
        }
      } else if (ext === ".ts") {
        // Touchstone network analyzer header: # [freq unit] [parameter] [format] [R n]
        if (/^#[ \t]*(?:GHZ|MHZ|KHZ|HZ)\b/im.test(header)) {
          return this.getPluginById("touchstone");
        }
        // Do not match TypeScript as Touchstone!
        return undefined;
      }
    }

    return this.extMap.get(ext);
  }

  /**
   * Resolves a language plugin by extension string (e.g. ".mo" or "mo").
   */
  getPluginForExtension(ext: string): LanguagePlugin | undefined {
    const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return this.extMap.get(normalized);
  }

  /**
   * Retrieves a custom protocol handler for a given URI and method name.
   */
  getHandlerForUri(uri: string, method: string): PluginProtocolHandler | undefined {
    const plugin = this.getPluginForUri(uri);
    return plugin?.handlers?.[method] ?? plugin?.languageDef?.lsp?.handlers?.[method];
  }

  /**
   * Resolves the WASM parser instance for a given file URI.
   */
  getParserForUri(uri: string): WasmParserInstance | null | undefined {
    return this.getPluginForUri(uri)?.parser;
  }

  /**
   * Resolves the WASM LspFacade instance for a given file URI.
   */
  getFacadeForUri(uri: string): WasmFacadeInstance | null | undefined {
    return this.getPluginForUri(uri)?.facade;
  }

  /**
   * Resolves the WorkspaceIndex for a given file URI.
   */
  getWorkspaceIndexForUri(uri: string): WorkspaceIndexLike | undefined {
    return this.getPluginForUri(uri)?.workspaceIndex;
  }

  /**
   * Resolves the QueryEngine for a given file URI.
   */
  getQueryEngineForUri(uri: string): QueryEngine | undefined {
    return this.getPluginForUri(uri)?.queryEngine;
  }

  /**
   * Returns all currently active language plugins.
   */
  getAllPlugins(): LanguagePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Returns all currently registered file extensions.
   */
  getAllExtensions(): string[] {
    return Array.from(this.extMap.keys());
  }

  /**
   * Returns all currently registered language identifiers.
   */
  getAllLanguageIds(): string[] {
    return Array.from(this.plugins.keys());
  }
}

/** Global singleton registry for the LSP server process. */
export const globalLanguageRegistry = new LanguageRegistry();
