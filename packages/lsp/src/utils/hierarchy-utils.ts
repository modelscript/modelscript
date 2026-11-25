// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOntologyCategoryNodes,
  getOntologyRootNodes,
  getOwlClassTreeNodes,
  getOwlIndividualTreeNodes,
  getOwlPropertyTreeNodes,
  getOwlSubPropertyTreeNodes,
} from "@modelscript/owl2";
import {
  globalLibraryRegistry,
  type ClassHierarchyNode,
  type ComponentTreeNode,
  type TreeNodeInfo,
} from "@modelscript/runtime";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

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

type Owl2WorkspaceParam = Parameters<typeof getOntologyRootNodes>[0];
type Owl2StoreParam = Parameters<typeof getOntologyRootNodes>[1];

export interface HierarchySymbolEntryLike {
  id?: number | string | undefined;
  parentId?: number | null | undefined;
  name: string;
  kind?: string | undefined;
  ruleName?: string | undefined;
  language?: string | undefined;
  resourceId?: string | undefined;
  metadata?:
    | {
        classPrefixes?: string | undefined;
        isPredefined?: boolean | undefined;
        iconSvg?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
}

export interface HierarchySymbolIndexLike {
  symbols: ReadonlyMap<number, HierarchySymbolEntryLike>;
  childrenOf: ReadonlyMap<number | null, readonly number[]>;
}

export interface HierarchyWorkspaceLike {
  owl2Store?: Owl2StoreParam;
  documents?: NonNullable<Owl2WorkspaceParam>["documents"];
  workspaces?: NonNullable<Owl2WorkspaceParam>["workspaces"];
  hasPendingChildren?(compositeName: string): boolean;
}

export interface ClassInstanceLike {
  name?: string | undefined;
  compositeName?: string | undefined;
  classKind?: string | undefined;
  kind?: string | undefined;
  description?: string | null | undefined;
  extendsClassInstances?: ReadonlyArray<{ classInstance?: ClassInstanceLike | null | undefined }> | undefined;
  components?: ReadonlyArray<ComponentElementLike> | undefined;
  elements?: ReadonlyArray<ComponentElementLike> | undefined;
}

export interface ComponentElementLike {
  name?: string | undefined;
  type?: string | undefined;
  kind?: string | undefined;
  isComponentInstance?: boolean | undefined;
  variability?: string | null | undefined;
  causality?: string | null | undefined;
  description?: string | null | undefined;
  classInstance?: ClassInstanceLike | null | undefined;
}

export const fqnCacheState: {
  index: HierarchySymbolIndexLike | null;
  cache: Map<string, number>;
} = {
  index: null,
  cache: new Map<string, number>(),
};

/** Clears the global FQN resolution cache. */
export function clearFqnCache(): void {
  fqnCacheState.index = null;
  fqnCacheState.cache.clear();
}

export function iconFromEntry(entry: HierarchySymbolEntryLike | null | undefined): string | undefined {
  if (entry?.language === "pscad") {
    return entry.metadata?.classPrefixes === "package" ? "package" : "circuit-board";
  }
  if (entry?.language && entry.ruleName) {
    const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
    const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
    if (symConfig?.icon) return symConfig.icon;
  }
  return undefined;
}

export function classKindFromEntry(entry: HierarchySymbolEntryLike | null | undefined): string {
  if (entry?.language === "pscad") {
    return entry.metadata?.classPrefixes ?? (entry.kind === "Package" ? "package" : "class");
  }
  if (entry?.language && entry.ruleName) {
    const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
    const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
    if (symConfig?.icon) return symConfig.icon;
    if (symConfig?.group) return symConfig.group;
  }
  if (entry?.language === "sysml2") {
    return (
      (entry.ruleName ? SYSML2_RULE_TO_KIND[entry.ruleName] : undefined) ?? entry.kind?.toLowerCase() ?? "definition"
    );
  }
  // Modelica path
  const prefixesText = entry?.metadata?.classPrefixes;
  if (typeof prefixesText !== "string" || !prefixesText) return "class";
  const lower = prefixesText.toLowerCase();
  for (let i = CLASS_KIND_KEYWORDS.length - 1; i >= 0; i--) {
    if (lower.includes(CLASS_KIND_KEYWORDS[i]!)) return CLASS_KIND_KEYWORDS[i]!;
  }
  return "class";
}

export function isTreeVisible(entry: HierarchySymbolEntryLike | null | undefined): boolean {
  if (entry?.metadata?.isPredefined) return false;
  if (entry?.kind === "Reference") return false;
  if (entry?.name?.startsWith("'") || entry?.name?.startsWith('"')) return false;
  if (entry?.language) {
    if (entry.language === "owl2") {
      return false; // Handled structurally via ontology nodes
    }
    if (entry.ruleName) {
      const plugin = globalLanguageRegistry.getPluginByLanguageId(entry.language);
      const symConfig = plugin?.languageDef?.symbols?.[entry.ruleName];
      if (symConfig?.treeVisible !== undefined) return symConfig.treeVisible;
    }
  }
  if (entry?.language === "sysml2") {
    return entry.kind !== undefined && SYSML2_TREE_KINDS.has(entry.kind);
  }
  if (entry?.language === "pscad") {
    return true;
  }
  return entry?.kind === "Class";
}

export function getCompositeName(
  entry: HierarchySymbolEntryLike,
  index: HierarchySymbolIndexLike,
  visited = new Set<string>(),
): string {
  if (entry.parentId === null || entry.parentId === undefined) return entry.name;
  const idKey = entry.id !== undefined ? entry.id.toString() : "";
  if (idKey && visited.has(idKey)) return entry.name;
  if (idKey) visited.add(idKey);

  const parent = index.symbols.get(entry.parentId);
  if (!parent) return entry.name;
  return getCompositeName(parent, index, visited) + "." + entry.name;
}

export interface MountedLibraryInfo {
  name: string;
  version: string;
  description?: string | undefined;
  language?: string | undefined;
  explicitlyInstalled?: boolean | undefined;
  category?: "library" | "standard-pack" | undefined;
  standardCode?: string | undefined;
  standardEdition?: string | undefined;
  profile?: string | undefined;
  activation?: "import" | "explicit" | "workspace" | undefined;
  active?: boolean | undefined;
}

export interface LoadingLibraryInfo {
  name: string;
  version: string;
  status?: string | undefined;
  message?: string | undefined;
}

/** Tracks metadata (version, language) for all mounted libraries (stdlibs and custom Ansatz packages alike). */
export const mountedLibraryMetadata = new Map<string, MountedLibraryInfo>();

/** Tracks libraries currently downloading, decompressing, or indexing in the background. */
export const loadingLibraryState = new Map<string, LoadingLibraryInfo>();

export function normalizeLibraryName(rawName: string): string {
  const trimmed = rawName.trim();
  if (
    trimmed === "Modelica Standard Library" ||
    trimmed === "Modelica" ||
    trimmed === "Complex" ||
    trimmed === "ModelicaServices"
  ) {
    return "Modelica";
  }
  if (trimmed === "SysML2 Standard Library" || trimmed === "SysML v2 Standard Library" || trimmed === "SysML") {
    return "SysML";
  }
  if (
    trimmed === "@modelscript/pscad-master-lib" ||
    trimmed === "pscad-master-lib" ||
    trimmed === "PSCAD Master Library" ||
    trimmed === "MASTER"
  ) {
    return "MASTER";
  }
  return trimmed;
}

export function getLibraryInfo(resourceId?: string): { name: string; version?: string | undefined } | null {
  if (!resourceId) return null;

  // 1. Custom packages mounted under /packages/<pkgName>/...
  if (resourceId.includes("/packages/")) {
    const after = resourceId.split("/packages/")[1] || "";
    const pkgName = after.split("/")[0];
    if (pkgName) {
      return { name: pkgName, version: mountedLibraryMetadata.get(pkgName)?.version };
    }
  }

  // 2. Registry packages mounted under /modelscript_registry/<pkgName>/<version>/...
  if (resourceId.includes("/modelscript_registry/")) {
    const after = resourceId.split("/modelscript_registry/")[1] || "";
    const parts = after.split("/").filter(Boolean);
    let pkgName = parts[0] || "";
    let version = parts[1];
    if (pkgName.startsWith("@") && parts.length >= 2) {
      pkgName = `${parts[0]}/${parts[1]}`;
      version = parts[2];
    }
    const norm = normalizeLibraryName(pkgName);
    return {
      name: norm || "External Library",
      version: version || mountedLibraryMetadata.get(norm)?.version,
    };
  }

  // 3. Pre-indexed library bundles: library-bundle:/<pkgName>@<version>
  if (resourceId.startsWith("library-bundle:/")) {
    const spec = resourceId.substring("library-bundle:/".length).split("/")[0] || "";
    const atIdx = spec.lastIndexOf("@");
    const rawName = atIdx > 0 ? spec.slice(0, atIdx) : spec;
    const version = atIdx > 0 ? spec.slice(atIdx + 1) : undefined;
    const norm = normalizeLibraryName(rawName);
    return {
      name: norm || "External Library",
      version: version || mountedLibraryMetadata.get(norm)?.version,
    };
  }

  // 4. Polyglot / local /lib/<folder> mounts
  if (resourceId.includes("/lib/")) {
    const after = resourceId.split("/lib/")[1] || "";
    const firstSeg = after.split("/")[0] || "";
    if (
      firstSeg.startsWith("Modelica") ||
      firstSeg === "Complex" ||
      firstSeg === "Complex.mo" ||
      firstSeg === "ModelicaServices"
    ) {
      const spaceVersion = firstSeg.startsWith("Modelica ") ? firstSeg.slice("Modelica ".length).trim() : undefined;
      return {
        name: "Modelica",
        version: mountedLibraryMetadata.get("Modelica")?.version || spaceVersion || "4.1.0",
      };
    }
    const cleanName = firstSeg.replace(/\.[^/.]+$/, "") || "External Library";
    return {
      name: cleanName,
      version: mountedLibraryMetadata.get(cleanName)?.version,
    };
  }

  // 5. Fallback for modelica: scheme (if not /packages/)
  if (resourceId.startsWith("modelica:")) {
    return {
      name: "Modelica",
      version: mountedLibraryMetadata.get("Modelica")?.version || "4.1.0",
    };
  }

  // 6. SysML v2 stdlib
  if (resourceId.startsWith("sysml2://stdlib/")) {
    return {
      name: "SysML",
      version: mountedLibraryMetadata.get("SysML")?.version || "2026.3.0",
    };
  }

  // 7. Native PSS/E standard dynamics library & DSL-registered language builtins
  if (
    resourceId === "builtin://psse" ||
    resourceId.startsWith("psse://stdlib/") ||
    resourceId.startsWith("psse://builtins")
  ) {
    const meta = mountedLibraryMetadata.get("PSSE-Standard-Dynamics");
    if (!meta) return null;
    return {
      name: "PSSE-Standard-Dynamics",
      version: meta.version || "1.0.0",
    };
  }
  if (resourceId.startsWith("builtin://")) {
    const lang = resourceId.slice("builtin://".length).split("/")[0] || "";
    for (const [mountedName, meta] of mountedLibraryMetadata.entries()) {
      if (meta.language === lang) {
        return { name: mountedName, version: meta.version };
      }
    }
  }

  return null;
}

export function getLibraryName(resourceId?: string): string | null {
  return getLibraryInfo(resourceId)?.name ?? null;
}

function getRootChildIds(index: HierarchySymbolIndexLike | null | undefined): number[] {
  const ids = new Set<number>();
  const childrenMap = index?.childrenOf as ReadonlyMap<unknown, readonly number[]> | undefined;
  for (const k of [0, null, undefined, "", "0", "null"]) {
    const list = childrenMap?.get(k);
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

function resolveCleanroomDiagramSvg(
  language: string | undefined,
  primaryName: string | undefined,
  fallbackName?: string | undefined,
): string | undefined {
  if (!primaryName && !fallbackName) return undefined;
  if (language) {
    const spec =
      (primaryName ? globalLibraryRegistry.getDiagramSpec(language, primaryName) : undefined) ??
      (fallbackName ? globalLibraryRegistry.getDiagramSpec(language, fallbackName) : undefined);
    if (spec?.svg) return spec.svg;
  }
  const anyHit =
    (primaryName ? globalLibraryRegistry.getDiagramSpecAnyLanguage(primaryName) : undefined) ??
    (fallbackName ? globalLibraryRegistry.getDiagramSpecAnyLanguage(fallbackName) : undefined);
  return anyHit?.spec.svg;
}

export async function getTreeChildrenFast(
  index: HierarchySymbolIndexLike,
  parentId?: string,
  workspace?: HierarchyWorkspaceLike | null,
): Promise<TreeNodeInfo[]> {
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
    if (parentId.startsWith("__LIB_CAT__:")) {
      const rest = parentId.slice("__LIB_CAT__:".length);
      const colonIdx = rest.indexOf(":");
      const libName = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      const category = colonIdx >= 0 ? rest.slice(colonIdx + 1) : "";
      const normLib = normalizeLibraryName(libName);
      for (const pkg of globalLibraryRegistry.getAllPackages()) {
        if (normalizeLibraryName(pkg.packageName) !== normLib) continue;
        const pkgLang = pkg.manifest.language ?? pkg.languages[0] ?? "modelica";
        for (const sym of pkg.symbols) {
          const meta = sym.metadata as Record<string, unknown> | undefined;
          const symCat = String(meta?.["category"] ?? "Components");
          if (symCat !== category) continue;
          const id = sym.namePath || sym.name;
          if (seen.has(id)) continue;
          seen.add(id);
          const label = meta?.["label"];
          const metaIconSvg = typeof meta?.["iconSvg"] === "string" ? meta["iconSvg"] : undefined;
          const iconSvg = metaIconSvg ?? resolveCleanroomDiagramSvg(pkgLang, id, sym.name);
          nodes.push({
            id,
            name: sym.name,
            compositeName: id,
            classKind: "class",
            description: typeof label === "string" ? label : undefined,
            icon: pkgLang === "pscad" ? "circuit-board" : "symbol-class",
            iconSvg,
            hasChildren: false,
            language: pkgLang,
          });
        }
      }
      return nodes;
    }
  }

  if (!parentId) {
    // Root level: group by library or show workspace files
    const rootChildIds = getRootChildIds(index);
    const libraryVersions = new Map<string, string | undefined>();
    const workspaceNodes: TreeNodeInfo[] = [];

    for (const [libKey, meta] of mountedLibraryMetadata.entries()) {
      libraryVersions.set(libKey, meta.version);
    }
    for (const pkg of globalLibraryRegistry.getPackagesForLanguage("pscad")) {
      const norm = normalizeLibraryName(pkg.packageName);
      if (!libraryVersions.has(norm)) {
        libraryVersions.set(norm, pkg.version);
      }
    }

    for (const id of rootChildIds) {
      const entry = index.symbols.get(id);
      if (!entry || !isTreeVisible(entry)) continue;
      if (entry.resourceId?.startsWith("builtin://") && !getLibraryInfo(entry.resourceId)) {
        continue;
      }

      const libInfo = getLibraryInfo(entry.resourceId);
      if (libInfo) {
        if (!libraryVersions.has(libInfo.name) || libInfo.version) {
          libraryVersions.set(libInfo.name, libInfo.version ?? libraryVersions.get(libInfo.name));
        }
      } else {
        const compositeName = entry.name;
        if (seen.has(compositeName)) continue;
        seen.add(compositeName);

        const kind = classKindFromEntry(entry);
        workspaceNodes.push({
          id: compositeName,
          name: entry.name,
          compositeName,
          classKind: kind,
          description: `${kind} · workspace`,
          icon: iconFromEntry(entry),
          iconSvg: entry.metadata?.iconSvg ?? resolveCleanroomDiagramSvg(entry.language, compositeName, entry.name),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
          uri: entry.resourceId,
        });
        fqnCacheState.cache.set(compositeName, id);
      }
    }

    // Emit mounted library package root nodes
    for (const [libName, ver] of libraryVersions.entries()) {
      if (libName === "ObsoleteModelica4") continue;
      const meta = mountedLibraryMetadata.get(libName);
      const formattedVer = ver ? (ver.startsWith("v") ? ver : `v${ver}`) : "package";
      const isStdPack = meta?.category === "standard-pack" || Boolean(meta?.standardCode);
      const description = isStdPack
        ? `${formattedVer} · ${meta?.standardCode ?? "Standard Pack"}${meta?.active ? " · Active" : ""}`
        : formattedVer;
      nodes.push({
        id: `__LIB__:${libName}`,
        name: libName,
        compositeName: `__LIB__:${libName}`,
        classKind: "package",
        description,
        icon: isStdPack ? "shield" : undefined,
        hasChildren: true,
        language:
          meta?.language ??
          (libName.includes("SysML")
            ? "sysml2"
            : libName === "PSSE-Standard-Dynamics"
              ? "psse"
              : libName === "MASTER"
                ? "pscad"
                : "modelica"),
      });
    }

    // Emit in-progress loading library nodes for any packages currently hydrating
    for (const [loadingName, loadingInfo] of loadingLibraryState.entries()) {
      const normName = normalizeLibraryName(loadingName);
      if (libraryVersions.has(normName)) continue;
      const verStr = loadingInfo.version
        ? loadingInfo.version.startsWith("v")
          ? loadingInfo.version
          : `v${loadingInfo.version}`
        : "";
      nodes.push({
        id: `__LOADING__:${normName}`,
        name: normName,
        compositeName: `__LOADING__:${normName}`,
        classKind: "loading-package",
        description: `${verStr ? `${verStr} · ` : ""}${loadingInfo.message ?? loadingInfo.status ?? "Loading..."}`,
        hasChildren: false,
        pendingIcon: true,
      });
    }

    // Append workspace classes after library packages
    for (const wsNode of workspaceNodes) {
      nodes.push(wsNode);
    }

    // Add OWL 2 ontology root containers
    if (workspace) {
      const ontologyRoots = getOntologyRootNodes(workspace as Owl2WorkspaceParam, workspace?.owl2Store);
      for (const ontNode of ontologyRoots) {
        nodes.push(ontNode);
      }
    }
  } else if (parentId.startsWith("__LIB__:")) {
    // Return root children belonging to this library (supporting legacy stdlib aliases)
    const libName = normalizeLibraryName(parentId.substring("__LIB__:".length));

    // Check if this library is a registered cleanroom symbol bundle (e.g. PSCAD MASTER, PSS/E std-lib, Simulink, etc.)
    const registryPkgs = globalLibraryRegistry
      .getAllPackages()
      .filter((p) => normalizeLibraryName(p.packageName) === libName && p.symbols.length > 0);
    if (registryPkgs.length > 0) {
      const categories = new Map<string, { count: number; language: string }>();
      for (const pkg of registryPkgs) {
        const pkgLang = pkg.manifest.language ?? pkg.languages[0] ?? "modelica";
        for (const sym of pkg.symbols) {
          const cat = String((sym.metadata as Record<string, unknown> | undefined)?.["category"] ?? "Components");
          const existing = categories.get(cat);
          if (existing) {
            existing.count += 1;
          } else {
            categories.set(cat, { count: 1, language: pkgLang });
          }
        }
      }
      for (const [cat, info] of categories.entries()) {
        const catId = `__LIB_CAT__:${libName}:${cat}`;
        nodes.push({
          id: catId,
          name: cat,
          compositeName: catId,
          classKind: "package",
          description: `${info.count} components`,
          icon: "package",
          hasChildren: true,
          language: info.language,
        });
      }
      return nodes;
    }

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
          iconSvg: entry.metadata?.iconSvg ?? resolveCleanroomDiagramSvg(entry.language, compositeName, entry.name),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
          uri: entry.resourceId,
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
          iconSvg: entry.metadata?.iconSvg ?? resolveCleanroomDiagramSvg(entry.language, compositeName, entry.name),
          hasChildren: hasClassChildren(index, id, compositeName, workspace),
          language: entry.language,
          uri: entry.resourceId,
        });
        fqnCacheState.cache.set(compositeName, id);
      }
    }
  }

  // Sort library packages first at root level, then alphabetically by name
  nodes.sort((a, b) => {
    if (!parentId) {
      const aIsLib = a.id?.startsWith("__LIB__:") || a.id?.startsWith("__LOADING__:") ? 0 : 1;
      const bIsLib = b.id?.startsWith("__LIB__:") || b.id?.startsWith("__LOADING__:") ? 0 : 1;
      if (aIsLib !== bIsLib) return aIsLib - bIsLib;
    }
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function hasClassChildren(
  index: HierarchySymbolIndexLike,
  symbolId: number,
  compositeName?: string,
  workspace?: HierarchyWorkspaceLike | null,
): boolean {
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
  classInstance: ClassInstanceLike | null | undefined,
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
      description: classInstance.description ?? null,
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
    description: classInstance.description ?? null,
    children,
  };
}

export function buildComponentTree(classInstance: ClassInstanceLike | null | undefined, depth = 0): ComponentTreeNode {
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
            variability: comp.variability ?? null,
            causality: comp.causality ?? null,
            description: comp.description ?? null,
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
