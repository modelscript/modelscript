// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LspContext } from "../LspContext.js";
import {
  CstLinkSynthesizer,
  ElementTableEngine,
  RtmIndexEngine,
  SuspectTracker,
  type ElementsTablePayload,
  type RtmDomain,
  type RtmLinkKind,
  type RtmMatrixPayload,
  type RtmPresetDefinition,
  type TableCellCompletionItem,
} from "../rtm/index.js";

const suspectTracker = new SuspectTracker();

/**
 * Registers all Interactive Traceability Matrix (RTM) JSON-RPC endpoints.
 */
export function registerRtmEndpoints(context: LspContext): void {
  // ── 0. Get Standard Matrix Presets ───────────────────────────────────────
  context.connection.onRequest("modelscript/getMatrixPresets", (): RtmPresetDefinition[] => {
    return RtmIndexEngine.getMatrixPresets();
  });

  // ── 1. Get Multi-Tier RTM Matrix ─────────────────────────────────────────
  context.connection.onRequest(
    "modelscript/getRtmMatrix",
    async (params: {
      uri?: string;
      rowDomain?: RtmDomain;
      colDomain?: RtmDomain;
      filter?: string;
    }): Promise<RtmMatrixPayload> => {
      try {
        const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        const rowDom = params.rowDomain ?? "sysml_logical";
        const colDom = params.colDomain ?? "requirement";
        const suspectMap = suspectTracker.getSuspectMap();

        return RtmIndexEngine.buildMatrix(db, rowDom, colDom, params.uri, undefined, suspectMap);
      } catch (e) {
        console.error("[rtm] Error building matrix:", e);
        return {
          rowDomain: params.rowDomain ?? "sysml_logical",
          colDomain: params.colDomain ?? "requirement",
          rows: [],
          cols: [],
          links: {},
          analytics: {
            totalRequirements: 0,
            satisfiedCount: 0,
            satisfiedPercentage: 0,
            verifiedCount: 0,
            verifiedPercentage: 0,
            orphanRequirements: [],
            unallocatedComponents: [],
            suspectLinkCount: 0,
            failingLinkCount: 0,
          },
        };
      }
    },
  );

  // ── 2. Create Trace Link (Bi-directional Synthesis) ─────────────────────
  context.connection.onRequest(
    "modelscript/createTraceLink",
    async (params: {
      sourceUri: string;
      sourceName: string;
      targetName: string;
      linkKind?: RtmLinkKind;
    }): Promise<{ success: boolean; error?: string }> => {
      try {
        const doc = context.documentManager.documents.get(params.sourceUri);
        if (!doc) {
          return { success: false, error: `Document not found: ${params.sourceUri}` };
        }

        const text = doc.getText();
        const isModelica = params.sourceUri.endsWith(".mo");
        const kind = params.linkKind ?? "satisfy";

        const edits = isModelica
          ? CstLinkSynthesizer.synthesizeModelicaTraceLink(text, params.sourceName, params.targetName, kind as any)
          : CstLinkSynthesizer.synthesizeSysMLTraceLink(text, params.sourceName, params.targetName, kind as any);

        if (!edits || edits.length === 0) {
          return {
            success: false,
            error: `Could not locate declaration of '${params.sourceName}' in ${params.sourceUri}`,
          };
        }

        const res = await context.connection.workspace.applyEdit({
          changes: {
            [params.sourceUri]: edits,
          },
        });

        return { success: res.applied };
      } catch (e: any) {
        return { success: false, error: e?.message ?? String(e) };
      }
    },
  );

  // ── 3. Delete Trace Link ────────────────────────────────────────────────
  context.connection.onRequest(
    "modelscript/deleteTraceLink",
    async (params: {
      declarationUri: string;
      sourceName: string;
      targetName: string;
      linkKind?: RtmLinkKind;
      declarationRange?: [number, number];
    }): Promise<{ success: boolean; error?: string }> => {
      try {
        const doc = context.documentManager.documents.get(params.declarationUri);
        if (!doc) {
          return { success: false, error: `Document not found: ${params.declarationUri}` };
        }

        const text = doc.getText();
        const isModelica = params.declarationUri.endsWith(".mo");
        const kind = params.linkKind ?? "satisfy";

        const edits = isModelica
          ? CstLinkSynthesizer.removeModelicaTraceLink(text, params.targetName)
          : CstLinkSynthesizer.removeSysMLTraceLink(
              text,
              params.targetName,
              kind as any,
              params.declarationRange,
              params.sourceName,
            );

        if (!edits || edits.length === 0) {
          return {
            success: false,
            error: `Could not locate trace link to '${params.targetName}' in ${params.declarationUri}`,
          };
        }

        const res = await context.connection.workspace.applyEdit({
          changes: {
            [params.declarationUri]: edits,
          },
        });

        return { success: res.applied };
      } catch (e: any) {
        return { success: false, error: e?.message ?? String(e) };
      }
    },
  );

  // ── 3.5. Batch Update Trace Links ───────────────────────────────────────
  context.connection.onRequest(
    "modelscript/batchUpdateTraceLinks",
    async (params: {
      creations?: {
        sourceUri: string;
        sourceName: string;
        targetName: string;
        linkKind?: RtmLinkKind;
      }[];
      deletions?: {
        declarationUri: string;
        sourceName: string;
        targetName: string;
        linkKind?: RtmLinkKind;
      }[];
    }): Promise<{ success: boolean; createdCount: number; deletedCount: number; error?: string }> => {
      try {
        let createdCount = 0;
        let deletedCount = 0;
        const editsByUri = new Map<string, any[]>();

        if (params.deletions && params.deletions.length > 0) {
          for (const del of params.deletions) {
            const doc = context.documentManager.documents.get(del.declarationUri);
            if (!doc) continue;
            const text = doc.getText();
            const edits = del.declarationUri.endsWith(".mo")
              ? CstLinkSynthesizer.removeModelicaTraceLink(text, del.targetName)
              : CstLinkSynthesizer.removeSysMLTraceLink(
                  text,
                  del.targetName,
                  (del.linkKind ?? "satisfy") as any,
                  undefined,
                  del.sourceName,
                );
            if (edits && edits.length > 0) {
              const list = editsByUri.get(del.declarationUri) ?? [];
              list.push(...edits);
              editsByUri.set(del.declarationUri, list);
              deletedCount++;
            }
          }
        }

        if (params.creations && params.creations.length > 0) {
          for (const cr of params.creations) {
            const doc = context.documentManager.documents.get(cr.sourceUri);
            if (!doc) continue;
            const text = doc.getText();
            const edits = cr.sourceUri.endsWith(".mo")
              ? CstLinkSynthesizer.synthesizeModelicaTraceLink(
                  text,
                  cr.sourceName,
                  cr.targetName,
                  (cr.linkKind ?? "satisfy") as any,
                )
              : CstLinkSynthesizer.synthesizeSysMLTraceLink(
                  text,
                  cr.sourceName,
                  cr.targetName,
                  (cr.linkKind ?? "satisfy") as any,
                );
            if (edits && edits.length > 0) {
              const list = editsByUri.get(cr.sourceUri) ?? [];
              list.push(...edits);
              editsByUri.set(cr.sourceUri, list);
              createdCount++;
            }
          }
        }

        if (editsByUri.size > 0) {
          const changes: Record<string, any[]> = {};
          for (const [uri, edits] of editsByUri.entries()) {
            changes[uri] = edits;
          }
          const res = await context.connection.workspace.applyEdit({ changes });
          return { success: res.applied, createdCount, deletedCount };
        }

        return { success: true, createdCount: 0, deletedCount: 0 };
      } catch (e: any) {
        return { success: false, createdCount: 0, deletedCount: 0, error: e?.message ?? String(e) };
      }
    },
  );

  // ── 4. Clear Suspect Link ───────────────────────────────────────────────
  context.connection.onRequest("modelscript/clearSuspectLink", (params: { linkKey: string }): { success: boolean } => {
    suspectTracker.clearSuspect(params.linkKey);
    return { success: true };
  });

  // ── 5. Re-verify Link (On-Demand Verification Trigger) ──────────────────
  context.connection.onRequest(
    "modelscript/reverifyLink",
    async (params: { targetUri: string; targetName?: string }): Promise<{ ok: boolean; error?: string }> => {
      try {
        if (typeof globalThis.runVerificationForUri === "function") {
          const res = await globalThis.runVerificationForUri(params.targetUri);
          if (params.targetName) {
            suspectTracker.clearSuspect(params.targetName);
          }
          return res;
        }
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
      }
    },
  );

  // ── 6. Export RTM as CSV ────────────────────────────────────────────────
  context.connection.onRequest(
    "modelscript/exportRtm",
    async (params: {
      uri?: string;
      rowDomain?: RtmDomain;
      colDomain?: RtmDomain;
    }): Promise<{ csv: string; filename: string }> => {
      const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      const matrix = RtmIndexEngine.buildMatrix(
        db,
        params.rowDomain ?? "sysml_logical",
        params.colDomain ?? "requirement",
        params.uri,
      );

      const header = ["Source \\ Target", ...matrix.cols.map((c) => c.name)];
      const lines = [header.join(",")];

      for (const row of matrix.rows) {
        const line = [row.name];
        for (const col of matrix.cols) {
          const key = `${row.name}|${col.name}`;
          const link = matrix.links[key];
          if (link) {
            line.push(`${link.linkKind} [${link.status}]`);
          } else {
            line.push("");
          }
        }
        lines.push(line.join(","));
      }

      return {
        csv: lines.join("\n"),
        filename: `traceability_matrix_${Date.now()}.csv`,
      };
    },
  );

  // ── 7. Get General-Purpose Elements Table ────────────────────────────────
  context.connection.onRequest(
    "modelscript/getElementsTable",
    async (params: { uri?: string; metaclass?: string; filter?: string }): Promise<ElementsTablePayload> => {
      try {
        const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        const metaclass = params.metaclass ?? "part";
        return ElementTableEngine.buildElementsTable(db, metaclass, params.uri);
      } catch (e) {
        console.error("[elementTable] Error building elements table:", e);
        return {
          metaclass: params.metaclass ?? "part",
          columns: ElementTableEngine.getColumnDefinitions(params.metaclass ?? "part"),
          rows: [],
          totalCount: 0,
        };
      }
    },
  );

  // ── 8. Update Element Attribute (Bi-directional Synthesis) ───────────────
  context.connection.onRequest(
    "modelscript/updateElementAttribute",
    async (params: {
      uri: string;
      qualifiedName: string;
      attributeName: string;
      newValue: string;
    }): Promise<{ success: boolean; error?: string }> => {
      try {
        const doc = context.documentManager.documents.get(params.uri);
        if (!doc) {
          return { success: false, error: `Document not found: ${params.uri}` };
        }

        const text = doc.getText();
        const edits = ElementTableEngine.updateElementAttribute(
          text,
          params.qualifiedName,
          params.attributeName,
          params.newValue,
        );

        if (!edits || edits.length === 0) {
          return {
            success: false,
            error: `Could not locate element '${params.qualifiedName}' to update attribute '${params.attributeName}'`,
          };
        }

        const res = await context.connection.workspace.applyEdit({
          changes: {
            [params.uri]: edits,
          },
        });

        return { success: res.applied };
      } catch (e: any) {
        return { success: false, error: e?.message ?? String(e) };
      }
    },
  );

  // ── 9. In-Cell Table Autocompletion ──────────────────────────────────────
  context.connection.onRequest(
    "modelscript/tableCellComplete",
    async (params: {
      uri?: string;
      metaclass?: string;
      attributeName: string;
      prefix?: string;
    }): Promise<TableCellCompletionItem[]> => {
      try {
        const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        return ElementTableEngine.getTableCellCompletions(
          db,
          params.metaclass ?? "part",
          params.attributeName,
          params.prefix ?? "",
        );
      } catch (e) {
        console.error("[tableCellComplete] Error generating completions:", e);
        return [];
      }
    },
  );

  // ── 10. In-Cell Table Validation ─────────────────────────────────────────
  context.connection.onRequest(
    "modelscript/validateTableCell",
    async (params: { attributeName: string; value: string }): Promise<{ valid: boolean; error?: string }> => {
      return ElementTableEngine.validateTableCell(params.attributeName, params.value);
    },
  );
}

export { suspectTracker };
