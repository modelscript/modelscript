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
  FlowAlgebraOracle,
  LanguageWorkspaceIndex,
  OntologyTheoryOracle,
  QueryEngine,
  SemanticTheoryCoordinator,
  ThreadDomain,
  UnifiedWorkspace,
} from "@modelscript/runtime";
import type { AlignedDomainElement } from "../providers/threadDiagnosticsProvider.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { extractIndexerHooks } from "../utils/hook-extractor.js";
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
}

/**
 * Configuration options for WorkspaceManager initialization.
 */
export interface WorkspaceManagerOptions {
  /** If true, seeds sample cross-domain digital threads for testing and demonstration. */
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

  /** Canonical Semantic Theory Coordinator for cross-domain formal consistency checking. */
  public coordinator: SemanticTheoryCoordinator = new SemanticTheoryCoordinator();

  /**
   * Returns the active `SemanticTheoryCoordinator` instance.
   */
  public getCoordinator(): SemanticTheoryCoordinator {
    return this.coordinator;
  }

  /**
   * Seeds the digital thread hypergraph with reference cross-domain threads
   * (powertrain inverter, thermal cooling plate, and multi-domain drone assembly) for testing/demo.
   */
  public seedDemoThreads(options?: { force?: boolean }): void {
    if (!options?.force && this.hypergraph.getThreadCount() > 0) return;
    const s0 = this.hypergraph.createThread(101, 1);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.Requirements, 1001);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.SysML2, 2001);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.Modelica, 3001);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.CAD, 4001);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.FEA, 5001);
    this.hypergraph.bindDomainNode(s0, ThreadDomain.BOM, 6001);

    this.threadMetadataMap.set("requirements:1001", {
      name: "REQ-TORQUE-01 (Peak Torque >= 350Nm)",
      uri: "file:///workspace/requirements/powertrain.reqif",
      line: 12,
      column: 1,
      domain: "requirements",
      properties: { status: "Verified" },
    });
    this.threadMetadataMap.set("sysml2:2001", {
      name: "part def PowertrainInverter",
      uri: "file:///workspace/sysml/Powertrain.sysml",
      line: 45,
      column: 5,
      domain: "sysml2",
      properties: { mass: 1.0 },
    });
    this.threadMetadataMap.set("modelica:3001", {
      name: "model InverterDrive",
      uri: "file:///workspace/modelica/InverterDrive.mo",
      line: 14,
      column: 1,
      domain: "modelica",
      properties: { mass: 1.0 },
    });
    this.threadMetadataMap.set("cad:4001", {
      name: "Inverter_Chassis.step",
      uri: "file:///workspace/cad/Inverter_Chassis.step",
      line: 1,
      column: 1,
      domain: "cad",
      properties: { mass: 1.02 },
    });
    this.threadMetadataMap.set("fea:5001", {
      name: "InverterMount_CalculiX.inp",
      uri: "file:///workspace/fea/InverterMount_CalculiX.inp",
      line: 1,
      column: 1,
      domain: "fea",
    });
    this.threadMetadataMap.set("bom:6001", {
      name: "P/N 840-0219 (Inverter Assy)",
      uri: "file:///workspace/bom/parts.csv",
      line: 1,
      column: 1,
      domain: "bom",
    });

    const s1 = this.hypergraph.createThread(102, 2);
    this.hypergraph.bindDomainNode(s1, ThreadDomain.Requirements, 1002);
    this.hypergraph.bindDomainNode(s1, ThreadDomain.SysML2, 2002);
    this.hypergraph.bindDomainNode(s1, ThreadDomain.Modelica, 3002);
    this.hypergraph.bindDomainNode(s1, ThreadDomain.CAD, 4002);
    this.hypergraph.markStale(s1);

    this.threadMetadataMap.set("requirements:1002", {
      name: "REQ-THERMAL-02 (Junction Temp <= 85C)",
      uri: "file:///workspace/requirements/thermal.reqif",
      line: 28,
      column: 1,
      domain: "requirements",
    });
    this.threadMetadataMap.set("sysml2:2002", {
      name: "part def CoolingPlate",
      uri: "file:///workspace/sysml/Cooling.sysml",
      line: 88,
      column: 5,
      domain: "sysml2",
    });
    this.threadMetadataMap.set("modelica:3002", {
      name: "model CoolingCircuit",
      uri: "file:///workspace/modelica/CoolingCircuit.mo",
      line: 32,
      column: 1,
      domain: "modelica",
      properties: { mass: 0.8 },
    });
    this.threadMetadataMap.set("cad:4002", {
      name: "CoolingPlate.step",
      uri: "file:///workspace/cad/CoolingPlate.step",
      line: 1,
      column: 1,
      domain: "cad",
      properties: { mass: 1.15 },
    });

    const sDrone = this.hypergraph.createThread(104, 3);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.SysML2, 2004);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.Modelica, 3004);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.CAD, 4004);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.FEA, 5004);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.CFD, 6004);
    this.hypergraph.bindDomainNode(sDrone, ThreadDomain.Requirements, 7004);

    this.threadMetadataMap.set("sysml2:2004", {
      name: "part def DroneAssembly",
      uri: "sysml/drone_specs.sysml",
      line: 30,
      column: 3,
      domain: "sysml2",
      properties: { mass: 1.2, frontalArea: 0.03, aeroDragCoeff: 0.8 },
    });
    this.threadMetadataMap.set("modelica:3004", {
      name: "model DroneSimulation",
      uri: "modelica/DroneSimulation.mo",
      line: 1,
      column: 1,
      domain: "modelica",
      properties: { mass: 1.2, frontalArea: 0.03, aeroDragCoeff: 0.8 },
    });
    this.threadMetadataMap.set("cad:4004", {
      name: "drone.scad",
      uri: "cad/drone.scad",
      line: 12,
      column: 1,
      domain: "cad",
      properties: { frontalArea: 0.03, mass: 1.2 },
    });
    this.threadMetadataMap.set("fea:5004", {
      name: "drone_chassis.inp",
      uri: "cae/drone_chassis.inp",
      line: 33,
      column: 1,
      domain: "fea",
      properties: { mass: 1.2, maxStress: 172.4, yieldStrength: 180.0 },
    });
    this.threadMetadataMap.set("cfd:6004", {
      name: "drone_aero.cfg",
      uri: "cae/drone_aero.cfg",
      line: 23,
      column: 1,
      domain: "cfd",
      properties: { aeroDragCoeff: 0.8, frontalArea: 0.03 },
    });
    this.threadMetadataMap.set("requirements:7004", {
      name: "requirement FlightCeilingRequirement",
      uri: "sysml/drone_specs.sysml",
      line: 43,
      column: 3,
      domain: "requirements",
      properties: { v_climb_max: 12.0, status: "Verified" },
    });
  }

  /**
   * Backwards-compatible alias for `seedDemoThreads()`.
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
    const domName = DOMAIN_INDEX_TO_NAME[domain] ?? "unknown";
    const key = `${domName}:${nodeId}`;
    this.threadMetadataMap.set(key, { ...meta, domain: domName });
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

    const normUri = uri.toLowerCase();
    for (const [key, meta] of this.threadMetadataMap.entries()) {
      if (meta.uri && (meta.uri.toLowerCase() === normUri || normUri.endsWith(meta.uri.toLowerCase()))) {
        const parts = key.split(":");
        const domName = parts[0]!;
        const nodeId = parseInt(parts[1]!, 10);
        const domIdx = DOMAIN_NAME_TO_INDEX[domName];
        if (domIdx !== undefined) {
          const slot = this.hypergraph.findSlotByDomainNode(domIdx, nodeId);
          if (slot !== null && slot !== undefined) {
            const record = this.hypergraph.getRecord(slot);
            results.push({ slot, record, meta, domain: domName, nodeId });
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

    for (let dom = 0; dom < 16; dom++) {
      const nodeId = this.hypergraph.getDomainNode(slot, dom);
      if (nodeId && nodeId > 0) {
        const domName = DOMAIN_INDEX_TO_NAME[dom] ?? "unknown";
        const key = `${domName}:${nodeId}`;
        const meta = this.threadMetadataMap.get(key);
        domainElements.push({
          domain: domName,
          name: meta?.name ?? `${domName}_node_${nodeId}`,
          line: meta?.line ?? 1,
          column: meta?.column ?? 1,
          properties: meta?.properties,
          status,
        });
      }
    }
    return domainElements;
  }

  /**
   * Retrieves (or lazily creates via registered factories) the workspace symbol index for `langId`.
   */
  public getWorkspaceIndex(langId: string): any {
    const norm = langId.toLowerCase();
    const ctx = this.languageContexts.get(norm);
    if (ctx?.index) return ctx.index;
    const plugin = globalLanguageRegistry.getPluginById(norm);
    if (plugin?.workspaceIndex) {
      this.setWorkspaceIndex(norm, plugin.workspaceIndex);
      return plugin.workspaceIndex;
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
        } else if (norm === "pscad") {
          const mod = nodeRequire("@modelscript/pscad");
          if (mod?.PscadWorkspaceIndex) {
            const idx = new mod.PscadWorkspaceIndex();
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
          const idx = new LanguageWorkspaceIndex(hooks);
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
          const uIdx = typeof idx.toUnifiedPartial === "function" ? idx.toUnifiedPartial() : idx;
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

  /** @deprecated Use `getWorkspaceIndex("step")` instead. */
  get stepWorkspaceIndex() {
    return this.getWorkspaceIndex("step");
  }
  set stepWorkspaceIndex(val: any) {
    this.setWorkspaceIndex("step", val);
  }

  /** Returns the PSCAD workspace symbol index. */
  get pscadWorkspaceIndex() {
    return this.getWorkspaceIndex("pscad");
  }
  set pscadWorkspaceIndex(val: any) {
    this.setWorkspaceIndex("pscad", val);
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
    if (options?.seedDemoThreads) {
      this.seedDemoThreads();
    }

    // Seed default workspace indices from registered language plugins
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.workspaceIndex) {
        this.setWorkspaceIndex(plugin.id, plugin.workspaceIndex);
      }
    }

    // Wire up CST providers for cross-language polyglot queries
    this.unifiedWorkspace.cstNodeProvider = (id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
      return this.getCstNodeForSymbol(entry);
    };

    this.unifiedWorkspace.cstTextProvider = (startOffset, endOffset, entry) => {
      if (!entry.resourceId) return null;
      const engine = this.getEngine(entry.resourceId);
      return engine?.toQueryDB().cstText(startOffset, endOffset, entry) ?? null;
    };

    this.unifiedWorkspace.queryProvider = (queryName, id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
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
      } catch {}
    }
    let tree =
      this.documentManager?.getDocumentTree?.(entry.resourceId) ??
      (this.unifiedWorkspace as any)?.getDocumentTree?.(entry.resourceId);
    const existingRoot = tree?.rootNode ?? (tree as any)?.tree?.rootNode;
    if (!existingRoot) {
      const text = this.getSourceText(entry.resourceId);
      if (text) {
        const parser =
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
          } catch {}
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
            } catch {}
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
      const children = db.childrenOf ? (db.childrenOf(entry.id) ?? []) : [];
      const components: any[] = [];
      const extendsClassInstances: any[] = [];
      const connectEquations: any[] = [];

      let classInstance: any;

      for (const child of children) {
        if (child.kind === "Component" || child.kind === "Variable") {
          let componentClassInstance = null;
          if (!options?.iconOnly) {
            const childClassId = db.query ? db.query("classInstance", child.id) : null;
            let typeSpec: string | null = (child.metadata as any)?.typeSpecifier ?? null;
            if (!typeSpec && db.query) {
              try {
                typeSpec = db.query("typeSpecifier", child.id);
              } catch {}
            }
            const childClassEntry = childClassId ? db.symbol(childClassId) : null;
            componentClassInstance = childClassEntry
              ? buildAdapter(childClassEntry, db, typeSpec || childClassEntry.name)
              : null;
            if (!componentClassInstance) {
              if (!typeSpec) {
                const compCst = (child.cstNode || (db.cstNode ? db.cstNode(child.id) : null)) as any;
                let p = compCst?.parent;
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
                  const text = getSourceText(entry.resourceId);
                  const sOff = child.startOffset;
                  const eOff = child.endOffset;
                  if (text && sOff != null && eOff != null) {
                    const lineStart = text.lastIndexOf("\n", sOff);
                    const declLine = text.substring(lineStart === -1 ? 0 : lineStart + 1, eOff);
                    const m = declLine.match(
                      /^\s*(?:(?:flow|stream|discrete|parameter|constant|input|output)\s+)*([A-Za-z0-9_.]+)\s+/,
                    );
                    if (m) {
                      typeSpec = m[1]!.trim();
                    }
                  }
                } catch {}
              }
              if (typeSpec) {
                componentClassInstance = this.resolveModelicaClassInstance(entry.resourceId, typeSpec, options);
              }
            }
          }
          const childCst = (db.cstNode ? db.cstNode(child.id) : null) ?? this.getCstNodeForSymbol(child);
          components.push({
            name: child.name,
            classInstance: componentClassInstance,
            annotations: [],
            declaration: child,
            cstNode: childCst,
            abstractSyntaxNode: childCst,
            annotation: (annName: string): any => {
              try {
                let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                if (!evaluatorClass && nodeRequire) {
                  try {
                    evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                  } catch {}
                }
                const cst = (db.cstNode ? db.cstNode(child.id) : null) ?? this.getCstNodeForSymbol(child);
                if (cst && evaluatorClass) {
                  const evaluator = new evaluatorClass(classInstance);
                  return evaluator.evaluate(cst, annName);
                }
              } catch {}
              return null;
            },
          });
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
                    const withinMatch = text.slice(0, 1000).match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
                    if (withinMatch && withinMatch[1]) {
                      scopeParts.push(...withinMatch[1].trim().split("."));
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
              extendsClassInstances.push({ name: child.name, classInstance: baseInstance });
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
              const cstText = connCst.text ?? "";
              const connectMatch = cstText.match(/connect\s*\(/);
              if (connectMatch && connectMatch.index !== undefined) {
                const start = connectMatch.index + connectMatch[0].length;
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
          if (lhsStr && rhsStr) {
            const targetEquationNode =
              connCst?.parent && (connCst.parent.type === "some_equation" || connCst.parent.type === "SomeEquation")
                ? connCst.parent
                : connCst;
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
                try {
                  let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                  if (!evaluatorClass && nodeRequire) {
                    try {
                      evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                    } catch {}
                  }
                  if (targetEquationNode && evaluatorClass) {
                    const evaluator = new evaluatorClass(classInstance);
                    return evaluator.evaluate(targetEquationNode, annName);
                  }
                } catch {}
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
        annotation: (name: string, _ctx?: any): any => {
          const ctxMod =
            _ctx?.cstNode?.text ??
            _ctx?.abstractSyntaxNode?.text ??
            (_ctx?.modification
              ? (() => {
                  try {
                    return JSON.stringify(_ctx.modification);
                  } catch {
                    return String(_ctx.modification);
                  }
                })()
              : "");
          const cacheKey = `${name}${_ctx?.ownOnly ? ":own" : ""}${ctxMod ? `:mod:${ctxMod}` : ""}`;
          if (!annotationCache.has(entry.id)) {
            annotationCache.set(entry.id, new Map());
          }
          const classAnnCache = annotationCache.get(entry.id)!;
          if (classAnnCache.has(cacheKey)) {
            return classAnnCache.get(cacheKey);
          }

          const cstNode: any = (db.cstNode ? db.cstNode(entry.id) : null) ?? this.getCstNodeForSymbol(entry);

          try {
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
                const evalScope =
                  _ctx && (_ctx.classInstance || _ctx.declaration || _ctx.modification || _ctx.cstNode)
                    ? { componentInstance: _ctx, classInstance }
                    : classInstance;
                const evaluator = new evaluatorClass(evalScope);
                const evaluated = evaluator.evaluate(cstNode, name);
                if (evaluated) {
                  classAnnCache.set(cacheKey, evaluated);
                  return evaluated;
                }
              }
            }

            // Fall back to inherited annotations from extends clauses unless caller requested own annotations only
            if (!_ctx?.ownOnly) {
              for (const ext of extendsClassInstances) {
                const inherited = ext.classInstance?.annotation?.(name, _ctx);
                if (inherited) {
                  classAnnCache.set(cacheKey, inherited);
                  return inherited;
                }
              }
            }

            classAnnCache.set(cacheKey, null);
            return null;
          } catch {
            classAnnCache.set(cacheKey, null);
            return null;
          }
        },
      };

      for (const comp of components) {
        comp.parent = classInstance;
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

      const idx = this.unifiedWorkspace.toUnifiedPartial();
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

    const idx = this.unifiedWorkspace.toUnifiedPartial();
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
}
