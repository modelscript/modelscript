/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import {
  ClassHierarchyNode,
  ComponentTreeNode,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  TreeNodeInfo,
} from "@modelscript/compiler";
import { Connection } from "vscode-languageserver";
import { DocumentManager } from "./DocumentManager";
import { WorkspaceManager } from "./WorkspaceManager";

export class HierarchyService {
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceManager: WorkspaceManager,
  ) {}

  classKindFromEntry(entry: any): string {
    if (entry.language === "sysml2") {
      return SYSML2_RULE_TO_KIND[entry.ruleName] ?? entry.kind?.toLowerCase() ?? "definition";
    }
    // Modelica path
    const prefixesText = entry.metadata?.classPrefixes;
    if (typeof prefixesText !== "string" || !prefixesText) return "class";
    const lower = prefixesText.toLowerCase();
    for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
      if (lower.includes(CLASS_KIND_KEYWORDS[i])) return CLASS_KIND_KEYWORDS[i];
    }
    return "class";
  }

  isTreeVisible(entry: any): boolean {
    if (entry.language === "sysml2") {
      return SYSML2_TREE_KINDS.has(entry.kind);
    }
    return entry.kind === "Class";
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
        fqnCache.set(compositeName, id);
      }
    } else {
      // Find the parent's numeric ID
      let parentIdNum = fqnCache.get(parentId);

      if (parentIdNum === undefined) {
        // Cache miss — search the index (one-time cost per FQN)
        for (const [id, entry] of index.symbols) {
          if (isTreeVisible(entry) && getCompositeName(entry, index) === parentId) {
            parentIdNum = id;
            fqnCache.set(parentId, id);
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
          fqnCache.set(compositeName, id);
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

  buildClassHierarchy(classInstance: ModelicaClassInstance, visited = new Set<string>()): ClassHierarchyNode {
    const name = classInstance.compositeName || classInstance.name || "<unknown>";
    if (visited.has(name)) {
      return { name, kind: classInstance.classKind || "class", description: classInstance.description, children: [] };
    }
    visited.add(name);

    const children: ClassHierarchyNode[] = [];
    try {
      for (const ext of classInstance.extendsClassInstances) {
        if (ext.classInstance) {
          children.push(buildClassHierarchy(ext.classInstance, visited));
        }
      }
    } catch {
      // ignore errors during hierarchy traversal
    }

    return {
      name,
      kind: classInstance.classKind || "class",
      description: classInstance.description,
      children,
    };
  }

  buildComponentTree(classInstance: ModelicaClassInstance, depth = 0): ComponentTreeNode {
    const children: ComponentTreeNode[] = [];
    if (depth < 5) {
      try {
        for (const comp of classInstance.components) {
          if (comp instanceof ModelicaComponentInstance) {
            const childCI = comp.classInstance;
            const childNode: ComponentTreeNode = {
              name: comp.name || "<unnamed>",
              typeName: childCI?.name || "<unknown>",
              kind: childCI?.classKind || "unknown",
              variability: comp.variability,
              causality: comp.causality,
              description: comp.description,
              children: [],
            };
            if (childCI) {
              try {
                const subtree = buildComponentTree(childCI, depth + 1);
                childNode.children = subtree.children;
              } catch {
                // ignore
              }
            }
            children.push(childNode);
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      name: classInstance.name || "<unnamed>",
      typeName: classInstance.compositeName || classInstance.name || "<unnamed>",
      kind: classInstance.classKind || "class",
      variability: null,
      causality: null,
      description: classInstance.description,
      children,
    };
  }
}
