// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Aras Innovator (OData v4 REST API) PLM Connector.
 *
 * Supports:
 * - OData v4 ItemType queries (`/Server/Odata/{ItemType}`) with incremental `modified_on` cursor
 * - Relationship / BOM expansion (`Part BOM`, `re_Requirement_Link`)
 * - Outbound relationship creation & verification run recording
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

export class ArasAlmConnector implements AlmConnector {
  readonly protocol = "aras";
  readonly aliases = ["aras-innovator"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { odataBase: string; origin: string; itemType: string } {
    const parsed = new URL(spec.parsed.url);
    const trimmedPath = parsed.pathname.replace(/\/+$/, "");
    const odataBase = trimmedPath.includes("/Odata")
      ? `${parsed.origin}${trimmedPath}`
      : `${parsed.origin}/Server/Odata`;
    const itemType = String(spec.options?.["itemType"] ?? spec.parsed.params["itemType"] ?? "Part");
    return { odataBase, origin: parsed.origin, itemType };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { odataBase } = this.apiBase(spec);
    const res = await almFetch(`${odataBase}/$metadata`, { auth, headers: { Accept: "application/xml" } });
    return {
      protocol: this.protocol,
      serverName: res.ok ? "Aras Innovator (OData v4)" : "Aras Innovator",
      serverVersion: "OData v4",
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { odataBase, origin, itemType } = this.apiBase(spec);
    const url = new URL(`${odataBase}/${encodeURIComponent(itemType)}`);
    const filters: string[] = [];
    if (spec.query?.trim()) filters.push(`(${spec.query.trim()})`);
    if (cursor) filters.push(`modified_on gt ${cursor}`);
    if (filters.length > 0) url.searchParams.set("$filter", filters.join(" and "));
    if (spec.options?.["expand"]) {
      url.searchParams.set("$expand", String(spec.options["expand"]));
    }

    const dbHeaders: Record<string, string> = {};
    if (spec.options?.["database"]) dbHeaders["DATABASE"] = String(spec.options["database"]);

    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;
    let nextUrl: string | undefined = url.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(currentUrl, {
        auth,
        headers: dbHeaders,
      });
      if (!res.ok) {
        throw new Error(`Aras Innovator OData query failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const items = payload.value ?? [];

      for (const item of items) {
        const id = String(item["item_number"] ?? item["keyed_name"] ?? item["id"] ?? "");
        if (!id) continue;
        const arasId = String(item["id"] ?? id);
        const modified = typeof item["modified_on"] === "string" ? item["modified_on"] : undefined;
        if (modified && (!latestModified || modified > latestModified)) {
          latestModified = modified;
        }

        upserted.push({
          externalId: id,
          kind: itemType.toLowerCase().includes("req") ? "requirement" : "document_section",
          uri: `${odataBase}/${encodeURIComponent(itemType)}('${encodeURIComponent(arasId)}')`,
          webUrl: `${origin}/Client/?StartItem=${encodeURIComponent(itemType)}:${encodeURIComponent(arasId)}`,
          title: String(item["name"] ?? item["keyed_name"] ?? id),
          text: String(item["description"] ?? item["content"] ?? ""),
          status: String(item["state"] ?? "Preliminary"),
          revision: String(item["major_rev"] ?? item["generation"] ?? "A"),
          etag: typeof item["@odata.etag"] === "string" ? item["@odata.etag"] : undefined,
          modifiedAt: modified,
          attributes: {
            plmSystem: "Aras Innovator",
            arasId,
            itemType,
            generation: Number(item["generation"] ?? 1),
          },
        });

        const bom = Array.isArray(item["Part BOM"]) ? (item["Part BOM"] as Array<Record<string, unknown>>) : [];
        for (const rel of bom) {
          const related = (rel["related_id"] ?? rel) as Record<string, unknown>;
          const childId = String(related["item_number"] ?? related["keyed_name"] ?? related["id"] ?? "");
          if (childId) {
            links.push({
              sourceId: id,
              targetId: childId,
              relation: "derivesFrom",
            });
          }
        }
      }

      const rawNext = payload["@odata.nextLink"];
      nextUrl =
        typeof rawNext === "string" && rawNext.length > 0
          ? rawNext.startsWith("http")
            ? rawNext
            : `${origin}${rawNext.startsWith("/") ? rawNext : `/${rawNext}`}`
          : undefined;
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      snapshotVersion: `aras@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { odataBase } = this.apiBase(spec);
    const linkItemType = String(spec.options?.["linkItemType"] ?? "External_Trace_Link");
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${odataBase}/${encodeURIComponent(linkItemType)}`, {
        method: "POST",
        auth,
        body: {
          source_id: link.sourceId,
          related_id: link.targetId,
          relation_type: link.relation,
          label: link.title ?? `ModelScript (${link.relation}): ${link.sourceId}`,
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
    const { odataBase } = this.apiBase(spec);
    const runItemType = String(spec.options?.["verificationItemType"] ?? "Verification_Run");
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(`${odataBase}/${encodeURIComponent(runItemType)}`, {
        method: "POST",
        auth,
        body: {
          item_number: run.runId,
          name: run.title,
          status: run.status,
          commit_sha: run.commitSha,
          dae_hash: run.daeHash,
          verifies_ids: run.verifiesIds.join(","),
          details: run.details ?? JSON.stringify(run.metrics),
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["id"] !== undefined) createdIds[run.runId] = String(data["id"]);
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
    const { odataBase, itemType } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const headers: Record<string, string> = {};
      if (spec.options?.["database"]) headers["DATABASE"] = String(spec.options["database"]);
      if (edit.expectedEtag) headers["If-Match"] = edit.expectedEtag;
      const res = await almFetch(
        `${odataBase}/${encodeURIComponent(itemType)}('${encodeURIComponent(edit.externalId)}')`,
        {
          method: "PATCH",
          auth,
          headers,
          body: {
            ...(edit.title !== undefined ? { name: edit.title } : {}),
            ...(edit.text !== undefined ? { description: edit.text } : {}),
            ...(edit.status !== undefined ? { state: edit.status } : {}),
          },
        },
      );
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
