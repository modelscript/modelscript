// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import {
  AbstractDomainOracle,
  ConstraintTheoryOracle,
  type CSTTree,
  DigitalThreadHypergraph,
  DimensionalTheoryOracle,
  FlowAlgebraOracle,
  LanguageWorkspaceIndex,
  OntologyTheoryOracle,
  QueryEngine,
  SemanticTheoryCoordinator,
  SymbolEntry,
  type SymbolIndex,
  type SyntaxNode,
  ThreadDomain,
  UnifiedWorkspace,
} from "@modelscript/runtime";
import type { AlignedDomainElement } from "../providers/threadDiagnosticsProvider.js";
import { globalLanguageRegistry, type WorkspaceIndexLike } from "../registry/LanguageRegistry.js";
import type { CstTreeLike } from "../utils/ast-utils.js";
import { extractIndexerHooks } from "../utils/hook-extractor.js";
import {
  DigitalThreadIndex,
  mapLanguageToThreadDomain,
  resolveCstNameSpan,
  type ThreadElementMetadata,
  type WorkspaceThreadRecord,
} from "./digital-thread-index.js";
import { DocumentManager, type SharedCompilerContext, type SharedCompilerFileSystem } from "./document-manager.js";
import {
  type AnnotationEvalContext,
  type DescendantCstNode,
  resolveModelicaClassInstanceWithHost,
  type WorkspaceClassInstance,
  type WorkspaceComponentInstance,
  type WorkspaceConnectEquation,
  type WorkspaceExtendsInstance,
} from "./modelica-class-adapter.js";

export {
  resolveCstNameSpan,
  type AnnotationEvalContext,
  type ThreadElementMetadata,
  type WorkspaceClassInstance,
  type WorkspaceComponentInstance,
  type WorkspaceConnectEquation,
  type WorkspaceExtendsInstance,
  type WorkspaceThreadRecord,
};

type NodeRequireFn = (id: string) => unknown;

let nodeRequire: NodeRequireFn | null = null;
try {
  if (typeof process !== "undefined" && process.versions?.node) {
    const req = typeof module !== "undefined" ? (module as { require?: NodeRequireFn }).require : null;
    if (typeof req === "function") {
      const nm = req("node:module") as { createRequire?: (url: string) => NodeRequireFn } | undefined;
      if (nm?.createRequire) {
        nodeRequire = nm.createRequire(import.meta.url);
      }
    }
  }
} catch {
  // Non-node environment
}

/** Structural interface covering per-language workspace symbol indices across built-in and plugin languages. */
export interface WorkspaceIndexHandle {
  fileCount?: number | undefined;
  pendingFileCount?: number | undefined;
  unifiedIndex?: SymbolIndex | undefined;
  register?(uri: string, rootOrGetter: unknown): unknown;
  reindexDocument?(uri: string, rootOrGetter?: unknown, editRanges?: unknown, totalDelta?: number): unknown;
  indexDocument?(
    uri: string,
    rootOrGetter: unknown,
    editRanges?: unknown,
    totalDelta?: number,
    eager?: boolean,
  ): unknown;
  has?(uri: string): boolean;
  getFileIndex?(uri: string): SymbolIndex | undefined;
  getIndex?(options?: { eager?: boolean }): SymbolIndex;
  getIndexAsync?(): Promise<SymbolIndex>;
  indexFile?(uri: string, text: string): void;
  addFile?(uri: string, text: string): void;
  removeDocument?(uri: string): void;
  ensureFQNIndexed?(fqn: string): void;
  ensureChildrenIndexed?(fqn: string): void;
  ensureIndexed?(uri: string): void;
  getFileUriForFQN?(fqn: string): string | undefined;
  indexRemainingInBackground?(batchSize?: number): Promise<void>;
  takeGlobalChangedIds?(): Set<number>;
  takeGlobalChangedNames?(): Set<string>;
  getDocumentUris?(): string[];
  symbols?: Map<number, SymbolEntry>;
  byName?: Map<string, number[]>;
  childrenOf?: Map<number | null, number[]>;
  version: number;
}

/** Map storing `WorkspaceClassInstance[]` per URI while accepting untyped record arrays on write. */
export class ClassInstanceListMap extends Map<string, [WorkspaceClassInstance, ...WorkspaceClassInstance[]]> {
  override set(key: string, value: ReadonlyArray<WorkspaceClassInstance | Record<string, unknown>>): this {
    return super.set(key, value as [WorkspaceClassInstance, ...WorkspaceClassInstance[]]);
  }
}

/** Map storing `SharedCompilerContext` per URI while accepting opaque context values on write. */
export class DocumentContextMap extends Map<string, SharedCompilerContext> {
  override set(key: string, value: unknown): this {
    return super.set(key, value as SharedCompilerContext);
  }
}

interface CstTreeContainer {
  rootNode?: DescendantCstNode | null | undefined;
  tree?: { rootNode?: DescendantCstNode | null | undefined } | null | undefined;
}

/**
 * Holds the per-language workspace symbol index and Salsa query engine instance.
 */
export interface LanguageWorkspaceContext {
  /** Language-specific workspace symbol index. */
  index: WorkspaceIndexHandle | null;
  /** Memoized Salsa `QueryEngine` bound to `index`, or `null` if not yet initialized. */
  queryEngine: QueryEngine | null;
}

/**
 * Configuration options for WorkspaceManager initialization.
 */
export interface WorkspaceManagerOptions {
  /** Optional custom seeder function to initialize digital threads (e.g. in test suites). */
  threadSeeder?: (wm: WorkspaceManager) => void;
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
  public allWorkspaceIndices = new Map<string, WorkspaceIndexHandle | null>();
  /** Cached instantiated class adapters keyed by `${uri}#${className}`. */
  public workspaceInstances: ClassInstanceListMap = new ClassInstanceListMap();
  /** Cached top-level instantiated class descriptors keyed by document URI. */
  public documentInstances: ClassInstanceListMap = new ClassInstanceListMap();
  /** Cached compiler `Context` objects keyed by document URI. */
  public documentContexts: DocumentContextMap = new DocumentContextMap();
  /** Optional injected virtual filesystem for resolving standard library and workspace files. */
  public sharedFs?: SharedCompilerFileSystem | undefined;
  /** Optional injected parser service for CST fallback parses and shared CST tree access. */
  public parserService?:
    | {
        getParser?(langId: string): { parse(text: string): unknown } | null;
        getSharedCstTreeWrapper?: () => CSTTree;
      }
    | undefined;

  /** Canonical Digital Thread Hypergraph tracking cross-domain node bindings and staleness/conflicts. */
  public hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();
  /** Metadata lookup table mapping `${domain}:${nodeId}` keys to source locations and properties. */
  public threadMetadataMap = new Map<string, ThreadElementMetadata>();
  /** Canonical Semantic Theory Coordinator for cross-domain formal consistency checking. */
  public coordinator: SemanticTheoryCoordinator = new SemanticTheoryCoordinator();
  /** Focused digital-thread index coordinating hypergraph bindings, TGG sync, and theory literals. */
  private readonly digitalThreadIndex: DigitalThreadIndex;

  /**
   * Returns the active `SemanticTheoryCoordinator` instance.
   */
  public getCoordinator(): SemanticTheoryCoordinator {
    return this.coordinator;
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
    return this.digitalThreadIndex.bindThreadSlot(threadId, domain, nodeId, meta);
  }

  /**
   * Finds all digital thread hypergraph slots and domain node bindings associated with a document URI.
   */
  public getThreadsForUri(uri: string): {
    slot: number;
    record: WorkspaceThreadRecord | null | undefined;
    meta: ThreadElementMetadata;
    domain: string;
    nodeId: number;
  }[] {
    return this.digitalThreadIndex.getThreadsForUri(uri);
  }

  /**
   * Returns all domain elements aligned under the specified hypergraph `slot` along with their
   * current synchronization status (`"synced"`, `"stale"`, or `"conflict"`).
   */
  public findAlignedElementsBySlot(slot: number): AlignedDomainElement[] {
    return this.digitalThreadIndex.findAlignedElementsBySlot(slot);
  }

  private readonly resolvingWorkspaceIndex = new Set<string>();

  /**
   * Retrieves (or lazily creates via registered factories) the workspace symbol index for `langId`.
   */
  public getWorkspaceIndex(langId: string): WorkspaceIndexHandle | undefined {
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
          return pIdx as unknown as WorkspaceIndexHandle;
        }
      } finally {
        this.resolvingWorkspaceIndex.delete(norm);
      }
    }
    if (norm === "sysml") {
      const s2 = this.getWorkspaceIndex("sysml2");
      if (s2) return s2;
    }
    const pluginFactory = (plugin as { createWorkspaceIndex?: () => WorkspaceIndexHandle } | undefined)
      ?.createWorkspaceIndex;
    if (typeof pluginFactory === "function") {
      const idx = pluginFactory();
      this.setWorkspaceIndex(norm, idx);
      return idx;
    }
    if (norm === "modelica") {
      const idx = createModelicaWorkspaceIndex() as unknown as WorkspaceIndexHandle;
      this.setWorkspaceIndex(norm, idx);
      return idx;
    }
    if (nodeRequire) {
      try {
        if (norm === "sysml2" || norm === "sysml") {
          const mod = nodeRequire("@modelscript/sysml2/factory") as
            { createSysML2WorkspaceIndex?: () => WorkspaceIndexHandle } | undefined;
          if (mod?.createSysML2WorkspaceIndex) {
            const idx = mod.createSysML2WorkspaceIndex();
            this.setWorkspaceIndex(norm, idx);
            return idx;
          }
        } else if (norm === "owl2" || norm === "owl") {
          const mod = nodeRequire("@modelscript/owl2/factory") as
            { createOWL2WorkspaceIndex?: () => WorkspaceIndexHandle } | undefined;
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
        const hooks = extractIndexerHooks(plugin.languageDef as unknown as Parameters<typeof extractIndexerHooks>[0]);
        if (hooks && hooks.length > 0) {
          const normalizedHooks = hooks.map((h) => ({
            ruleName: h.ruleName,
            kind: h.kind,
            namePath: h.namePath,
            exportPaths: h.exportPaths ?? [],
            inheritPaths: h.inheritPaths ?? [],
            metadataFieldPaths: h.metadataFieldPaths ?? {},
          }));
          const idx = new LanguageWorkspaceIndex(
            normalizedHooks,
            plugin.languageDef.indexing?.workspaceHooks as ConstructorParameters<typeof LanguageWorkspaceIndex>[1],
          ) as unknown as WorkspaceIndexHandle;
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
  public setWorkspaceIndex(
    langId: string,
    index: WorkspaceIndexHandle | WorkspaceIndexLike | LanguageWorkspaceIndex | null | undefined,
  ): void {
    const norm = langId.toLowerCase();
    const resolvedIndex = (index ?? null) as WorkspaceIndexHandle | null;
    const existing = this.languageContexts.get(norm) ?? { index: null, queryEngine: null };
    existing.index = resolvedIndex;
    this.languageContexts.set(norm, existing);
    this.allWorkspaceIndices.set(norm, resolvedIndex);
    if (this.unifiedWorkspace && typeof this.unifiedWorkspace.registerWorkspace === "function") {
      this.unifiedWorkspace.registerWorkspace(
        norm,
        resolvedIndex as unknown as Parameters<UnifiedWorkspace["registerWorkspace"]>[1],
      );
    }

    const alt = norm === "sysml" ? "sysml2" : norm === "sysml2" ? "sysml" : null;
    if (alt) {
      const altExisting = this.languageContexts.get(alt) ?? { index: null, queryEngine: null };
      altExisting.index = resolvedIndex;
      this.languageContexts.set(alt, altExisting);
      this.allWorkspaceIndices.set(alt, resolvedIndex);
      if (this.unifiedWorkspace && typeof this.unifiedWorkspace.registerWorkspace === "function") {
        this.unifiedWorkspace.registerWorkspace(
          alt,
          resolvedIndex as unknown as Parameters<UnifiedWorkspace["registerWorkspace"]>[1],
        );
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
          const uIdx = (
            this.unifiedWorkspace && typeof this.unifiedWorkspace.getIndex === "function"
              ? this.unifiedWorkspace.getIndex()
              : typeof idx.getIndex === "function"
                ? idx.getIndex()
                : idx
          ) as SymbolIndex;
          injectPredefinedTypes(uIdx);
          const cstWrapper = this.parserService?.getSharedCstTreeWrapper?.();
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
    if (qe && this.unifiedWorkspace && typeof this.unifiedWorkspace.registerQueryEngine === "function") {
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
  get globalWorkspaceIndex(): WorkspaceIndexHandle | undefined {
    return this.getWorkspaceIndex("modelica");
  }
  set globalWorkspaceIndex(val: WorkspaceIndexHandle | WorkspaceIndexLike | LanguageWorkspaceIndex | null | undefined) {
    this.setWorkspaceIndex("modelica", val);
  }

  /** @deprecated Use `getWorkspaceIndex("sysml2")` instead. */
  get sysml2WorkspaceIndex(): WorkspaceIndexHandle | undefined {
    return this.getWorkspaceIndex("sysml2");
  }
  set sysml2WorkspaceIndex(val: WorkspaceIndexHandle | WorkspaceIndexLike | LanguageWorkspaceIndex | null | undefined) {
    this.setWorkspaceIndex("sysml2", val);
  }

  /** @deprecated Use `getQueryEngine("modelica")` instead. */
  get globalModelicaQueryEngine(): QueryEngine | null {
    return this.getQueryEngine("modelica");
  }
  set globalModelicaQueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("modelica", val);
  }

  /** @deprecated Use `getQueryEngine("sysml2")` instead. */
  get globalSysML2QueryEngine(): QueryEngine | null {
    return this.getQueryEngine("sysml2");
  }
  set globalSysML2QueryEngine(val: QueryEngine | null) {
    this.setQueryEngine("sysml2", val);
  }

  /**
   * Cleans up cached instances, contexts, and query engine caches for a closed document.
   */
  public disposeDocument(uri: string): void {
    this.workspaceInstances.delete(uri);
    this.documentInstances.delete(uri);
    this.documentContexts.delete(uri);
    this.digitalThreadIndex.disposeDocument(uri);
    type DisposableQueryEngine = QueryEngine & { disposeDocument?: (docUri: string) => void };
    const eng = globalLanguageRegistry.getQueryEngineForUri(uri) as DisposableQueryEngine | undefined;
    eng?.disposeDocument?.(uri);
    (this.globalModelicaQueryEngine as DisposableQueryEngine | null)?.disposeDocument?.(uri);
    (this.globalSysML2QueryEngine as DisposableQueryEngine | null)?.disposeDocument?.(uri);
  }

  /** Optional reference to the `DocumentManager` for accessing open text documents and CST trees. */
  public documentManager?: DocumentManager | undefined;

  /**
   * Creates a new `WorkspaceManager`, registers all formal semantic theory oracles,
   * optionally seeds sample digital threads, and wires CST/query providers into `unifiedWorkspace`.
   */
  constructor(documentManager?: DocumentManager, options?: WorkspaceManagerOptions) {
    this.documentManager = documentManager;
    this.digitalThreadIndex = new DigitalThreadIndex(this);

    this.coordinator.registerOracle(new OntologyTheoryOracle());
    this.coordinator.registerOracle(new ConstraintTheoryOracle());
    this.coordinator.registerOracle(new AbstractDomainOracle());
    this.coordinator.registerOracle(new DimensionalTheoryOracle());
    this.coordinator.registerOracle(new FlowAlgebraOracle());
    if (typeof options?.threadSeeder === "function") {
      options.threadSeeder(this);
    }

    if (typeof this.unifiedWorkspace.attachHypergraph === "function") {
      this.unifiedWorkspace.attachHypergraph(this.hypergraph);
    }

    // Seed default workspace indices and declarative DSL language configs from registered language plugins
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.languageDef && typeof this.unifiedWorkspace.registerLanguageDef === "function") {
        this.unifiedWorkspace.registerLanguageDef(
          plugin.id,
          plugin.languageDef as unknown as Parameters<UnifiedWorkspace["registerLanguageDef"]>[1],
        );
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
  public getEngine(resourceId?: string): QueryEngine | null {
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

    const sfs = this.sharedFs ?? this.documentManager?.sharedContext?.fs;
    if (sfs) {
      let fsPath = resourceId;
      try {
        fsPath = decodeURIComponent(fsPath);
      } catch {
        // Keep raw resourceId if URI contains malformed percent-encoding.
      }
      if (fsPath.startsWith("modelica:")) {
        fsPath = fsPath.replace(/^modelica:\/*/, "/");
      } else if (fsPath.startsWith("file:")) {
        fsPath = fsPath.replace(/^file:\/*/, "/");
      }
      try {
        if (sfs.exists(fsPath)) return sfs.read(fsPath) ?? null;
        const noSlash = fsPath.replace(/^\/+/, "");
        if (sfs.exists(noSlash)) return sfs.read(noSlash) ?? null;
        const withSlash = "/" + noSlash;
        if (sfs.exists(withSlash)) return sfs.read(withSlash) ?? null;
      } catch {
        // ignore
      }
    }

    try {
      let fsPath = resourceId;
      try {
        fsPath = decodeURIComponent(fsPath);
      } catch {
        // Keep raw resourceId if URI contains malformed percent-encoding.
      }
      if (fsPath.startsWith("file://")) fsPath = fsPath.substring("file://".length);
      if (typeof process !== "undefined" && process.versions?.node && nodeRequire) {
        const fsMod = nodeRequire("fs") as {
          readFileSync: (p: string, enc: string) => string;
          existsSync: (p: string) => boolean;
        };
        if (fsMod.existsSync(fsPath)) return fsMod.readFileSync(fsPath, "utf-8");
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Recovers the linear memory CST node for a `SymbolEntry` using its stored byte/character offsets.
   */
  public getCstNodeForSymbol(
    entry:
      | (Partial<SymbolEntry> & {
          cstNode?: DescendantCstNode | null | undefined;
        })
      | null
      | undefined,
  ): DescendantCstNode | null {
    if (!entry) return null;
    if (entry.cstNode) return entry.cstNode;
    if (!entry.resourceId) return null;
    const engine = this.getEngine(entry.resourceId);
    if (engine && typeof entry.id === "number") {
      try {
        const n = engine.toQueryDB().cstNode(entry.id) as DescendantCstNode | null | undefined;
        if (n) return n;
      } catch {
        // Deliberate fallback: stale or evicted CST entries fall through to document text re-parse.
      }
    }
    const resId = entry.resourceId;
    const normUri = resId ? resId.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///") : "";
    const oneSlashUri = resId ? resId.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:/") : "";
    const uw = this.unifiedWorkspace;
    const getDocTree = (u: string): CstTreeContainer | null => {
      const dmTree = this.documentManager?.getDocumentTree?.(u);
      if (dmTree && typeof dmTree === "object") return dmTree as CstTreeContainer;
      if ("getDocumentTree" in uw && typeof uw.getDocumentTree === "function") {
        const uwTree = uw.getDocumentTree(u);
        if (uwTree && typeof uwTree === "object") return uwTree as CstTreeContainer;
      }
      return null;
    };
    let tree: CstTreeContainer | null =
      getDocTree(resId) ?? (normUri ? getDocTree(normUri) : null) ?? (oneSlashUri ? getDocTree(oneSlashUri) : null);
    const existingRoot = tree?.rootNode ?? tree?.tree?.rootNode;
    if (!existingRoot) {
      const text =
        this.getSourceText(resId) ??
        (normUri ? this.getSourceText(normUri) : null) ??
        (oneSlashUri ? this.getSourceText(oneSlashUri) : null);
      if (text) {
        const parser =
          globalLanguageRegistry.getPluginById("modelica")?.parser ??
          this.parserService?.getParser?.("modelica") ??
          null;
        if (parser) {
          try {
            const parsedTree = parser.parse(text) as CstTreeContainer | null;
            tree = parsedTree;
            if (parsedTree) {
              this.documentManager?.documentTrees?.set(entry.resourceId, {
                text,
                tree: parsedTree as CstTreeLike,
                classCache: new Map(),
              });
            }
          } catch (err) {
            console.warn("[LSP:workspace-manager] CST fallback parse failed:", err);
          }
        } else {
          const sc = this.documentManager?.sharedContext;
          if (sc && typeof sc.parse === "function") {
            try {
              const ext = entry.resourceId?.endsWith(".sysml") ? ".sysml" : ".mo";
              const parsedTree = sc.parse(ext, text) as CstTreeContainer | null;
              tree = parsedTree;
              if (parsedTree) {
                this.documentManager?.documentTrees?.set(entry.resourceId, {
                  text,
                  tree: parsedTree as unknown as CstTreeLike,
                  classCache: new Map(),
                });
              }
            } catch (err) {
              console.warn("[LSP:workspace-manager] sharedContext CST parse failed:", err);
            }
          }
        }
      }
    }
    const root = tree?.rootNode ?? tree?.tree?.rootNode;
    if (root) {
      const startOff = entry.startOffset;
      const endOff = entry.endOffset;
      if (startOff != null && endOff != null) {
        let node: DescendantCstNode | null = null;
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
  ): WorkspaceClassInstance | null {
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
  ): WorkspaceClassInstance | null {
    return resolveModelicaClassInstanceWithHost(
      {
        documentInstances: this.documentInstances,
        unifiedWorkspace: this.unifiedWorkspace,
        documentManager: this.documentManager,
        globalModelicaQueryEngine: this.globalModelicaQueryEngine,
        globalSysML2QueryEngine: this.globalSysML2QueryEngine,
        nodeRequire,
        getSourceText: (resourceId) => this.getSourceText(resourceId),
        getCstNodeForSymbol: (entry) => this.getCstNodeForSymbol(entry),
        resolveModelicaClassInstance: (targetUri, targetClass, targetOptions) =>
          this.resolveModelicaClassInstance(targetUri, targetClass, targetOptions),
      },
      uri,
      className,
      options,
    );
  }

  /**
   * Maps any registered ModelScript language ID onto the 16-domain `ThreadDomain` bitfield
   * used by `DigitalThreadHypergraph`, preserving distinct slots across cross-language pairs.
   */
  public mapLanguageToThreadDomain(langId: string): ThreadDomain {
    return mapLanguageToThreadDomain(langId);
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
    return this.digitalThreadIndex.discoverThreadsForDocument(uri, text, langId, tree);
  }
}
