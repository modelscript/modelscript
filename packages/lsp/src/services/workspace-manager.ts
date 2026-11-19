// SPDX-License-Identifier: AGPL-3.0-or-later

import { AnnotationEvaluator } from "@modelscript/modelica/diagram";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import {
  AbstractDomainOracle,
  ConstraintTheoryOracle,
  DigitalThreadHypergraph,
  DimensionalTheoryOracle,
  DOMAIN_INDEX_TO_NAME,
  DOMAIN_NAME_TO_INDEX,
  extractCrossLanguageLinks,
  FlowAlgebraOracle,
  isMemberLikeSymbol,
  isTypeLikeSymbol,
  LanguageWorkspaceIndex,
  OntologyTheoryOracle,
  parseSysmlRequirements,
  QueryEngine,
  SemanticTheoryCoordinator,
  SymbolEntry,
  type SymbolIndex,
  type SyntaxNode,
  type TheoryLiteral,
  ThreadDomain,
  UnifiedWorkspace,
} from "@modelscript/runtime";
import type { AlignedDomainElement } from "../providers/threadDiagnosticsProvider.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { extractIndexerHooks } from "../utils/hook-extractor.js";
import {
  extractModelicaTypeFromDeclLine,
  extractWithinPackageName,
  findAssignedNumberInLine,
  skipWs,
} from "../utils/lexical-utils.js";
import { DocumentManager } from "./document-manager.js";

let nodeRequire: ((id: string) => any) | null = null;
try {
  if (typeof process !== "undefined" && process.versions?.node) {
    const req = (globalThis as any).require ?? (typeof module !== "undefined" ? (module as any).require : null);
    if (typeof req === "function") {
      const nm = req("node:module");
      if (nm?.createRequire) {
        nodeRequire = nm.createRequire(import.meta.url);
      }
    }
  }
} catch {
  // Non-node environment
}

/**
 * Holds the per-language workspace symbol index and Salsa query engine instance.
 */
export interface LanguageWorkspaceContext {
  /** Language-specific workspace symbol index. */
  index: any;
  /** Memoized Salsa `QueryEngine` bound to `index`, or `null` if not yet initialized. */
  queryEngine: QueryEngine | null;
}

/**
 * Source location and property metadata for a domain element bound to a digital thread slot.
 */
export interface ThreadElementMetadata {
  /** Human-readable element name or identifier. */
  name: string;
  /** Document URI containing the element declaration. */
  uri: string;
  /** 1-based source line number of the declaration. */
  line: number;
  /** 1-based source column number of the declaration. */
  column: number;
  /** Optional character length of the declaration identifier. */
  length?: number | undefined;
  /** Engineering domain key (e.g., `"sysml2"`, `"modelica"`, `"cad"`, `"fea"`). */
  domain?: string | undefined;
  /** Optional key-value map of extracted engineering parameters (e.g., `mass`, `frontalArea`). */
  properties?: Record<string, any> | undefined;
  /** Marks entries created by automatic workspace discovery so manual test seeders remain untouched. */
  autoDiscovered?: boolean | undefined;
}

/**
 * Configuration options for WorkspaceManager initialization.
 */
export interface WorkspaceManagerOptions {
  /** Optional custom seeder function to initialize digital threads (e.g. in test suites). */
  threadSeeder?: (wm: WorkspaceManager) => void;
  /** @deprecated Use `threadSeeder` or explicit test fixtures (`seedTestWorkspaceThreads`) instead. */
  seedDemoThreads?: boolean;
}

/**
 * Central multi-language workspace manager coordinating per-language symbol indices,
 * Salsa query engines, cross-language `UnifiedWorkspace` resolution, digital thread
 * hypergraph bindings, and formal semantic theory oracles.
 */
export class WorkspaceManager {
  /** Per-language index and query engine contexts keyed by lowercase language ID. */
  private languageContexts = new Map<string, LanguageWorkspaceContext>();
  /** Polyglot unified workspace aggregating symbols across all registered language indices. */
  public unifiedWorkspace = new UnifiedWorkspace();
  /** Map of all registered language workspace indices keyed by lowercase language ID. */
  public allWorkspaceIndices = new Map<string, any>();
  /** Cached instantiated class adapters keyed by `${uri}#${className}`. */
  public workspaceInstances = new Map<string, any[]>();
  /** Cached top-level instantiated class descriptors keyed by document URI. */
  public documentInstances = new Map<string, any[]>();
  /** Cached compiler `Context` objects keyed by document URI. */
  public documentContexts = new Map<string, any>();

  /** Canonical Digital Thread Hypergraph tracking cross-domain node bindings and staleness/conflicts. */
  public hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();
  /** Metadata lookup table mapping `${domain}:${nodeId}` keys to source locations and properties. */
  public threadMetadataMap = new Map<string, ThreadElementMetadata>();
  /** Tracks auto-asserted SemanticTheoryCoordinator literal IDs per hypergraph slot for clean cross-file retraction. */
  private autoCoordinatorLiteralsBySlot = new Map<number, number[]>();
  /** Tracks auto-discovered hypergraph slots touched by each document URI. */
  private autoSlotsByUri = new Map<string, Set<number>>();
  /** Tracks auto-bound thread slot/metadata keys owned by each document URI. */
  private autoThreadKeysByUri = new Map<string, Array<{ slot: number; metaKey: string }>>();
  /** Set of hypergraph slot indices created by automatic discovery (never manually seeded slots). */
  private autoSlotIds = new Set<number>();

  /** Canonical Semantic Theory Coordinator for cross-domain formal consistency checking. */
  public coordinator: SemanticTheoryCoordinator = new SemanticTheoryCoordinator();

  /**
   * Returns the active `SemanticTheoryCoordinator` instance.
   */
  public getCoordinator(): SemanticTheoryCoordinator {
    return this.coordinator;
  }

  /**
   * Seeds the digital thread hypergraph with reference cross-domain threads for testing.
   *
   * @deprecated Use `threadSeeder` option or `seedTestWorkspaceThreads` from `tests/fixtures/demo-threads.js` in test suites.
   */
  public seedDemoThreads(_options?: { force?: boolean }): void {
    // Deprecated: No-op in production. Digital threads must be dynamically registered or initialized via threadSeeder.
  }

  /**
   * Backwards-compatible alias for `seedDemoThreads()`.
   *
   * @deprecated Use `threadSeeder` option or `seedTestWorkspaceThreads` instead.
   */
  public initDefaultThreads(): void {
    this.seedDemoThreads();
  }

  /**
   * Binds a domain node ID and its source metadata to a digital thread slot (creating the thread if needed).
   *
   * @param threadId - Numeric digital thread identifier.
   * @param domain - Engineering domain enum value.
   * @param nodeId - Domain-local symbol or entity ID.
   * @param meta - Source location and parameter metadata for the bound node.
   * @returns Allocated or existing hypergraph slot index.
   */
  public bindThreadSlot(threadId: number, domain: ThreadDomain, nodeId: number, meta: ThreadElementMetadata): number {
    let slot = this.hypergraph.findSlotByThreadId(threadId);
    if (slot === null || slot === undefined) {
      slot = this.hypergraph.createThread(threadId, 1);
    }
    this.hypergraph.bindDomainNode(slot, domain, nodeId);
    const slotDomName = DOMAIN_INDEX_TO_NAME[domain] ?? "unknown";
    const key = `${slotDomName}:${nodeId}`;
    this.threadMetadataMap.set(key, { ...meta, domain: meta.domain ?? slotDomName });
    return slot;
  }

  /**
   * Finds all digital thread hypergraph slots and domain node bindings associated with a document URI.
   */
  public getThreadsForUri(
    uri: string,
  ): { slot: number; record: any; meta: ThreadElementMetadata; domain: string; nodeId: number }[] {
    const results: {
      slot: number;
      record: any;
      meta: ThreadElementMetadata;
      domain: string;
      nodeId: number;
    }[] = [];
    const seenSlotNodes = new Set<string>();

    const normUri = uri.toLowerCase();
    for (const [key, meta] of this.threadMetadataMap.entries()) {
      if (meta.uri && (meta.uri.toLowerCase() === normUri || normUri.endsWith(meta.uri.toLowerCase()))) {
        const parts = key.split(":");
        const slotDomName = parts[0]!;
        const nodeId = parseInt(parts[1]!, 10);
        const domIdx = DOMAIN_NAME_TO_INDEX[slotDomName];
        if (domIdx !== undefined) {
          const slots =
            typeof (this.hypergraph as any).findSlotsByDomainNode === "function"
              ? this.hypergraph.findSlotsByDomainNode(domIdx, nodeId)
              : (() => {
                  const s = this.hypergraph.findSlotByDomainNode(domIdx, nodeId);
                  return s !== null && s !== undefined ? [s] : [];
                })();
          for (const slot of slots) {
            if (typeof (this.hypergraph as any).isRemoved === "function" && this.hypergraph.isRemoved(slot)) {
              continue;
            }
            const dedupe = `${slot}:${slotDomName}:${nodeId}`;
            if (seenSlotNodes.has(dedupe)) continue;
            seenSlotNodes.add(dedupe);
            const record = this.hypergraph.getRecord(slot);
            results.push({ slot, record, meta, domain: meta.domain ?? slotDomName, nodeId });
          }
        }
      }
    }
    return results;
  }

  /**
   * Returns all domain elements aligned under the specified hypergraph `slot` along with their
   * current synchronization status (`"synced"`, `"stale"`, or `"conflict"`).
   */
  public findAlignedElementsBySlot(slot: number): AlignedDomainElement[] {
    const record = this.hypergraph.getRecord(slot);
    if (!record) return [];

    const domainElements: AlignedDomainElement[] = [];
    const isConflict = this.hypergraph.isConflicted(slot);
    const isStale = this.hypergraph.isStale(slot);
    const status = isConflict ? "conflict" : isStale ? "stale" : "synced";

    const isAutoSlot = this.autoSlotIds.has(slot);
    for (let dom = 0; dom < 16; dom++) {
      const nodeId = this.hypergraph.getDomainNode(slot, dom);
      if (nodeId && nodeId > 0) {
        const slotDomName = DOMAIN_INDEX_TO_NAME[dom] ?? "unknown";
        const key = `${slotDomName}:${nodeId}`;
        const meta = this.threadMetadataMap.get(key);
        if (isAutoSlot && !meta) continue;
        const reportedDomain = meta?.domain ?? slotDomName;
        domainElements.push({
          domain: reportedDomain,
          name: meta?.name ?? `${reportedDomain}_node_${nodeId}`,
          uri: meta?.uri,
          line: meta?.line ?? 1,
          column: meta?.column ?? 1,
          properties: meta?.properties,
          status,
        });
      }
    }
    if (isAutoSlot && domainElements.length < 2) return [];
    return domainElements;
  }

  private readonly resolvingWorkspaceIndex = new Set<string>();

  /**
   * Retrieves (or lazily creates via registered factories) the workspace symbol index for `langId`.
   */
  public getWorkspaceIndex(langId: string): any {
    const norm = langId.toLowerCase();
    const ctx = this.languageContexts.get(norm);
    if (ctx?.index) return ctx.index;
    const plugin = globalLanguageRegistry.getPluginById(norm);
    if (plugin && !this.resolvingWorkspaceIndex.has(norm)) {
      this.resolvingWorkspaceIndex.add(norm);
      try {
        const pIdx = plugin.workspaceIndex;
        if (pIdx) {
          this.setWorkspaceIndex(norm, pIdx);
          return pIdx;
        }
      } finally {
        this.resolvingWorkspaceIndex.delete(norm);
      }
    }
    if (norm === "sysml") {
      const s2 = this.getWorkspaceIndex("sysml2");
      if (s2) return s2;
    }
    const factory =
      (plugin as any)?.createWorkspaceIndex ??
      (globalThis as any)[`create_${norm}_workspace_index`] ??
      (globalThis as any)[`create${norm.charAt(0).toUpperCase() + norm.slice(1)}WorkspaceIndex`];
    if (typeof factory === "function") {
      const idx = factory();
      this.setWorkspaceIndex(norm, idx);
      return idx;
    }
    if (norm === "modelica") {
      const idx = createModelicaWorkspaceIndex();
      this.setWorkspaceIndex(norm, idx);
      return idx;
    }
    if (nodeRequire) {
      try {
        if (norm === "sysml2" || norm === "sysml") {
          const mod = nodeRequire("@modelscript/sysml2/factory");
          if (mod?.createSysML2WorkspaceIndex) {
            const idx = mod.createSysML2WorkspaceIndex();
            this.setWorkspaceIndex(norm, idx);
            return idx;
          }
        } else if (norm === "owl2" || norm === "owl") {
          const mod = nodeRequire("@modelscript/owl2/factory");
          if (mod?.createOWL2WorkspaceIndex) {
            const idx = mod.createOWL2WorkspaceIndex();
            this.setWorkspaceIndex(norm, idx);
            return idx;
          }
        }
      } catch {
        // Fallback failed
      }
    }
    if (plugin?.languageDef) {
      try {
        const hooks = extractIndexerHooks(plugin.languageDef);
        if (hooks && hooks.length > 0) {
          const idx = new LanguageWorkspaceIndex(hooks, plugin.languageDef.indexing?.workspaceHooks);
          this.setWorkspaceIndex(norm, idx);
          return idx;
        }
      } catch {
        // Fallback failed
      }
    }
    return undefined;
  }

  /** Re-entrancy guard set preventing recursive `getQueryEngine` lookups. */
  private activeQueryEngineLookups = new Set<string>();

  /**
   * Registers a workspace symbol index for `langId` and synchronizes it with `unifiedWorkspace`.
   */
  public setWorkspaceIndex(langId: string, index: any): void {
    const norm = langId.toLowerCase();
    const existing = this.languageContexts.get(norm) ?? { index: null, queryEngine: null };
    existing.index = index;
    this.languageContexts.set(norm, existing);
    this.allWorkspaceIndices.set(norm, index);
    if (this.unifiedWorkspace && typeof (this.unifiedWorkspace as any).registerWorkspace === "function") {
      this.unifiedWorkspace.registerWorkspace(norm, index);
    }

    const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alt) {
      const altExisting = this.languageContexts.get(alt) ?? { index: null, queryEngine: null };
      altExisting.index = index;
      this.languageContexts.set(alt, altExisting);
      this.allWorkspaceIndices.set(alt, index);
      if (this.unifiedWorkspace && typeof (this.unifiedWorkspace as any).registerWorkspace === "function") {
        this.unifiedWorkspace.registerWorkspace(alt, index);
      }
    }
  }

  /**
   * Retrieves (or lazily initializes) the Salsa `QueryEngine` for `langId`.
   */
  public getQueryEngine(langId: string): QueryEngine | null {
    const norm = langId.toLowerCase();
    if (this.activeQueryEngineLookups.has(norm)) {
      return null;
    }
    this.activeQueryEngineLookups.add(norm);
    try {
      const qe = this.languageContexts.get(norm)?.queryEngine;
      if (qe) return qe;

      const alternate = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
      if (alternate) {
        const altQe = this.languageContexts.get(alternate)?.queryEngine;
        if (altQe) return altQe;
      }

      const plugin = globalLanguageRegistry.getPluginById(norm);
      if (plugin) {
        const desc = Object.getOwnPropertyDescriptor(plugin, "queryEngine");
        if (!desc?.get && plugin.queryEngine) {
          return plugin.queryEngine;
        }
      }
      if (alternate) {
        const altPlugin = globalLanguageRegistry.getPluginById(alternate);
        if (altPlugin) {
          const desc = Object.getOwnPropertyDescriptor(altPlugin, "queryEngine");
          if (!desc?.get && altPlugin.queryEngine) {
            return altPlugin.queryEngine;
          }
        }
      }

      if (norm === "modelica") {
        if (this.globalModelicaQueryEngine) {
          this.setQueryEngine(norm, this.globalModelicaQueryEngine);
          return this.globalModelicaQueryEngine;
        }
        const idx = this.getWorkspaceIndex("modelica");
        if (idx) {
          const uIdx =
            this.unifiedWorkspace && typeof this.unifiedWorkspace.getIndex === "function"
              ? this.unifiedWorkspace.getIndex()
              : typeof idx.getIndex === "function"
                ? idx.getIndex()
                : idx;
          const injectFn = (globalThis as any).injectPredefinedTypes;
          if (typeof injectFn === "function") {
            injectFn(uIdx);
          }
          const cstWrapper = (this as any).parserService?.getSharedCstTreeWrapper?.();
          const qe = createModelicaQueryEngine(uIdx, cstWrapper);
          this.setQueryEngine(norm, qe);
          return qe;
        }
      }

      return null;
    } finally {
      this.activeQueryEngineLookups.delete(norm);
    }
  }

  /**
   * Stores the active Salsa `QueryEngine` for `langId` and updates the corresponding language plugin.
   */
  public setQueryEngine(langId: string, qe: QueryEngine | null): void {
    const norm = langId.toLowerCase();
    const existing = this.languageContexts.get(norm) ?? { index: null, queryEngine: null };
    existing.queryEngine = qe;
    this.languageContexts.set(norm, existing);
    if (qe && this.unifiedWorkspace && typeof (this.unifiedWorkspace as any).registerQueryEngine === "function") {
      this.unifiedWorkspace.registerQueryEngine(norm, qe);
    }

    const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alt) {
      const altExisting = this.languageContexts.get(alt) ?? { index: null, queryEngine: null };
      altExisting.queryEngine = qe;
      this.languageContexts.set(alt, altExisting);
    }

    const plugin = globalLanguageRegistry.getPluginById(norm);
    if (plugin) {
      const desc = Object.getOwnPropertyDescriptor(plugin, "queryEngine");
      if (!desc?.get) {
        plugin.queryEngine = qe ?? undefined;
      }
    }
    if (alt) {
      const altPlugin = globalLanguageRegistry.getPluginById(alt);
      if (altPlugin) {
        const desc = Object.getOwnPropertyDescriptor(altPlugin, "queryEngine");
        if (!desc?.get) {
          altPlugin.queryEngine = qe ?? undefined;
        }
      }
    }
  }

  // Compatibility getters/setters for legacy callers
  /** @deprecated Use `getWorkspaceIndex("modelica")` instead. */
  get globalWorkspaceIndex() {
    return this.getWorkspaceIndex("modelica");
  }
  set globalWorkspaceIndex(val: any) {
    this.setWorkspaceIndex("modelica", val);
  }

  /** @deprecated Use `getWorkspaceIndex("sysml2")` instead. */
  get sysml2WorkspaceIndex() {
    return this.getWorkspaceIndex("sysml2");
  }
  set sysml2WorkspaceIndex(val: any) {
    this.setWorkspaceIndex("sysml2", val);
  }

  /** @deprecated Use `getWorkspaceIndex("owl2")` instead. */
  get owl2WorkspaceIndex() {
    return this.getWorkspaceIndex("owl2");
  }
  set owl2WorkspaceIndex(val: any) {
    this.setWorkspaceIndex("owl2", val);
  }

  /** @deprecated Use `getQueryEngine("modelica")` instead. */
  get globalModelicaQueryEngine() {
    return this.getQueryEngine("modelica");
  }
  set globalModelicaQueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("modelica", val);
  }

  /** @deprecated Use `getQueryEngine("sysml2")` instead. */
  get globalSysML2QueryEngine() {
    return this.getQueryEngine("sysml2");
  }
  set globalSysML2QueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("sysml2", val);
  }

  /** @deprecated Use `getQueryEngine("owl2")` instead. */
  get globalOWL2QueryEngine() {
    return this.getQueryEngine("owl2");
  }
  set globalOWL2QueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("owl2", val);
  }

  /** @deprecated Use `getQueryEngine("step")` instead. */
  get globalStepQueryEngine() {
    return this.getQueryEngine("step");
  }
  set globalStepQueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("step", val);
  }

  /**
   * Cleans up cached instances, contexts, and query engine caches for a closed document.
   */
  public disposeDocument(uri: string): void {
    this.workspaceInstances.delete(uri);
    this.documentInstances.delete(uri);
    this.documentContexts.delete(uri);
    const eng = globalLanguageRegistry.getQueryEngineForUri(uri);
    (eng as any)?.disposeDocument?.(uri);
    (this.globalModelicaQueryEngine as any)?.disposeDocument?.(uri);
    (this.globalSysML2QueryEngine as any)?.disposeDocument?.(uri);
  }

  /** Optional reference to the `DocumentManager` for accessing open text documents and CST trees. */
  private documentManager?: DocumentManager | undefined;

  /**
   * Creates a new `WorkspaceManager`, registers all formal semantic theory oracles,
   * optionally seeds sample digital threads, and wires CST/query providers into `unifiedWorkspace`.
   */
  constructor(documentManager?: DocumentManager, options?: WorkspaceManagerOptions) {
    this.documentManager = documentManager;
    this.coordinator.registerOracle(new OntologyTheoryOracle());
    this.coordinator.registerOracle(new ConstraintTheoryOracle());
    this.coordinator.registerOracle(new AbstractDomainOracle());
    this.coordinator.registerOracle(new DimensionalTheoryOracle());
    this.coordinator.registerOracle(new FlowAlgebraOracle());
    if (typeof options?.threadSeeder === "function") {
      options.threadSeeder(this);
    } else if (options?.seedDemoThreads) {
      this.seedDemoThreads();
    }

    if (typeof this.unifiedWorkspace.attachHypergraph === "function") {
      this.unifiedWorkspace.attachHypergraph(this.hypergraph);
    }

    // Seed default workspace indices and declarative DSL language configs from registered language plugins
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.languageDef && typeof (this.unifiedWorkspace as any).registerLanguageDef === "function") {
        this.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
      if (plugin.workspaceIndex) {
        this.setWorkspaceIndex(plugin.id, plugin.workspaceIndex);
      }
    }

    // Wire up CST providers for cross-language polyglot queries
    this.unifiedWorkspace.cstNodeProvider = (id) => {
      const entry = this.unifiedWorkspace.getIndex().symbols.get(id);
      return this.getCstNodeForSymbol(entry);
    };

    this.unifiedWorkspace.cstTextProvider = (startOffset, endOffset, entry) => {
      if (!entry.resourceId) return null;
      const engine = this.getEngine(entry.resourceId);
      return engine?.toQueryDB().cstText(startOffset, endOffset, entry) ?? null;
    };

    this.unifiedWorkspace.queryProvider = (queryName, id) => {
      const entry = this.unifiedWorkspace.getIndex().symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const engine = this.getEngine(entry.resourceId);
      return engine?.query(queryName, id) ?? null;
    };
  }

  /**
   * Resolves the Salsa `QueryEngine` responsible for the given document `resourceId`.
   */
  public getEngine(resourceId?: string): any {
    if (!resourceId) return null;
    const pluginEngine = globalLanguageRegistry.getQueryEngineForUri(resourceId);
    if (pluginEngine) return pluginEngine;
    const plugin = globalLanguageRegistry.getPluginForUri(resourceId);
    if (plugin) {
      const eng = this.getQueryEngine(plugin.id);
      if (eng) return eng;
    }
    return null;
  }

  /**
   * Reads the raw source text for `resourceId` from open editor buffers, cached CST trees,
   * the virtual browser filesystem, or Node.js disk storage.
   */
  public getSourceText(resourceId: string): string | null {
    const doc = this.documentManager?.documents?.get?.(resourceId);
    if (doc) return doc.getText();
    const docTree = this.documentManager?.documentTrees?.get?.(resourceId);
    if (docTree?.text) return docTree.text;

    const sfs =
      (globalThis as any).sharedFs ?? (globalThis as any).sharedContext?.fs ?? this.documentManager?.sharedContext?.fs;
    if (sfs) {
      let fsPath = resourceId;
      try {
        fsPath = decodeURIComponent(fsPath);
      } catch {}
      if (fsPath.startsWith("modelica:")) {
        fsPath = fsPath.replace(/^modelica:\/*/, "/");
      } else if (fsPath.startsWith("file:")) {
        fsPath = fsPath.replace(/^file:\/*/, "/");
      }
      try {
        if (sfs.exists(fsPath)) return sfs.read(fsPath);
        const noSlash = fsPath.replace(/^\/+/, "");
        if (sfs.exists(noSlash)) return sfs.read(noSlash);
        const withSlash = "/" + noSlash;
        if (sfs.exists(withSlash)) return sfs.read(withSlash);
      } catch {
        // ignore
      }
    }

    try {
      let fsPath = resourceId;
      try {
        fsPath = decodeURIComponent(fsPath);
      } catch {}
      if (fsPath.startsWith("file://")) fsPath = fsPath.substring("file://".length);
      if (typeof process !== "undefined" && process.versions?.node && nodeRequire) {
        const { readFileSync, existsSync } = nodeRequire("fs");
        if (existsSync(fsPath)) return readFileSync(fsPath, "utf-8");
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Recovers the linear memory CST node for a `SymbolEntry` using its stored byte/character offsets.
   */
  public getCstNodeForSymbol(entry: any): any {
    if (!entry) return null;
    if (entry.cstNode) return entry.cstNode;
    if (!entry.resourceId) return null;
    const engine = this.getEngine(entry.resourceId);
    if (engine) {
      try {
        const n = engine.toQueryDB().cstNode(entry.id);
        if (n) return n;
      } catch {
        // Deliberate fallback: stale or evicted CST entries fall through to document text re-parse.
      }
    }
    const resId = entry.resourceId;
    const normUri = resId ? resId.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///") : "";
    const oneSlashUri = resId ? resId.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/") : "";
    let tree =
      this.documentManager?.getDocumentTree?.(resId) ??
      (normUri ? this.documentManager?.getDocumentTree?.(normUri) : null) ??
      (oneSlashUri ? this.documentManager?.getDocumentTree?.(oneSlashUri) : null) ??
      (this.unifiedWorkspace as any)?.getDocumentTree?.(resId) ??
      (normUri ? (this.unifiedWorkspace as any)?.getDocumentTree?.(normUri) : null) ??
      (oneSlashUri ? (this.unifiedWorkspace as any)?.getDocumentTree?.(oneSlashUri) : null);
    const existingRoot = tree?.rootNode ?? (tree as any)?.tree?.rootNode;
    if (!existingRoot) {
      const text =
        this.getSourceText(resId) ??
        (normUri ? this.getSourceText(normUri) : null) ??
        (oneSlashUri ? this.getSourceText(oneSlashUri) : null);
      if (text) {
        const parser =
          globalLanguageRegistry.getPluginById("modelica")?.parser ??
          (globalThis as any).modelicaParser ??
          (globalThis as any).parser ??
          (globalThis as any).sharedContext?.parsers?.get?.(".mo");
        if (parser) {
          try {
            const parsedTree = parser.parse(text);
            tree = parsedTree;
            this.documentManager?.documentTrees?.set(entry.resourceId, {
              text,
              tree: parsedTree,
              classCache: new Map(),
            });
          } catch (err) {
            console.warn("[LSP:workspace-manager] CST fallback parse failed:", err);
          }
        } else {
          const sc = (globalThis as any).sharedContext ?? this.documentManager?.sharedContext;
          if (sc && typeof sc.parse === "function") {
            try {
              const ext = entry.resourceId?.endsWith(".sysml") ? ".sysml" : ".mo";
              const parsedTree = sc.parse(ext, text);
              tree = parsedTree;
              this.documentManager?.documentTrees?.set(entry.resourceId, {
                text,
                tree: parsedTree,
                classCache: new Map(),
              });
            } catch (err) {
              console.warn("[LSP:workspace-manager] sharedContext CST parse failed:", err);
            }
          }
        }
      }
    }
    const root = tree?.rootNode ?? (tree as any)?.tree?.rootNode;
    if (root) {
      const startOff = entry.startOffset;
      const endOff = entry.endOffset;
      if (startOff != null && endOff != null) {
        let node: any = null;
        if (typeof root.descendantForIndex === "function") {
          node = root.descendantForIndex(startOff, endOff) || root;
        } else if (typeof root.descendantForByteRange === "function") {
          node = root.descendantForByteRange(startOff, endOff) || root;
        } else {
          node = root;
        }
        if (node && (entry.kind === "Component" || entry.kind === "Variable")) {
          while (
            node.parent &&
            (node.type === "identifier" ||
              node.type === "Identifier" ||
              node.type === "declaration" ||
              node.type === "Declaration") &&
            (node.parent.type === "declaration" ||
              node.parent.type === "Declaration" ||
              node.parent.type === "component_declaration" ||
              node.parent.type === "ComponentDeclaration")
          ) {
            node = node.parent;
          }
        }
        return node;
      }
      return root;
    }
    return null;
  }

  /**
   * Resolves a class instance adapter for `uri` and optional `className`.
   */
  public resolveClassInstance(
    uri: string,
    className?: string,
    options?: { iconOnly?: boolean | undefined },
  ): any | null {
    return this.resolveModelicaClassInstance(uri, className, options);
  }

  /**
   * Resolves a Modelica or SysML v2 class symbol to a rich class-instance adapter supporting
   * component traversal, `extends` inheritance resolution, `connect` equation extraction,
   * and lazy `AnnotationEvaluator` evaluation for diagram and icon rendering.
   */
  public resolveModelicaClassInstance(
    uri: string,
    className?: string,
    options?: { iconOnly?: boolean | undefined },
  ): any | null {
    // 1. Check documentInstances first for rich AST models
    const docInsts = this.documentInstances.get(uri);
    if (docInsts && docInsts.length > 0) {
      const richInsts = docInsts.filter(
        (ci: any) =>
          (options?.iconOnly || !ci._iconOnly) &&
          (typeof ci.annotation === "function" || (Array.isArray(ci.components) && ci.components.length > 0)),
      );
      if (richInsts.length > 0) {
        if (className) {
          const found = richInsts.find(
            (ci: any) =>
              ci.name === className || ci.compositeName === className || ci.compositeName?.endsWith(`.${className}`),
          );
          if (found) return found;
        } else {
          return richInsts[richInsts.length - 1];
        }
      }
    }

    const annotationCache = new Map<number, Map<string, any>>();
    const adapterByEntryId = new Map<number, unknown>();

    const getSourceText = (resourceId: string): string | null => this.getSourceText(resourceId);

    const createPredefinedPackageInstance = (name = "Package"): any => ({
      name,
      kind: "Package",
      components: [],
      extendsClassInstances: [],
      connectEquations: [],
      annotation: (annName: string) => {
        if (annName === "Icon") {
          return {
            "@type": "Icon",
            coordinateSystem: {
              "@type": "coordinateSystem",
              preserveAspectRatio: false,
              extent: [
                [-100, -100],
                [100, 100],
              ],
            },
            graphics: [
              {
                "@type": "Rectangle",
                lineColor: [200, 200, 200],
                fillColor: [248, 248, 248],
                fillPattern: "HorizontalCylinder",
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
                radius: 25,
              },
              {
                "@type": "Rectangle",
                lineColor: [128, 128, 128],
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
                radius: 25,
              },
            ],
          };
        }
        return null;
      },
    });

    const buildAdapter = (entry: any, db: any, compositeName: string): any => {
      if (entry?.id != null && adapterByEntryId.has(entry.id)) {
        return adapterByEntryId.get(entry.id);
      }
      const children = db.childrenOf ? (db.childrenOf(entry.id) ?? []) : [];
      const components: any[] = [];
      const extendsClassInstances: any[] = [];
      const connectEquations: any[] = [];

      let classInstance: any;

      for (const child of children) {
        if (child.kind === "Component" || child.kind === "Variable") {
          let componentClassInstance: unknown = undefined;
          let childCst: unknown = undefined;
          const getChildCst = (): unknown => {
            if (childCst === undefined) {
              childCst = (db.cstNode ? db.cstNode(child.id) : null) ?? this.getCstNodeForSymbol(child) ?? null;
            }
            return childCst;
          };
          const getComponentClassInstance = (): unknown => {
            if (componentClassInstance !== undefined) {
              return componentClassInstance;
            }
            if (options?.iconOnly) {
              componentClassInstance = null;
              return null;
            }
            const metaTypeSpec: string | null =
              (child.metadata as { typeSpecifier?: string } | undefined)?.typeSpecifier ?? null;
            let typeSpec: string | null = null;
            if (db.query) {
              try {
                typeSpec = db.query("typeSpecifier", child.id) ?? null;
              } catch {}
            }
            if (!typeSpec) {
              typeSpec = metaTypeSpec;
            }
            if (
              typeSpec === "Real" ||
              typeSpec === "Integer" ||
              typeSpec === "Boolean" ||
              typeSpec === "String" ||
              typeSpec === "StateSelect" ||
              typeSpec === "ExternalObject" ||
              typeSpec === "Clock" ||
              (typeSpec &&
                (typeSpec.startsWith("SI.") ||
                  typeSpec.startsWith("Modelica.SIunits.") ||
                  typeSpec.startsWith("Modelica.Units.")))
            ) {
              componentClassInstance = null;
              return null;
            }
            const childClassId = db.query ? db.query("classInstance", child.id) : null;
            const childClassEntry = childClassId ? db.symbol(childClassId) : null;
            componentClassInstance = childClassEntry
              ? buildAdapter(childClassEntry, db, typeSpec || childClassEntry.name)
              : null;
            if (!componentClassInstance) {
              if (!typeSpec) {
                const compCst = (child.cstNode || getChildCst()) as {
                  parent?: { type?: string; children?: Array<{ type?: string; text?: string }> };
                } | null;
                let p = compCst as any;
                while (p) {
                  if (p.type === "component_clause" || p.type === "ComponentClause") {
                    const ts = p.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
                    if (ts) {
                      typeSpec = ts.text?.trim() ?? null;
                      break;
                    }
                  }
                  p = p.parent;
                }
              }
              if (!typeSpec && entry.resourceId) {
                try {
                  const cachedTree = (this as any).documentManager?.documentTrees?.get(entry.resourceId);
                  const root = cachedTree?.tree?.rootNode;
                  if (root && child.startOffset != null && child.endOffset != null) {
                    const findInCst = (n: any): string | null => {
                      if (!n) return null;
                      if (
                        (n.type === "component_clause" || n.type === "ComponentClause") &&
                        n.startIndex <= child.startOffset &&
                        n.endIndex >= child.endOffset
                      ) {
                        const ts = (n.children || []).find(
                          (c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier",
                        );
                        if (ts?.text) return ts.text.trim();
                      }
                      for (const ch of n.children || []) {
                        const res = findInCst(ch);
                        if (res) return res;
                      }
                      return null;
                    };
                    typeSpec = findInCst(root) ?? null;
                  }
                  if (!typeSpec) {
                    const text = getSourceText(entry.resourceId);
                    const sOff = child.startOffset;
                    const eOff = child.endOffset;
                    if (text && sOff != null && eOff != null) {
                      const lineStart = text.lastIndexOf("\n", sOff);
                      const declLine = text.substring(lineStart === -1 ? 0 : lineStart + 1, eOff);
                      const parsedType = extractModelicaTypeFromDeclLine(declLine);
                      if (parsedType) {
                        typeSpec = parsedType;
                      }
                    }
                  }
                } catch {}
              }
              if (
                typeSpec &&
                typeSpec !== "Real" &&
                typeSpec !== "Integer" &&
                typeSpec !== "Boolean" &&
                typeSpec !== "String" &&
                !typeSpec.startsWith("SI.") &&
                !typeSpec.startsWith("Modelica.SIunits.") &&
                !typeSpec.startsWith("Modelica.Units.")
              ) {
                componentClassInstance = this.resolveModelicaClassInstance(entry.resourceId, typeSpec, options);
              }
            }
            return componentClassInstance;
          };
          const compAnnCache = new Map<string, unknown>();
          const compObj = {
            name: child.name,
            annotations: [],
            declaration: child,
            defaultValue: (child.metadata as any)?.defaultValue,
            unit: (child.metadata as any)?.unit,
            description: (child.metadata as any)?.description ?? null,
            get classInstance() {
              return getComponentClassInstance();
            },
            set classInstance(v: unknown) {
              componentClassInstance = v;
            },
            get cstNode() {
              return getChildCst();
            },
            get abstractSyntaxNode() {
              return getChildCst();
            },
            annotation: (annName: string): any => {
              if (compAnnCache.has(annName)) {
                return compAnnCache.get(annName);
              }
              try {
                if ((annName === "Placement" || annName === "placement") && db.query && child.id != null) {
                  try {
                    const salsaPlacement = db.query("componentPlacement", child.id);
                    if (salsaPlacement != null) {
                      compAnnCache.set(annName, salsaPlacement);
                      return salsaPlacement;
                    }
                  } catch {}
                }
                if (
                  (annName === "Placement" || annName === "placement") &&
                  (child.metadata as any)?.placementAnnotation != null
                ) {
                  const metaPlacement = (child.metadata as any).placementAnnotation;
                  compAnnCache.set(annName, metaPlacement);
                  return metaPlacement;
                }
                let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                if (!evaluatorClass && nodeRequire) {
                  try {
                    evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                  } catch {}
                }
                const cst = getChildCst();
                if (cst && evaluatorClass) {
                  const evaluator = new evaluatorClass(classInstance);
                  const res = evaluator.evaluate(cst, annName);
                  compAnnCache.set(annName, res);
                  return res;
                }
              } catch {}
              compAnnCache.set(annName, null);
              return null;
            },
          };
          components.push(compObj);
        } else if (child.kind === "Extends" && child.name) {
          if (child.name !== entry.name && child.name !== compositeName) {
            let baseInstance = this.resolveModelicaClassInstance(entry.resourceId, child.name, options);
            if (!baseInstance && entry.parentId != null) {
              // Try resolving relative to parent scopes (e.g. child.name is "Icons.Package" in "Modelica.Electrical")
              let currParent = db.symbol ? db.symbol(entry.parentId) : null;
              while (currParent && !baseInstance) {
                const qualifiedParentName = currParent.name ? `${currParent.name}.${child.name}` : child.name;
                baseInstance = this.resolveModelicaClassInstance(entry.resourceId, qualifiedParentName, options);
                currParent = currParent.parentId != null && db.symbol ? db.symbol(currParent.parentId) : null;
              }
            }
            if (!baseInstance) {
              // Try resolving relative to package hierarchy from compositeName or resourceId
              const scopeParts = (compositeName ? compositeName.split(".") : []).slice(0, -1);
              if (scopeParts.length === 0 && entry.resourceId) {
                try {
                  const text = getSourceText(entry.resourceId);
                  if (text) {
                    const withinPkg = extractWithinPackageName(text.slice(0, 1000));
                    if (withinPkg) {
                      scopeParts.push(...withinPkg.split("."));
                    }
                  }
                } catch {}
              }
              if (scopeParts.length === 0 && entry.resourceId) {
                const clean = entry.resourceId.replace(/^[a-z]+:\/*(?:lib\/)?/, "").replace(/\/[^/]+$/, "");
                const segments = clean.split("/").filter(Boolean);
                const mIdx = segments.findIndex((s: string) => s === "Modelica" || s.startsWith("Modelica"));
                if (mIdx !== -1) {
                  scopeParts.push(...segments.slice(mIdx));
                  if (scopeParts[0]?.startsWith("Modelica")) scopeParts[0] = "Modelica";
                } else {
                  scopeParts.push(...segments);
                }
              }
              while (scopeParts.length > 0 && !baseInstance) {
                const qualifiedParentName = `${scopeParts.join(".")}.${child.name}`;
                baseInstance = this.resolveModelicaClassInstance(entry.resourceId, qualifiedParentName, options);
                scopeParts.pop();
              }
            }
            if (
              !baseInstance &&
              (child.name === "Modelica.Icons.Package" ||
                child.name === "Icons.Package" ||
                child.name.endsWith(".Icons.Package") ||
                child.name.endsWith(".Package") ||
                child.name === "Package")
            ) {
              baseInstance = createPredefinedPackageInstance(child.name.split(".").pop() || "Package");
            }
            if (baseInstance) {
              type InstType = NonNullable<typeof baseInstance>;
              type CompType = NonNullable<InstType["components"]>[number];
              type ExtType = NonNullable<InstType["extendsClassInstances"]>[number];
              let effectiveBaseInstance: InstType = baseInstance;
              if (db.query && child.id != null) {
                try {
                  const extMods = db.query("extendsModificationParsed", child.id) as
                    | {
                        args?: Array<{
                          name?: string;
                          isRedeclaration?: boolean;
                          redeclaredKind?: string;
                          redeclaredTypeSpecifier?: string;
                        }>;
                      }
                    | null
                    | undefined;
                  const redeclares = new Map<string, string>();
                  for (const arg of extMods?.args ?? []) {
                    if (
                      arg?.isRedeclaration &&
                      arg.name &&
                      arg.redeclaredTypeSpecifier &&
                      arg.redeclaredKind !== "class"
                    ) {
                      redeclares.set(arg.name, arg.redeclaredTypeSpecifier);
                    }
                  }
                  if (redeclares.size > 0) {
                    const wrapRedeclared = (inst: InstType, visited = new Set<object>()): InstType => {
                      if (!inst || typeof inst !== "object" || visited.has(inst)) return inst;
                      visited.add(inst);
                      const wrappedComponents = (inst.components ?? []).map((comp: CompType) => {
                        const overrideType = comp?.name ? redeclares.get(comp.name) : undefined;
                        if (!overrideType) return comp;
                        let resolvedOverride: InstType | null | undefined = undefined;
                        const resolveOverrideInstance = () =>
                          this.resolveModelicaClassInstance(entry.resourceId, overrideType, options);
                        return {
                          ...comp,
                          typeSpecifier: overrideType,
                          get classInstance() {
                            if (resolvedOverride === undefined) {
                              resolvedOverride = resolveOverrideInstance();
                            }
                            return resolvedOverride;
                          },
                          annotation: (annName: string) =>
                            typeof comp.annotation === "function" ? comp.annotation(annName) : null,
                        };
                      });
                      const wrappedExtends = (inst.extendsClassInstances ?? []).map((ext: ExtType) => ({
                        ...ext,
                        classInstance: ext?.classInstance
                          ? wrapRedeclared(ext.classInstance, visited)
                          : ext?.classInstance,
                      }));
                      return {
                        ...inst,
                        components: wrappedComponents,
                        extendsClassInstances: wrappedExtends,
                        annotation: (annName: string, compCtx?: string) =>
                          typeof inst.annotation === "function" ? inst.annotation(annName, compCtx) : null,
                      };
                    };
                    effectiveBaseInstance = wrapRedeclared(baseInstance);
                  }
                } catch {}
              }
              extendsClassInstances.push({ name: child.name, classInstance: effectiveBaseInstance });
            }
          }
        } else if (
          child.kind === "ConnectEquation" ||
          child.ruleName === "ConnectEquation" ||
          child.ruleName === "connect_equation"
        ) {
          let lhsStr = (child.metadata?.lhs as string) ?? child.name ?? "";
          let rhsStr = (child.metadata?.rhs as string) ?? "";
          const connCst = (db.cstNode ? db.cstNode(child.id) : null) ?? this.getCstNodeForSymbol(child);
          if ((!lhsStr || !rhsStr) && connCst) {
            try {
              // 1. CST-native resolution of connect equation endpoints
              const compRefs: any[] = [];
              const collectCompRefs = (node: any) => {
                if (!node) return;
                if (node.type === "component_reference" || node.type === "ComponentReference") {
                  compRefs.push(node);
                  return;
                }
                for (const c of node.children || []) {
                  collectCompRefs(c);
                }
              };
              collectCompRefs(connCst);
              if (compRefs.length >= 2) {
                lhsStr = compRefs[0].text?.trim() ?? lhsStr;
                rhsStr = compRefs[1].text?.trim() ?? rhsStr;
              } else if (connCst.lhs && connCst.rhs) {
                lhsStr = (typeof connCst.lhs === "string" ? connCst.lhs : connCst.lhs.text)?.trim() ?? lhsStr;
                rhsStr = (typeof connCst.rhs === "string" ? connCst.rhs : connCst.rhs.text)?.trim() ?? rhsStr;
              }
            } catch {}

            // 2. Degraded text-based fallback only if CST lacked endpoints
            if (!lhsStr || !rhsStr) {
              try {
                const cstText = connCst.text ?? "";
                const cIdx = cstText.indexOf("connect");
                const openIdx = cIdx !== -1 ? skipWs(cstText, cIdx + 7) : -1;
                if (cIdx !== -1 && cstText[openIdx] === "(") {
                  const start = openIdx + 1;
                  const closeIdx = cstText.lastIndexOf(")");
                  if (closeIdx > start) {
                    const inner = cstText.slice(start, closeIdx);
                    const commaIdx = inner.indexOf(",");
                    if (commaIdx !== -1) {
                      lhsStr = inner.slice(0, commaIdx).trim();
                      rhsStr = inner.slice(commaIdx + 1).trim();
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          }
          if (lhsStr && rhsStr) {
            const targetEquationNode =
              connCst?.parent && (connCst.parent.type === "some_equation" || connCst.parent.type === "SomeEquation")
                ? connCst.parent
                : connCst;
            const connAnnCache = new Map<string, unknown>();
            connectEquations.push({
              lhs: lhsStr,
              rhs: rhsStr,
              componentReference1: {
                parts: lhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
              },
              componentReference2: {
                parts: rhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
              },
              cstNode: targetEquationNode,
              ast: targetEquationNode,
              annotation: (annName: string): any => {
                if (connAnnCache.has(annName)) {
                  return connAnnCache.get(annName);
                }
                try {
                  let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                  if (!evaluatorClass && nodeRequire) {
                    try {
                      evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                    } catch {}
                  }
                  if (targetEquationNode && evaluatorClass) {
                    const evaluator = new evaluatorClass(classInstance);
                    const res = evaluator.evaluate(targetEquationNode, annName);
                    connAnnCache.set(annName, res);
                    return res;
                  }
                } catch {}
                connAnnCache.set(annName, null);
                return null;
              },
            });
          }
        }
      }

      const classCstNode = (db.cstNode ? db.cstNode(entry.id) : null) ?? this.getCstNodeForSymbol(entry);
      classInstance = {
        id: entry.id,
        db,
        entry,
        cstNode: classCstNode,
        abstractSyntaxNode: classCstNode,
        name: entry.name ?? "",
        kind: entry.kind ?? "Class",
        classKind: (entry.metadata as any)?.classKind ?? (entry.metadata as any)?.classPrefixes ?? "class",
        compositeName,
        description: (entry.metadata as any)?.description ?? null,
        isClassInstance: true,
        _iconOnly: Boolean(options?.iconOnly),
        components,
        connectEquations,
        extendsClassInstances,
        resolveName: (parts: string[] | string): any => {
          const partsArray = Array.isArray(parts) ? parts : typeof parts === "string" ? parts.split(".") : [];
          if (partsArray.length === 0) return null;
          const target = partsArray[0];
          const found = components.find((c) => c.name === target);
          if (found) return found;
          for (const ext of extendsClassInstances) {
            const extFound = ext.classInstance?.resolveName?.(partsArray);
            if (extFound) return extFound;
          }
          return null;
        },
        annotation: (() => {
          const ctxAnnCache = new WeakMap<object, Map<string, unknown>>();
          return (name: string, _ctx?: any): any => {
            if (!annotationCache.has(entry.id)) {
              annotationCache.set(entry.id, new Map());
            }
            const classAnnCache = annotationCache.get(entry.id)!;

            const hasCtxInstance = Boolean(
              _ctx && (_ctx.classInstance !== undefined || _ctx.declaration || _ctx.modification || _ctx.cstNode),
            );
            let ctxMap: Map<string, unknown> | undefined;
            if (hasCtxInstance && typeof _ctx === "object") {
              ctxMap = ctxAnnCache.get(_ctx);
              if (ctxMap && ctxMap.has(name)) {
                return ctxMap.get(name);
              }
            }

            const cacheKey = `${name}${_ctx?.ownOnly ? ":own" : ""}`;
            if (!hasCtxInstance && classAnnCache.has(cacheKey)) {
              return classAnnCache.get(cacheKey);
            }

            const setCache = (val: unknown): unknown => {
              if (hasCtxInstance && typeof _ctx === "object") {
                if (!ctxMap) {
                  ctxMap = new Map();
                  ctxAnnCache.set(_ctx, ctxMap);
                }
                ctxMap.set(name, val);
              } else {
                classAnnCache.set(cacheKey, val);
              }
              return val;
            };

            const cstNode: any =
              classCstNode ?? (db.cstNode ? db.cstNode(entry.id) : null) ?? this.getCstNodeForSymbol(entry);

            try {
              if ((name === "Icon" || name === "Diagram") && (!hasCtxInstance || !cstNode) && db.query) {
                try {
                  const qName = name === "Icon" ? "classIconGraphics" : "classDiagramGraphics";
                  const salsaLayer = db.query(qName, entry.id);
                  if (salsaLayer) {
                    return setCache(salsaLayer);
                  }
                } catch {
                  // fall through to metadata / evaluator
                }
              }

              if (!cstNode && entry?.metadata) {
                if (name === "Icon" && (entry.metadata as any).iconAnnotation != null) {
                  return setCache((entry.metadata as any).iconAnnotation);
                }
                if (name === "Diagram" && (entry.metadata as any).diagramAnnotation != null) {
                  return setCache((entry.metadata as any).diagramAnnotation);
                }
                if (name === "defaultComponentName" && (entry.metadata as any).defaultComponentName != null) {
                  return setCache((entry.metadata as any).defaultComponentName);
                }
              }

              if (cstNode) {
                let evaluatorClass =
                  (globalThis as any).AnnotationEvaluator ??
                  AnnotationEvaluator ??
                  (globalLanguageRegistry.getPluginForUri(entry.resourceId || "") as any)?.annotationEvaluator;
                if (!evaluatorClass && nodeRequire) {
                  try {
                    evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                  } catch {
                    // ignore
                  }
                }
                if (evaluatorClass) {
                  const evalScope = hasCtxInstance ? { componentInstance: _ctx, classInstance } : classInstance;
                  const evaluator = new evaluatorClass(evalScope);
                  const evaluated = evaluator.evaluate(cstNode, name);
                  if (evaluated) {
                    return setCache(evaluated);
                  }
                }
              }

              // Fall back to inherited annotations from extends clauses unless caller requested own annotations only
              if (!_ctx?.ownOnly) {
                for (const ext of extendsClassInstances) {
                  const inherited = ext.classInstance?.annotation?.(name, _ctx);
                  if (inherited) {
                    return setCache(inherited);
                  }
                }
              }

              return setCache(null);
            } catch {
              return setCache(null);
            }
          };
        })(),
      };

      for (const comp of components) {
        comp.parent = classInstance;
      }

      if (entry?.id != null) {
        adapterByEntryId.set(entry.id, classInstance);
      }

      return classInstance;
    };

    const isClassLike = (e: any): boolean =>
      e != null &&
      (e.kind === "Class" ||
        e.kind === "Def" ||
        e.kind === "Package" ||
        e.kind === "Model" ||
        e.kind === "Block" ||
        e.kind === "Connector" ||
        e.kind === "Record" ||
        e.kind === "Function" ||
        e.kind === "Type" ||
        e.kind === "Part");

    if (className) {
      if (className.includes("Icons")) {
        (this.unifiedWorkspace as any)?.ensureFQNIndexed?.("Modelica.Icons");
        (this.unifiedWorkspace as any)?.ensureFQNIndexed?.("Icons");
        (this.unifiedWorkspace as any)?.ensureChildrenIndexed?.("Modelica");
      }
      if (typeof (this.unifiedWorkspace as any)?.ensureFQNIndexed === "function") {
        (this.unifiedWorkspace as any).ensureFQNIndexed(className);
      }
      if (typeof (this.unifiedWorkspace as any)?.ensureChildrenIndexed === "function") {
        (this.unifiedWorkspace as any).ensureChildrenIndexed(className);
      }

      const idx = this.unifiedWorkspace.getIndex();
      let rawSymbolIds = idx.byName.get(className) || [];
      // Prefer actual Class/Def symbols over Extends or Import references
      let symbolIds = rawSymbolIds.filter((id: number) => {
        const e = idx.symbols.get(id);
        return isClassLike(e);
      });

      // Try multi-part resolution for fully qualified names ("A.B.C")
      if (symbolIds.length === 0 && className.includes(".")) {
        const parts = className.split(".");

        // 1. Try resolving starting from longest matched prefix in byName (e.g. "Modelica.Icons" -> "Package")
        for (let prefixLen = parts.length - 1; prefixLen >= 1 && symbolIds.length === 0; prefixLen--) {
          const prefix = parts.slice(0, prefixLen).join(".");
          let currentIds = (idx.byName.get(prefix) || []).filter((id: number) => {
            const e = idx.symbols.get(id);
            return isClassLike(e);
          });
          if (currentIds.length === 0) continue;

          for (let i = prefixLen; i < parts.length && currentIds.length > 0; i++) {
            const part = parts[i];
            const nextIds: number[] = [];
            for (const parentId of currentIds) {
              const children = idx.childrenOf.get(parentId);
              if (children) {
                for (const childId of children) {
                  const childEntry = idx.symbols.get(childId);
                  if (childEntry && childEntry.name === part && isClassLike(childEntry)) {
                    nextIds.push(childId);
                  }
                }
              }
            }
            currentIds = nextIds;
          }
          if (currentIds.length > 0) {
            symbolIds = currentIds;
            break;
          }
        }

        // 2. Fall back to part-by-part traversal from each segment
        if (symbolIds.length === 0) {
          for (let startIdx = 0; startIdx < parts.length && symbolIds.length === 0; startIdx++) {
            let currentIds = (idx.byName.get(parts[startIdx]!) || []).filter((id: number) => {
              const e = idx.symbols.get(id);
              return isClassLike(e);
            });
            if (currentIds.length === 0) continue;
            for (let i = startIdx + 1; i < parts.length && currentIds.length > 0; i++) {
              const part = parts[i];
              const nextIds: number[] = [];
              for (const parentId of currentIds) {
                const children = idx.childrenOf.get(parentId);
                if (children) {
                  for (const childId of children) {
                    const childEntry = idx.symbols.get(childId);
                    if (childEntry && childEntry.name === part && isClassLike(childEntry)) {
                      nextIds.push(childId);
                    }
                  }
                }
              }
              currentIds = nextIds;
            }
            if (currentIds.length > 0) {
              symbolIds = currentIds;
              break;
            }
          }
        }
      }

      // If still not found, try matching by composite name
      if (symbolIds.length === 0) {
        let bestMatchLen = 0;
        let bestMatchId: number | null = null;
        for (const [id, e] of idx.symbols) {
          if (isClassLike(e) && e.name === className.split(".").pop()) {
            const fqn = getCompositeName(e, idx);
            if (fqn === className) {
              bestMatchId = id;
              bestMatchLen = fqn.length;
              break;
            } else if (fqn.endsWith(`.${className}`) || className.endsWith(`.${fqn}`)) {
              if (fqn.length > bestMatchLen) {
                bestMatchLen = fqn.length;
                bestMatchId = id;
              }
            }
          }
        }
        if (bestMatchId != null) {
          symbolIds = [bestMatchId];
        }
      }

      const fallbackDb = {
        childrenOf: (id: number) => {
          const childIds = idx.childrenOf.get(id) || [];
          return childIds.map((cid: any) => idx.symbols.get(cid)).filter(Boolean);
        },
        symbol: (id: number) => idx.symbols.get(id) || null,
        query: (_name: string, _id: number) => null,
        cstNode: (id: number) => this.getCstNodeForSymbol(idx.symbols.get(id)),
      };

      const targetId = symbolIds[0];
      if (targetId == null) return null;
      const entry = idx.symbols.get(targetId);
      if (entry && entry.resourceId) {
        let engine =
          entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")
            ? (this.globalSysML2QueryEngine ??
              (
                this.unifiedWorkspace as
                  | { getQueryEngine?: (lang: string) => WorkspaceManager["globalModelicaQueryEngine"] }
                  | undefined
              )?.getQueryEngine?.("sysml2"))
            : (this.globalModelicaQueryEngine ??
              (
                this.unifiedWorkspace as
                  | { getQueryEngine?: (lang: string) => WorkspaceManager["globalModelicaQueryEngine"] }
                  | undefined
              )?.getQueryEngine?.("modelica"));
        if (!engine) {
          engine =
            this.globalModelicaQueryEngine ??
            (
              this.unifiedWorkspace as
                | { getQueryEngine?: (lang: string) => WorkspaceManager["globalModelicaQueryEngine"] }
                | undefined
            )?.getQueryEngine?.("modelica");
        }
        const db = {
          childrenOf: (id: number) => {
            const res = engine ? engine.toQueryDB().childrenOf(id) : [];
            if (res && res.length > 0) return res;
            return fallbackDb.childrenOf(id);
          },
          symbol: (id: number) => (engine ? engine.toQueryDB().symbol(id) : null) ?? fallbackDb.symbol(id),
          query: (name: string, id: number) => (engine ? engine.toQueryDB().query?.(name, id) : null),
          cstNode: (id: number) => (engine ? engine.toQueryDB().cstNode?.(id) : null) ?? fallbackDb.cstNode(id),
        };
        const inst = buildAdapter(entry, db, className);
        if (inst && entry.resourceId) {
          const existing = this.documentInstances.get(entry.resourceId) ?? [];
          const existingIdx = existing.findIndex((x: any) => x.id === inst.id);
          if (existingIdx >= 0) {
            if (!inst._iconOnly || existing[existingIdx]._iconOnly) {
              existing[existingIdx] = inst;
            }
          } else {
            existing.push(inst);
          }
          this.documentInstances.set(entry.resourceId, existing);
        }
        return inst;
      }
      return null;
    }

    const idx = this.unifiedWorkspace.getIndex();
    const fallbackDb = {
      childrenOf: (id: number) => {
        const childIds = idx.childrenOf.get(id) || [];
        return childIds.map((cid: any) => idx.symbols.get(cid)).filter(Boolean);
      },
      symbol: (id: number) => idx.symbols.get(id) || null,
      query: (_name: string, _id: number) => null,
      cstNode: (id: number) => this.getCstNodeForSymbol(idx.symbols.get(id)),
    };

    const normUri = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    const targetNorm = normUri(uri);
    for (const entry of idx.symbols.values()) {
      if (
        (entry.resourceId === uri || (entry.resourceId && normUri(entry.resourceId) === targetNorm)) &&
        isClassLike(entry) &&
        entry.parentId === null
      ) {
        let engine =
          entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")
            ? this.globalSysML2QueryEngine
            : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        const db = {
          childrenOf: (id: number) => {
            const res = engine ? engine.toQueryDB().childrenOf(id) : [];
            if (res && res.length > 0) return res;
            return fallbackDb.childrenOf(id);
          },
          symbol: (id: number) => (engine ? engine.toQueryDB().symbol(id) : null) ?? fallbackDb.symbol(id),
          query: (name: string, id: number) => (engine ? engine.toQueryDB().query?.(name, id) : null),
          cstNode: (id: number) => (engine ? engine.toQueryDB().cstNode?.(id) : null) ?? fallbackDb.cstNode(id),
        };
        const inst = buildAdapter(entry, db, entry.name ?? "");
        if (inst) {
          const existing = this.documentInstances.get(uri) ?? [];
          const existingIdx = existing.findIndex((x: any) => x.id === inst.id);
          if (existingIdx >= 0) {
            if (!inst._iconOnly || existing[existingIdx]._iconOnly) {
              existing[existingIdx] = inst;
            }
          } else {
            existing.push(inst);
          }
          this.documentInstances.set(uri, existing);
        }
        return inst;
      }
    }

    return null;
  }

  /**
   * Maps any registered ModelScript language ID onto the 16-domain `ThreadDomain` bitfield
   * used by `DigitalThreadHypergraph`, preserving distinct slots across cross-language pairs.
   */
  public mapLanguageToThreadDomain(langId: string): ThreadDomain {
    const norm = langId.toLowerCase();
    const mapped = DOMAIN_NAME_TO_INDEX[norm];
    if (mapped !== undefined) return mapped;
    switch (norm) {
      case "psse":
      case "raw":
      case "dyr":
        return ThreadDomain.FMU;
      case "pscad":
      case "pscx":
      case "pslx":
        return ThreadDomain.Software;
      case "easy5":
      case "rocets":
        return ThreadDomain.Surrogate;
      case "spice":
        return ThreadDomain.Telemetry;
      case "ssp":
      case "ssv":
        return ThreadDomain.BOM;
      default:
        return ThreadDomain.Software;
    }
  }

  private normalizeAutoThreadUri(uri: string | undefined): string {
    return (uri ?? "").replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///").toLowerCase();
  }

  private retractSlotCoordinatorLiterals(slot: number): void {
    const prevLits = this.autoCoordinatorLiteralsBySlot.get(slot);
    if (prevLits && typeof this.coordinator?.retractLiteral === "function") {
      for (const litId of prevLits) {
        try {
          this.coordinator.retractLiteral(litId);
        } catch {
          // Ignore already-retracted literals
        }
      }
    }
    this.autoCoordinatorLiteralsBySlot.delete(slot);
  }

  private retractAutoThreadStateForUri(uri: string): void {
    const normTarget = this.normalizeAutoThreadUri(uri);
    const prevSlots = this.autoSlotsByUri.get(normTarget);
    if (prevSlots) {
      for (const slot of prevSlots) {
        this.retractSlotCoordinatorLiterals(slot);
      }
      this.autoSlotsByUri.delete(normTarget);
    }

    const prevKeys = this.autoThreadKeysByUri.get(normTarget);
    if (prevKeys) {
      for (const { slot, metaKey } of prevKeys) {
        this.retractSlotCoordinatorLiterals(slot);
        if (typeof this.hypergraph?.clearTheoryConflict === "function") {
          this.hypergraph.clearTheoryConflict(slot);
        }
        const existing = this.threadMetadataMap.get(metaKey);
        if (existing?.autoDiscovered && this.normalizeAutoThreadUri(existing.uri) === normTarget) {
          this.threadMetadataMap.delete(metaKey);
        }
      }
      this.autoThreadKeysByUri.delete(normTarget);
    }
  }

  private getDocTextForUri(uri: string | undefined): string {
    if (!uri) return "";
    const dm = this.documentManager;
    if (dm?.documents) {
      const doc = dm.documents.get(uri) ?? dm.documents.get(uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///"));
      if (doc && typeof doc.getText === "function") return doc.getText();
    }
    const treeEntry = dm?.documentTrees?.get(uri);
    if (treeEntry?.text) return treeEntry.text;
    const uDoc = this.unifiedWorkspace?.getDocument?.(uri);
    return uDoc?.text ?? "";
  }

  private extractNumericScalarProperties(
    index: SymbolIndex,
    entry: SymbolEntry,
    fallbackText?: string,
  ): Record<string, number> {
    const props: Record<string, number> = {};
    const docText = fallbackText || this.getDocTextForUri(entry.resourceId);

    const recordNumeric = (name: string | undefined, val: unknown): void => {
      if (!name) return;
      if (typeof val === "number" && Number.isFinite(val)) {
        props[name] = val;
      } else if (typeof val === "string") {
        const parsed = Number(val.trim());
        if (val.trim() !== "" && Number.isFinite(parsed)) {
          props[name] = parsed;
        }
      }
    };

    const extractFromSymbol = (sym: SymbolEntry): void => {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      if (meta["namedParams"] && typeof meta["namedParams"] === "object") {
        for (const [k, v] of Object.entries(meta["namedParams"])) {
          recordNumeric(k, v);
        }
      }
      for (const key of ["value", "defaultValue", "bindingValue", "literalValue"]) {
        if (meta[key] !== undefined) {
          recordNumeric(sym.name, meta[key]);
          break;
        }
      }
      if (props[sym.name] === undefined && docText && sym.endOffset > sym.startOffset) {
        const slice = docText.slice(Math.max(0, sym.startOffset), Math.min(docText.length, sym.endOffset + 40));
        const span = findAssignedNumberInLine(slice, { allowSign: true, allowExponent: true });
        if (span?.text) {
          recordNumeric(sym.name, span.text);
        }
      }
    };

    extractFromSymbol(entry);
    const childIds: number[] = index.childrenOf?.get(entry.id) ?? [];
    for (const cid of childIds) {
      const child = index.symbols?.get(cid);
      if (child && isMemberLikeSymbol(child)) {
        extractFromSymbol(child);
      }
    }
    return props;
  }

  /**
   * Automatically discovers cross-language links, requirement bindings, and matching scalar parameters
   * for `uri` from source CSTs, imports, `@twin`/`implements` annotations, and `UnifiedWorkspace` symbols,
   * registering hypergraph slots and formal theory constraints in `this.coordinator`.
   */
  public discoverThreadsForDocument(
    uri: string,
    text: string,
    langId: string,
    tree?: { rootNode?: SyntaxNode | null | undefined } | null,
  ): number[] {
    if (!this.unifiedWorkspace || typeof this.unifiedWorkspace.getIndex !== "function" || !text) {
      return [];
    }
    const uIdx = this.unifiedWorkspace.getIndex();
    if (!uIdx || !uIdx.symbols) return [];

    const normLang = langId.toLowerCase();
    // Large AP242 STEP B-Rep files (>256 KB) never declare @twin/Import/implements source links;
    // scanning them on every keystroke or peer validation stalls the LSP worker.
    if (normLang === "step" && text.length > 262_144) {
      this.retractAutoThreadStateForUri(uri);
      return [];
    }
    const normUri = (u: string) => u.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///").toLowerCase();
    const targetNormUri = normUri(uri);

    this.retractAutoThreadStateForUri(uri);

    const docsToScan: Array<{
      docUri: string;
      docText: string;
      docLang: string;
      docTree: { rootNode?: SyntaxNode | null | undefined } | null | undefined;
    }> = [{ docUri: uri, docText: text, docLang: normLang, docTree: tree }];
    if (this.documentManager?.documents) {
      for (const otherDoc of this.documentManager.documents.all()) {
        if (normUri(otherDoc.uri) === targetNormUri) continue;
        const otherLang =
          globalLanguageRegistry.getPluginForUri(otherDoc.uri)?.id?.toLowerCase() ??
          otherDoc.languageId?.toLowerCase() ??
          "";
        if (!otherLang) continue;
        const otherText = otherDoc.getText();
        if (otherLang === "step" && otherText.length > 262_144) continue;
        const cachedTree = this.documentManager.documentTrees.get(otherDoc.uri)?.tree;
        docsToScan.push({
          docUri: otherDoc.uri,
          docText: otherText,
          docLang: otherLang,
          docTree: cachedTree,
        });
      }
    }

    const discoveredLinks: ReturnType<typeof extractCrossLanguageLinks> = [];
    for (const item of docsToScan) {
      try {
        const found = extractCrossLanguageLinks({
          uri: item.docUri,
          language: item.docLang,
          index: uIdx,
          text: item.docText,
          tree: item.docTree,
        });
        for (const link of found) {
          if (!link.targetEntry) continue;
          const srcNorm = normUri(link.sourceUri);
          const tgtNorm = link.targetEntry.resourceId ? normUri(link.targetEntry.resourceId) : "";
          if (srcNorm === targetNormUri || tgtNorm === targetNormUri) {
            discoveredLinks.push(link);
          }
        }
      } catch {
        // Ignore link extraction failures on malformed/partial buffers
      }
    }

    const computeLineCol = (srcText: string, offset: number): { line: number; column: number } => {
      const safe = Math.max(0, Math.min(offset, srcText.length));
      const before = srcText.slice(0, safe);
      const nl = before.lastIndexOf("\n");
      let line = 1;
      for (let i = 0; i < safe; i++) {
        if (srcText.charCodeAt(i) === 10) line++;
      }
      return { line, column: nl === -1 ? safe + 1 : safe - nl };
    };

    const touchedSlots = new Set<number>();
    const retractedSlotsThisPass = new Set<number>();
    const ownedMetaKeys: Array<{ slot: number; metaKey: string }> = [];
    const slotVarNames = new Map<number, string[]>();

    const retractSlotOnce = (slot: number): void => {
      if (!retractedSlotsThisPass.has(slot)) {
        this.retractSlotCoordinatorLiterals(slot);
        retractedSlotsThisPass.add(slot);
      }
    };

    const assertSlotLiteral = (slot: number, lit: Omit<TheoryLiteral, "id"> & { id?: number | undefined }): void => {
      if (typeof this.coordinator?.assertLiteral !== "function") return;
      retractSlotOnce(slot);
      const litId = this.coordinator.assertLiteral(lit);
      const list = this.autoCoordinatorLiteralsBySlot.get(slot) ?? [];
      list.push(litId);
      this.autoCoordinatorLiteralsBySlot.set(slot, list);
    };

    for (const link of discoveredLinks) {
      const srcEntry = uIdx.symbols.get(link.sourceSymbolId);
      const tgtEntry = link.targetEntry;
      if (!srcEntry || !tgtEntry) continue;
      // Ignore pure package-level wildcard imports unless target is a concrete type/model
      if (link.relationKind === "import" && !isTypeLikeSymbol(tgtEntry)) continue;

      const srcLang = link.sourceLang.toLowerCase();
      const tgtLang = (tgtEntry.language ?? "").toLowerCase();
      if (!tgtLang || tgtLang === srcLang) continue;

      let srcDomain = this.mapLanguageToThreadDomain(srcLang);
      let tgtDomain = this.mapLanguageToThreadDomain(tgtLang);
      if (srcDomain === tgtDomain) {
        tgtDomain = srcDomain === ThreadDomain.Software ? ThreadDomain.FMU : ThreadDomain.Software;
      }

      const stableSymbolPath = (entry: SymbolEntry): string => {
        const parts: string[] = [];
        let cur: SymbolEntry | undefined = entry;
        const seen = new Set<number>();
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          if (cur.name) parts.unshift(cur.name);
          cur = cur.parentId != null ? uIdx.symbols.get(cur.parentId) : undefined;
        }
        return parts.join(".") || entry.name;
      };
      const srcStableName = stableSymbolPath(srcEntry);
      const tgtStableName = stableSymbolPath(tgtEntry);
      const pairKey = [
        `${srcLang}:${normUri(srcEntry.resourceId ?? link.sourceUri)}:${srcStableName}`,
        `${tgtLang}:${normUri(tgtEntry.resourceId ?? "")}:${tgtStableName}`,
      ]
        .sort()
        .join("|");
      let hash = 2166136261;
      for (let i = 0; i < pairKey.length; i++) {
        hash ^= pairKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      const threadId = 100_000 + (hash % 800_000_000);

      const srcText = normUri(link.sourceUri) === targetNormUri ? text : this.getDocTextForUri(link.sourceUri);
      const tgtText =
        tgtEntry.resourceId && normUri(tgtEntry.resourceId) === targetNormUri
          ? text
          : this.getDocTextForUri(tgtEntry.resourceId);

      const srcProps: Record<string, unknown> = {
        ...this.extractNumericScalarProperties(uIdx, srcEntry, srcText),
        ...(link.properties ?? {}),
      };
      const tgtProps: Record<string, unknown> = {
        ...this.extractNumericScalarProperties(uIdx, tgtEntry, tgtText),
      };

      const tgtPos = tgtEntry.resourceId ? computeLineCol(tgtText, tgtEntry.startOffset) : { line: 1, column: 1 };

      const srcDomName = DOMAIN_INDEX_TO_NAME[srcDomain] ?? "unknown";
      const tgtDomName = DOMAIN_INDEX_TO_NAME[tgtDomain] ?? "unknown";
      const srcMetaKey = `${srcDomName}:${srcEntry.id}`;
      const tgtMetaKey = `${tgtDomName}:${tgtEntry.id}`;

      const slot = this.bindThreadSlot(threadId, srcDomain, srcEntry.id, {
        name: srcEntry.name,
        uri: link.sourceUri,
        line: link.sourceLine,
        column: link.sourceColumn,
        length: srcEntry.name.length,
        domain: srcLang,
        properties: srcProps,
        autoDiscovered: true,
      });
      this.bindThreadSlot(threadId, tgtDomain, tgtEntry.id, {
        name: tgtEntry.name,
        uri: tgtEntry.resourceId ?? "",
        line: tgtPos.line,
        column: tgtPos.column,
        length: tgtEntry.name.length,
        domain: tgtLang,
        properties: tgtProps,
        autoDiscovered: true,
      });

      this.autoSlotIds.add(slot);
      touchedSlots.add(slot);
      retractSlotOnce(slot);
      if (normUri(link.sourceUri) === targetNormUri) {
        ownedMetaKeys.push({ slot, metaKey: srcMetaKey });
      }
      if (tgtEntry.resourceId && normUri(tgtEntry.resourceId) === targetNormUri) {
        ownedMetaKeys.push({ slot, metaKey: tgtMetaKey });
      }

      // Assert shared numeric parameter equalities + exact intervals into SemanticTheoryCoordinator
      const canonicalKey = (k: string) => (k === "m" ? "mass" : k);
      for (const [kA, vA] of Object.entries(srcProps)) {
        if (typeof vA !== "number" || !Number.isFinite(vA)) continue;
        const canonA = canonicalKey(kA);
        const matchB = Object.entries(tgtProps).find(([kB]) => canonicalKey(kB) === canonA);
        if (matchB && typeof matchB[1] === "number" && Number.isFinite(matchB[1])) {
          const vB = matchB[1];
          const varA = `${threadId}.${srcLang}.${srcEntry.name}.${canonA}`;
          const varB = `${threadId}.${tgtLang}.${tgtEntry.name}.${canonA}`;
          const vars = slotVarNames.get(slot) ?? [];
          vars.push(varA, varB, canonA, srcEntry.name, tgtEntry.name);
          slotVarNames.set(slot, vars);
          if (typeof this.coordinator?.assertLiteral === "function") {
            assertSlotLiteral(slot, {
              predicate: "interval",
              args: [varA, vA, vA],
              domain: "continuous_safety",
              sourceContext: { slot, uri: link.sourceUri, name: `${srcEntry.name}.${kA}`, value: vA },
            });
            assertSlotLiteral(slot, {
              predicate: "interval",
              args: [varB, vB, vB],
              domain: "continuous_safety",
              sourceContext: { slot, uri: tgtEntry.resourceId, name: `${tgtEntry.name}.${matchB[0]}`, value: vB },
            });
            assertSlotLiteral(slot, {
              predicate: "equal",
              args: [varA, varB],
              domain: "continuous_safety",
              sourceContext: { slot, key: canonA },
            });
          }
        }
      }
    }

    // Synchronize declarative TGG correspondences (Tier 2: zero-annotation container/child/foreignKey alignment)
    if (typeof this.unifiedWorkspace.syncTggCorrespondences === "function") {
      const tggSummary = this.unifiedWorkspace.syncTggCorrespondences(uIdx);
      const projTable = this.unifiedWorkspace.tggProjectionTable;
      for (const slot of tggSummary.touchedSlots) {
        const rec = this.hypergraph.getRecord(slot);
        if (!rec || rec.isRemoved || !rec.domainNodes) continue;
        const memberEntries: Array<{ domIdx: number; entry: SymbolEntry; lang: string }> = [];
        let involvesTargetUri = false;
        for (const [domKey, nodeId] of Object.entries(rec.domainNodes)) {
          const domIdx = Number(domKey);
          if (!Number.isFinite(domIdx) || typeof nodeId !== "number" || nodeId <= 0) continue;
          const sym = uIdx.symbols.get(nodeId);
          if (!sym) continue;
          const symUri = sym.resourceId ?? sym.documentUri ?? "";
          if (symUri && normUri(symUri) === targetNormUri) {
            involvesTargetUri = true;
          }
          memberEntries.push({
            domIdx,
            entry: sym,
            lang: (sym.language ?? DOMAIN_INDEX_TO_NAME[domIdx] ?? "").toLowerCase(),
          });
        }
        if (!involvesTargetUri || memberEntries.length < 2) continue;

        touchedSlots.add(slot);
        const extractedByMember: Array<{
          entry: SymbolEntry;
          lang: string;
          symUri: string;
          props: Record<string, unknown>;
        }> = [];

        for (const m of memberEntries) {
          const symUri = m.entry.resourceId ?? m.entry.documentUri ?? "";
          const symText = symUri && normUri(symUri) === targetNormUri ? text : this.getDocTextForUri(symUri);
          const pos = symUri ? computeLineCol(symText, m.entry.startOffset) : { line: 1, column: 1 };
          const props = this.extractNumericScalarProperties(uIdx, m.entry, symText);
          const domName = DOMAIN_INDEX_TO_NAME[m.domIdx] ?? "unknown";
          const metaKey = `${domName}:${m.entry.id}`;
          if (!this.threadMetadataMap.has(metaKey)) {
            this.threadMetadataMap.set(metaKey, {
              name: m.entry.name,
              uri: symUri,
              line: pos.line,
              column: pos.column,
              length: m.entry.name.length,
              domain: m.lang || domName,
              properties: props,
              autoDiscovered: true,
            });
            if (symUri && normUri(symUri) === targetNormUri) {
              ownedMetaKeys.push({ slot, metaKey });
            }
          }
          extractedByMember.push({ entry: m.entry, lang: m.lang, symUri, props });
        }

        // Assert shared numeric parameter equalities across TGG-aligned containers (including fieldAliases like m <-> mass)
        const canonicalKey = (k: string) => (k === "m" ? "mass" : k);
        const threadId = rec.threadId || slot;
        for (let i = 0; i < extractedByMember.length; i++) {
          const mA = extractedByMember[i]!;
          for (let j = i + 1; j < extractedByMember.length; j++) {
            const mB = extractedByMember[j]!;
            for (const [kA, vA] of Object.entries(mA.props)) {
              if (typeof vA !== "number" || !Number.isFinite(vA)) continue;
              const matchB = Object.entries(mB.props).find(
                ([kB]) =>
                  canonicalKey(kA) === canonicalKey(kB) ||
                  (mA.lang && mB.lang && projTable.areMemberNamesAligned(mA.lang, kA, mB.lang, kB)),
              );
              if (matchB && typeof matchB[1] === "number" && Number.isFinite(matchB[1])) {
                const vB = matchB[1];
                const canon = canonicalKey(kA);
                const varA = `${threadId}.${mA.lang}.${mA.entry.name}.${canon}`;
                const varB = `${threadId}.${mB.lang}.${mB.entry.name}.${canon}`;
                const vars = slotVarNames.get(slot) ?? [];
                vars.push(varA, varB, canon, mA.entry.name, mB.entry.name);
                slotVarNames.set(slot, vars);
                if (typeof this.coordinator?.assertLiteral === "function") {
                  assertSlotLiteral(slot, {
                    predicate: "interval",
                    args: [varA, vA, vA],
                    domain: "continuous_safety",
                    sourceContext: { slot, uri: mA.symUri, name: `${mA.entry.name}.${kA}`, value: vA },
                  });
                  assertSlotLiteral(slot, {
                    predicate: "interval",
                    args: [varB, vB, vB],
                    domain: "continuous_safety",
                    sourceContext: { slot, uri: mB.symUri, name: `${mB.entry.name}.${matchB[0]}`, value: vB },
                  });
                  assertSlotLiteral(slot, {
                    predicate: "equal",
                    args: [varA, varB],
                    domain: "continuous_safety",
                    sourceContext: { slot, key: canon },
                  });
                }
              }
            }
          }
        }
      }
    }

    // Bind formal SysML v2 requirement constraints against discovered thread variables
    for (const item of docsToScan) {
      if (item.docLang !== "sysml2" && item.docLang !== "sysml") continue;
      let reqs: ReturnType<typeof parseSysmlRequirements> = [];
      try {
        reqs = parseSysmlRequirements(item.docText, item.docTree?.rootNode ?? null);
      } catch {
        reqs = [];
      }
      if (reqs.length === 0) continue;

      for (const req of reqs) {
        const canonAttr = req.targetAttribute === "m" ? "mass" : req.targetAttribute;
        for (const slot of touchedSlots) {
          const elems = this.findAlignedElementsBySlot(slot);
          const rec = this.hypergraph.getRecord(slot);
          const matchesSubject = (() => {
            if (!req.subjectName) return true;
            const subjLower = req.subjectName.toLowerCase();
            if (
              elems.some((el) => el.name.toLowerCase() === subjLower || el.name.toLowerCase().endsWith(`.${subjLower}`))
            ) {
              return true;
            }
            if (rec?.domainNodes) {
              for (const nodeId of Object.values(rec.domainNodes)) {
                let cur = uIdx.symbols.get(nodeId);
                const seen = new Set<number>();
                while (cur && !seen.has(cur.id)) {
                  seen.add(cur.id);
                  if (cur.name.toLowerCase() === subjLower) return true;
                  cur = cur.parentId != null ? uIdx.symbols.get(cur.parentId) : undefined;
                }
              }
            }
            return false;
          })();
          if (!matchesSubject) continue;

          for (const el of elems) {
            const props = el.properties ?? {};
            const matchedVal =
              typeof props[req.targetAttribute] === "number"
                ? props[req.targetAttribute]
                : typeof props[canonAttr] === "number"
                  ? props[canonAttr]
                  : undefined;
            if (
              typeof matchedVal === "number" &&
              Number.isFinite(matchedVal) &&
              typeof this.coordinator?.assertLiteral === "function"
            ) {
              const reqVar = `req.${req.id}.${canonAttr}`;
              const elVar = `${slot}.${el.domain}.${el.name}.${canonAttr}`;
              const vars = slotVarNames.get(slot) ?? [];
              vars.push(reqVar, elVar, req.id, el.name, req.targetAttribute);
              slotVarNames.set(slot, vars);
              assertSlotLiteral(slot, {
                predicate: "bound",
                args: [reqVar, req.operator, req.limitValue],
                domain: "continuous_safety",
                sourceContext: { slot, uri: item.docUri, requirementId: req.id, limitValue: req.limitValue },
              });
              assertSlotLiteral(slot, {
                predicate: "interval",
                args: [elVar, matchedVal, matchedVal],
                domain: "continuous_safety",
                sourceContext: { slot, uri: el.uri, name: el.name, value: matchedVal },
              });
              assertSlotLiteral(slot, {
                predicate: "equal",
                args: [reqVar, elVar],
                domain: "continuous_safety",
                sourceContext: { slot, requirementId: req.id },
              });
            }
          }
        }
      }
    }

    if (touchedSlots.size > 0) {
      this.autoSlotsByUri.set(targetNormUri, new Set(touchedSlots));
    }
    if (ownedMetaKeys.length > 0) {
      this.autoThreadKeysByUri.set(targetNormUri, ownedMetaKeys);
    }

    if (touchedSlots.size > 0 && typeof this.coordinator?.checkSat === "function") {
      try {
        const sat = this.coordinator.checkSat();
        for (const slot of touchedSlots) {
          if (typeof this.hypergraph?.clearTheoryConflict === "function") {
            this.hypergraph.clearTheoryConflict(slot);
          }
        }
        if (!sat.isSat && sat.conflict) {
          const culprits = (sat.conflict.culpritEntities ?? []).map((c) => c.toLowerCase());
          const explanationLower = (sat.conflict.explanation ?? "").toLowerCase();
          for (const slot of touchedSlots) {
            const slotVars = (slotVarNames.get(slot) ?? []).map((v) => v.toLowerCase());
            const matchesSlot =
              culprits.some((c) => slotVars.some((sv) => sv === c || sv.includes(c) || c.includes(sv))) ||
              slotVars.some((sv) => explanationLower.includes(sv));
            if (matchesSlot && typeof this.hypergraph?.recordTheoryConflict === "function") {
              this.hypergraph.recordTheoryConflict(slot, sat.conflict);
            }
          }
        }
      } catch {
        // Non-fatal: partial theory states must not crash validation
      }
    }

    return Array.from(touchedSlots);
  }
}
