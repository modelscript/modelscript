// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeCanvasBlastRadius,
  exportCanvasToSspXml,
  synthesizeThreadsForCanvas,
  TileAdapterRegistry,
  validateFmiWire,
  type CanvasDocument,
  type DigitalThreadAlignmentInput,
  type TileAnchorSpec,
} from "@modelscript/canvas";
import type { LspContext } from "../lsp-context.js";

const canvasTileRegistry = new TileAdapterRegistry();

/**
 * Registers LSP JSON-RPC endpoints (`modelscript/canvas.*`) powering live
 * Polyglot Infinite Spatial Canvas anchor discovery, Digital Thread synthesis,
 * FMI validation, causal Blast Radius analysis, and SSP 1.0 export.
 */
export function registerCanvasEndpoints(context: LspContext): void {
  context.connection.onRequest(
    "modelscript/canvas.resolveAnchors",
    (params: {
      artifactUri: string;
      languageId?: string | undefined;
      targetSymbol?: string | undefined;
    }): TileAnchorSpec[] => {
      const anchors: TileAnchorSpec[] = [];
      const targetLower = params.artifactUri.toLowerCase();
      const langId = canvasTileRegistry.resolveDescriptor(params.languageId, params.artifactUri).languageId;

      // Extract live symbols from indexed workspace documents when available
      const index = context.workspaceManager?.getWorkspaceIndex?.(langId) as
        { symbols?: Map<unknown, { uri?: string; qualifiedName?: string; name: string; kind?: string }> } | undefined;
      if (index?.symbols) {
        let idx = 0;
        for (const sym of index.symbols.values()) {
          const symUri = (sym.uri ?? "").toLowerCase();
          if (!symUri || (!symUri.endsWith(targetLower) && symUri !== targetLower)) {
            continue;
          }
          if (params.targetSymbol && sym.qualifiedName && !sym.qualifiedName.startsWith(params.targetSymbol)) {
            continue;
          }

          const kindStr = String(sym.kind ?? "").toLowerCase();
          const anchorKind: TileAnchorSpec["kind"] = kindStr.includes("req")
            ? "requirement"
            : kindStr.includes("param")
              ? "parameter"
              : kindStr.includes("input")
                ? "fmi-input"
                : kindStr.includes("output")
                  ? "fmi-output"
                  : "symbol";

          anchors.push({
            path: sym.qualifiedName ?? sym.name,
            label: sym.name,
            kind: anchorKind,
            side: anchorKind === "fmi-input" ? "left" : anchorKind === "fmi-output" ? "right" : "bottom",
            sideOffset: Math.min(0.9, 0.15 + (idx % 8) * 0.1),
          });
          idx += 1;
          if (anchors.length >= 32) break;
        }
      }

      return anchors;
    },
  );

  context.connection.onRequest(
    "modelscript/canvas.synthesizeThreads",
    (params: { document: CanvasDocument; alignments: DigitalThreadAlignmentInput[] }) => {
      const wires = synthesizeThreadsForCanvas(params.document, params.alignments ?? []);
      return { wires };
    },
  );

  context.connection.onRequest(
    "modelscript/canvas.validateFmiWire",
    (params: { source: TileAnchorSpec; target: TileAnchorSpec }) => {
      return validateFmiWire(params.source, params.target);
    },
  );

  context.connection.onRequest(
    "modelscript/canvas.blastRadius",
    (params: { document: CanvasDocument; rootTileId: string; rootAnchorPath?: string | undefined }) => {
      return computeCanvasBlastRadius(params.document, params.rootTileId, params.rootAnchorPath);
    },
  );

  context.connection.onRequest("modelscript/canvas.exportSsp", (params: { document: CanvasDocument }) => {
    return { xml: exportCanvasToSspXml(params.document) };
  });
}
