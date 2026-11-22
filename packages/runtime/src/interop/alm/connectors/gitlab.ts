// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GitLab Issues & Merge Requests (REST API v4) Connector.
 *
 * Supports:
 * - Project issues pull (`/api/v4/projects/{projectId}/issues`) with `updated_after` cursor
 * - Outbound notes/trace-links on issues (`POST .../issues/{iid}/notes`)
 * - Verification run notes & `defects-on-fail` issue creation
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

export class GitLabAlmConnector implements AlmConnector {
  readonly protocol = "gitlab";
  readonly aliases = ["gl"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { origin: string; projectId: string } {
    const parsed = new URL(spec.parsed.url);
    const apiMatch = /\/api\/v4\/projects\/([^/]+)/i.exec(parsed.pathname);
    const projectId = String(
      spec.options?.["projectId"] ??
        spec.parsed.params["projectId"] ??
        (apiMatch ? decodeURIComponent(apiMatch[1]!) : parsed.pathname.replace(/^\/+|\/+$/g, "")),
    );
    return { origin: parsed.origin, projectId };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, projectId } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${origin}/api/v4/projects/${encodeURIComponent(projectId)}`, {
      auth,
    });
    let serverName = `GitLab (${projectId})`;
    if (res.ok) {
      try {
        const info = res.json();
        if (info["path_with_namespace"]) serverName = `GitLab (${String(info["path_with_namespace"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v4",
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { origin, projectId } = this.apiBase(spec);
    const url = new URL(`${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues`);
    url.searchParams.set("per_page", String(spec.options?.["perPage"] ?? 100));
    if (cursor) url.searchParams.set("updated_after", cursor);
    if (spec.options?.["labels"]) url.searchParams.set("labels", String(spec.options["labels"]));

    const upserted: AlmArtifact[] = [];
    let latestUpdated = cursor;
    const maxPages = Number(spec.options?.["maxPages"] ?? 20);
    let currentPage: string | undefined = "1";

    for (let page = 0; currentPage && page < maxPages; page++) {
      if (page > 0) url.searchParams.set("page", currentPage);
      const res = await almFetch<Array<Record<string, unknown>>>(url.toString(), { auth });
      if (!res.ok) {
        throw new Error(`GitLab issues fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const items = Array.isArray(res.json()) ? res.json() : [];

      for (const issue of items) {
        const iid = issue["iid"] ?? issue["id"];
        if (iid === undefined || iid === null) continue;
        const externalId = `GL-${String(iid)}`;
        const updated = typeof issue["updated_at"] === "string" ? issue["updated_at"] : undefined;
        if (updated && (!latestUpdated || updated > latestUpdated)) {
          latestUpdated = updated;
        }
        const labels = Array.isArray(issue["labels"]) ? issue["labels"].map(String) : [];

        upserted.push({
          externalId,
          kind: labels.some((l) => l.toLowerCase().includes("req")) ? "requirement" : "change_request",
          uri: `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues/${iid}`,
          webUrl: typeof issue["web_url"] === "string" ? issue["web_url"] : undefined,
          title: String(issue["title"] ?? externalId),
          text: String(issue["description"] ?? ""),
          status: String(issue["state"] ?? "opened"),
          revision: updated,
          modifiedAt: updated,
          attributes: {
            iid: Number(iid),
            labels: labels.join(","),
          },
        });
      }

      const nextPage = res.headers.get("x-next-page")?.trim();
      currentPage = nextPage && nextPage.length > 0 ? nextPage : undefined;
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `gitlab@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin, projectId } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const iid = link.targetId.replace(/^GL-/i, "");
      const endpoint = `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}/notes`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          body: `ModelScript Trace Link (${link.relation}): \`${link.sourceId}\`${link.title ? ` — ${link.title}` : ""}`,
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
    const { origin, projectId } = this.apiBase(spec);
    const createDefects = (spec.push ?? []).includes("defects-on-fail");
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      if ((run.status === "Failed" || run.status === "Error") && createDefects) {
        const res = await almFetch<Record<string, unknown>>(
          `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues`,
          {
            method: "POST",
            auth,
            body: {
              title: `[ModelScript Verify Failed] ${run.title}`,
              description: `Run: \`${run.runId}\`\nCommit: \`${run.commitSha ?? "n/a"}\`\nDAE: \`${run.daeHash ?? "n/a"}\`\n${run.details ?? ""}`,
              labels: "modelscript-verify,bug",
            },
          },
        );
        if (res.ok) {
          pushed++;
          try {
            const data = res.json();
            if (data["iid"] !== undefined) createdIds[run.runId] = `GL-${String(data["iid"])}`;
          } catch {
            // Ignore parse failure
          }
        } else {
          errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
        }
      } else if (run.verifiesIds.length > 0) {
        const iid = run.verifiesIds[0]!.replace(/^GL-/i, "");
        const res = await almFetch(
          `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}/notes`,
          {
            method: "POST",
            auth,
            body: {
              body: `ModelScript Verification **${run.status}**: ${run.title} (\`${run.runId}\`)`,
            },
          },
        );
        if (res.ok) pushed++;
        else errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      } else {
        skipped++;
      }
    }

    return { pushed, skipped, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const { origin, projectId } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const iid = edit.externalId.replace(/^GL-/i, "");
      const res = await almFetch(
        `${origin}/api/v4/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}`,
        {
          method: "PUT",
          auth,
          body: {
            ...(edit.title !== undefined ? { title: edit.title } : {}),
            ...(edit.text !== undefined ? { description: edit.text } : {}),
            ...(edit.status !== undefined
              ? { state_event: edit.status.toLowerCase() === "closed" ? "close" : "reopen" }
              : {}),
          },
        },
      );
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
