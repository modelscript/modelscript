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
import { DocumentManager } from "./DocumentManager.js";

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

export interface LanguageWorkspaceContext {
  index: any;
  queryEngine: QueryEngine | null;
}

export interface ThreadElementMetadata {
  name: string;
  uri: string;
  line: number;
  column: number;
  length?: number;
  domain?: string;
  properties?: Record<string, any>;
}

export class WorkspaceManager {
  private languageContexts = new Map<string, LanguageWorkspaceContext>();
  public unifiedWorkspace = new UnifiedWorkspace();
  public allWorkspaceIndices = new Map<string, any>();
  public workspaceInstances = new Map<string, any[]>();
  public documentInstances = new Map<string, any[]>();
  public documentContexts = new Map<string, any>();

  // Canonical Digital Thread Hypergraph
  public hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();
  public threadMetadataMap = new Map<string, ThreadElementMetadata>();

  // Canonical Semantic Theory Coordinator for cross-domain formal consistency
  public coordinator: SemanticTheoryCoordinator = new SemanticTheoryCoordinator();

  public getCoordinator(): SemanticTheoryCoordinator {
    return this.coordinator;
  }

  public initDefaultThreads(): void {
    if (this.hypergraph.getThreadCount() > 0) return;
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
  }

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

  private activeQueryEngineLookups = new Set<string>();

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
        const idx = this.getWorkspaceIndex("modelica");
        if (idx) {
          const uIdx = typeof idx.toUnifiedPartial === "function" ? idx.toUnifiedPartial() : idx;
          const qe = createModelicaQueryEngine(uIdx);
          this.setQueryEngine(norm, qe);
          return qe;
        }
      }

      return null;
    } finally {
      this.activeQueryEngineLookups.delete(norm);
    }
  }

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

  private documentManager?: DocumentManager;

  constructor(documentManager?: DocumentManager) {
    this.documentManager = documentManager;
    this.coordinator.registerOracle(new OntologyTheoryOracle());
    this.coordinator.registerOracle(new ConstraintTheoryOracle());
    this.coordinator.registerOracle(new AbstractDomainOracle());
    this.coordinator.registerOracle(new DimensionalTheoryOracle());
    this.coordinator.registerOracle(new FlowAlgebraOracle());
    this.initDefaultThreads();

    // Seed default workspace indices from registered language plugins
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.workspaceIndex) {
        this.setWorkspaceIndex(plugin.id, plugin.workspaceIndex);
      }
    }

    const getEngine = (resourceId?: string) => {
      if (!resourceId) return null;
      const pluginEngine = globalLanguageRegistry.getQueryEngineForUri(resourceId);
      if (pluginEngine) return pluginEngine;
      const plugin = globalLanguageRegistry.getPluginForUri(resourceId);
      if (plugin) {
        const eng = this.getQueryEngine(plugin.id);
        if (eng) return eng;
      }
      return null;
    };

    // Wire up CST providers for cross-language polyglot queries
    this.unifiedWorkspace.cstNodeProvider = (id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const engine = getEngine(entry.resourceId);
      return engine?.toQueryDB().cstNode(id) ?? null;
    };

    this.unifiedWorkspace.cstTextProvider = (startByte, endByte, entry) => {
      if (!entry.resourceId) return null;
      const engine = getEngine(entry.resourceId);
      return engine?.toQueryDB().cstText(startByte, endByte, entry) ?? null;
    };

    this.unifiedWorkspace.queryProvider = (queryName, id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const engine = getEngine(entry.resourceId);
      return engine?.query(queryName, id) ?? null;
    };
  }

  public resolveClassInstance(uri: string, className?: string): any | null {
    return this.resolveModelicaClassInstance(uri, className);
  }

  public resolveModelicaClassInstance(uri: string, className?: string): any | null {
    // 1. Check documentInstances first for rich AST models
    const docInsts = this.documentInstances.get(uri);
    if (docInsts && docInsts.length > 0) {
      const richInsts = docInsts.filter(
        (ci: any) => typeof ci.annotation === "function" || (Array.isArray(ci.components) && ci.components.length > 0),
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

    const getSourceText = (resourceId: string): string | null => {
      const doc = this.documentManager?.documents?.get?.(resourceId);
      if (doc) return doc.getText();
      const docTree = this.documentManager?.documentTrees?.get?.(resourceId);
      if (docTree?.text) return docTree.text;

      const sfs =
        (globalThis as any).sharedFs ??
        (globalThis as any).sharedContext?.fs ??
        this.documentManager?.sharedContext?.fs;
      if (sfs) {
        let fsPath = resourceId;
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
        if (fsPath.startsWith("file://")) fsPath = fsPath.substring("file://".length);
        if (typeof process !== "undefined" && process.versions?.node) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { readFileSync, existsSync } = require("fs");
          if (existsSync(fsPath)) return readFileSync(fsPath, "utf-8");
        }
      } catch {
        // ignore
      }
      return null;
    };

    const buildAdapter = (entry: any, db: any, compositeName: string): any => {
      const children = db.childrenOf ? (db.childrenOf(entry.id) ?? []) : [];
      const components: any[] = [];
      const extendsClassInstances: any[] = [];
      const connectEquations: any[] = [];

      let classInstance: any;

      for (const child of children) {
        if (child.kind === "Component" || child.kind === "Variable") {
          const childClassId = db.query ? db.query("classInstance", child.id) : null;
          const childClassEntry = childClassId ? db.symbol(childClassId) : null;
          components.push({
            name: child.name,
            classInstance: childClassEntry ? buildAdapter(childClassEntry, db, childClassEntry.name) : null,
            annotations: [],
            declaration: child,
            cstNode: db.cstNode ? db.cstNode(child.id) : null,
            abstractSyntaxNode: db.cstNode ? db.cstNode(child.id) : null,
            annotation: (annName: string): any => {
              try {
                let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                if (!evaluatorClass && nodeRequire) {
                  try {
                    evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                  } catch {}
                }
                const cst = db.cstNode ? db.cstNode(child.id) : null;
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
            let baseInstance = this.resolveModelicaClassInstance(entry.resourceId, child.name);
            if (!baseInstance && entry.parentId != null) {
              // Try resolving relative to parent scopes (e.g. child.name is "Icons.Package" in "Modelica.Electrical")
              let currParent = db.symbol ? db.symbol(entry.parentId) : null;
              while (currParent && !baseInstance) {
                const qualifiedParentName = currParent.name ? `${currParent.name}.${child.name}` : child.name;
                baseInstance = this.resolveModelicaClassInstance(entry.resourceId, qualifiedParentName);
                currParent = currParent.parentId != null && db.symbol ? db.symbol(currParent.parentId) : null;
              }
            }
            if (baseInstance) {
              extendsClassInstances.push({ classInstance: baseInstance });
            }
          }
        } else if (
          child.kind === "ConnectEquation" ||
          child.ruleName === "ConnectEquation" ||
          child.ruleName === "connect_equation"
        ) {
          let lhsStr = (child.metadata?.lhs as string) ?? child.name ?? "";
          let rhsStr = (child.metadata?.rhs as string) ?? "";
          if ((!lhsStr || !rhsStr) && db.cstNode) {
            try {
              const cst = db.cstNode(child.id);
              if (cst) {
                const cstText = cst.text ?? "";
                const m = cstText.match(/connect\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/);
                if (m) {
                  lhsStr = m[1].trim();
                  rhsStr = m[2].trim();
                }
              }
            } catch {
              // ignore
            }
          }
          if (lhsStr && rhsStr) {
            connectEquations.push({
              lhs: lhsStr,
              rhs: rhsStr,
              componentReference1: {
                parts: lhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
              },
              componentReference2: {
                parts: rhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
              },
              cstNode: db.cstNode ? db.cstNode(child.id) : null,
              ast: db.cstNode ? db.cstNode(child.id) : null,
              annotation: (annName: string): any => {
                try {
                  let evaluatorClass = (globalThis as any).AnnotationEvaluator ?? AnnotationEvaluator;
                  if (!evaluatorClass && nodeRequire) {
                    try {
                      evaluatorClass = nodeRequire("@modelscript/modelica/diagram").AnnotationEvaluator;
                    } catch {}
                  }
                  const cst = db.cstNode ? db.cstNode(child.id) : null;
                  if (cst && evaluatorClass) {
                    const evaluator = new evaluatorClass(classInstance);
                    return evaluator.evaluate(cst, annName);
                  }
                } catch {}
                return null;
              },
            });
          }
        }
      }

      classInstance = {
        id: entry.id,
        db,
        entry,
        cstNode: db.cstNode ? db.cstNode(entry.id) : null,
        abstractSyntaxNode: db.cstNode ? db.cstNode(entry.id) : null,
        name: entry.name ?? "",
        kind: entry.kind ?? "Class",
        classKind: (entry.metadata as any)?.classKind ?? "class",
        compositeName,
        description: (entry.metadata as any)?.description ?? null,
        isClassInstance: true,
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
          const cacheKey = _ctx?.ownOnly ? `${name}:own` : name;
          if (!annotationCache.has(entry.id)) {
            annotationCache.set(entry.id, new Map());
          }
          const classAnnCache = annotationCache.get(entry.id)!;
          if (classAnnCache.has(cacheKey)) {
            return classAnnCache.get(cacheKey);
          }

          let cstNode: any = null;
          if (db.cstNode) {
            cstNode = db.cstNode(entry.id);
          }
          if (!cstNode && this.unifiedWorkspace) {
            cstNode = this.unifiedWorkspace.getCstNode(entry.id);
          }

          if (!cstNode && entry.resourceId) {
            const cachedDoc = this.documentManager?.getDocumentTree?.(entry.resourceId);
            const root = cachedDoc?.rootNode ?? (cachedDoc as any)?.tree?.rootNode;
            if (root) {
              const startOff = entry.startOffset ?? entry.startByte;
              const endOff = entry.endOffset ?? entry.endByte;
              if (startOff != null && endOff != null) {
                if (typeof root.descendantForIndex === "function") {
                  cstNode = root.descendantForIndex(startOff, endOff) || root;
                } else if (typeof root.descendantForByteRange === "function") {
                  cstNode = root.descendantForByteRange(startOff, endOff) || root;
                } else {
                  cstNode = root;
                }
              } else {
                cstNode = root;
              }
            }
          }

          if (!cstNode && entry.resourceId) {
            let text = getSourceText(entry.resourceId);
            if (text) {
              // NOTE: Do NOT truncate large .mo files here. The getSafePackageSource-style
              // truncation strips the trailing annotation(Icon(...)) block, which breaks
              // icon rendering for MSL packages. Annotation evaluation is a lazy background
              // task, so the cost of parsing the full file is acceptable.
              const parser =
                (globalThis as any).modelicaParser ??
                (globalThis as any).parser ??
                (globalThis as any).sharedContext?.parsers?.get?.(".mo");
              try {
                const tree = parser?.parse
                  ? parser.parse(text)
                  : (globalThis as any).sharedContext?.parse?.(".mo", text);
                const root = tree?.rootNode;
                if (root) {
                  const startOff = entry.startOffset ?? entry.startByte;
                  const endOff = entry.endOffset ?? entry.endByte;
                  if (startOff != null && endOff != null && text.length === getSourceText(entry.resourceId)?.length) {
                    if (typeof root.descendantForIndex === "function") {
                      cstNode = root.descendantForIndex(startOff, endOff) || root;
                    } else if (typeof root.descendantForByteRange === "function") {
                      cstNode = root.descendantForByteRange(startOff, endOff) || root;
                    } else {
                      cstNode = root;
                    }
                  } else {
                    cstNode = root;
                  }
                }
              } catch {
                // ignore
              }
            }
          }

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
                const evaluator = new evaluatorClass(classInstance);
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

      return classInstance;
    };

    if (className) {
      if (typeof (this.unifiedWorkspace as any)?.ensureFQNIndexed === "function") {
        (this.unifiedWorkspace as any).ensureFQNIndexed(className);
      } else if (typeof (this.unifiedWorkspace as any)?.ensureChildrenIndexed === "function") {
        (this.unifiedWorkspace as any).ensureChildrenIndexed(className);
        const lastDot = className.lastIndexOf(".");
        if (lastDot > 0) {
          (this.unifiedWorkspace as any).ensureChildrenIndexed(className.substring(0, lastDot));
        }
      }

      const idx = this.unifiedWorkspace.toUnifiedPartial();
      let rawSymbolIds = idx.byName.get(className) || [];
      // Prefer actual Class/Def symbols over Extends or Import references
      let symbolIds = rawSymbolIds.filter((id: number) => {
        const e = idx.symbols.get(id);
        return e && (e.kind === "Class" || e.kind === "Def");
      });

      // Try multi-part resolution for fully qualified names ("A.B.C")
      if (symbolIds.length === 0 && className.includes(".")) {
        const parts = className.split(".");

        // 1. Try resolving starting from longest matched prefix in byName (e.g. "Modelica.Icons" -> "Package")
        for (let prefixLen = parts.length - 1; prefixLen >= 1 && symbolIds.length === 0; prefixLen--) {
          const prefix = parts.slice(0, prefixLen).join(".");
          let currentIds = (idx.byName.get(prefix) || []).filter((id: number) => {
            const e = idx.symbols.get(id);
            return e && (e.kind === "Class" || e.kind === "Def");
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
                  if (
                    childEntry &&
                    childEntry.name === part &&
                    (childEntry.kind === "Class" || childEntry.kind === "Def")
                  ) {
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
            let currentIds = (idx.byName.get(parts[startIdx]) || []).filter((id: number) => {
              const e = idx.symbols.get(id);
              return e && (e.kind === "Class" || e.kind === "Def");
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
                    if (
                      childEntry &&
                      childEntry.name === part &&
                      (childEntry.kind === "Class" || childEntry.kind === "Def")
                    ) {
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
          if ((e.kind === "Class" || e.kind === "Def") && e.name === className.split(".").pop()) {
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
        const db = engine ? (engine.toQueryDB() as any) : fallbackDb;
        const inst = buildAdapter(entry, db, className);
        if (inst && entry.resourceId) {
          const existing = this.documentInstances.get(entry.resourceId) ?? [];
          if (!existing.some((x: any) => x.id === inst.id)) {
            existing.push(inst);
            this.documentInstances.set(entry.resourceId, existing);
          }
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
    };

    const normUri = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    const targetNorm = normUri(uri);
    for (const [id, entry] of idx.symbols.entries()) {
      if (
        (entry.resourceId === uri || (entry.resourceId && normUri(entry.resourceId) === targetNorm)) &&
        (entry.kind === "Class" || entry.kind === "Def") &&
        entry.parentId === null
      ) {
        let engine =
          entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")
            ? this.globalSysML2QueryEngine
            : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        const db = engine ? (engine.toQueryDB() as any) : fallbackDb;
        const inst = buildAdapter(entry, db, entry.name ?? "");
        if (inst) {
          const existing = this.documentInstances.get(uri) ?? [];
          if (!existing.some((x: any) => x.id === inst.id)) {
            existing.push(inst);
            this.documentInstances.set(uri, existing);
          }
        }
        return inst;
      }
    }

    return null;
  }
}
