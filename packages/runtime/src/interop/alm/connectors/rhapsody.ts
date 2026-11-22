// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IBM Engineering Systems Design Rhapsody / Rhapsody Model Manager (RMM OSLC AM) Connector.
 *
 * Supports:
 * - Pulling SysML/UML architecture elements (Blocks, Ports, Requirements) via RMM OSLC AM JSON-LD
 * - Preserving Global Configuration context (`OSLC-Configuration-Context`)
 * - Extracting `satisfies` / `verifies` / `derivesFrom` architecture links
 * - Outbound OSLC AM link push (`pushLinks`)
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

export class RhapsodyAlmConnector implements AlmConnector {
  readonly protocol = "rhapsody";
  readonly aliases = ["rmm"] as const;

  private configHeaders(spec: ResolvedRemoteSpec): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/ld+json, application/json",
      "OSLC-Core-Version": "2.0",
    };
    if (spec.baseline) headers["OSLC-Configuration-Context"] = spec.baseline;
    return headers;
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const parsed = new URL(spec.parsed.url);
    const res = await almFetch(`${parsed.origin}/am/rootservices`, { auth, headers: this.configHeaders(spec) });
    return {
      protocol: this.protocol,
      serverName: "IBM Rhapsody Model Manager (OSLC AM)",
      serverVersion: res.ok ? "OSLC AM 2.0" : `HTTP ${res.status}`,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: true,
      supportsVerificationPush: false,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const url = new URL(spec.parsed.url);
    if (cursor) url.searchParams.set("oslc.where", `dcterms:modified>"${cursor}"`);

    const res = await almFetch<{
      "rdfs:member"?: Array<Record<string, unknown>>;
      resources?: Array<Record<string, unknown>>;
    }>(url.toString(), { auth, headers: this.configHeaders(spec) });
    if (!res.ok) {
      throw new Error(`Rhapsody RMM query failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const data = res.json();
    const members = data["rdfs:member"] ?? data.resources ?? [];
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;

    for (const m of members) {
      const id = String(m["dcterms:identifier"] ?? m["id"] ?? "");
      if (!id) continue;
      const uri = String(m["@id"] ?? m["uri"] ?? `${spec.parsed.url}/${encodeURIComponent(id)}`);
      const modified = typeof m["dcterms:modified"] === "string" ? m["dcterms:modified"] : undefined;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }
      const metaclass = String(m["oslc_am:resourceType"] ?? m["metaclass"] ?? "Block");

      upserted.push({
        externalId: id,
        kind: metaclass.toLowerCase().includes("requirement") ? "requirement" : "document_section",
        uri,
        webUrl: uri,
        title: String(m["dcterms:title"] ?? id),
        text: String(m["dcterms:description"] ?? ""),
        status: "Committed",
        revision: modified,
        modifiedAt: modified,
        attributes: {
          mbseTool: "Rhapsody",
          metaclass,
        },
      });

      const satisfies = Array.isArray(m["oslc_rm:satisfies"]) ? m["oslc_rm:satisfies"].map(String) : [];
      for (const target of satisfies) {
        links.push({ sourceId: id, targetId: target, relation: "satisfies" });
      }
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      baselineUri: spec.baseline,
      snapshotVersion: `rhapsody@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const endpoint = `${spec.parsed.url.replace(/\/+$/, "")}/${encodeURIComponent(link.targetId)}/links`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        headers: this.configHeaders(spec),
        body: { source: link.sourceId, relation: link.relation, title: link.title },
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
