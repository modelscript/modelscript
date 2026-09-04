/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import owl2Lang from "@modelscript/owl2/language";
import { QueryEngine, UnifiedWorkspace } from "@modelscript/runtime";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import { extractIndexerHooks } from "../utils/hook-extractor.js";
import { DocumentManager } from "./DocumentManager.js";

const owl2IndexerHooks = extractIndexerHooks(owl2Lang);

export class WorkspaceManager {
  public globalWorkspaceIndex = createModelicaWorkspaceIndex();
  public sysml2WorkspaceIndex = createSysML2WorkspaceIndex();
  public owl2WorkspaceIndex: any = { version: 0, fileCount: 0 };
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

    // Wire up CST providers for cross-language polyglot queries
    this.unifiedWorkspace.cstNodeProvider = (id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const engine = entry.resourceId.endsWith(".sysml")
        ? this.globalSysML2QueryEngine
        : this.globalModelicaQueryEngine;
      return engine?.toQueryDB().cstNode(id) ?? null;
    };

    this.unifiedWorkspace.cstTextProvider = (startByte, endByte, entry) => {
      if (!entry.resourceId) return null;
      const engine = entry.resourceId.endsWith(".sysml")
        ? this.globalSysML2QueryEngine
        : this.globalModelicaQueryEngine;
      return engine?.toQueryDB().cstText(startByte, endByte, entry) ?? null;
    };

    this.unifiedWorkspace.queryProvider = (queryName, id) => {
      const entry = this.unifiedWorkspace.toUnifiedPartial().symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const engine = entry.resourceId.endsWith(".sysml")
        ? this.globalSysML2QueryEngine
        : this.globalModelicaQueryEngine;
      return engine?.query(queryName, id) ?? null;
    };
  }

  public resolveModelicaClassInstance(uri: string, className?: string): any | null {
    if (className) {
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

      const entry = idx.symbols.get(symbolIds[0]);
      if (entry && entry.resourceId) {
        let engine = entry.resourceId.endsWith(".sysml")
          ? this.globalSysML2QueryEngine
          : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        if (engine) {
          const db = engine.toQueryDB() as any;
          return {
            id: entry.id,
            db,
            entry,
            name: entry.name ?? "",
            kind: entry.kind ?? "Class",
            classKind: (entry.metadata as any)?.classKind ?? "class",
            compositeName: className,
            description: (entry.metadata as any)?.description ?? null,
            isClassInstance: true,
          };
        }
      }
      return null;
    }

    const idx = this.unifiedWorkspace.toUnifiedPartial();
    for (const [id, entry] of idx.symbols.entries()) {
      if (entry.resourceId === uri && (entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
        let engine = entry.resourceId.endsWith(".sysml")
          ? this.globalSysML2QueryEngine
          : this.globalModelicaQueryEngine;
        if (!engine) engine = this.globalModelicaQueryEngine;
        if (engine) {
          const db = engine.toQueryDB() as any;
          return {
            id: entry.id,
            db,
            entry,
            name: entry.name ?? "",
            kind: entry.kind ?? "Class",
            classKind: (entry.metadata as any)?.classKind ?? "class",
            compositeName: entry.name ?? "",
            description: (entry.metadata as any)?.description ?? null,
            isClassInstance: true,
          };
        }
      }
    }

    const instances = this.documentInstances.get(uri);
    return instances && instances.length > 0 ? instances[instances.length - 1] : null;
  }
}
