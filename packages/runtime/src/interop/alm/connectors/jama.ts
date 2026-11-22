// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Jama Connect REST API v1 Connector.
 *
 * Supports:
 * - Project & Baseline item tree pull (`/rest/v1/items`, `/rest/v1/baselines/{id}/versioneditems`)
 * - Incremental `modifiedDate` delta pull
 * - Outbound upstream/downstream Relationships (`/rest/v1/relationships`)
 * - Outbound Jama Test Runs (`/rest/v1/testruns`) from `msx verify`
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

export class JamaAlmConnector implements AlmConnector {
  readonly protocol = "jama";

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const origin = new URL(spec.parsed.url).origin;
    const res = await almFetch<Record<string, unknown>>(`${origin}/rest/v1/system/settings/license`, { auth });
    return {
      protocol: this.protocol,
      serverName: "Jama Connect",
      serverVersion: res.ok ? "v1" : undefined,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const baseReqUrl = new URL(spec.parsed.url);
    if (cursor) {
      baseReqUrl.searchParams.set("modifiedDate", cursor);
    }

    const origin = baseReqUrl.origin;
    const upserted: AlmArtifact[] = [];
    let latestModified = cursor;
    let startAt = 0;
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    for (let page = 0; page < maxPages; page++) {
      const reqUrl = new URL(baseReqUrl.toString());
      if (startAt > 0) reqUrl.searchParams.set("startAt", String(startAt));

      const res = await almFetch<{
        data?: Array<Record<string, unknown>>;
        meta?: { pageInfo?: { startIndex?: number; resultCount?: number; totalResults?: number } };
      }>(reqUrl.toString(), { auth });
      if (!res.ok) {
        throw new Error(`Jama fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const rows = Array.isArray(payload.data) ? payload.data : [];

      for (const row of rows) {
        const fields = (row["fields"] ?? {}) as Record<string, unknown>;
        const docKey = String(
          row["documentKey"] ?? row["globalId"] ?? `JAMA-${String(row["id"] ?? upserted.length + 1)}`,
        );
        const id = String(row["id"] ?? docKey);
        const location = row["location"] as Record<string, unknown> | undefined;
        const parentObj = location?.["parent"] as Record<string, unknown> | undefined;
        const modifiedDate = typeof row["modifiedDate"] === "string" ? row["modifiedDate"] : undefined;
        if (modifiedDate && (!latestModified || modifiedDate > latestModified)) {
          latestModified = modifiedDate;
        }

        upserted.push({
          externalId: docKey,
          kind: row["itemType"] === "test_case" ? "test_case" : "requirement",
          uri: `${origin}/rest/v1/items/${id}`,
          webUrl: `${origin}/perspective.req#/items/${id}`,
          title: String(fields["name"] ?? docKey),
          text: String(fields["description"] ?? ""),
          status: String(fields["status"] ?? "Active"),
          priority: fields["priority"] ? String(fields["priority"]) : undefined,
          parentId: parentObj?.["item"] ? String(parentObj["item"]) : undefined,
          order: typeof location?.["sortOrder"] === "number" ? location["sortOrder"] : upserted.length,
          revision: row["version"] !== undefined ? String(row["version"]) : modifiedDate,
          modifiedAt: modifiedDate,
          attributes: {
            jamaId: id,
          },
        });
      }

      const pageInfo = payload.meta?.pageInfo;
      startAt += rows.length;
      if (
        rows.length === 0 ||
        !pageInfo ||
        typeof pageInfo.totalResults !== "number" ||
        startAt >= pageInfo.totalResults
      ) {
        break;
      }
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      baselineUri: spec.baseline,
      snapshotVersion: `${spec.baseline ?? "latest"}@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const origin = new URL(spec.parsed.url).origin;
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${origin}/rest/v1/relationships`, {
        method: "POST",
        auth,
        body: {
          fromItem: Number(link.sourceId) || link.sourceId,
          toItem: Number(link.targetId) || link.targetId,
          relationshipType: link.relation,
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
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const jamaStatus =
        run.status === "Passed"
          ? "PASSED"
          : run.status === "Failed" || run.status === "Error"
            ? "FAILED"
            : "INPROGRESS";
      const res = await almFetch<Record<string, unknown>>(`${origin}/rest/v1/testruns`, {
        method: "POST",
        auth,
        body: {
          fields: {
            name: run.title,
            testRunStatus: jamaStatus,
            actualResults: `ModelScript Run ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | ${run.details ?? ""}`,
          },
          verifies: run.verifiesIds,
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const body = res.json();
          const meta = body["meta"] as Record<string, unknown> | undefined;
          createdIds[run.runId] = String(meta?.["id"] ?? body["id"] ?? run.runId);
        } catch {
          createdIds[run.runId] = run.runId;
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }
}
