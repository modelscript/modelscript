// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Siemens Polarion ALM REST API v1 (JSON:API) Connector.
 *
 * Supports:
 * - SVN-revision-based incremental delta sync (`revision` cursor)
 * - LiveDoc outline ordering preservation
 * - Polarion Baseline pinning
 * - Outbound Work Item Links & Test Records with Git commit SHA provenance
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

export class PolarionAlmConnector implements AlmConnector {
  readonly protocol = "polarion";

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const origin = new URL(spec.parsed.url).origin;
    const res = await almFetch<Record<string, unknown>>(`${origin}/polarion/rest/v1/projects`, { auth });
    return {
      protocol: this.protocol,
      serverName: "Siemens Polarion ALM",
      serverVersion: res.ok ? "rest/v1" : undefined,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const initialUrl = new URL(spec.parsed.url);
    if (spec.revision) {
      initialUrl.searchParams.set("revision", spec.revision);
    }
    if (cursor) {
      initialUrl.searchParams.set("sinceRevision", cursor);
    }
    if (spec.query) {
      initialUrl.searchParams.set("query", spec.query);
    }

    const origin = initialUrl.origin;
    const upserted: AlmArtifact[] = [];
    let headRevision = cursor;
    let nextUrl: string | null = initialUrl.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    interface PolarionPagePayload {
      data?: Array<Record<string, unknown>> | undefined;
      meta?: Record<string, unknown> | undefined;
      links?: { next?: string | undefined } | undefined;
    }

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<PolarionPagePayload>(currentUrl, {
        auth,
        headers: { Accept: "application/vnd.api+json, application/json" },
      });
      if (!res.ok) {
        throw new Error(`Polarion fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload: PolarionPagePayload = res.json();
      const rows = Array.isArray(payload.data) ? payload.data : [];
      if (payload.meta?.["revision"]) {
        headRevision = String(payload.meta["revision"]);
      }

      for (const row of rows) {
        const rawId = String(row["id"] ?? `POL-${upserted.length + 1}`);
        const shortId = rawId.includes("/") ? rawId.split("/").pop()! : rawId;
        const attrs = (row["attributes"] ?? {}) as Record<string, unknown>;
        const descObj = attrs["description"] as Record<string, unknown> | string | undefined;
        const text = typeof descObj === "string" ? descObj : String(descObj?.["value"] ?? "");
        const rev = attrs["revision"] ? String(attrs["revision"]) : headRevision;
        if (rev && (!headRevision || Number(rev) > Number(headRevision))) {
          headRevision = rev;
        }

        upserted.push({
          externalId: shortId,
          kind: attrs["type"] === "testcase" ? "test_case" : "requirement",
          uri: `${origin}/polarion/rest/v1/projects/workitems/${encodeURIComponent(rawId)}`,
          webUrl: `${origin}/polarion/#/workitem?id=${encodeURIComponent(shortId)}`,
          title: String(attrs["title"] ?? shortId),
          text,
          status: String(attrs["status"] ?? "open"),
          priority: attrs["priority"] ? String(attrs["priority"]) : undefined,
          order: typeof attrs["outlineOrder"] === "number" ? attrs["outlineOrder"] : upserted.length,
          revision: rev,
          modifiedAt: typeof attrs["updated"] === "string" ? attrs["updated"] : undefined,
          attributes: {
            ...(attrs["outlineNumber"] ? { outlineNumber: String(attrs["outlineNumber"]) } : {}),
          },
        });
      }

      nextUrl = payload.links?.next || null;
    }

    const revLabel = spec.revision ?? headRevision ?? "head";
    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: headRevision,
      baselineUri: spec.baseline ?? (spec.revision ? `rev:${spec.revision}` : undefined),
      snapshotVersion: `rev:${revLabel}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const origin = new URL(spec.parsed.url).origin;
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(
        `${origin}/polarion/rest/v1/workitems/${encodeURIComponent(link.targetId)}/linkedworkitems`,
        {
          method: "POST",
          auth,
          headers: { "Content-Type": "application/vnd.api+json" },
          body: {
            data: [
              {
                type: "linkedworkitems",
                attributes: { role: link.relation },
                relationships: {
                  workItem: { data: { type: "workitems", id: link.sourceId } },
                },
              },
            ],
          },
        },
      );
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
    const projectId = String(spec.options?.["projectId"] ?? "default");
    const testRunId = String(spec.options?.["testRunId"] ?? "modelscript-ci");
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(
        `${origin}/polarion/rest/v1/projects/${encodeURIComponent(projectId)}/testruns/${encodeURIComponent(testRunId)}/testrecords`,
        {
          method: "POST",
          auth,
          headers: { "Content-Type": "application/vnd.api+json" },
          body: {
            data: [
              {
                type: "testrecords",
                attributes: {
                  result: run.status.toLowerCase(),
                  executed: run.timestamp,
                  comment: {
                    type: "text/plain",
                    value: `ModelScript ${run.runId} | commit=${run.commitSha ?? "n/a"} | dae=${run.daeHash ?? "n/a"} | ${run.details ?? ""}`,
                  },
                },
                meta: { verifies: run.verifiesIds, metrics: run.metrics },
              },
            ],
          },
        },
      );
      if (res.ok) {
        pushed++;
        createdIds[run.runId] = `${testRunId}/${run.runId}`;
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }
}
