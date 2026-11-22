// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Microsoft Excel (Graph Workbook REST API) & Tabular Spreadsheet Connector.
 *
 * Supports:
 * - Pulling worksheet rows from Microsoft Graph (`/workbook/worksheets/{sheet}/usedRange`)
 *   or Google Sheets (`/values/{range}`) JSON `values: string[][]` payloads
 * - Mapping header columns to `AlmArtifact` records
 * - Bidirectional row update via `upsertArtifacts`
 */

import type {
  AlmArtifact,
  AlmArtifactKind,
  AlmDelta,
  AlmLink,
  AlmVerificationRun,
  ArtifactEdit,
  AuthContext,
  PushResult,
  RemoteCapabilities,
} from "../alm_ir.js";
import type { AlmConnector, ResolvedRemoteSpec } from "../connector_spi.js";
import { almFetch } from "../http_client.js";

export class ExcelAlmConnector implements AlmConnector {
  readonly protocol = "excel";
  readonly aliases = ["xlsx", "sheets"] as const;

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const res = await almFetch(spec.parsed.url, { auth });
    return {
      protocol: this.protocol,
      serverName: `Excel / Spreadsheet (${spec.parsed.host})`,
      serverVersion: res.ok ? "Workbook REST" : `HTTP ${res.status}`,
      supportsIncrementalDelta: false,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: false,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<AlmDelta> {
    const res = await almFetch<{ values?: unknown[][] }>(spec.parsed.url, { auth });
    if (!res.ok) {
      throw new Error(`Excel/Spreadsheet fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const matrix = Array.isArray(res.json().values) ? res.json().values! : [];
    if (matrix.length < 2) {
      return {
        upserted: [],
        deletedIds: [],
        links: [],
        isFullSnapshot: true,
        snapshotVersion: `excel@${new Date().toISOString()}`,
      };
    }

    const headers = matrix[0]!.map((h) => String(h ?? "").trim());
    const idCol = String(spec.options?.["idColumn"] ?? "ID").toLowerCase();
    const titleCol = String(spec.options?.["titleColumn"] ?? "Title").toLowerCase();
    const textCol = String(spec.options?.["textColumn"] ?? "Text").toLowerCase();
    const statusCol = String(spec.options?.["statusColumn"] ?? "Status").toLowerCase();
    const kind = (spec.options?.["kind"] as AlmArtifactKind | undefined) ?? "requirement";

    const colIndex = (name: string, fallback: number): number => {
      const idx = headers.findIndex((h) => h.toLowerCase() === name);
      return idx >= 0 ? idx : fallback;
    };

    const idIdx = colIndex(idCol, 0);
    const titleIdx = colIndex(titleCol, 1);
    const textIdx = colIndex(textCol, 2);
    const statusIdx = colIndex(statusCol, 3);

    const upserted: AlmArtifact[] = [];
    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r]!;
      const externalId = String(row[idIdx] ?? "").trim();
      if (!externalId) continue;

      const attributes: Record<string, string | number | boolean> = { rowNumber: r + 1 };
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        const val = row[c];
        if (key && (typeof val === "string" || typeof val === "number" || typeof val === "boolean")) {
          attributes[key] = val;
        }
      }

      upserted.push({
        externalId,
        kind,
        uri: `${spec.parsed.url}#row=${r + 1}`,
        title: String(row[titleIdx] ?? externalId),
        text: String(row[textIdx] ?? ""),
        status: String(row[statusIdx] ?? "Active"),
        order: r,
        attributes,
      });
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: true,
      snapshotVersion: `excel@${upserted.length}rows`,
    };
  }

  async pushLinks(_spec: ResolvedRemoteSpec, _auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    return { pushed: 0, skipped: links.length, errors: [] };
  }

  async pushVerificationRuns(
    spec: ResolvedRemoteSpec,
    auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    const endpoint = String(spec.options?.["appendUrl"] ?? `${spec.parsed.url.replace(/\/+$/, "")}/rows/add`);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const run of runs) {
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          values: [
            [run.runId, run.title, run.status, run.commitSha ?? "", run.daeHash ?? "", run.verifiesIds.join(",")],
          ],
        },
      });
      if (res.ok) pushed++;
      else errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const res = await almFetch(spec.parsed.url, {
        method: "PATCH",
        auth,
        headers: edit.expectedEtag ? { "If-Match": edit.expectedEtag } : undefined,
        body: {
          externalId: edit.externalId,
          values: [[edit.externalId, edit.title ?? "", edit.text ?? "", edit.status ?? ""]],
        },
      });
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
