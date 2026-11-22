// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PTC Onshape (Cloud CAD REST API v6) Connector.
 *
 * Supports:
 * - Pulling Cloud CAD document elements & assembly BOMs (`/api/v6/assemblies/d/{did}/w/{wid}/e/{eid}/bom`)
 * - Extracting part numbers, revisions, materials, and assembly hierarchy (`derivesFrom`) links
 * - Outbound metadata/property link updates on parts
 */

import type {
  AlmArtifact,
  AlmDelta,
  AlmLink,
  AlmVerificationRun,
  AuthContext,
  PushResult,
  RemoteCapabilities,
} from "../alm_ir.js";
import type { AlmConnector, ResolvedRemoteSpec } from "../connector_spi.js";
import { almFetch, buildOnshapeHmacHeaders } from "../http_client.js";

export class OnshapeAlmConnector implements AlmConnector {
  readonly protocol = "onshape";

  private apiBase(spec: ResolvedRemoteSpec): {
    origin: string;
    did: string;
    wvmType: string;
    wvmId: string;
    eid: string;
  } {
    const parsed = new URL(spec.parsed.url);
    const match = /\/documents\/([^/]+)\/([wvm])\/([^/]+)(?:\/e\/([^/]+))?/i.exec(parsed.pathname);
    return {
      origin: parsed.origin,
      did: String(spec.options?.["documentId"] ?? match?.[1] ?? ""),
      wvmType: String(spec.options?.["wvmType"] ?? match?.[2] ?? "w"),
      wvmId: String(spec.options?.["wvmId"] ?? match?.[3] ?? ""),
      eid: String(spec.options?.["elementId"] ?? match?.[4] ?? ""),
    };
  }

  private async onshapeHeaders(method: string, url: string, auth: AuthContext): Promise<Record<string, string>> {
    if (auth.username && auth.password && !auth.token) {
      return buildOnshapeHmacHeaders(method, url, auth.username, auth.password);
    }
    return {};
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, did } = this.apiBase(spec);
    const docUrl = `${origin}/api/v6/documents/${encodeURIComponent(did)}`;
    const headers = await this.onshapeHeaders("GET", docUrl, auth);
    const res = await almFetch<Record<string, unknown>>(docUrl, {
      auth: headers["Authorization"] ? { fetchImpl: auth.fetchImpl } : auth,
      headers,
    });
    let serverName = "PTC Onshape";
    if (res.ok) {
      try {
        const doc = res.json();
        if (doc["name"]) serverName = `PTC Onshape (${String(doc["name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v6",
      supportsIncrementalDelta: false,
      supportsBaselines: true,
      supportsWorkingSets: true,
      supportsVerificationPush: false,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<AlmDelta> {
    const { origin, did, wvmType, wvmId, eid } = this.apiBase(spec);
    const bomUrl = `${origin}/api/v6/assemblies/d/${encodeURIComponent(did)}/${wvmType}/${encodeURIComponent(wvmId)}/e/${encodeURIComponent(eid)}/bom?indented=true`;
    const headers = await this.onshapeHeaders("GET", bomUrl, auth);
    const res = await almFetch<{
      bomTable?: { items?: Array<Record<string, unknown>> };
      rows?: Array<Record<string, unknown>>;
    }>(bomUrl, { auth: headers["Authorization"] ? { fetchImpl: auth.fetchImpl } : auth, headers });
    if (!res.ok) {
      throw new Error(`Onshape BOM fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const data = res.json();
    const rows = data.rows ?? data.bomTable?.items ?? [];
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    const rootId = `ONSHAPE-${did.slice(0, 8)}`;

    for (const row of rows) {
      const headerMap = (row["headerIdToValue"] ?? row) as Record<string, unknown>;
      const itemSource = (row["itemSource"] ?? {}) as Record<string, unknown>;
      const partNumber = String(headerMap["partNumber"] ?? itemSource["partId"] ?? row["rowId"] ?? "");
      if (!partNumber) continue;
      const name = String(headerMap["name"] ?? partNumber);
      const rev = String(headerMap["revision"] ?? "A");

      upserted.push({
        externalId: partNumber,
        kind: "document_section",
        uri: `${origin}/api/v6/parts/d/${did}/${wvmType}/${wvmId}/e/${eid}/partid/${encodeURIComponent(String(itemSource["partId"] ?? partNumber))}`,
        webUrl: `${origin}/documents/${did}/${wvmType}/${wvmId}/e/${eid}`,
        title: name,
        text: String(headerMap["description"] ?? `Onshape CAD part ${partNumber} (rev ${rev})`),
        status: String(headerMap["state"] ?? "IN_PROGRESS"),
        revision: rev,
        attributes: {
          cadSystem: "Onshape",
          documentId: did,
          elementId: eid,
          quantity: Number(headerMap["quantity"] ?? 1),
          material: String(headerMap["material"] ?? ""),
        },
      });

      links.push({
        sourceId: rootId,
        targetId: partNumber,
        relation: "derivesFrom",
      });
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: true,
      baselineUri: wvmType === "v" ? wvmId : undefined,
      workingSet: wvmType === "w" ? wvmId : undefined,
      snapshotVersion: `onshape@${wvmType}:${wvmId}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin, did, wvmType, wvmId, eid } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const endpoint = `${origin}/api/v6/metadata/d/${encodeURIComponent(did)}/${wvmType}/${encodeURIComponent(wvmId)}/e/${encodeURIComponent(eid)}`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          items: [
            {
              properties: [{ name: "ModelScriptTrace", value: `${link.relation}:${link.sourceId}->${link.targetId}` }],
            },
          ],
        },
      });
      if (res.ok) pushed++;
      else
        errors.push({
          id: `${link.sourceId}->${link.targetId}`,
          message: res.text.slice(0, 200),
          statusCode: res.status,
        });
    }

    return { pushed, skipped: 0, errors };
  }

  async pushVerificationRuns(
    _spec: ResolvedRemoteSpec,
    _auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    return { pushed: 0, skipped: runs.length, errors: [] };
  }
}
