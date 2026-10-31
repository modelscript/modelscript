// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageAction, LanguageOptions, WritebackConfig, WritebackHandler } from "@modelscript/dsl";
import type { QueryEngine } from "@modelscript/runtime";
import type { Disposable } from "vscode-languageserver";

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
  /** Tree-sitter / WASM parser instance */
  parser?: any;
  /** WASM LspFacade providing instant symbols, completions, folding, and AST queries */
  facade?: any;
  /** Monaco Monarch token definition rules for client-side syntax highlighting */
  monarch?: any;
  /** TextMate grammar JSON structure */
  textmate?: any;
  /** Workspace index instance for multi-file cross-referencing */
  workspaceIndex?: any;
  /** Salsa QueryEngine for memoized semantic queries */
  queryEngine?: QueryEngine | undefined;
  /** Dynamic LSP capability registrations (client/registerCapability disposables) */
  disposables?: Disposable[] | undefined;
  /** Compiled WebAssembly bytecode buffer */
  wasmBytes?: Uint8Array | undefined;
  /** WebAssembly linear memory reference */
  memory?: WebAssembly.Memory | undefined;
  /** Custom language-specific handler overrides */
  customHandlers?:
    | {
        validate?: ((doc: any) => Promise<any[]> | any[]) | undefined;
        postValidate?: ((doc: any, context: any, diagnostics: any[]) => Promise<void> | void) | undefined;
        complete?: ((offset: number, text: string, uri?: string) => any[]) | undefined;
        hover?: ((offset: number, text: string, uri?: string) => any | null) | undefined;
        definition?: ((offset: number, text: string, uri?: string) => any | null) | undefined;
        references?: ((offset: number, text: string, uri?: string) => any[]) | undefined;
        symbols?: ((tree: any) => any[]) | undefined;
        folding?: ((tree: any) => any[]) | undefined;
      }
    | undefined;
  /** Full language definition options from @modelscript/dsl */
  languageDef?: LanguageOptions | any;
  /** First-class declarative language actions (commands, toolbar buttons, LLM tools) */
  actions?: LanguageAction[] | undefined;
  /** Custom JSON-RPC request and notification handlers */
  handlers?: Record<string, (context: any, params: any) => Promise<any> | any> | undefined;
  /** Domain action execution handlers (decoupled from AST grammar) */
  actionHandlers?: Record<string, (context: any, inputs: any) => Promise<any> | any> | undefined;
  /** Optional source text preprocessor hook (e.g. keyword aliases) */
  preprocessText?: ((text: string) => string) | undefined;
  /** Factory for creating a Salsa QueryEngine for this language */
  createQueryEngine?: ((unifiedIndex: any, cstTreeWrapper: any) => QueryEngine) | undefined;
  /** Diagram backend instance */
  diagramBackend?: any;
  /** Annotation evaluator class or constructor */
  annotationEvaluator?: any;
  /** Bi-directional parameter writeback handler or configuration */
  writeback?: WritebackConfig | WritebackHandler | undefined;
  /** Language maturity tier */
  maturity?: "stable" | "beta" | "experimental" | undefined;
}

export const DEFAULT_LANGUAGE_MATURITY: Record<string, "stable" | "beta" | "experimental"> = {
  // Stable (Tier 1)
  modelica: "stable",
  sysml2: "stable",
  sysml: "stable",
  step: "stable",
  scad: "stable",
  owl2: "stable",
  csv: "stable",
  pscad: "stable",
  psse: "stable",
  ssp: "stable",
  fortran: "stable",

  // Beta (Tier 2)
  cfd: "beta",
  fea: "beta",
  simpack: "beta",
  gensys: "beta",
  spice: "beta",
  openfoam: "beta",
  olga: "beta",
  vhdlams: "beta",
  verilogams: "beta",
  bondgraph: "beta",
  smv: "beta",
  reqif: "beta",
  sima: "beta",
  lps: "beta",
  gtsuite: "beta",
  modelscript: "beta",
  easy5: "beta",
  rocets: "beta",
  plcopen: "beta",
  adams: "beta",
  urdf: "beta",
  aspen: "beta",
  eclipse: "beta",
  "verilog-a": "beta",

  // Experimental (Tier 3)
  aacl: "experimental",
  autosar: "experimental",
  c: "experimental",
  ccsds: "experimental",
  canary: "experimental",
  capella: "experimental",
  comsol: "experimental",
  dsd: "experimental",
  dymola: "experimental",
  dwsim: "experimental",
  energyplus: "experimental",
  epanet: "experimental",
  fluent: "experimental",
  gproms: "experimental",
  htri: "experimental",
  ibis: "experimental",
  if97: "experimental",
  jsbsim: "experimental",
  kratos: "experimental",
  maap: "experimental",
  magicdraw: "experimental",
  matpower: "experimental",
  modflow: "experimental",
  nastran: "experimental",
  omnetpp: "experimental",
  opendrive: "experimental",
  opendss: "experimental",
  openscenario: "experimental",
  pandapower: "experimental",
  patran: "experimental",
  Petrel: "experimental",
  petrel: "experimental",
  phreeqc: "experimental",
  plantuml: "experimental",
  plaxis: "experimental",
  process: "experimental",
  prometheus: "experimental",
  ptolemy: "experimental",
  relap5: "experimental",
  ros2: "experimental",
  sbml: "experimental",
  scade: "experimental",
  simscape: "experimental",
  simulink: "experimental",
  structural: "experimental",
  swmm: "experimental",
  thermoflow: "experimental",
  touchstone: "experimental",
  trace32: "experimental",
  trnsys: "experimental",
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
        plugin.parser = existing.parser;
      }
      if (!plugin.facade && existing.facade) {
        plugin.facade = existing.facade;
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
        } catch {}
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
      } catch {}
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

    const dotIdx = cleanUri.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const ext = cleanUri.slice(dotIdx).toLowerCase();

    if (!text && (ext === ".inp" || ext === ".xml" || ext === ".net")) {
      const openDoc = (globalThis as any).documents?.get?.(uri);
      if (openDoc && typeof openDoc.getText === "function") {
        text = openDoc.getText();
      }
    }

    if (text && (ext === ".inp" || ext === ".xml" || ext === ".net")) {
      const header = text.slice(0, 2048);
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
      } else if (ext === ".xml") {
        if (/<REQ-IF\b/i.test(header)) return this.getPluginById("reqif") ?? this.extMap.get(ext);
        if (/<AUTOSAR\b/i.test(header)) return this.getPluginById("autosar") ?? this.extMap.get(ext);
        if (/<OpenDRIVE\b/i.test(header)) return this.getPluginById("opendrive") ?? this.extMap.get(ext);
        if (/<OpenSCENARIO\b/i.test(header)) return this.getPluginById("openscenario") ?? this.extMap.get(ext);
        if (/<sbml\b/i.test(header)) return this.getPluginById("sbml") ?? this.extMap.get(ext);
        if (/<fdm_config\b/i.test(header)) return this.getPluginById("jsbsim") ?? this.extMap.get(ext);
        if (/<project\b[^>]*plcopen/i.test(header)) return this.getPluginById("plcopen") ?? this.extMap.get(ext);
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
  getHandlerForUri(uri: string, method: string): ((context: any, params: any) => Promise<any> | any) | undefined {
    const plugin = this.getPluginForUri(uri);
    return plugin?.handlers?.[method] ?? plugin?.languageDef?.lsp?.handlers?.[method];
  }

  /**
   * Resolves the WASM parser instance for a given file URI.
   */
  getParserForUri(uri: string): any | undefined {
    return this.getPluginForUri(uri)?.parser;
  }

  /**
   * Resolves the WASM LspFacade instance for a given file URI.
   */
  getFacadeForUri(uri: string): any | undefined {
    return this.getPluginForUri(uri)?.facade;
  }

  /**
   * Resolves the WorkspaceIndex for a given file URI.
   */
  getWorkspaceIndexForUri(uri: string): any | undefined {
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
