// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PTC Windchill REST Services (WRS OData v4) PLM Connector.
 *
 * Supports:
 * - OData v4 Part / eBOM pull (`/Windchill/servlet/odata/ProdMgmt/Parts`) with `$expand=Uses`
 * - Incremental delta sync via `$filter=LastModified gt <cursor>`
 * - Outbound external reference links (`References`)
 * - Problem Report / Change Notice creation on verification failure (`defects-on-fail`)
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
import { almFetch, fetchWindchillCsrfNonce } from "../http_client.js";

export class WindchillAlmConnector implements AlmConnector {
  readonly protocol = "windchill";
  readonly aliases = ["ptc-windchill"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { odataBase: string; origin: string; entitySet: string } {
    const parsed = new URL(spec.parsed.url);
    const trimmedPath = parsed.pathname.replace(/\/+$/, "");
    const odataBase = trimmedPath.includes("/odata/")
      ? `${parsed.origin}${trimmedPath}`
      : `${parsed.origin}/Windchill/servlet/odata/ProdMgmt`;
    const entitySet = String(spec.options?.["entitySet"] ?? "Parts");
    return { odataBase, origin: parsed.origin, entitySet };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { odataBase } = this.apiBase(spec);
    const res = await almFetch(`${odataBase}/$metadata`, { auth, headers: { Accept: "application/xml" } });
    return {
      protocol: this.protocol,
      serverName: res.ok ? "PTC Windchill (WRS OData v4)" : "PTC Windchill",
      serverVersion: "OData v4",
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { odataBase, origin, entitySet } = this.apiBase(spec);
    const url = new URL(`${odataBase}/${entitySet}`);
    const filters: string[] = [];
    if (spec.query?.trim()) filters.push(`(${spec.query.trim()})`);
    if (cursor) filters.push(`LastModified gt ${cursor}`);
    if (filters.length > 0) url.searchParams.set("$filter", filters.join(" and "));
    if (spec.options?.["expandUses"] !== false) {
      url.searchParams.set("$expand", "Uses");
    }

    const upserted: AlmArtifact[] = [];
    const deletedIds: string[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;
    let nextUrl: string | undefined = url.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(currentUrl, {
        auth,
      });
      if (!res.ok) {
        throw new Error(`Windchill OData query failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const items = payload.value ?? [];

      for (const part of items) {
        const partNumber = String(part["Number"] ?? part["ID"] ?? "");
        if (!partNumber) continue;
        if (part["@odata.removed"]) {
          deletedIds.push(partNumber);
          continue;
        }
        const oid = String(part["ID"] ?? partNumber);
        const modified = typeof part["LastModified"] === "string" ? part["LastModified"] : undefined;
        if (modified && (!latestModified || modified > latestModified)) {
          latestModified = modified;
        }
        const stateObj = part["State"] as Record<string, unknown> | string | undefined;
        const state =
          typeof stateObj === "string" ? stateObj : String(stateObj?.["Display"] ?? stateObj?.["Value"] ?? "In Work");
        const version = String(part["Version"] ?? part["Revision"] ?? "A.1");

        upserted.push({
          externalId: partNumber,
          kind: "document_section",
          uri: `${odataBase}/${entitySet}('${encodeURIComponent(oid)}')`,
          webUrl: `${origin}/Windchill/app/#ptc1/tcomp/infoPage?oid=${encodeURIComponent(oid)}`,
          title: String(part["Name"] ?? partNumber),
          text: String(part["Description"] ?? `${partNumber} (${version})`),
          status: state,
          revision: version,
          etag: typeof part["@odata.etag"] === "string" ? part["@odata.etag"] : undefined,
          modifiedAt: modified,
          attributes: {
            plmSystem: "Windchill",
            oid,
            partNumber,
            version,
            view: String(part["View"] ?? "Design"),
          },
        });

        const uses = Array.isArray(part["Uses"]) ? (part["Uses"] as Array<Record<string, unknown>>) : [];
        for (const usage of uses) {
          const child = (usage["UsedBy"] ?? usage["Uses"] ?? usage) as Record<string, unknown>;
          const childNum = String(child["Number"] ?? usage["ChildNumber"] ?? "");
          if (childNum) {
            links.push({
              sourceId: partNumber,
              targetId: childNum,
              relation: "derivesFrom",
              title: usage["Quantity"] !== undefined ? `qty=${String(usage["Quantity"])}` : undefined,
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
      deletedIds,
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      baselineUri: spec.baseline,
      snapshotVersion: `windchill@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { odataBase, entitySet } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const endpoint = `${odataBase}/${entitySet}('${encodeURIComponent(link.targetId)}')/References`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          Source: link.sourceId,
          Relation: link.relation,
          Title: link.title ?? `ModelScript (${link.relation}): ${link.sourceId}`,
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
    const { origin } = this.apiBase(spec);
    const createDefects = (spec.push ?? []).includes("defects-on-fail");
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      if ((run.status === "Failed" || run.status === "Error") && !createDefects) {
        skipped++;
        continue;
      }
      const endpoint = `${origin}/Windchill/servlet/odata/ChangeMgmt/ProblemReports`;
      const res = await almFetch<Record<string, unknown>>(endpoint, {
        method: "POST",
        auth,
        body: {
          Name: `[ModelScript ${run.status}] ${run.title}`,
          Description: `Run: ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | Parts: ${run.verifiesIds.join(", ")} | ${run.details ?? ""}`,
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["ID"] !== undefined) createdIds[run.runId] = String(data["ID"]);
        } catch {
          // Ignore parse failure
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const { odataBase, origin, entitySet } = this.apiBase(spec);
    const csrf = await fetchWindchillCsrfNonce(origin, auth);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const body: Record<string, unknown> = {};
      if (edit.title !== undefined) body["Name"] = edit.title;
      if (edit.text !== undefined) body["Description"] = edit.text;
      const headers: Record<string, string> = {};
      if (csrf) headers[csrf.key] = csrf.value;
      if (edit.expectedEtag) headers["If-Match"] = edit.expectedEtag;

      const res = await almFetch(`${odataBase}/${entitySet}('${encodeURIComponent(edit.externalId)}')`, {
        method: "PATCH",
        auth,
        headers,
        body,
      });
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
