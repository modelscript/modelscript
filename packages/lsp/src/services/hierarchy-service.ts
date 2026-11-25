// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-useless-constructor */
import type {
  ClassHierarchyNode,
  ComponentTreeNode,
  SymbolEntry,
  SymbolIndex,
  TreeNodeInfo,
} from "@modelscript/runtime";
import { Connection } from "vscode-languageserver";
import {
  buildClassHierarchy,
  buildComponentTree,
  classKindFromEntry,
  fqnCacheState,
  getCompositeName,
  hasClassChildren,
  isTreeVisible,
} from "../utils/hierarchy-utils.js";
import { DocumentManager } from "./document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";

export type HierarchySymbolEntry = Pick<SymbolEntry, "id" | "name" | "parentId"> & Partial<SymbolEntry>;

export interface HierarchySymbolIndexLike {
  symbols: Map<number, HierarchySymbolEntry>;
  childrenOf: Map<number | null, number[]>;
}

export interface HierarchyClassInstanceLike {
  name?: string | undefined;
  compositeName?: string | undefined;
  classKind?: string | undefined;
  kind?: string | undefined;
  description?: string | null | undefined;
  extendsClassInstances?: Array<{ classInstance?: HierarchyClassInstanceLike | null | undefined }> | undefined;
  components?: Array<Record<string, unknown>> | undefined;
  elements?: Array<Record<string, unknown>> | undefined;
}

export class HierarchyService {
  constructor(_connection: Connection, _documentManager: DocumentManager, _workspaceManager: WorkspaceManager) {}

  classKindFromEntry(entry: HierarchySymbolEntry): string {
    return classKindFromEntry(entry);
  }

  isTreeVisible(entry: HierarchySymbolEntry): boolean {
    return isTreeVisible(entry);
  }

  getCompositeName(entry: HierarchySymbolEntry, index: SymbolIndex | HierarchySymbolIndexLike): string {
    if (entry.parentId === null) return entry.name;
    const parent = index.symbols.get(entry.parentId);
    if (!parent) return entry.name;
    return getCompositeName(parent, index) + "." + entry.name;
  }

  getTreeChildrenFast(index: SymbolIndex | HierarchySymbolIndexLike, parentId?: string): TreeNodeInfo[] {
    const nodes: TreeNodeInfo[] = [];

    if (!parentId) {
      // Root level: get children of null (top-level symbols)
      const rootChildIds = index.childrenOf.get(null) ?? [];
      for (const id of rootChildIds) {
        const entry = index.symbols.get(id);
        if (!entry || !isTreeVisible(entry)) continue;
        const compositeName = entry.name; // Root classes have no parent
        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromEntry(entry),
          hasChildren: hasClassChildren(index, id),
          language: entry.language,
        });
        // Cache FQN → ID
        fqnCacheState.cache.set(compositeName, id);
      }
    } else {
      // Find the parent's numeric ID
      let parentIdNum = fqnCacheState.cache.get(parentId);

      if (parentIdNum === undefined) {
        // Cache miss — search the index (one-time cost per FQN)
        for (const [id, entry] of index.symbols) {
          if (isTreeVisible(entry) && getCompositeName(entry, index) === parentId) {
            parentIdNum = id;
            fqnCacheState.cache.set(parentId, id);
            break;
          }
        }
      }

      if (parentIdNum !== undefined) {
        const childIds = index.childrenOf.get(parentIdNum) ?? [];
        for (const id of childIds) {
          const entry = index.symbols.get(id);
          if (!entry || !isTreeVisible(entry)) continue;
          const compositeName = parentId + "." + entry.name;
          nodes.push({
            id: compositeName,
            name: entry.name,
            compositeName,
            classKind: classKindFromEntry(entry),
            hasChildren: hasClassChildren(index, id),
            language: entry.language,
          });
          // Cache FQN → ID
          fqnCacheState.cache.set(compositeName, id);
        }
      }
    }

    // Sort nodes alphabetically
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    return nodes;
  }

  hasClassChildren(index: SymbolIndex | HierarchySymbolIndexLike, symbolId: number): boolean {
    const childIds = index.childrenOf.get(symbolId);
    if (!childIds) return false;
    for (const id of childIds) {
      const entry = index.symbols.get(id);
      if (entry && isTreeVisible(entry)) return true;
    }
    return false;
  }

  buildClassHierarchy(
    classInstance: HierarchyClassInstanceLike | null | undefined,
    visited = new Set<string>(),
  ): ClassHierarchyNode {
    return buildClassHierarchy(classInstance, visited);
  }

  buildComponentTree(classInstance: HierarchyClassInstanceLike | null | undefined, depth = 0): ComponentTreeNode {
    return buildComponentTree(classInstance, depth);
  }
}
