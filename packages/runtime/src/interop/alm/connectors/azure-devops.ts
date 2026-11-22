// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Microsoft Azure DevOps (REST API v7.1) Connector.
 *
 * Supports:
 * - WIQL-scoped work-item pull with incremental `System.ChangedDate` cursor
 * - Batched work-item hydration with `relations` link extraction
 * - Outbound Hyperlink relation push via JSON Patch (`application/json-patch+json`)
 * - Test Run creation & optional `defects-on-fail` Bug creation
 */

import type {
  AlmArtifact,
  AlmArtifactKind,
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

function mapAzdoWorkItemKind(workItemType: string): AlmArtifactKind {
  const lower = workItemType.toLowerCase();
  if (lower.includes("test")) return "test_case";
  if (lower.includes("bug") || lower.includes("task") || lower.includes("issue")) return "change_request";
  return "requirement";
}

function stripHtml(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class AzureDevOpsAlmConnector implements AlmConnector {
  readonly protocol = "azdo";
  readonly aliases = ["azure-devops", "ado"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { projectBase: string; apiVersion: string } {
    const parsed = new URL(spec.parsed.url);
    const projectBase = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    const apiVersion = String(spec.options?.["apiVersion"] ?? "7.1");
    return { projectBase, apiVersion };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { projectBase, apiVersion } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(
      `${projectBase}/_apis/projects?api-version=${encodeURIComponent(apiVersion)}`,
      { auth },
    );
    let serverName = "Azure DevOps";
    if (res.ok) {
      try {
        const data = res.json();
        if (typeof data["count"] === "number") {
          serverName = `Azure DevOps (${data["count"]} projects)`;
        }
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: apiVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { projectBase, apiVersion } = this.apiBase(spec);
    const baseWiql =
      spec.query?.trim() ||
      spec.parsed.params["wiql"] ||
      "SELECT [System.Id] FROM WorkItems ORDER BY [System.ChangedDate] DESC";
    const wiql = cursor
      ? `${baseWiql.replace(/\s+ORDER\s+BY[\s\S]*$/i, "")} AND [System.ChangedDate] >= '${cursor}'`
      : baseWiql;

    const wiqlRes = await almFetch<{ workItems?: Array<{ id?: number | string }> }>(
      `${projectBase}/_apis/wit/wiql?api-version=${encodeURIComponent(apiVersion)}`,
      {
        method: "POST",
        auth,
        body: { query: wiql },
      },
    );
    if (!wiqlRes.ok) {
      throw new Error(`Azure DevOps WIQL query failed (${wiqlRes.status}): ${wiqlRes.text.slice(0, 300)}`);
    }

    const wiqlData = wiqlRes.json();
    const ids = (wiqlData.workItems ?? [])
      .map((w) => (w.id !== undefined ? String(w.id) : ""))
      .filter((id) => id.length > 0);

    const upserted: AlmArtifact[] = [];
    const deletedIds: string[] = [];
    const links: AlmLink[] = [];
    let latestChanged = cursor;
    const batchSize = Math.min(200, Math.max(1, Number(spec.options?.["batchSize"] ?? 100)));

    for (let i = 0; i < ids.length; i += batchSize) {
      const slice = ids.slice(i, i + batchSize);
      const batchUrl = `${projectBase}/_apis/wit/workitems?ids=${encodeURIComponent(slice.join(","))}&$expand=relations&api-version=${encodeURIComponent(apiVersion)}`;
      const res = await almFetch<{ value?: Array<Record<string, unknown>> }>(batchUrl, { auth });
      if (!res.ok) {
        throw new Error(`Azure DevOps work-item fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }
      const items = res.json().value ?? [];
      for (const item of items) {
        const id = String(item["id"] ?? "");
        if (!id) continue;
        const fields = (item["fields"] ?? {}) as Record<string, unknown>;
        if (fields["System.IsDeleted"] === true) {
          deletedIds.push(`WI-${id}`);
          continue;
        }
        const workItemType = String(fields["System.WorkItemType"] ?? "Requirement");
        const changedDate = typeof fields["System.ChangedDate"] === "string" ? fields["System.ChangedDate"] : undefined;
        if (changedDate && (!latestChanged || changedDate > latestChanged)) {
          latestChanged = changedDate;
        }
        const rev = item["rev"] !== undefined ? String(item["rev"]) : undefined;

        upserted.push({
          externalId: `WI-${id}`,
          kind: mapAzdoWorkItemKind(workItemType),
          uri: String(item["url"] ?? `${projectBase}/_apis/wit/workItems/${id}`),
          webUrl: `${projectBase}/_workitems/edit/${id}`,
          title: String(fields["System.Title"] ?? `Work Item ${id}`),
          text: stripHtml(fields["System.Description"]),
          status: String(fields["System.State"] ?? "New"),
          priority:
            fields["Microsoft.VSTS.Common.Priority"] !== undefined
              ? `P${String(fields["Microsoft.VSTS.Common.Priority"])}`
              : undefined,
          revision: rev,
          modifiedAt: changedDate,
          attributes: {
            workItemType,
            areaPath: String(fields["System.AreaPath"] ?? ""),
          },
        });

        const relations = Array.isArray(item["relations"]) ? (item["relations"] as Array<Record<string, unknown>>) : [];
        for (const rel of relations) {
          const relType = String(rel["rel"] ?? "");
          const targetUrl = typeof rel["url"] === "string" ? rel["url"] : "";
          const match = /\/workItems\/(\d+)$/i.exec(targetUrl);
          if (match) {
            links.push({
              sourceId: `WI-${id}`,
              targetId: `WI-${match[1]}`,
              relation: relType.includes("Hierarchy-Reverse") ? "derivesFrom" : "relatesTo",
            });
          }
        }
      }
    }

    return {
      upserted,
      deletedIds,
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestChanged,
      snapshotVersion: `wiql@${latestChanged ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { projectBase, apiVersion } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const numericId = link.targetId.replace(/^WI-/i, "");
      const endpoint = `${projectBase}/_apis/wit/workitems/${encodeURIComponent(numericId)}?api-version=${encodeURIComponent(apiVersion)}`;
      const res = await almFetch(endpoint, {
        method: "PATCH",
        auth,
        headers: { "Content-Type": "application/json-patch+json" },
        body: [
          {
            op: "add",
            path: "/relations/-",
            value: {
              rel: "Hyperlink",
              url: link.sourceId.startsWith("http")
                ? link.sourceId
                : `https://modelscript.org/symbols/${encodeURIComponent(link.sourceId)}`,
              attributes: {
                comment: link.title ?? `ModelScript (${link.relation}): ${link.sourceId}`,
              },
            },
          },
        ],
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
    const { projectBase, apiVersion } = this.apiBase(spec);
    const createDefects = (spec.push ?? []).includes("defects-on-fail");
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const runRes = await almFetch<Record<string, unknown>>(
        `${projectBase}/_apis/test/runs?api-version=${encodeURIComponent(apiVersion)}`,
        {
          method: "POST",
          auth,
          body: {
            name: run.title,
            automated: true,
            state: "Completed",
            comment: `Status: ${run.status} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | Verifies: ${run.verifiesIds.join(", ")}`,
          },
        },
      );
      if (runRes.ok) {
        pushed++;
        try {
          const data = runRes.json();
          if (data["id"] !== undefined) createdIds[run.runId] = String(data["id"]);
        } catch {
          // Ignore parse failure
        }
      } else {
        errors.push({ id: run.runId, message: runRes.text.slice(0, 200), statusCode: runRes.status });
      }

      if (createDefects && (run.status === "Failed" || run.status === "Error")) {
        const bugRes = await almFetch<Record<string, unknown>>(
          `${projectBase}/_apis/wit/workitems/$Bug?api-version=${encodeURIComponent(apiVersion)}`,
          {
            method: "POST",
            auth,
            headers: { "Content-Type": "application/json-patch+json" },
            body: [
              { op: "add", path: "/fields/System.Title", value: `[ModelScript Verify Failed] ${run.title}` },
              {
                op: "add",
                path: "/fields/System.Description",
                value: `Run: ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | ${run.details ?? ""}`,
              },
            ],
          },
        );
        if (!bugRes.ok) {
          errors.push({ id: `${run.runId}:defect`, message: bugRes.text.slice(0, 200), statusCode: bugRes.status });
        }
      } else if (run.status !== "Passed" && !createDefects && !runRes.ok) {
        skipped++;
      }
    }

    return { pushed, skipped, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const { projectBase, apiVersion } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const numericId = edit.externalId.replace(/^WI-/i, "");
      const ops: Array<{ op: string; path: string; value: unknown }> = [];
      if (edit.expectedRevision && !Number.isNaN(Number(edit.expectedRevision))) {
        ops.push({ op: "test", path: "/rev", value: Number(edit.expectedRevision) });
      }
      if (edit.title !== undefined) ops.push({ op: "replace", path: "/fields/System.Title", value: edit.title });
      if (edit.text !== undefined) ops.push({ op: "replace", path: "/fields/System.Description", value: edit.text });
      if (edit.status !== undefined) ops.push({ op: "replace", path: "/fields/System.State", value: edit.status });
      if (ops.length === 0) continue;

      const res = await almFetch(
        `${projectBase}/_apis/wit/workitems/${encodeURIComponent(numericId)}?api-version=${encodeURIComponent(apiVersion)}`,
        {
          method: "PATCH",
          auth,
          headers: { "Content-Type": "application/json-patch+json" },
          body: ops,
        },
      );
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
