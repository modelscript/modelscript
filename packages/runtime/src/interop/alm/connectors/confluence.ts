// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Atlassian Confluence (REST API v1 / CQL) Connector.
 *
 * Supports:
 * - Space / CQL page pull (`/rest/api/content/search`) with incremental `lastModified` cursor
 * - Materialization as `document_section` artifacts with clickable Confluence web URLs
 * - Outbound footer comment trace links & verification evidence comments
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

function stripHtml(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ConfluenceAlmConnector implements AlmConnector {
  readonly protocol = "confluence";

  private apiBase(spec: ResolvedRemoteSpec): { restBase: string; origin: string; spaceKey?: string | undefined } {
    const parsed = new URL(spec.parsed.url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    const restBase = trimmed.includes("/rest/api")
      ? `${parsed.origin}${trimmed.replace(/\/rest\/api.*$/, "/rest/api")}`
      : trimmed.startsWith("/wiki")
        ? `${parsed.origin}/wiki/rest/api`
        : `${parsed.origin}/rest/api`;
    const spaceKey =
      spec.options?.["spaceKey"] !== undefined ? String(spec.options["spaceKey"]) : spec.parsed.params["spaceKey"];
    return { restBase, origin: parsed.origin, spaceKey };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { restBase, spaceKey } = this.apiBase(spec);
    const probeUrl = spaceKey ? `${restBase}/space/${encodeURIComponent(spaceKey)}` : `${restBase}/space?limit=1`;
    const res = await almFetch<Record<string, unknown>>(probeUrl, { auth });
    let serverName = "Atlassian Confluence";
    if (res.ok && spaceKey) {
      try {
        const info = res.json();
        if (info["name"]) serverName = `Confluence (${String(info["name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v1",
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { restBase, origin, spaceKey } = this.apiBase(spec);
    const baseCql = spec.query?.trim() || (spaceKey ? `type = page AND space = "${spaceKey}"` : "type = page");
    const cql = cursor ? `(${baseCql}) AND lastModified >= "${cursor}"` : baseCql;
    const url = new URL(`${restBase}/content/search`);
    url.searchParams.set("cql", cql);
    url.searchParams.set("expand", "body.storage,version,space");
    url.searchParams.set("limit", String(spec.options?.["limit"] ?? 50));

    const upserted: AlmArtifact[] = [];
    let latestModified = cursor;
    let nextUrl: string | undefined = url.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 20);

    for (let pageIdx = 0; nextUrl && pageIdx < maxPages; pageIdx++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<{
        results?: Array<Record<string, unknown>>;
        _links?: { next?: string };
      }>(currentUrl, { auth });
      if (!res.ok) {
        throw new Error(`Confluence CQL search failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const pages = payload.results ?? [];

      for (const page of pages) {
        const id = String(page["id"] ?? "");
        if (!id) continue;
        const versionObj = (page["version"] ?? {}) as Record<string, unknown>;
        const when = typeof versionObj["when"] === "string" ? versionObj["when"] : undefined;
        if (when && (!latestModified || when > latestModified)) {
          latestModified = when;
        }
        const bodyObj = (page["body"] ?? {}) as Record<string, unknown>;
        const storageObj = (bodyObj["storage"] ?? {}) as Record<string, unknown>;
        const linksObj = (page["_links"] ?? {}) as Record<string, unknown>;
        const webui = typeof linksObj["webui"] === "string" ? linksObj["webui"] : undefined;

        upserted.push({
          externalId: `CONF-${id}`,
          kind: "document_section",
          uri: `${restBase}/content/${id}`,
          webUrl: webui ? `${origin}${webui.startsWith("/") ? webui : `/${webui}`}` : undefined,
          title: String(page["title"] ?? `Page ${id}`),
          text: stripHtml(storageObj["value"]),
          status: String(page["status"] ?? "current"),
          revision: versionObj["number"] !== undefined ? String(versionObj["number"]) : undefined,
          modifiedAt: when,
          attributes: {
            pageId: id,
            spaceKey: String(((page["space"] ?? {}) as Record<string, unknown>)["key"] ?? spaceKey ?? ""),
          },
        });
      }

      const rawNext = payload._links?.next;
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
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      snapshotVersion: `confluence@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { restBase } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const pageId = link.targetId.replace(/^CONF-/i, "");
      const res = await almFetch(`${restBase}/content`, {
        method: "POST",
        auth,
        body: {
          type: "comment",
          container: { id: pageId, type: "page" },
          body: {
            storage: {
              value: `<p>ModelScript Trace Link (${link.relation}): <code>${link.sourceId}</code></p>`,
              representation: "storage",
            },
          },
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
    spec: ResolvedRemoteSpec,
    auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    const { restBase } = this.apiBase(spec);
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];

    for (const run of runs) {
      const targetPage = run.verifiesIds[0]?.replace(/^CONF-/i, "");
      if (!targetPage) {
        skipped++;
        continue;
      }
      const res = await almFetch(`${restBase}/content`, {
        method: "POST",
        auth,
        body: {
          type: "comment",
          container: { id: targetPage, type: "page" },
          body: {
            storage: {
              value: `<p>ModelScript Verification <strong>${run.status}</strong>: ${run.title} (Run: <code>${run.runId}</code>, Commit: <code>${run.commitSha ?? "n/a"}</code>)</p>`,
              representation: "storage",
            },
          },
        },
      });
      if (res.ok) pushed++;
      else errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
    }

    return { pushed, skipped, errors };
  }
}
