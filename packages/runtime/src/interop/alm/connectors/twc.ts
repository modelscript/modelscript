// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dassault Systèmes Teamwork Cloud (Cameo / MagicDraw Server REST API) Connector.
 *
 * Supports:
 * - Pulling Teamwork Cloud resource revisions & SysML elements (`/osmc/resources/{id}/revisions/...`)
 * - Mapping SysML Blocks, Requirements, and Satisfy/Verify relationships into ModelScript
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

export class TeamworkCloudAlmConnector implements AlmConnector {
  readonly protocol = "twc";
  readonly aliases = ["teamwork-cloud", "cameo-twc"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { origin: string; resourceId: string; branchId?: string | undefined } {
    const parsed = new URL(spec.parsed.url);
    const match = /\/resources\/([^/]+)/i.exec(parsed.pathname);
    const resourceId = String(spec.options?.["resourceId"] ?? match?.[1] ?? "");
    const branchId =
      spec.workingSet ?? (spec.options?.["branchId"] !== undefined ? String(spec.options["branchId"]) : undefined);
    return { origin: parsed.origin, resourceId, branchId };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, resourceId } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${origin}/osmc/resources/${encodeURIComponent(resourceId)}`, {
      auth,
    });
    let serverName = "Teamwork Cloud";
    if (res.ok) {
      try {
        const info = res.json();
        if (info["name"]) serverName = `Teamwork Cloud (${String(info["name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "OSMC",
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: true,
      supportsVerificationPush: false,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { origin, resourceId, branchId } = this.apiBase(spec);
    const rev = spec.revision ?? "latest";
    const url = new URL(
      `${origin}/osmc/resources/${encodeURIComponent(resourceId)}/revisions/${encodeURIComponent(rev)}/elements`,
    );
    if (branchId) url.searchParams.set("branch", branchId);
    if (cursor) url.searchParams.set("sinceRevision", cursor);

    const res = await almFetch<{ revision?: number | string; elements?: Array<Record<string, unknown>> }>(
      url.toString(),
      { auth },
    );
    if (!res.ok) {
      throw new Error(`Teamwork Cloud elements fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const data = res.json();
    const elements = data.elements ?? [];
    const serverRev = data.revision !== undefined ? String(data.revision) : rev;
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];

    for (const el of elements) {
      const id = String(el["elementId"] ?? el["id"] ?? "");
      if (!id) continue;
      const stereotype = String(el["stereotype"] ?? el["type"] ?? "Block");
      upserted.push({
        externalId: id,
        kind: stereotype.toLowerCase().includes("requirement") ? "requirement" : "document_section",
        uri: `${origin}/osmc/resources/${encodeURIComponent(resourceId)}/elements/${encodeURIComponent(id)}`,
        title: String(el["name"] ?? id),
        text: String(el["documentation"] ?? el["text"] ?? ""),
        status: "Committed",
        revision: serverRev,
        attributes: {
          stereotype,
          resourceId,
          qualifiedName: String(el["qualifiedName"] ?? ""),
        },
      });

      const rels = Array.isArray(el["relationships"]) ? (el["relationships"] as Array<Record<string, unknown>>) : [];
      for (const rel of rels) {
        const targetId = String(rel["targetId"] ?? "");
        if (targetId) {
          links.push({
            sourceId: id,
            targetId,
            relation: String(rel["type"] ?? "")
              .toLowerCase()
              .includes("verif")
              ? "verifies"
              : "satisfies",
          });
        }
      }
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: serverRev,
      workingSet: branchId,
      snapshotVersion: `twc@r${serverRev}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin, resourceId } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${origin}/osmc/resources/${encodeURIComponent(resourceId)}/links`, {
        method: "POST",
        auth,
        body: { sourceId: link.sourceId, targetId: link.targetId, relation: link.relation },
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
