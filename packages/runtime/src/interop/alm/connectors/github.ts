// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GitHub Issues & Pull Requests (REST API v3) Connector.
 *
 * Supports:
 * - Repository issues/PRs pull (`/repos/{owner}/{repo}/issues`) with incremental `since` cursor
 * - Outbound traceability comments on issues/PRs (`pushLinks`)
 * - Verification run status comments & optional `defects-on-fail` issue creation
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
import { almFetch, parseLinkHeaderNext } from "../http_client.js";

export class GitHubAlmConnector implements AlmConnector {
  readonly protocol = "github";
  readonly aliases = ["gh"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { apiOrigin: string; owner: string; repo: string } {
    const parsed = new URL(spec.parsed.url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    // Support both https://api.github.com/repos/owner/repo and https://github.com/owner/repo
    const isReposPrefix = segments[0] === "repos";
    const owner = String(spec.options?.["owner"] ?? (isReposPrefix ? segments[1] : segments[0]) ?? "");
    const repo = String(spec.options?.["repo"] ?? (isReposPrefix ? segments[2] : segments[1]) ?? "");
    const apiOrigin = parsed.hostname === "github.com" ? "https://api.github.com" : parsed.origin;
    return { apiOrigin, owner, repo };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { apiOrigin, owner, repo } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(
      `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { auth, headers: { Accept: "application/vnd.github+json" } },
    );
    let serverName = `GitHub (${owner}/${repo})`;
    if (res.ok) {
      try {
        const info = res.json();
        if (info["full_name"]) serverName = `GitHub (${String(info["full_name"])})`;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion: "v3",
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { apiOrigin, owner, repo } = this.apiBase(spec);
    const url = new URL(`${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`);
    url.searchParams.set("state", String(spec.options?.["state"] ?? "all"));
    url.searchParams.set("per_page", String(spec.options?.["perPage"] ?? 100));
    if (cursor) url.searchParams.set("since", cursor);
    if (spec.options?.["labels"]) url.searchParams.set("labels", String(spec.options["labels"]));

    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestUpdated = cursor;
    let nextUrl: string | undefined = url.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 20);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const res = await almFetch<Array<Record<string, unknown>>>(nextUrl, {
        auth,
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        throw new Error(`GitHub issues fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const items = Array.isArray(res.json()) ? res.json() : [];

      for (const issue of items) {
        const num = issue["number"];
        if (num === undefined || num === null) continue;
        const isPr = Boolean(issue["pull_request"]);
        const externalId = `${isPr ? "PR" : "GH"}-${String(num)}`;
        const updated = typeof issue["updated_at"] === "string" ? issue["updated_at"] : undefined;
        if (updated && (!latestUpdated || updated > latestUpdated)) {
          latestUpdated = updated;
        }
        const labels = Array.isArray(issue["labels"])
          ? (issue["labels"] as Array<Record<string, unknown>>).map((l) => String(l["name"] ?? "")).filter(Boolean)
          : [];

        upserted.push({
          externalId,
          kind: labels.some((l) => l.toLowerCase().includes("req")) ? "requirement" : "change_request",
          uri: String(issue["url"] ?? `${apiOrigin}/repos/${owner}/${repo}/issues/${num}`),
          webUrl: typeof issue["html_url"] === "string" ? issue["html_url"] : undefined,
          title: String(issue["title"] ?? externalId),
          text: String(issue["body"] ?? ""),
          status: String(issue["state"] ?? "open"),
          revision: updated,
          modifiedAt: updated,
          attributes: {
            isPullRequest: isPr,
            labels: labels.join(","),
            number: Number(num),
          },
        });
      }

      nextUrl = parseLinkHeaderNext(res.headers.get("link"));
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `github@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { apiOrigin, owner, repo } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const num = link.targetId.replace(/^(GH|PR)-/i, "");
      const endpoint = `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(num)}/comments`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        headers: { Accept: "application/vnd.github+json" },
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
    const { apiOrigin, owner, repo } = this.apiBase(spec);
    const createDefects = (spec.push ?? []).includes("defects-on-fail");
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      if ((run.status === "Failed" || run.status === "Error") && createDefects) {
        const res = await almFetch<Record<string, unknown>>(
          `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          {
            method: "POST",
            auth,
            headers: { Accept: "application/vnd.github+json" },
            body: {
              title: `[ModelScript Verify Failed] ${run.title}`,
              body: `Run: \`${run.runId}\`\nCommit: \`${run.commitSha ?? "n/a"}\`\nDAE Hash: \`${run.daeHash ?? "n/a"}\`\nVerifies: ${run.verifiesIds.join(", ")}\n\n${run.details ?? ""}`,
              labels: ["modelscript-verify", "bug"],
            },
          },
        );
        if (res.ok) {
          pushed++;
          try {
            const data = res.json();
            if (data["number"] !== undefined) createdIds[run.runId] = `GH-${String(data["number"])}`;
          } catch {
            // Ignore parse failure
          }
        } else {
          errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
        }
      } else if (run.verifiesIds.length > 0) {
        const targetNum = run.verifiesIds[0]!.replace(/^(GH|PR)-/i, "");
        const res = await almFetch(
          `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(targetNum)}/comments`,
          {
            method: "POST",
            auth,
            headers: { Accept: "application/vnd.github+json" },
            body: {
              body: `ModelScript Verification **${run.status}**: ${run.title} (\`${run.runId}\`, commit \`${run.commitSha ?? "n/a"}\`)`,
            },
          },
        );
        if (res.ok) {
          pushed++;
        } else {
          errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
        }
      } else {
        skipped++;
      }
    }

    return { pushed, skipped, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const { apiOrigin, owner, repo } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const num = edit.externalId.replace(/^(GH|PR)-/i, "");
      const res = await almFetch(
        `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(num)}`,
        {
          method: "PATCH",
          auth,
          headers: { Accept: "application/vnd.github+json" },
          body: {
            ...(edit.title !== undefined ? { title: edit.title } : {}),
            ...(edit.text !== undefined ? { body: edit.text } : {}),
            ...(edit.status !== undefined ? { state: edit.status.toLowerCase() === "closed" ? "closed" : "open" } : {}),
          },
        },
      );
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }
}
