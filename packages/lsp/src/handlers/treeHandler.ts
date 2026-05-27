/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// @ts-nocheck

import { LspContext } from "../LspContext";

export function registerTreeHandlers(context: LspContext) {
  context.connection.onRequest(
    "modelscript/getLibraryTree",
    (params: { uri: string; parentId?: string }): TreeNodeInfo[] => {
      // Use the unified workspace — merges all language indices
      const unifiedIndex = context.workspaceManager.unifiedWorkspace.toTreeIndex();
      if (!unifiedIndex) return [];

      // Invalidate FQN cache when the index changes
      if (fqnCacheIndex !== unifiedIndex) {
        context.state.fqnCache = new Map();
        fqnCacheIndex = unifiedIndex;
      }

      return getTreeChildrenFast(unifiedIndex, params.parentId);
    },
  );

  context.connection.onRequest("modelscript/getProjectTree", (params: { parentId?: string }): ProjectTreeNodeInfo[] => {
    const nodes: ProjectTreeNodeInfo[] = [];

    const globalUnified = context.workspaceManager.globalWorkspaceIndex.toTreeIndex();
    const sysmlUnified = context.workspaceManager.sysml2WorkspaceIndex.toTreeIndex();

    const allSymbols = new Map<string, any>();
    for (const [id, entry] of globalUnified.symbols) allSymbols.set(id.toString(), entry);
    for (const [id, entry] of sysmlUnified.symbols) allSymbols.set(id.toString(), entry);

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
    (params: { className: string; uri?: string }): string | null => {
      return null; // Disabled temporarily for performance testing
    },
  );

  context.connection.onRequest(
    "modelscript/listClasses",
    (): { classes: { name: string; kind: string; uri: string }[] } => {
      const classes: { name: string; kind: string; uri: string }[] = [];
      const seen = new Set<string>();

      const globalUnified = context.workspaceManager.globalWorkspaceIndex.toTreeIndex();
      const sysmlUnified = context.workspaceManager.sysml2WorkspaceIndex.toTreeIndex();

      const allSymbols = new Map<string, any>();
      for (const [id, entry] of globalUnified.symbols) allSymbols.set(id.toString(), entry);
      for (const [id, entry] of sysmlUnified.symbols) allSymbols.set(id.toString(), entry);

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
