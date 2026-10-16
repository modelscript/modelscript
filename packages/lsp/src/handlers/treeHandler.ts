// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */

import type { TreeNodeInfo } from "@modelscript/runtime";
import { LspContext } from "../lsp-context.js";
import { fqnCacheState, getTreeChildrenFast } from "../utils/hierarchy-utils.js";

export interface ProjectTreeNodeInfo {
  id: string;
  name: string;
  uri?: string;
  compositeName?: string;
  classKind?: string;
  hasChildren: boolean;
  isFile: boolean;
  iconSvg?: string;
  line?: number;
}

export const iconCache = new Map<string, string | null>();

export function registerTreeHandlers(context: LspContext) {
  context.connection.onRequest(
    "modelscript/getLibraryTree",
    async (params: { uri: string; parentId?: string }): Promise<TreeNodeInfo[]> => {
      console.log(`[LSP treeHandler] getLibraryTree parentId=${params.parentId}`);
      // Use the unified workspace — merges all language indices
      const uw = context.workspaceManager.unifiedWorkspace;

      if (!params.parentId) {
        // Root level: only workspace files and top-level library nodes are shown.
        // No lazy loading needed.
      } else if (params.parentId.startsWith("__LIB__:")) {
        const libName = params.parentId.substring("__LIB__:".length);
        if (libName === "Modelica Standard Library") {
          const mws = context.workspaceManager.getWorkspaceIndex("modelica");
          if (typeof (mws as any)?.ensureChildrenIndexed === "function") {
            (mws as any).ensureChildrenIndexed("");
          }
        } else if (libName.includes("SysML")) {
          const sws = context.workspaceManager.getWorkspaceIndex("sysml2");
          if (typeof (sws as any)?.ensureChildrenIndexed === "function") {
            (sws as any).ensureChildrenIndexed("");
          }
        }
      } else {
        if (typeof (uw as any)?.ensureChildrenIndexed === "function") {
          (uw as any).ensureChildrenIndexed(params.parentId);
        }
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

      context.connection.console.info(
        `[LSP treeHandler] getLibraryTree parentId=${params.parentId} symbols=${unifiedIndex?.symbols?.size} childrenOfKeys=${Array.from(unifiedIndex?.childrenOf?.keys() ?? []).join(",")}`,
      );

      const res = await getTreeChildrenFast(unifiedIndex, params.parentId, uw);
      context.connection.console.info(
        `[LSP treeHandler] getLibraryTree parentId=${params.parentId} returning ${res.length} nodes: ${res.map((n) => n.name).join(", ")}`,
      );
      return res;
    },
  );

  context.connection.onRequest("modelscript/getProjectTree", (params: { parentId?: string }): ProjectTreeNodeInfo[] => {
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
  });

  context.connection.onRequest(
    "modelscript/getClassIcon",
    async (params: { className: string; uri?: string }): Promise<string | null> => {
      if (
        !params.className ||
        params.className.startsWith("__LIB__:") ||
        params.className.startsWith("__ONTOLOGY__:")
      ) {
        return null;
      }
      if (iconCache.has(params.className)) {
        return iconCache.get(params.className) || null;
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
        let symIds = unified.byName.get(params.className);
        if (!symIds || symIds.length === 0) {
          const parts = params.className.split(".");
          const leaf = parts[parts.length - 1];
          symIds = unified.byName.get(leaf);
        }
        if (symIds && symIds.length > 0) {
          for (const id of symIds) {
            const entry = unified.symbols.get(id);
            if (entry?.metadata?.iconSvg) {
              const svg = String(entry.metadata.iconSvg);
              iconCache.set(params.className, svg);
              return svg;
            }
          }
        }
      }

      const getIconSvg = (globalThis as any).getClassIconSvg ?? (globalThis as any).modelicaDiagramOps?.getClassIconSvg;
      if (!getIconSvg) {
        iconCache.set(params.className, null);
        return null;
      }

      const cls = context.workspaceManager.resolveClassInstance(params.uri || "file:///", params.className, {
        iconOnly: true,
      });
      if (!cls) {
        iconCache.set(params.className, null);
        return null;
      }

      try {
        const svg = getIconSvg(cls, 20, false);
        iconCache.set(params.className, svg || null);
        return svg || null;
      } catch (e) {
        console.warn(`Failed to render icon for ${params.className}:`, e);
        iconCache.set(params.className, null);
        return null;
      }
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
