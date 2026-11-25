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

interface IndexProviderLike {
  getIndex?: () => {
    byName: Map<string, number[]>;
    symbols: Map<number, { resourceId?: string; startOffset: number }>;
  };
}

interface BridgePositionsLike {
  positions?: {
    charOffsetToPosition?: (offset: number) => { line: number; character: number } | null | undefined;
  };
}

export function registerOwl2Endpoints(context: LspContext): void {
  context.connection.onRequest(
    "modelscript/owl2/classHierarchy",
    async (params: { uri?: string | undefined; parentIri?: string | null | undefined }): Promise<OWL2ClassNode[]> => {
      try {
        return await getOwl2ClassHierarchy(context.workspaceManager.unifiedWorkspace?.owl2Store, params.parentIri);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        context.connection.console.error(`[owl2/classHierarchy] Failed: ${msg}`);
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
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        context.connection.console.error(`[owl2/propertyHierarchy] Failed: ${msg}`);
        return [];
      }
    },
  );

  context.connection.onRequest(
    "modelscript/owl2/diagramData",
    async (_params: { uri?: string | undefined }): Promise<OWL2DiagramData> => {
      try {
        return getOwl2DiagramData(context.workspaceManager.unifiedWorkspace?.owl2Store);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        context.connection.console.error(`[owl2/diagramData] Failed: ${msg}`);
        return { nodes: [], edges: [] };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/owl2/goToDeclaration",
    async (params: { iri: string }): Promise<{ uri: string; line: number; character: number } | null> => {
      try {
        const idx = context.workspaceManager.getWorkspaceIndex("owl2") as IndexProviderLike | null | undefined;
        const unified =
          (idx && typeof idx.getIndex === "function" ? idx.getIndex() : null) ??
          context.workspaceManager.unifiedWorkspace?.getIndex?.();
        if (unified) {
          const ids = unified.byName.get(params.iri) ?? [];
          if (ids.length > 0) {
            const entry = unified.symbols.get(ids[0]!);
            if (entry?.resourceId) {
              const bridge = context.state.documentLSPBridges.get(entry.resourceId) as BridgePositionsLike | undefined;
              if (bridge) {
                const pos = bridge.positions?.charOffsetToPosition?.(entry.startOffset);
                if (pos) {
                  return { uri: entry.resourceId, line: pos.line, character: pos.character };
                }
              }
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        context.connection.console.error(`[owl2/goToDeclaration] Failed: ${msg}`);
      }
      return null;
    },
  );
}
