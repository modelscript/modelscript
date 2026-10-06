// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClassHierarchyNode, ComponentTreeNode, TreeNodeInfo } from "@modelscript/runtime";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import {
  getOntologyCategoryNodes,
  getOntologyRootNodes,
  getOwlClassTreeNodes,
  getOwlIndividualTreeNodes,
  getOwlPropertyTreeNodes,
  getOwlSubPropertyTreeNodes,
} from "./owl2-tree-utils.js";

export const CLASS_KIND_KEYWORDS = [
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "operator",
  "optimization",
];

export const SYSML2_RULE_TO_KIND: Record<string, string> = {
  Package: "package",
  LibraryPackage: "package",
  PartDefinition: "part def",
  AttributeDefinition: "attribute def",
  PortDefinition: "port def",
  ItemDefinition: "item def",
  OccurrenceDefinition: "occurrence def",
  ConnectionDefinition: "connection def",
  InterfaceDefinition: "interface def",
  AllocationDefinition: "allocation def",
  FlowDefinition: "flow def",
  ActionDefinition: "action def",
  StateDefinition: "state def",
  CalculationDefinition: "calc def",
  ConstraintDefinition: "constraint def",
  RequirementDefinition: "requirement def",
  ConcernDefinition: "concern def",
  UseCaseDefinition: "use case def",
  CaseDefinition: "case def",
  AnalysisCaseDefinition: "analysis case def",
  VerificationCaseDefinition: "verification def",
  ViewDefinition: "view def",
  ViewpointDefinition: "viewpoint def",
  RenderingDefinition: "rendering def",
  MetadataDefinition: "metadata def",
  EnumerationDefinition: "enumeration",
};

export const SYSML2_TREE_KINDS = new Set(["Definition", "Package", "Enumeration"]);

export const fqnCacheState = {
  index: null as any,
  cache: new Map<string, number>(),
};

export function iconFromEntry(entry: any): string | undefined {
  if (entry?.language) {
    const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
    const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
    if (symConfig?.icon) return symConfig.icon;
  }
  return undefined;
}

export function classKindFromEntry(entry: any): string {
  if (entry?.language) {
    const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
    const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
    if (symConfig?.icon) return symConfig.icon;
    if (symConfig?.group) return symConfig.group;
  }
  if (entry?.language === "sysml2") {
    return SYSML2_RULE_TO_KIND[entry.ruleName] ?? entry.kind?.toLowerCase() ?? "definition";
  }
  // Modelica path
  const prefixesText = entry?.metadata?.classPrefixes;
  if (typeof prefixesText !== "string" || !prefixesText) return "class";
  const lower = prefixesText.toLowerCase();
  for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
    if (lower.includes(CLASS_KIND_KEYWORDS[i])) return CLASS_KIND_KEYWORDS[i];
  }
  return "class";
}

export function isTreeVisible(entry: any): boolean {
  if (entry?.metadata?.isPredefined) return false;
  if (entry?.name?.startsWith("'") || entry?.name?.startsWith('"')) return false;
  if (entry?.language) {
    if (entry.language === "owl2") {
      return false; // Handled structurally via ontology nodes
    }
    const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
    const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
    if (symConfig?.treeVisible !== undefined) return symConfig.treeVisible;
  }
  if (entry?.language === "sysml2") {
    return SYSML2_TREE_KINDS.has(entry.kind);
  }
  return entry?.kind === "Class";
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
  if (
    resourceId.startsWith("modelica:") ||
    resourceId.includes("/lib/Modelica") ||
    resourceId.includes("/lib/Complex")
  ) {
    return "Modelica Standard Library";
  }
  if (resourceId.startsWith("sysml2://stdlib/")) {
    return "SysML2 Standard Library";
  }
  if (resourceId.startsWith("library-bundle:/")) {
    const parts = resourceId.substring("library-bundle:/".length).split("/");
    return parts[0] || "External Library";
  }
  return null;
}

function getRootChildIds(index: any): number[] {
  const ids = new Set<number>();
  for (const k of [0, null, undefined, "", "0", "null"]) {
    const list = index?.childrenOf?.get(k);
    if (Array.isArray(list)) {
      for (const id of list) ids.add(id);
    }
  }
  if (ids.size === 0 && index?.symbols) {
    for (const [id, entry] of index.symbols.entries()) {
      if (entry.parentId === null || entry.parentId === undefined || entry.parentId === 0) {
        ids.add(id);
      }
    }
  }
  return Array.from(ids);
}

export async function getTreeChildrenFast(index: any, parentId?: string, workspace?: any): Promise<TreeNodeInfo[]> {
  const nodes: TreeNodeInfo[] = [];
  const seen = new Set<string>();

  // OWL 2 Ontology subtree navigation
  if (parentId) {
    const store = workspace?.owl2Store;
    if (parentId.startsWith("__ONTOLOGY__:")) {
      return getOntologyCategoryNodes(parentId, store);
    }
    if (parentId.startsWith("__OWL_CLASSES__:")) {
      return await getOwlClassTreeNodes(store, null);
    }
    if (parentId.startsWith("__OWL_CLASS__:")) {
      const classIri = parentId.substring("__OWL_CLASS__:".length);
      return await getOwlClassTreeNodes(store, classIri);
    }
    if (parentId.startsWith("__OWL_OBJ_PROPS__:")) {
      return getOwlPropertyTreeNodes(store, "object");
    }
    if (parentId.startsWith("__OWL_OBJ_PROP__:")) {
      const propIri = parentId.substring("__OWL_OBJ_PROP__:".length);
      return getOwlSubPropertyTreeNodes(store, propIri, "object");
    }
    if (parentId.startsWith("__OWL_DATA_PROPS__:")) {
      return getOwlPropertyTreeNodes(store, "data");
    }
    if (parentId.startsWith("__OWL_DATA_PROP__:")) {
      const propIri = parentId.substring("__OWL_DATA_PROP__:".length);
      return getOwlSubPropertyTreeNodes(store, propIri, "data");
    }
    if (parentId.startsWith("__OWL_INDIVIDUALS__:")) {
      return getOwlIndividualTreeNodes(store);
    }
  }

  if (!parentId) {
    // Root level: group by library or show workspace files directly
    const rootChildIds = getRootChildIds(index);
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
          icon: iconFromEntry(entry),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
        });
        fqnCacheState.cache.set(compositeName, id);
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

    // Add OWL 2 ontology root containers
    if (workspace) {
      const ontologyRoots = getOntologyRootNodes(workspace, workspace?.owl2Store);
      for (const ontNode of ontologyRoots) {
        nodes.push(ontNode);
      }
    }
  } else if (parentId.startsWith("__LIB__:")) {
    // Return root children belonging to this library
    const libName = parentId.substring("__LIB__:".length);
    const rootChildIds = getRootChildIds(index);
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
          icon: iconFromEntry(entry),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
        });
        fqnCacheState.cache.set(compositeName, id);
      }
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
        if (seen.has(compositeName)) continue;
        seen.add(compositeName);

        nodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: classKindFromEntry(entry),
          icon: iconFromEntry(entry),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
        });
        fqnCacheState.cache.set(compositeName, id);
      }
    }
  }

  // Sort nodes alphabetically
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

export function hasClassChildren(index: any, symbolId: number, compositeName?: string, workspace?: any): boolean {
  const childIds = index.childrenOf.get(symbolId);
  if (childIds && childIds.length > 0) {
    for (const id of childIds) {
      const entry = index.symbols.get(id);
      if (entry && isTreeVisible(entry)) return true;
    }
  }
  if (compositeName && workspace && typeof workspace.hasPendingChildren === "function") {
    if (workspace.hasPendingChildren(compositeName)) return true;
  }
  return false;
}

export function buildClassHierarchy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classInstance: any,
  visited = new Set<string>(),
): ClassHierarchyNode {
  if (!classInstance) {
    return { name: "<unknown>", kind: "class", description: null, children: [] };
  }
  const name = classInstance.compositeName || classInstance.name || "<unknown>";
  if (visited.has(name)) {
    return {
      name,
      kind: classInstance.classKind || classInstance.kind || "class",
      description: classInstance.description,
      children: [],
    };
  }
  visited.add(name);

  const children: ClassHierarchyNode[] = [];
  try {
    for (const ext of classInstance.extendsClassInstances || []) {
      if (ext.classInstance) {
        children.push(buildClassHierarchy(ext.classInstance, visited));
      }
    }
  } catch {
    // ignore errors during hierarchy traversal
  }

  return {
    name,
    kind: classInstance.classKind || classInstance.kind || "class",
    description: classInstance.description,
    children,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildComponentTree(classInstance: any, depth = 0): ComponentTreeNode {
  const children: ComponentTreeNode[] = [];
  if (classInstance && depth < 5) {
    try {
      for (const comp of classInstance.components || classInstance.elements || []) {
        if (comp.isComponentInstance || comp.kind === "Component") {
          const childCI = comp.classInstance;
          const childNode: ComponentTreeNode = {
            name: comp.name || "<unnamed>",
            typeName: childCI?.name || comp.type || "<unknown>",
            kind: childCI?.classKind || childCI?.kind || "unknown",
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
    name: classInstance?.name || "<unnamed>",
    typeName: classInstance?.compositeName || classInstance?.name || "<unnamed>",
    kind: classInstance?.classKind || classInstance?.kind || "class",
    variability: null,
    causality: null,
    description: classInstance?.description || null,
    children,
  };
}
