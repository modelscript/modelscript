// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TreeNodeInfo } from "@modelscript/runtime";
import { LspContext } from "../lsp-context.js";
import {
  fqnCacheState,
  getTreeChildrenFast,
  mountedLibraryMetadata,
  normalizeLibraryName,
} from "../utils/hierarchy-utils.js";
import { loadPrebakedMslIcons } from "../utils/msl-icons-loader.js";

export interface ProjectTreeNodeInfo {
  id: string;
  name: string;
  uri?: string | undefined;
  compositeName?: string | undefined;
  classKind?: string | undefined;
  hasChildren: boolean;
  isFile: boolean;
  iconSvg?: string | undefined;
  line?: number | undefined;
}

export const iconCache = new Map<string, string | null>();

export function getCachedClassIcon(className: string): string | null | undefined {
  const rootSeg = className.split(".")[0];
  if (rootSeg) {
    const normRoot = normalizeLibraryName(rootSeg);
    const activeVer = mountedLibraryMetadata.get(normRoot)?.version;
    if (activeVer) {
      const versionedKey = `${normRoot}@${activeVer}:${className}`;
      if (iconCache.has(versionedKey)) {
        return iconCache.get(versionedKey);
      }
    }
  }
  if (iconCache.has(className)) {
    return iconCache.get(className);
  }
  return undefined;
}

export function registerTreeHandlers(context: LspContext) {
  context.connection.onRequest(
    "modelscript/getLibraryTree",
    async (params: { uri: string; parentId?: string | undefined }): Promise<TreeNodeInfo[]> => {
      // Use the unified workspace — merges all language indices
      const uw = context.workspaceManager.unifiedWorkspace;

      if (!params.parentId) {
        // Root level: only workspace files and top-level library nodes are shown.
        // No lazy loading needed.
      } else if (params.parentId.startsWith("__LIB__:")) {
        const libName = normalizeLibraryName(params.parentId.substring("__LIB__:".length));
        type IndexWithChildren = { ensureChildrenIndexed?(parent: string): void };
        if (libName === "Modelica") {
          const mws = context.workspaceManager.getWorkspaceIndex("modelica") as IndexWithChildren | undefined;
          mws?.ensureChildrenIndexed?.("");
        } else if (libName.includes("SysML")) {
          const sws = context.workspaceManager.getWorkspaceIndex("sysml2") as IndexWithChildren | undefined;
          sws?.ensureChildrenIndexed?.("");
        } else {
          const mws = context.workspaceManager.getWorkspaceIndex("modelica") as IndexWithChildren | undefined;
          mws?.ensureChildrenIndexed?.("");
          (uw as IndexWithChildren | undefined)?.ensureChildrenIndexed?.("");
        }
      } else {
        type IndexWithChildren = { ensureChildrenIndexed?(parent: string): void };
        (uw as IndexWithChildren | undefined)?.ensureChildrenIndexed?.(params.parentId);
      }

      const unifiedIndex =
        typeof uw?.toTreeIndex === "function"
          ? uw.toTreeIndex()
          : typeof uw?.toUnifiedPartial === "function"
            ? uw.toUnifiedPartial()
            : uw?.toUnified?.();
      if (!unifiedIndex) return [];

      // Invalidate FQN cache when the index changes
      if (fqnCacheState.index !== unifiedIndex) {
        fqnCacheState.cache.clear();
        fqnCacheState.index = unifiedIndex;
      }

      if (params.parentId?.startsWith("__LIB__:Modelica") || params.parentId?.startsWith("Modelica") || !params.parentId) {
        await loadPrebakedMslIcons((globalThis as any).serverDistBase ?? params.uri);
      }

      const nodes = await getTreeChildrenFast(unifiedIndex, params.parentId, uw);
      for (const node of nodes) {
        if (!node.iconSvg && node.compositeName) {
          const lookupName = node.compositeName.startsWith("__LIB__:")
            ? node.compositeName.slice("__LIB__:".length)
            : node.compositeName;
          const direct = getCachedClassIcon(lookupName) ?? getCachedClassIcon(node.compositeName);
          if (direct) {
            node.iconSvg = direct;
          } else {
            for (const [key, svg] of iconCache) {
              if (svg && !key.includes(":") && (key === lookupName || key.endsWith("." + lookupName))) {
                node.iconSvg = svg;
                break;
              }
            }
          }
        }
      }
      return nodes;
    },
  );

  context.connection.onRequest(
    "modelscript/getProjectTree",
    (params: { parentId?: string | undefined }): ProjectTreeNodeInfo[] => {
      const nodes: ProjectTreeNodeInfo[] = [];

      const getIndex = (ws: any) =>
        typeof ws?.toTreeIndex === "function"
          ? ws.toTreeIndex()
          : typeof ws?.toUnifiedPartial === "function"
            ? ws.toUnifiedPartial()
            : typeof ws?.toUnified === "function"
              ? ws.toUnified()
              : (ws?.toSymbolIndex?.() ?? { symbols: new Map(), byName: new Map(), childrenOf: new Map() });

      const unified = getIndex(context.workspaceManager?.unifiedWorkspace);

      const allSymbols = new Map<string, any>();
      if (unified?.symbols) {
        for (const [id, entry] of unified.symbols) allSymbols.set(id.toString(), entry);
      }

      // Group top-level elements by resourceId
      const files = new Map<string, any[]>();
      for (const entry of allSymbols.values()) {
        if (entry.resourceId) {
          if (!files.has(entry.resourceId)) files.set(entry.resourceId, []);
          files.get(entry.resourceId)?.push(entry);
        }
      }

      function getCompositeName(entry: any): string {
        if (entry.parentId === null) return entry.name;
        const parent = allSymbols.get(entry.parentId.toString());
        if (!parent) return entry.name;
        return getCompositeName(parent) + "." + entry.name;
      }

      function hasClassChildren(entry: any) {
        for (const child of allSymbols.values()) {
          if (child.parentId === entry.id && (child.kind === "Class" || child.kind === "Def")) {
            return true;
          }
        }
        return false;
      }

      if (!params.parentId) {
        // Root level: return one node per parsed file (exclude stdlib)
        for (const [uri, entries] of files.entries()) {
          if (!uri) continue;
          if (uri.startsWith("file:///lib/")) continue;

          const fileName = uri.split("/").pop() ?? uri;
          let hasChildren = false;
          for (const entry of entries) {
            if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
              hasChildren = true;
              break;
            }
          }

          nodes.push({
            id: uri,
            name: fileName,
            uri,
            hasChildren,
            isFile: true,
          });
        }
        nodes.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        const sepIdx = params.parentId.indexOf("::");
        const isFileNode = sepIdx < 0;

        if (isFileNode) {
          const entries = files.get(params.parentId) ?? [];
          for (const entry of entries) {
            if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
              nodes.push({
                id: `${params.parentId}::${getCompositeName(entry)}`,
                name: entry.name,
                uri: params.parentId,
                compositeName: getCompositeName(entry),
                classKind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
                hasChildren: hasClassChildren(entry),
                isFile: false,
              });
            }
          }
        } else {
          const docUri = params.parentId.substring(0, sepIdx);
          const compositeName = params.parentId.substring(sepIdx + 2);
          const entries = files.get(docUri) ?? [];

          let parentEntry: any = null;
          for (const entry of entries) {
            if (getCompositeName(entry) === compositeName) {
              parentEntry = entry;
              break;
            }
          }

          if (parentEntry) {
            for (const entry of entries) {
              if (entry.parentId === parentEntry.id && (entry.kind === "Class" || entry.kind === "Def")) {
                nodes.push({
                  id: `${docUri}::${getCompositeName(entry)}`,
                  name: entry.name,
                  uri: docUri,
                  compositeName: getCompositeName(entry),
                  classKind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
                  hasChildren: hasClassChildren(entry),
                  isFile: false,
                });
              }
            }
          }
        }
      }

      return nodes;
    },
  );

  async function resolveClassIcon(className: string, uri?: string | undefined): Promise<string | null> {
    if (!className || className.startsWith("__ONTOLOGY__:")) {
      return null;
    }
    const cleanName = className.startsWith("__LIB__:") ? className.slice("__LIB__:".length) : className;

    const existingCached = getCachedClassIcon(cleanName) ?? getCachedClassIcon(className);
    if (existingCached !== undefined) {
      return existingCached || null;
    }

    if (cleanName.startsWith("Modelica.") || cleanName === "Modelica" || iconCache.size === 0) {
      await loadPrebakedMslIcons((globalThis as any).serverDistBase ?? uri);
      const afterMsl = getCachedClassIcon(cleanName) ?? getCachedClassIcon(className);
      if (afterMsl !== undefined) {
        return afterMsl || null;
      }
    }

    // Yield to event loop to avoid blocking LSP completely
    await new Promise((r) => setTimeout(r, 0));

    // Check if unified index has this symbol with metadata.iconSvg (e.g. PSCAD components)
    const uw = context.workspaceManager.unifiedWorkspace;
    const unified =
      typeof uw?.toTreeIndex === "function"
        ? uw.toTreeIndex()
        : typeof uw?.toUnifiedPartial === "function"
          ? uw.toUnifiedPartial()
          : uw?.toUnified?.();
    if (unified) {
      let symIds = unified.byName.get(cleanName) ?? unified.byName.get(className);
      if (!symIds || symIds.length === 0) {
        const parts = cleanName.split(".");
        const leaf = parts[parts.length - 1]!;
        symIds = unified.byName.get(leaf);
      }
      if (symIds && symIds.length > 0) {
        for (const id of symIds) {
          const entry = unified.symbols.get(id);
          if (entry?.metadata?.["iconSvg"]) {
            const svg = String(entry.metadata["iconSvg"]);
            iconCache.set(className, svg);
            iconCache.set(cleanName, svg);
            return svg;
          }
          if (
            entry?.language === "pscad" ||
            entry?.metadata?.["language"] === "pscad" ||
            entry?.ruleName?.startsWith("pscad")
          ) {
            // PSCAD project, case study, or library container
            iconCache.set(className, null);
            iconCache.set(cleanName, null);
            return null;
          }
        }
      }
    }

    const getIconSvg = (globalThis as any).getClassIconSvg ?? (globalThis as any).modelicaDiagramOps?.getClassIconSvg;
    if (!getIconSvg) {
      iconCache.set(className, null);
      iconCache.set(cleanName, null);
      return null;
    }

    try {
      const cls = context.workspaceManager.resolveClassInstance(uri || "file:///", cleanName, {
        iconOnly: true,
      });
      if (!cls) {
        iconCache.set(className, null);
        iconCache.set(cleanName, null);
        return null;
      }

      if (cls.compositeName) {
        const fqnCached = getCachedClassIcon(cls.compositeName);
        if (fqnCached) {
          iconCache.set(className, fqnCached);
          iconCache.set(cleanName, fqnCached);
          return fqnCached;
        }
      }

      const svg = getIconSvg(cls, 20, false);
      iconCache.set(className, svg || null);
      iconCache.set(cleanName, svg || null);
      return svg || null;
    } catch (_e) {
      iconCache.set(className, null);
      iconCache.set(cleanName, null);
      return null;
    }
  }

  context.connection.onRequest(
    "modelscript/getClassIcon",
    async (params: { className: string; uri?: string | undefined }): Promise<string | null> => {
      return resolveClassIcon(params.className, params.uri);
    },
  );

  context.connection.onRequest(
    "modelscript/getClassIcons",
    async (params: { classNames: string[]; uri?: string | undefined }): Promise<Record<string, string | null>> => {
      const results: Record<string, string | null> = {};
      if (!Array.isArray(params.classNames) || params.classNames.length === 0) {
        return results;
      }
      const chunkSize = 10;
      for (let i = 0; i < params.classNames.length; i += chunkSize) {
        const chunk = params.classNames.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (className) => {
            results[className] = await resolveClassIcon(className, params.uri);
          }),
        );
      }
      return results;
    },
  );

  context.connection.onRequest(
    "modelscript/listClasses",
    (): { classes: { name: string; kind: string; uri: string }[] } => {
      const classes: { name: string; kind: string; uri: string }[] = [];
      const seen = new Set<string>();

      const unified = context.workspaceManager.unifiedWorkspace.toTreeIndex();

      const allSymbols = new Map<string, any>();
      if (unified?.symbols) {
        for (const [id, entry] of unified.symbols) allSymbols.set(id.toString(), entry);
      }

      for (const entry of allSymbols.values()) {
        if ((entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
          if (!seen.has(entry.name)) {
            seen.add(entry.name);
            classes.push({
              name: entry.name,
              kind: (entry.metadata?.classKind as string) ?? (entry.metadata?.defKind as string) ?? "class",
              uri: entry.resourceId,
            });
          }
        }
      }

      return { classes };
    },
  );
}
