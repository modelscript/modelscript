// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-useless-constructor */
import type { ClassHierarchyNode, ComponentTreeNode, TreeNodeInfo } from "@modelscript/runtime";
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

export class HierarchyService {
  constructor(_connection: Connection, _documentManager: DocumentManager, _workspaceManager: WorkspaceManager) {}

  classKindFromEntry(entry: any): string {
    return classKindFromEntry(entry);
  }

  isTreeVisible(entry: any): boolean {
    return isTreeVisible(entry);
  }

  getCompositeName(entry: any, index: any): string {
    if (entry.parentId === null) return entry.name;
    const parent = index.symbols.get(entry.parentId);
    if (!parent) return entry.name;
    return getCompositeName(parent, index) + "." + entry.name;
  }

  getTreeChildrenFast(index: any, parentId?: string): TreeNodeInfo[] {
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

  hasClassChildren(index: any, symbolId: number): boolean {
    const childIds = index.childrenOf.get(symbolId);
    if (!childIds) return false;
    for (const id of childIds) {
      const entry = index.symbols.get(id);
      if (entry && isTreeVisible(entry)) return true;
    }
    return false;
  }

  buildClassHierarchy(classInstance: any, visited = new Set<string>()): ClassHierarchyNode {
    return buildClassHierarchy(classInstance, visited);
  }

  buildComponentTree(classInstance: any, depth = 0): ComponentTreeNode {
    return buildComponentTree(classInstance, depth);
  }
}
