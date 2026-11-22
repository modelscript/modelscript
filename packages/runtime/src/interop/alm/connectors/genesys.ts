// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitech / Zuken GENESYS (MBSE REST API) Connector.
 *
 * Supports:
 * - Pulling GENESYS project entities (Requirements, Components, Functions, VerificationRequirements)
 * - Extracting MBSE relationships (`satisfiedBy`, `verifiedBy`, `decomposedBy`)
 * - Outbound relationship push (`pushLinks`)
 */

import type {
  AlmArtifact,
  AlmArtifactKind,
  AlmDelta,
  AlmLink,
  AlmVerificationRun,
  AuthContext,
  PushResult,
  RemoteCapabilities,
} from "../alm_ir.js";
import type { AlmConnector, ResolvedRemoteSpec } from "../connector_spi.js";
import { almFetch } from "../http_client.js";

function mapGenesysKind(className: string): AlmArtifactKind {
  const lower = className.toLowerCase();
  if (lower.includes("verification") || lower.includes("test")) return "test_case";
  if (lower.includes("requirement")) return "requirement";
  return "document_section";
}

export class GenesysAlmConnector implements AlmConnector {
  readonly protocol = "genesys";
  readonly aliases = ["vitech"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string; projectId: string } {
    const parsed = new URL(spec.parsed.url);
    const match = /\/projects\/([^/]+)/i.exec(parsed.pathname);
    const projectId = String(spec.options?.["projectId"] ?? match?.[1] ?? "default");
    const baseUrl = `${parsed.origin}/api/v1`;
    return { baseUrl, projectId };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl, projectId } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${baseUrl}/projects/${encodeURIComponent(projectId)}`, {
      auth,
    });
    let serverName = `Vitech GENESYS (${projectId})`;
    if (res.ok) {
      try {
        const info = res.json();
        if (info["name"]) serverName = `Vitech GENESYS (${String(info["name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v1",
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: false,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { baseUrl, projectId } = this.apiBase(spec);
    const url = new URL(`${baseUrl}/projects/${encodeURIComponent(projectId)}/entities`);
    if (spec.options?.["entityClass"]) url.searchParams.set("class", String(spec.options["entityClass"]));
    if (cursor) url.searchParams.set("modifiedAfter", cursor);

    const res = await almFetch<{ entities?: Array<Record<string, unknown>> }>(url.toString(), { auth });
    if (!res.ok) {
      throw new Error(`GENESYS entities fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const entities = res.json().entities ?? [];
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;

    for (const ent of entities) {
      const id = String(ent["number"] ?? ent["id"] ?? "");
      if (!id) continue;
      const cls = String(ent["class"] ?? "Requirement");
      const modified = typeof ent["modifiedAt"] === "string" ? ent["modifiedAt"] : undefined;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }

      upserted.push({
        externalId: id,
        kind: mapGenesysKind(cls),
        uri: `${baseUrl}/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(String(ent["id"] ?? id))}`,
        title: String(ent["name"] ?? id),
        text: String(ent["description"] ?? ""),
        status: String(ent["status"] ?? "Active"),
        revision: modified,
        modifiedAt: modified,
        attributes: {
          mbseTool: "GENESYS",
          entityClass: cls,
        },
      });

      const rels = Array.isArray(ent["relationships"]) ? (ent["relationships"] as Array<Record<string, unknown>>) : [];
      for (const rel of rels) {
        const target = String(rel["targetId"] ?? "");
        const relName = String(rel["relation"] ?? "").toLowerCase();
        if (target) {
          links.push({
            sourceId: id,
            targetId: target,
            relation: relName.includes("verif") ? "verifies" : relName.includes("satisf") ? "satisfies" : "derivesFrom",
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
      snapshotVersion: `genesys@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { baseUrl, projectId } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${baseUrl}/projects/${encodeURIComponent(projectId)}/relationships`, {
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
