/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ClassHierarchyNode, ComponentTreeNode, ModelicaClassInstance, TreeNodeInfo } from "@modelscript/compiler";

export function classKindFromEntry(entry: any): string {
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

export function isTreeVisible(entry: any): boolean {
  if (entry.metadata?.isPredefined) return false;
  if (entry.language === "sysml2") {
    return SYSML2_TREE_KINDS.has(entry.kind);
  }
  return entry.kind === "Class";
}

export function getCompositeName(entry: any, index: any, visited = new Set<string>()): string {
  if (entry.parentId === null) return entry.name;
  if (visited.has(entry.id?.toString())) return entry.name;
  visited.add(entry.id?.toString());

  const parent = index.symbols.get(entry.parentId);
  if (!parent) return entry.name;
  return getCompositeName(parent, index, visited) + "." + entry.name;
}

function getLibraryName(resourceId?: string): string | null {
  if (!resourceId) return null;
  if (resourceId.startsWith("modelica:/")) {
    const withoutPrefix = resourceId.substring("modelica:/".length);
    const parts = withoutPrefix.split("/").filter((p: string) => p !== "" && p !== "lib");
    if (parts.length > 0) return parts[0];
  }
  if (resourceId.startsWith("sysml2://stdlib/")) {
    return "SysML2 Standard Library";
  }
  return null;
}

export function getTreeChildrenFast(index: any, parentId?: string): TreeNodeInfo[] {
  const nodes: TreeNodeInfo[] = [];
  const seen = new Set<string>();

  if (!parentId) {
    // Root level: group by library or show workspace files directly
    const rootChildIds = index.childrenOf.get(0) ?? [];
    const libraryNames = new Set<string>();

    for (const id of rootChildIds) {
      const entry = index.symbols.get(id);
      if (!entry || !isTreeVisible(entry)) continue;

      const libName = getLibraryName(entry.resourceId);
      if (libName) {
        libraryNames.add(libName);
      } else {
        const compositeName = entry.name;
        if (seen.has(compositeName)) continue;
        seen.add(compositeName);

        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromEntry(entry),
          hasChildren: hasClassChildren(index, id),
          language: entry.language,
        });
        fqnCache.set(compositeName, id);
      }
    }

    for (const libName of libraryNames) {
      nodes.push({
        id: `__LIB__:${libName}`,
        name: libName,
        compositeName: `__LIB__:${libName}`,
        classKind: "package",
        hasChildren: true,
        language: libName.includes("SysML") ? "sysml2" : "modelica",
      });
    }
  } else if (parentId.startsWith("__LIB__:")) {
    // Return root children belonging to this library
    const libName = parentId.substring("__LIB__:".length);
    const rootChildIds = index.childrenOf.get(0) ?? [];
    for (const id of rootChildIds) {
      const entry = index.symbols.get(id);
      if (!entry || !isTreeVisible(entry)) continue;

      if (getLibraryName(entry.resourceId) === libName) {
        const compositeName = entry.name;
        if (seen.has(compositeName)) continue;
        seen.add(compositeName);

        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromEntry(entry),
          hasChildren: hasClassChildren(index, id),
          language: entry.language,
        });
        fqnCache.set(compositeName, id);
      }
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
        if (seen.has(compositeName)) continue;
        seen.add(compositeName);

        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromEntry(entry),
          hasChildren: hasClassChildren(index, id),
          language: entry.language,
        });
        fqnCache.set(compositeName, id);
      }
    }
  }

  // Sort nodes alphabetically
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

export function hasClassChildren(index: any, symbolId: number): boolean {
  const childIds = index.childrenOf.get(symbolId);
  if (!childIds) return false;
  for (const id of childIds) {
    const entry = index.symbols.get(id);
    if (entry && isTreeVisible(entry)) return true;
  }
  return false;
}

export function buildClassHierarchy(
  classInstance: ModelicaClassInstance,
  visited = new Set<string>(),
): ClassHierarchyNode {
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

export function buildComponentTree(classInstance: ModelicaClassInstance, depth = 0): ComponentTreeNode {
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
