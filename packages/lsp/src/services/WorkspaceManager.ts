/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
import { Context, QueryEngine, UnifiedWorkspace, WorkspaceIndex } from "@modelscript/compiler";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import { ModelicaClassInstance } from "@modelscript/modelica/semantic-model";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
// @ts-ignore
import { INDEXER_HOOKS as owl2IndexerHooks } from "@modelscript/owl2/config";
import { DocumentManager } from "./DocumentManager";

export class WorkspaceManager {
  public globalWorkspaceIndex = createModelicaWorkspaceIndex();
  public sysml2WorkspaceIndex = createSysML2WorkspaceIndex();
  public owl2WorkspaceIndex = new WorkspaceIndex(owl2IndexerHooks);
  public stepWorkspaceIndex: any; // Requires step-workspace-index
  public unifiedWorkspace = new UnifiedWorkspace();
  public allWorkspaceIndices = new Map<string, any>();
  public workspaceInstances = new Map<string, ModelicaClassInstance[]>();
  public documentInstances = new Map<string, ModelicaClassInstance[]>();
  public documentContexts = new Map<string, Context>();

  public globalModelicaQueryEngine: QueryEngine | null = null;
  public globalSysML2QueryEngine: QueryEngine | null = null;
  public globalStepQueryEngine: QueryEngine | null = null;
  public globalOWL2QueryEngine: QueryEngine | null = null;

  private documentManager: DocumentManager;

  constructor(documentManager: DocumentManager) {
    this.documentManager = documentManager;
    // Step integration is handled in browserServerMain or by a setter
  }

  public resolveModelicaClassInstance(uri: string, className?: string): ModelicaClassInstance | null {
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
          const classInstance = new ModelicaClassInstance(entry.id, engine.toQueryDB() as any);
          return classInstance;
        }
      }
      return null;
    }

    const instances = this.documentInstances.get(uri);
    return instances && instances.length > 0 ? instances[instances.length - 1] : null;
  }
}
