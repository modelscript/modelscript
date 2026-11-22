// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gurock TestRail (REST API v2) Connector.
 *
 * Supports:
 * - Test case pull (`get_cases/{projectId}`) with incremental `updated_after` cursor
 * - Requirement reference extraction (`refs` -> `verifies` links)
 * - Outbound test case `refs` updates (`update_case/{caseId}`)
 * - Verification run push (`add_run/{projectId}` + `add_results_for_cases/{runId}`)
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

function mapTestRailStatusId(status: AlmVerificationRun["status"]): number {
  switch (status) {
    case "Passed":
      return 1;
    case "Inconclusive":
      return 2; // Blocked
    case "Failed":
    case "Error":
    default:
      return 5; // Failed
  }
}

export class TestRailAlmConnector implements AlmConnector {
  readonly protocol = "testrail";

  private apiBase(spec: ResolvedRemoteSpec): { origin: string; projectId: string; suiteId?: string | undefined } {
    const parsed = new URL(spec.parsed.url);
    const projectMatch = /\/projects?\/(\d+)/i.exec(parsed.pathname);
    const projectId = String(
      spec.options?.["projectId"] ?? spec.parsed.params["projectId"] ?? projectMatch?.[1] ?? "1",
    );
    const suiteId =
      spec.options?.["suiteId"] !== undefined ? String(spec.options["suiteId"]) : spec.parsed.params["suiteId"];
    return { origin: parsed.origin, projectId, suiteId };
  }

  private endpoint(origin: string, route: string): string {
    return `${origin}/index.php?/api/v2/${route}`;
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, projectId } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(this.endpoint(origin, `get_project/${projectId}`), { auth });
    let serverName = "TestRail";
    if (res.ok) {
      try {
        const proj = res.json();
        if (proj["name"]) serverName = `TestRail (${String(proj["name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v2",
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { origin, projectId, suiteId } = this.apiBase(spec);
    const queryParts: string[] = [];
    if (suiteId) queryParts.push(`suite_id=${encodeURIComponent(suiteId)}`);
    if (cursor) queryParts.push(`updated_after=${encodeURIComponent(cursor)}`);
    const suffix = queryParts.length > 0 ? `&${queryParts.join("&")}` : "";

    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let maxUpdatedOn = cursor ? Number(cursor) : 0;
    let nextUrl: string | undefined = this.endpoint(origin, `get_cases/${encodeURIComponent(projectId)}${suffix}`);
    const maxPages = Number(spec.options?.["maxPages"] ?? 20);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<
        { cases?: Array<Record<string, unknown>>; _links?: { next?: string | null } } | Array<Record<string, unknown>>
      >(currentUrl, { auth });
      if (!res.ok) {
        throw new Error(`TestRail get_cases failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const raw = res.json();
      const cases = Array.isArray(raw) ? raw : Array.isArray(raw.cases) ? raw.cases : [];

      for (const tc of cases) {
        const id = String(tc["id"] ?? "");
        if (!id) continue;
        const externalId = `C${id}`;
        const updatedOn = typeof tc["updated_on"] === "number" ? tc["updated_on"] : 0;
        if (updatedOn > maxUpdatedOn) maxUpdatedOn = updatedOn;
        const refs = typeof tc["refs"] === "string" ? tc["refs"] : "";

        upserted.push({
          externalId,
          kind: "test_case",
          uri: this.endpoint(origin, `get_case/${id}`),
          webUrl: `${origin}/index.php?/cases/view/${id}`,
          title: String(tc["title"] ?? externalId),
          text: String(tc["custom_preconds"] ?? tc["custom_steps"] ?? ""),
          status: "Active",
          priority: tc["priority_id"] !== undefined ? `P${String(tc["priority_id"])}` : undefined,
          parentId: tc["section_id"] !== undefined ? `SEC-${String(tc["section_id"])}` : undefined,
          revision: updatedOn ? String(updatedOn) : undefined,
          modifiedAt: updatedOn ? new Date(updatedOn * 1000).toISOString() : undefined,
          attributes: {
            suiteId: Number(tc["suite_id"] ?? 0),
            refs,
          },
        });

        for (const ref of refs
          .split(/[,\s]+/)
          .map((r) => r.trim())
          .filter(Boolean)) {
          links.push({
            sourceId: externalId,
            targetId: ref,
            relation: "verifies",
          });
        }
      }

      const rawNext = !Array.isArray(raw) ? raw._links?.next : undefined;
      nextUrl =
        typeof rawNext === "string" && rawNext.length > 0
          ? rawNext.startsWith("http")
            ? rawNext
            : `${origin}/index.php?${rawNext.startsWith("/") ? rawNext : `/${rawNext}`}`
          : undefined;
    }

    const nextCursor = maxUpdatedOn > 0 ? String(maxUpdatedOn) : cursor;
    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor,
      snapshotVersion: `testrail@${nextCursor ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const caseId = link.sourceId.replace(/^C/i, "");
      const res = await almFetch(this.endpoint(origin, `update_case/${encodeURIComponent(caseId)}`), {
        method: "POST",
        auth,
        body: { refs: link.targetId },
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
    const { origin, projectId, suiteId } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      let runId = spec.options?.["runId"] !== undefined ? String(spec.options["runId"]) : undefined;
      if (!runId) {
        const createRes = await almFetch<Record<string, unknown>>(
          this.endpoint(origin, `add_run/${encodeURIComponent(projectId)}`),
          {
            method: "POST",
            auth,
            body: {
              name: run.title,
              suite_id: suiteId ? Number(suiteId) : undefined,
              description: `ModelScript verification run ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"}`,
              include_all: false,
              case_ids: run.verifiesIds.map((id) => Number(id.replace(/^C/i, ""))).filter((n) => !Number.isNaN(n)),
            },
          },
        );
        if (!createRes.ok) {
          errors.push({ id: run.runId, message: createRes.text.slice(0, 200), statusCode: createRes.status });
          continue;
        }
        try {
          const created = createRes.json();
          if (created["id"] !== undefined) {
            runId = String(created["id"]);
            createdIds[run.runId] = runId;
          }
        } catch {
          // Ignore parse failure
        }
      }

      if (!runId) {
        errors.push({ id: run.runId, message: "TestRail add_run did not return a run ID." });
        continue;
      }

      const caseResults = run.verifiesIds
        .map((id) => Number(id.replace(/^C/i, "")))
        .filter((n) => !Number.isNaN(n))
        .map((caseId) => ({
          case_id: caseId,
          status_id: mapTestRailStatusId(run.status),
          elapsed: run.durationMs ? `${Math.max(1, Math.round(run.durationMs / 1000))}s` : undefined,
          comment: `Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | Metrics: ${JSON.stringify(run.metrics)}${run.details ? ` | ${run.details}` : ""}`,
        }));

      const res = await almFetch(this.endpoint(origin, `add_results_for_cases/${encodeURIComponent(runId)}`), {
        method: "POST",
        auth,
        body: { results: caseResults },
      });
      if (res.ok) {
        pushed++;
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }
}
