// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Atlassian Bitbucket Data Center (REST 1.0) & Cloud (REST 2.0) Connector.
 *
 * Supports:
 * - Pulling Pull Requests as `change_request` artifacts
 * - Pushing traceability comments onto PRs (`pushLinks`)
 * - Pushing verification build statuses onto commits (`pushVerificationRuns`)
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

export class BitbucketAlmConnector implements AlmConnector {
  readonly protocol = "bitbucket";
  readonly aliases = ["bb"] as const;

  private apiBase(spec: ResolvedRemoteSpec): {
    origin: string;
    isCloud: boolean;
    project: string;
    repo: string;
  } {
    const parsed = new URL(spec.parsed.url);
    const isCloud =
      spec.options?.["cloud"] === true ||
      parsed.hostname === "api.bitbucket.org" ||
      parsed.hostname === "bitbucket.org";
    const segments = parsed.pathname.split("/").filter(Boolean);
    const project = String(spec.options?.["project"] ?? segments[segments.length - 2] ?? "");
    const repo = String(spec.options?.["repo"] ?? segments[segments.length - 1] ?? "");
    const origin = parsed.hostname === "bitbucket.org" ? "https://api.bitbucket.org" : parsed.origin;
    return { origin, isCloud, project, repo };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, isCloud, project, repo } = this.apiBase(spec);
    const probeUrl = isCloud
      ? `${origin}/2.0/repositories/${encodeURIComponent(project)}/${encodeURIComponent(repo)}`
      : `${origin}/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}`;
    const res = await almFetch(probeUrl, { auth });
    return {
      protocol: this.protocol,
      serverName: `Atlassian Bitbucket ${isCloud ? "Cloud" : "Data Center"} (${project}/${repo})`,
      serverVersion: res.ok ? (isCloud ? "2.0" : "1.0") : `HTTP ${res.status}`,
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { origin, isCloud, project, repo } = this.apiBase(spec);
    const endpoint = isCloud
      ? `${origin}/2.0/repositories/${encodeURIComponent(project)}/${encodeURIComponent(repo)}/pullrequests?state=ALL`
      : `${origin}/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests?state=ALL`;

    const upserted: AlmArtifact[] = [];
    let latestUpdated = cursor;
    let nextUrl: string | undefined = endpoint;
    const maxPages = Number(spec.options?.["maxPages"] ?? 20);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const currentUrl: string = nextUrl;
      const res = await almFetch<{
        values?: Array<Record<string, unknown>>;
        next?: string;
        isLastPage?: boolean;
        nextPageStart?: number;
      }>(currentUrl, { auth });
      if (!res.ok) {
        throw new Error(`Bitbucket PR fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const prs = payload.values ?? [];

      for (const pr of prs) {
        const id = pr["id"];
        if (id === undefined || id === null) continue;
        const updatedRaw = pr["updatedDate"] ?? pr["updated_on"];
        const updated =
          typeof updatedRaw === "number"
            ? new Date(updatedRaw).toISOString()
            : typeof updatedRaw === "string"
              ? updatedRaw
              : undefined;
        if (cursor && updated && updated <= cursor) continue;
        if (updated && (!latestUpdated || updated > latestUpdated)) {
          latestUpdated = updated;
        }

        const linksObj = (pr["links"] ?? {}) as Record<string, unknown>;
        const selfArr = Array.isArray(linksObj["self"]) ? (linksObj["self"] as Array<Record<string, unknown>>) : [];
        const htmlObj = (linksObj["html"] ?? {}) as Record<string, unknown>;
        const webUrl =
          typeof htmlObj["href"] === "string"
            ? htmlObj["href"]
            : typeof selfArr[0]?.["href"] === "string"
              ? String(selfArr[0]["href"])
              : undefined;

        upserted.push({
          externalId: `BB-PR-${String(id)}`,
          kind: "change_request",
          uri: `${endpoint.split("?")[0]}/${String(id)}`,
          webUrl,
          title: String(pr["title"] ?? `PR #${String(id)}`),
          text: String(pr["description"] ?? ""),
          status: String(pr["state"] ?? "OPEN"),
          revision: updated,
          modifiedAt: updated,
          attributes: {
            prId: Number(id),
            project,
            repo,
          },
        });
      }

      if (typeof payload.next === "string" && payload.next.length > 0) {
        nextUrl = payload.next;
      } else if (payload.isLastPage === false && typeof payload.nextPageStart === "number") {
        nextUrl = `${endpoint}&start=${payload.nextPageStart}`;
      } else {
        nextUrl = undefined;
      }
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `bitbucket@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin, isCloud, project, repo } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const prId = link.targetId.replace(/^BB-PR-/i, "");
      const endpoint = isCloud
        ? `${origin}/2.0/repositories/${encodeURIComponent(project)}/${encodeURIComponent(repo)}/pullrequests/${encodeURIComponent(prId)}/comments`
        : `${origin}/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(repo)}/pull-requests/${encodeURIComponent(prId)}/comments`;
      const body = isCloud
        ? { content: { raw: `ModelScript Trace Link (${link.relation}): \`${link.sourceId}\`` } }
        : { text: `ModelScript Trace Link (${link.relation}): \`${link.sourceId}\`` };

      const res = await almFetch(endpoint, { method: "POST", auth, body });
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
    const { origin, isCloud, project, repo } = this.apiBase(spec);
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];

    for (const run of runs) {
      if (!run.commitSha) {
        skipped++;
        continue;
      }
      const state = run.status === "Passed" ? "SUCCESSFUL" : run.status === "Inconclusive" ? "INPROGRESS" : "FAILED";
      const endpoint = isCloud
        ? `${origin}/2.0/repositories/${encodeURIComponent(project)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(run.commitSha)}/statuses/build`
        : `${origin}/rest/build-status/1.0/commits/${encodeURIComponent(run.commitSha)}`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          state,
          key: `modelscript-${run.runId}`,
          name: run.title,
          url: run.reportUrl ?? `https://modelscript.org/runs/${encodeURIComponent(run.runId)}`,
          description: `DAE: ${run.daeHash ?? "n/a"} | Verifies: ${run.verifiesIds.join(", ")}`,
        },
      });
      if (res.ok) pushed++;
      else errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
    }

    return { pushed, skipped, errors };
  }
}
