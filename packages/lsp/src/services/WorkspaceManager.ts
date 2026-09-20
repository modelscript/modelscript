/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
import { AnnotationEvaluator } from "@modelscript/modelica/diagram";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { createOWL2WorkspaceIndex } from "@modelscript/owl2/factory";
import owl2Lang from "@modelscript/owl2/language";
import { QueryEngine, UnifiedWorkspace } from "@modelscript/runtime";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getCompositeName } from "../utils/hierarchyUtils.js";
import { extractIndexerHooks } from "../utils/hook-extractor.js";
import { DocumentManager } from "./DocumentManager.js";

const owl2IndexerHooks = extractIndexerHooks(owl2Lang);

export class WorkspaceManager {
  public globalWorkspaceIndex = createModelicaWorkspaceIndex();
  public sysml2WorkspaceIndex = createSysML2WorkspaceIndex();
  public owl2WorkspaceIndex = createOWL2WorkspaceIndex();
  public stepWorkspaceIndex: any; // Requires step-workspace-index
  public unifiedWorkspace = new UnifiedWorkspace();
  public allWorkspaceIndices = new Map<string, any>();
  public workspaceInstances = new Map<string, any[]>();
  public documentInstances = new Map<string, any[]>();
  public documentContexts = new Map<string, any>();

  public globalModelicaQueryEngine: QueryEngine | null = null;
  public globalSysML2QueryEngine: QueryEngine | null = null;
  public globalStepQueryEngine: QueryEngine | null = null;
  public globalOWL2QueryEngine: QueryEngine | null = null;

  private documentManager: DocumentManager;

  constructor(documentManager: DocumentManager) {
    this.documentManager = documentManager;
    // Step integration is handled in browserServerMain or by a setter

    const getEngine = (resourceId?: string) => {
      if (!resourceId) return null;
      const pluginEngine = globalLanguageRegistry.getQueryEngineForUri(resourceId);
      if (pluginEngine) return pluginEngine;
      if (resourceId.endsWith(".sysml")) return this.globalSysML2QueryEngine;
      if (resourceId.endsWith(".owl") || resourceId.endsWith(".ofn")) return this.globalOWL2QueryEngine;
      if (/\.(step|stp|p21)$/i.test(resourceId)) return this.globalStepQueryEngine;
      return this.globalModelicaQueryEngine;
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

  public resolveModelicaClassInstance(uri: string, className?: string): any | null {
    // 1. Check documentInstances first for rich AST models
    const docInsts = this.documentInstances.get(uri);
    if (docInsts && docInsts.length > 0) {
      if (className) {
        const found = docInsts.find(
          (ci: any) =>
            ci.name === className || ci.compositeName === className || ci.compositeName?.endsWith(`.${className}`),
        );
        if (found) return found;
      } else {
        return docInsts[docInsts.length - 1];
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

      for (const child of children) {
        if (child.kind === "Component" || child.kind === "Variable") {
          const childClassId = db.query ? db.query("classInstance", child.id) : null;
          const childClassEntry = childClassId ? db.symbol(childClassId) : null;
          components.push({
            name: child.name,
            classInstance: childClassEntry ? buildAdapter(childClassEntry, db, childClassEntry.name) : null,
            annotations: [],
            declaration: child,
          });
        } else if (child.kind === "Extends" && child.name) {
          if (child.name !== entry.name && child.name !== compositeName) {
            const baseInstance = this.resolveModelicaClassInstance(entry.resourceId, child.name);
            if (baseInstance) {
              extendsClassInstances.push({ classInstance: baseInstance });
            }
          }
        }
      }

      let classInstance: any;
      classInstance = {
        id: entry.id,
        db,
        entry,
        name: entry.name ?? "",
        kind: entry.kind ?? "Class",
        classKind: (entry.metadata as any)?.classKind ?? "class",
        compositeName,
        description: (entry.metadata as any)?.description ?? null,
        isClassInstance: true,
        components,
        connectEquations: [],
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
          if (!annotationCache.has(entry.id)) {
            annotationCache.set(entry.id, new Map());
          }
          const classAnnCache = annotationCache.get(entry.id)!;
          if (classAnnCache.has(name)) {
            return classAnnCache.get(name);
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
              if (entry.startByte != null && entry.endByte != null) {
                if (typeof root.descendantForByteRange === "function") {
                  cstNode = root.descendantForByteRange(entry.startByte, entry.endByte) || root;
                } else if (typeof root.descendantForIndex === "function") {
                  cstNode = root.descendantForIndex(entry.startByte, entry.endByte) || root;
                } else {
                  cstNode = root;
                }
              } else {
                cstNode = root;
              }
            }
          }

          if (!cstNode && entry.resourceId) {
            const text = getSourceText(entry.resourceId);
            if (text) {
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
                  if (entry.startByte != null && entry.endByte != null) {
                    if (typeof root.descendantForByteRange === "function") {
                      cstNode = root.descendantForByteRange(entry.startByte, entry.endByte) || root;
                    } else if (typeof root.descendantForIndex === "function") {
                      cstNode = root.descendantForIndex(entry.startByte, entry.endByte) || root;
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

          if (!cstNode) {
            classAnnCache.set(name, null);
            return null;
          }

          try {
            const evaluator = new AnnotationEvaluator(classInstance);
            const evaluated = evaluator.evaluate(cstNode, name);
            classAnnCache.set(name, evaluated ?? null);
            return evaluated ?? null;
          } catch {
            classAnnCache.set(name, null);
            return null;
          }
        },
      };

      return classInstance;
    };

    if (className) {
      if (typeof (this.unifiedWorkspace as any)?.ensureChildrenIndexed === "function") {
        (this.unifiedWorkspace as any).ensureChildrenIndexed(className);
        const lastDot = className.lastIndexOf(".");
        if (lastDot > 0) {
          (this.unifiedWorkspace as any).ensureChildrenIndexed(className.substring(0, lastDot));
        }
      }

      const idx = this.unifiedWorkspace.toUnifiedPartial();
      let symbolIds = idx.byName.get(className) || [];

      // Try multi-part resolution for fully qualified names ("A.B.C")
      if (symbolIds.length === 0 && className.includes(".")) {
        const parts = className.split(".");
        let currentIds = idx.byName.get(parts[0]) || [];
        for (let i = 1; i < parts.length && currentIds.length > 0; i++) {
          const part = parts[i];
          const nextIds: any[] = [];
          for (const parentId of currentIds) {
            const children = idx.childrenOf.get(parentId);
            if (children) {
              for (const childId of children) {
                const childEntry = idx.symbols.get(childId);
                if (childEntry && childEntry.name === part) {
                  nextIds.push(childId);
                }
              }
            }
          }
          currentIds = nextIds;
        }
        symbolIds = currentIds;
      }

      // If still not found, try matching by composite name
      if (symbolIds.length === 0) {
        for (const [id, entry] of idx.symbols) {
          if (entry.name === className.split(".").pop()) {
            const fqn = getCompositeName(entry, idx);
            if (fqn === className || fqn.endsWith(`.${className}`)) {
              symbolIds = [id];
              break;
            }
          }
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

      const entry = idx.symbols.get(symbolIds[0]);
      if (entry && entry.resourceId) {
        let engine = entry.resourceId.endsWith(".sysml")
          ? this.globalSysML2QueryEngine
          : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        const db = engine ? (engine.toQueryDB() as any) : fallbackDb;
        return buildAdapter(entry, db, className);
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

    for (const [id, entry] of idx.symbols.entries()) {
      if (entry.resourceId === uri && (entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
        let engine = entry.resourceId.endsWith(".sysml")
          ? this.globalSysML2QueryEngine
          : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        const db = engine ? (engine.toQueryDB() as any) : fallbackDb;
        return buildAdapter(entry, db, entry.name ?? "");
      }
    }

    return null;
  }
}
