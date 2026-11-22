// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PTC Codebeamer REST API v3 Connector.
 *
 * Supports:
 * - Tracker item pull (`/api/v3/trackers/{trackerId}/items`)
 * - Working-Sets (`workingSet: "branch:${git.branch}"`) & Baselines
 * - Outbound tracker associations (`/api/v3/associations`)
 * - Outbound Test Run submissions from `msx verify`
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

export class CodebeamerAlmConnector implements AlmConnector {
  readonly protocol = "codebeamer";

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const origin = new URL(spec.parsed.url).origin;
    const res = await almFetch<Record<string, unknown>>(`${origin}/api/v3/system/version`, { auth });
    let serverVersion: string | undefined;
    if (res.ok) {
      try {
        serverVersion = String(res.json()["version"] ?? "");
      } catch {
        // Ignore
      }
    }
    return {
      protocol: this.protocol,
      serverName: "PTC Codebeamer",
      serverVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: true,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const baseReqUrl = new URL(spec.parsed.url);
    if (!baseReqUrl.pathname.endsWith("/items")) {
      baseReqUrl.pathname = `${baseReqUrl.pathname.replace(/\/$/, "")}/items`;
    }
    if (spec.baseline) {
      baseReqUrl.searchParams.set("baselineId", spec.baseline);
    }
    if (spec.workingSet) {
      baseReqUrl.searchParams.set("workingSet", spec.workingSet);
    }
    if (cursor) {
      baseReqUrl.searchParams.set("modifiedAfter", cursor);
    }

    const origin = baseReqUrl.origin;
    const upserted: AlmArtifact[] = [];
    let latestModified = cursor;
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    for (let page = 1; page <= maxPages; page++) {
      const reqUrl = new URL(baseReqUrl.toString());
      if (page > 1) reqUrl.searchParams.set("page", String(page));

      const res = await almFetch<{
        itemRefs?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
        total?: number;
      }>(reqUrl.toString(), { auth });
      if (!res.ok) {
        throw new Error(`Codebeamer fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const rawItems = payload.items ?? payload.itemRefs ?? [];

      for (const item of rawItems) {
        const id = String(item["id"] ?? upserted.length + 1);
        const statusObj = item["status"] as Record<string, unknown> | undefined;
        const priorityObj = item["priority"] as Record<string, unknown> | undefined;
        const parentObj = item["parent"] as Record<string, unknown> | undefined;
        const modifiedAt = typeof item["modifiedAt"] === "string" ? item["modifiedAt"] : undefined;
        if (modifiedAt && (!latestModified || modifiedAt > latestModified)) {
          latestModified = modifiedAt;
        }

        upserted.push({
          externalId: `CB-${id}`,
          kind: "requirement",
          uri: `${origin}/api/v3/items/${id}`,
          webUrl: `${origin}/cb/issue/${id}`,
          title: String(item["name"] ?? `Item ${id}`),
          text: String(item["description"] ?? ""),
          status: String(statusObj?.["name"] ?? item["status"] ?? "New"),
          priority: priorityObj?.["name"] ? String(priorityObj["name"]) : undefined,
          parentId: parentObj?.["id"] ? `CB-${String(parentObj["id"])}` : undefined,
          order: typeof item["ordinal"] === "number" ? item["ordinal"] : upserted.length,
          revision: item["version"] !== undefined ? String(item["version"]) : modifiedAt,
          modifiedAt,
          attributes: {},
        });
      }

      if (rawItems.length === 0 || typeof payload.total !== "number" || upserted.length >= payload.total) {
        break;
      }
    }

    const label = spec.workingSet ?? spec.baseline ?? "head";
    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      baselineUri: spec.baseline,
      workingSet: spec.workingSet,
      snapshotVersion: `${label}@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const origin = new URL(spec.parsed.url).origin;
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${origin}/api/v3/associations`, {
        method: "POST",
        auth,
        body: {
          from: { id: Number(link.sourceId.replace(/^CB-/, "")) || link.sourceId },
          to: { id: Number(link.targetId.replace(/^CB-/, "")) || link.targetId },
          type: { name: link.relation },
          description: link.title ?? `ModelScript ${link.relation}`,
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
    const origin = new URL(spec.parsed.url).origin;
    const testRunTrackerId = String(spec.options?.["testRunTrackerId"] ?? "testruns");
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(
        `${origin}/api/v3/trackers/${encodeURIComponent(testRunTrackerId)}/items`,
        {
          method: "POST",
          auth,
          body: {
            name: run.title,
            description: `Run ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | ${run.details ?? ""}`,
            result: { name: run.status },
            verifies: run.verifiesIds.map((id) => ({ id: Number(id.replace(/^CB-/, "")) || id })),
          },
        },
      );
      if (res.ok) {
        pushed++;
        try {
          const body = res.json();
          createdIds[run.runId] = `CB-${String(body["id"] ?? run.runId)}`;
        } catch {
          createdIds[run.runId] = run.runId;
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const origin = new URL(spec.parsed.url).origin;
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const numericId = edit.externalId.replace(/^CB-/, "");
      const res = await almFetch(`${origin}/api/v3/items/${encodeURIComponent(numericId)}`, {
        method: "PUT",
        auth,
        headers: edit.expectedEtag ? { "If-Match": edit.expectedEtag } : undefined,
        body: {
          ...(edit.title !== undefined ? { name: edit.title } : {}),
          ...(edit.text !== undefined ? { description: edit.text } : {}),
        },
      });
      if (res.ok) {
        pushed++;
      } else {
        errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors };
  }
}
