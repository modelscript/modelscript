// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getOwl2ClassHierarchy,
  getOwl2DiagramData,
  getOwl2PropertyHierarchy,
  type OWL2ClassNode,
  type OWL2DiagramData,
  type OWL2DiagramEdge,
  type OWL2DiagramNode,
  type OWL2PropertyNode,
} from "@modelscript/owl2";
import { LspContext } from "../lsp-context.js";

export type { OWL2ClassNode, OWL2DiagramData, OWL2DiagramEdge, OWL2DiagramNode, OWL2PropertyNode };

export function registerOwl2Endpoints(context: LspContext): void {
  context.connection.onRequest(
    "modelscript/owl2/classHierarchy",
    async (params: { uri?: string | undefined; parentIri?: string | null | undefined }): Promise<OWL2ClassNode[]> => {
      try {
        return await getOwl2ClassHierarchy(context.workspaceManager.unifiedWorkspace?.owl2Store, params.parentIri);
      } catch (e: any) {
        context.connection.console.error(`[owl2/classHierarchy] Failed: ${e?.message || e}`);
        return [];
      }
    },
  );

  context.connection.onRequest(
    "modelscript/owl2/propertyHierarchy",
    async (_params: {
      uri?: string | undefined;
      parentIri?: string | null | undefined;
      propertyType?: string | null | undefined;
    }): Promise<OWL2PropertyNode[]> => {
      try {
        return getOwl2PropertyHierarchy(context.workspaceManager.unifiedWorkspace?.owl2Store);
      } catch (e: any) {
        context.connection.console.error(`[owl2/propertyHierarchy] Failed: ${e?.message || e}`);
        return [];
      }
    },
  );

  context.connection.onRequest(
    "modelscript/owl2/diagramData",
    async (_params: { uri?: string | undefined }): Promise<OWL2DiagramData> => {
      try {
        return getOwl2DiagramData(context.workspaceManager.unifiedWorkspace?.owl2Store);
      } catch (e: any) {
        context.connection.console.error(`[owl2/diagramData] Failed: ${e?.message || e}`);
        return { nodes: [], edges: [] };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/owl2/goToDeclaration",
    async (params: { iri: string }): Promise<{ uri: string; line: number; character: number } | null> => {
      try {
        const idx = context.workspaceManager.owl2WorkspaceIndex;
        const unified =
          (idx && typeof (idx as any).getIndex === "function" ? (idx as any).getIndex() : null) ??
          context.workspaceManager.unifiedWorkspace?.getIndex?.();
        if (unified) {
          const ids = unified.byName.get(params.iri) ?? [];
          if (ids.length > 0) {
            const entry = unified.symbols.get(ids[0]!);
            if (entry?.resourceId) {
              const bridge = context.state.documentLSPBridges.get(entry.resourceId);
              if (bridge) {
                const pos = (bridge as any).positions?.charOffsetToPosition?.(entry.startOffset);
                if (pos) {
                  return { uri: entry.resourceId, line: pos.line, character: pos.character };
                }
              }
            }
          }
        }
      } catch (e: any) {
        context.connection.console.error(`[owl2/goToDeclaration] Failed: ${e?.message || e}`);
      }
      return null;
    },
  );
}
