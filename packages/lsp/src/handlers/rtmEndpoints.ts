// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LspContext } from "../LspContext.js";
import {
  CstLinkSynthesizer,
  RtmIndexEngine,
  SuspectTracker,
  type RtmDomain,
  type RtmMatrixPayload,
} from "../rtm/index.js";

const suspectTracker = new SuspectTracker();

/**
 * Registers all Interactive Traceability Matrix (RTM) JSON-RPC endpoints.
 */
export function registerRtmEndpoints(context: LspContext): void {
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
      linkKind?: "satisfy" | "verify" | "allocate";
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
          ? CstLinkSynthesizer.synthesizeModelicaTraceLink(text, params.sourceName, params.targetName, kind)
          : CstLinkSynthesizer.synthesizeSysMLTraceLink(text, params.sourceName, params.targetName, kind);

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
      linkKind?: "satisfy" | "verify" | "allocate";
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
          : CstLinkSynthesizer.removeSysMLTraceLink(text, params.targetName, kind, params.declarationRange);

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
}

export { suspectTracker };
