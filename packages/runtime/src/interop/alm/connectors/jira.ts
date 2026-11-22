// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Jira Cloud (REST API v3) & Jira Data Center (REST API v2) Connector.
 *
 * Supports:
 * - JQL-scoped incremental pull (`updated >= "<cursor>"`)
 * - Materialization as `change_request` artifacts with clickable `browse/<KEY>` URLs
 * - Outbound Remote Issue Links
 * - `defects-on-fail`: automatic Jira defect creation when `msx verify` reports failures
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

function extractJiraDescription(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  // Minimal Atlassian Document Format (ADF) text extraction
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec["text"] === "string") parts.push(rec["text"]);
    if (Array.isArray(rec["content"])) {
      for (const child of rec["content"]) walk(child);
    }
  };
  walk(raw);
  return parts.join(" ").trim();
}

export class JiraAlmConnector implements AlmConnector {
  readonly protocol = "jira";

  private apiBase(spec: ResolvedRemoteSpec): { origin: string; apiVersion: "2" | "3" } {
    const parsed = new URL(spec.parsed.url);
    const apiVersion = spec.options?.["apiVersion"] === 2 || spec.options?.["apiVersion"] === "2" ? "2" : "3";
    return { origin: parsed.origin, apiVersion };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { origin, apiVersion } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${origin}/rest/api/${apiVersion}/serverInfo`, { auth });
    let serverName = "Jira";
    let serverVersion: string | undefined;
    if (res.ok) {
      try {
        const info = res.json();
        serverName = String(info["serverTitle"] ?? "Jira");
        serverVersion = info["version"] ? String(info["version"]) : undefined;
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName,
      serverVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { origin, apiVersion } = this.apiBase(spec);
    const baseJql = spec.query?.trim() || spec.parsed.params["jql"] || "ORDER BY updated DESC";
    const jql = cursor ? `(${baseJql}) AND updated >= "${cursor}"` : baseJql;
    const pageSize = Number(spec.options?.["maxResults"] ?? 100);
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestUpdated = cursor;
    let startAt = 0;

    for (let page = 0; page < maxPages; page++) {
      const searchUrl = new URL(`${origin}/rest/api/${apiVersion}/search`);
      searchUrl.searchParams.set("jql", jql);
      searchUrl.searchParams.set("maxResults", String(pageSize));
      if (startAt > 0) searchUrl.searchParams.set("startAt", String(startAt));

      const res = await almFetch<{ issues?: Array<Record<string, unknown>>; total?: number }>(searchUrl.toString(), {
        auth,
      });
      if (!res.ok) {
        throw new Error(`Jira search failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const data = res.json();
      const issues = Array.isArray(data.issues) ? data.issues : [];

      for (const issue of issues) {
        const key = String(issue["key"] ?? issue["id"] ?? "");
        if (!key) continue;
        const fields = (issue["fields"] ?? {}) as Record<string, unknown>;
        const statusObj = (fields["status"] ?? {}) as Record<string, unknown>;
        const priorityObj = (fields["priority"] ?? {}) as Record<string, unknown>;
        const issueTypeObj = (fields["issuetype"] ?? {}) as Record<string, unknown>;
        const updated = typeof fields["updated"] === "string" ? fields["updated"] : undefined;
        if (updated && (!latestUpdated || updated > latestUpdated)) {
          latestUpdated = updated;
        }

        upserted.push({
          externalId: key,
          kind: "change_request",
          uri: String(issue["self"] ?? `${origin}/rest/api/${apiVersion}/issue/${key}`),
          webUrl: `${origin}/browse/${key}`,
          title: String(fields["summary"] ?? key),
          text: extractJiraDescription(fields["description"]),
          status: String(statusObj["name"] ?? "Open"),
          priority: priorityObj["name"] ? String(priorityObj["name"]) : undefined,
          revision: updated,
          modifiedAt: updated,
          attributes: {
            issueType: String(issueTypeObj["name"] ?? "Task"),
          },
        });

        const issueLinks = Array.isArray(fields["issuelinks"])
          ? (fields["issuelinks"] as Array<Record<string, unknown>>)
          : [];
        for (const il of issueLinks) {
          const outward = il["outwardIssue"] as Record<string, unknown> | undefined;
          if (outward && typeof outward["key"] === "string") {
            links.push({
              sourceId: key,
              targetId: outward["key"],
              relation: "relatesTo",
            });
          }
        }
      }

      startAt += issues.length;
      if (issues.length === 0 || typeof data.total !== "number" || startAt >= data.total) {
        break;
      }
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `jql@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { origin, apiVersion } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const endpoint = `${origin}/rest/api/${apiVersion}/issue/${encodeURIComponent(link.targetId)}/remotelink`;
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: {
          object: {
            url: link.sourceId.startsWith("http")
              ? link.sourceId
              : `https://modelscript.org/symbols/${encodeURIComponent(link.sourceId)}`,
            title: link.title ?? `ModelScript (${link.relation}): ${link.sourceId}`,
          },
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
    const { origin, apiVersion } = this.apiBase(spec);
    const projectKey = String(spec.options?.["projectKey"] ?? spec.parsed.params["project"] ?? "ENG");
    const defectType = String(spec.options?.["defectIssueType"] ?? "Bug");
    const createDefects = (spec.push ?? []).includes("defects-on-fail");

    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      if (run.status === "Failed" || run.status === "Error") {
        if (!createDefects) {
          skipped++;
          continue;
        }
        const res = await almFetch<Record<string, unknown>>(`${origin}/rest/api/${apiVersion}/issue`, {
          method: "POST",
          auth,
          body: {
            fields: {
              project: { key: projectKey },
              summary: `[ModelScript Verify Failed] ${run.title}`,
              issuetype: { name: defectType },
              description:
                apiVersion === "2"
                  ? `Run: ${run.runId}\nCommit: ${run.commitSha ?? "n/a"}\nDAE Hash: ${run.daeHash ?? "n/a"}\nDetails: ${run.details ?? ""}`
                  : {
                      type: "doc",
                      version: 1,
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: `Run: ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"} | ${run.details ?? ""}`,
                            },
                          ],
                        },
                      ],
                    },
            },
          },
        });
        if (res.ok) {
          pushed++;
          try {
            const body = res.json();
            createdIds[run.runId] = String(body["key"] ?? body["id"] ?? run.runId);
          } catch {
            createdIds[run.runId] = run.runId;
          }
        } else {
          errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
        }
      } else {
        // Post verification pass comment to each linked Jira issue
        for (const issueKey of run.verifiesIds) {
          const commentRes = await almFetch(
            `${origin}/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}/comment`,
            {
              method: "POST",
              auth,
              body: {
                body: `ModelScript verification ${run.status}: ${run.title} (commit ${run.commitSha ?? "n/a"}, run ${run.runId})`,
              },
            },
          );
          if (commentRes.ok) {
            pushed++;
          } else {
            errors.push({
              id: `${run.runId}:${issueKey}`,
              message: commentRes.text.slice(0, 200),
              statusCode: commentRes.status,
            });
          }
        }
      }
    }

    return { pushed, skipped, errors, createdIds };
  }
}
