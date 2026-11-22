// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Siemens Teamcenter (Active Workspace / REST API) PLM Connector.
 *
 * Supports:
 * - ItemRevision & BOM structure pull with incremental `modifiedAfter` cursor
 * - Outbound TraceLink / IMAN_specification relation push
 * - Verification run evidence & ProblemReport push
 */

import type {
  AlmArtifact,
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

export class TeamcenterAlmConnector implements AlmConnector {
  readonly protocol = "teamcenter";
  readonly aliases = ["tc"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string; origin: string; isSoa: boolean } {
    const parsed = new URL(spec.parsed.url);
    const baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    const isSoa = spec.options?.["mode"] === "soa" || parsed.pathname.includes("/RestServices");
    return { baseUrl, origin: parsed.origin, isSoa };
  }

  private async soaSessionCookie(baseUrl: string, auth: AuthContext): Promise<string | undefined> {
    if (!auth.username || !auth.password) return undefined;
    const soaRoot = baseUrl.replace(/\/RestServices.*$/, "/RestServices");
    const loginRes = await almFetch(`${soaRoot}/Core-2006-03-Session/login`, {
      method: "POST",
      auth: { fetchImpl: auth.fetchImpl },
      body: {
        header: { state: {}, policy: {} },
        body: {
          credentials: {
            user: auth.username,
            password: auth.password,
            group: "",
            role: "",
            locale: "",
            descrimator: "",
          },
        },
      },
    });
    if (!loginRes.ok) return undefined;
    const setCookie = loginRes.headers.get("set-cookie");
    return setCookie ? setCookie.split(";")[0] : undefined;
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${baseUrl}/info`, { auth });
    let serverVersion: string | undefined;
    if (res.ok) {
      try {
        const data = res.json();
        if (data["version"]) serverVersion = String(data["version"]);
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName: "Siemens Teamcenter",
      serverVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { baseUrl, origin, isSoa } = this.apiBase(spec);
    let items: Array<Record<string, unknown>> = [];

    if (isSoa) {
      const soaRoot = baseUrl.replace(/\/RestServices.*$/, "/RestServices");
      const cookie = await this.soaSessionCookie(baseUrl, auth);
      const soaRes = await almFetch<{
        searchResultsJSON?: string;
        ServiceData?: { modelObjects?: Record<string, Record<string, unknown>> };
        items?: Array<Record<string, unknown>>;
      }>(`${soaRoot}/Query-2014-11-Finder/performSearchViewModel4`, {
        method: "POST",
        auth,
        headers: cookie ? { Cookie: cookie } : undefined,
        body: {
          header: { state: {}, policy: {} },
          body: {
            searchInput: {
              maxToLoad: Number(spec.options?.["maxToLoad"] ?? 100),
              maxToReturn: Number(spec.options?.["maxToReturn"] ?? 100),
              providerName: "Awp0FullTextSearchProvider",
              searchCriteria: {
                searchString: spec.query?.trim() || "*",
                ...(cursor ? { modifiedAfter: cursor } : {}),
              },
            },
          },
        },
      });
      if (!soaRes.ok) {
        throw new Error(`Teamcenter SOA search failed (${soaRes.status}): ${soaRes.text.slice(0, 300)}`);
      }
      const data = soaRes.json();
      if (Array.isArray(data.items)) {
        items = data.items;
      } else if (data.ServiceData?.modelObjects) {
        items = Object.entries(data.ServiceData.modelObjects).map(([uid, mo]) => {
          const props = (mo["props"] ?? {}) as Record<string, { dbValues?: unknown[]; uiValues?: unknown[] }>;
          return {
            uid,
            item_id: props["item_id"]?.dbValues?.[0] ?? uid,
            item_revision_id: props["item_revision_id"]?.dbValues?.[0] ?? "A",
            object_name: props["object_name"]?.uiValues?.[0] ?? props["object_name"]?.dbValues?.[0] ?? uid,
            object_desc: props["object_desc"]?.uiValues?.[0] ?? "",
            release_status: props["release_status_list"]?.uiValues?.[0] ?? "In Process",
            object_type: mo["type"] ?? "ItemRevision",
            last_mod_date: props["last_mod_date"]?.dbValues?.[0],
          };
        });
      }
    } else {
      const url = new URL(`${baseUrl}/items`);
      if (spec.query?.trim()) url.searchParams.set("query", spec.query.trim());
      if (spec.baseline) url.searchParams.set("revisionRule", spec.baseline);
      if (cursor) url.searchParams.set("modifiedAfter", cursor);

      const res = await almFetch<{ items?: Array<Record<string, unknown>> }>(url.toString(), { auth });
      if (!res.ok) {
        throw new Error(`Teamcenter items query failed (${res.status}): ${res.text.slice(0, 300)}`);
      }
      items = res.json().items ?? [];
    }
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;

    for (const item of items) {
      const itemId = String(item["item_id"] ?? item["uid"] ?? "");
      if (!itemId) continue;
      const uid = String(item["uid"] ?? itemId);
      const revId = String(item["item_revision_id"] ?? "A");
      const modified = typeof item["last_mod_date"] === "string" ? item["last_mod_date"] : undefined;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }

      upserted.push({
        externalId: itemId,
        kind: String(item["object_type"] ?? "")
          .toLowerCase()
          .includes("requirement")
          ? "requirement"
          : "document_section",
        uri: `${baseUrl}/items/${encodeURIComponent(uid)}`,
        webUrl: `${origin}/#/com.siemens.splm.clientfx.tcui.xrt.showObject?uid=${encodeURIComponent(uid)}`,
        title: String(item["object_name"] ?? itemId),
        text: String(item["object_desc"] ?? ""),
        status: String(item["release_status"] ?? "In Process"),
        revision: revId,
        modifiedAt: modified,
        attributes: {
          plmSystem: "Teamcenter",
          uid,
          itemRevisionId: revId,
          objectType: String(item["object_type"] ?? "ItemRevision"),
        },
      });

      const children = Array.isArray(item["bom_children"])
        ? (item["bom_children"] as Array<Record<string, unknown>>)
        : [];
      for (const child of children) {
        const childId = String(child["item_id"] ?? child["uid"] ?? "");
        if (childId) {
          links.push({
            sourceId: itemId,
            targetId: childId,
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
      snapshotVersion: `teamcenter@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${baseUrl}/relations`, {
        method: "POST",
        auth,
        body: {
          primaryObject: link.targetId,
          secondaryObject: link.sourceId,
          relationType: link.relation === "verifies" ? "FND_TraceLink" : "IMAN_specification",
          title: link.title ?? `ModelScript (${link.relation}): ${link.sourceId}`,
        },
      });
      if (res.ok) {
        pushed++;
      } else {
        errors.push({
          id: `${link.sourceId}->${link.targetId}`,
          message: res.text.slice(0, 200),
          statusCode: res.status,
        });
      }
    }

    return { pushed, skipped: 0, errors };
  }

  async pushVerificationRuns(
    spec: ResolvedRemoteSpec,
    auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(`${baseUrl}/verification-runs`, {
        method: "POST",
        auth,
        body: {
          runId: run.runId,
          title: run.title,
          status: run.status,
          commitSha: run.commitSha,
          daeHash: run.daeHash,
          verifiesIds: run.verifiesIds,
          metrics: run.metrics,
          timestamp: run.timestamp,
          details: run.details,
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["uid"] !== undefined || data["id"] !== undefined) {
            createdIds[run.runId] = String(data["uid"] ?? data["id"]);
          }
        } catch {
          // Ignore parse failure
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const res = await almFetch(`${baseUrl}/items/${encodeURIComponent(edit.externalId)}`, {
        method: "PATCH",
        auth,
        headers: edit.expectedEtag ? { "If-Match": edit.expectedEtag } : undefined,
        body: {
          ...(edit.title !== undefined ? { object_name: edit.title } : {}),
          ...(edit.text !== undefined ? { object_desc: edit.text } : {}),
          ...(edit.status !== undefined ? { release_status: edit.status } : {}),
        },
      });
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
