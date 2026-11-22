// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zuken DS-CR (PCB) & DS-E3 (Wire Harness / Electrical) ECAD Connector.
 *
 * Supports:
 * - Pulling ECAD designs, PCB boards, wire harnesses, and component BOMs (`/api/v1/designs`)
 * - Extracting netlist/component hierarchy (`derivesFrom`) links
 * - Outbound external trace-link registration (`pushLinks`)
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
import { almFetch } from "../http_client.js";

export class ZukenAlmConnector implements AlmConnector {
  readonly protocol = "zuken";
  readonly aliases = ["ds-cr", "ds-e3"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string; domain: "ds-cr" | "ds-e3" } {
    const parsed = new URL(spec.parsed.url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    const baseUrl = trimmed.includes("/api/") ? `${parsed.origin}${trimmed}` : `${parsed.origin}/api/v1`;
    const domain = spec.parsed.protocol === "ds-e3" || spec.options?.["domain"] === "ds-e3" ? "ds-e3" : "ds-cr";
    return { baseUrl, domain };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl, domain } = this.apiBase(spec);
    const res = await almFetch(`${baseUrl}/info`, { auth });
    return {
      protocol: this.protocol,
      serverName: domain === "ds-e3" ? "Zuken DS-E3 (Wire Harness)" : "Zuken DS-CR (PCB)",
      serverVersion: res.ok ? "v1" : `HTTP ${res.status}`,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: false,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { baseUrl, domain } = this.apiBase(spec);
    const url = new URL(`${baseUrl}/designs`);
    url.searchParams.set("domain", domain);
    if (cursor) url.searchParams.set("modifiedAfter", cursor);

    const res = await almFetch<{ designs?: Array<Record<string, unknown>> }>(url.toString(), { auth });
    if (!res.ok) {
      throw new Error(`Zuken ${domain} designs fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const designs = res.json().designs ?? [];
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;

    for (const d of designs) {
      const id = String(d["partNumber"] ?? d["id"] ?? "");
      if (!id) continue;
      const modified = typeof d["modifiedAt"] === "string" ? d["modifiedAt"] : undefined;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }

      upserted.push({
        externalId: id,
        kind: "document_section",
        uri: `${baseUrl}/designs/${encodeURIComponent(id)}`,
        title: String(d["name"] ?? id),
        text: String(d["description"] ?? `Zuken ${domain.toUpperCase()} design ${id}`),
        status: String(d["state"] ?? "Released"),
        revision: String(d["revision"] ?? "A"),
        modifiedAt: modified,
        attributes: {
          ecadTool: domain.toUpperCase(),
          partNumber: id,
        },
      });

      const components = Array.isArray(d["components"]) ? (d["components"] as Array<Record<string, unknown>>) : [];
      for (const comp of components) {
        const compId = String(comp["partNumber"] ?? comp["refDes"] ?? "");
        if (compId) {
          links.push({
            sourceId: id,
            targetId: compId,
            relation: "derivesFrom",
          });
        }
      }
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      baselineUri: spec.baseline,
      snapshotVersion: `${domain}@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${baseUrl}/designs/${encodeURIComponent(link.targetId)}/links`, {
        method: "POST",
        auth,
        body: { sourceId: link.sourceId, relation: link.relation },
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
