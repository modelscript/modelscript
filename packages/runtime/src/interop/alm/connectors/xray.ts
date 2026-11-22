// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SmartBear / Xblend Xray Test Management (REST API v2) Connector.
 *
 * Supports:
 * - Pulling Xray Test definitions (`/api/v2/tests` or configured endpoint)
 * - Pushing ModelScript simulation/V-cycle verification runs as Xray Test Executions
 *   (`/api/v2/import/execution`) with PASS/FAIL/TODO statuses and DAE/commit evidence
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
import { almFetch, exchangeXrayCloudJwt } from "../http_client.js";

function mapXrayStatus(status: AlmVerificationRun["status"]): "PASSED" | "FAILED" | "TODO" {
  if (status === "Passed") return "PASSED";
  if (status === "Inconclusive") return "TODO";
  return "FAILED";
}

export class XrayAlmConnector implements AlmConnector {
  readonly protocol = "xray";

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string } {
    const parsed = new URL(spec.parsed.url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    const baseUrl = trimmed.includes("/api/") ? `${parsed.origin}${trimmed}` : `${parsed.origin}/api/v2`;
    return { baseUrl };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl } = this.apiBase(spec);
    const res = await almFetch(`${baseUrl}/info`, { auth });
    return {
      protocol: this.protocol,
      serverName: "Xray Test Management",
      serverVersion: res.ok ? "v2" : `HTTP ${res.status}`,
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: false,
    };
  }

  private async resolveAuth(baseUrl: string, auth: AuthContext): Promise<AuthContext> {
    if (!auth.token && auth.username && auth.password) {
      const jwt = await exchangeXrayCloudJwt(baseUrl, auth.username, auth.password, auth);
      if (jwt) return { ...auth, token: jwt, username: undefined, password: undefined };
    }
    return auth;
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const { baseUrl } = this.apiBase(spec);
    const effectiveAuth = await this.resolveAuth(baseUrl, auth);
    const useGraphql =
      spec.options?.["mode"] === "graphql" || spec.parsed.host.toLowerCase().includes("xray.cloud.getxray.app");

    let tests: Array<Record<string, unknown>> = [];
    if (useGraphql) {
      const limit = Number(spec.options?.["limit"] ?? 100);
      const maxPages = Number(spec.options?.["maxPages"] ?? 20);
      let start = 0;
      for (let page = 0; page < maxPages; page++) {
        const gqlRes = await almFetch<{
          data?: { getTests?: { total?: number; results?: Array<Record<string, unknown>> } };
        }>(`${baseUrl}/graphql`, {
          method: "POST",
          auth: effectiveAuth,
          body: {
            query: `query($jql: String, $limit: Int!, $start: Int!) { getTests(jql: $jql, limit: $limit, start: $start) { total results { issueId jira(fields: ["key","summary","description","status","updated"]) testType { name } } } }`,
            variables: { jql: spec.query?.trim() || "", limit, start },
          },
        });
        if (!gqlRes.ok) {
          throw new Error(`Xray GraphQL query failed (${gqlRes.status}): ${gqlRes.text.slice(0, 300)}`);
        }
        const batch = gqlRes.json().data?.getTests?.results ?? [];
        for (const row of batch) {
          const jira = (row["jira"] ?? {}) as Record<string, unknown>;
          const statusObj = jira["status"] as Record<string, unknown> | string | undefined;
          const tt = row["testType"] as Record<string, unknown> | undefined;
          tests.push({
            key: jira["key"] ?? row["issueId"],
            summary: jira["summary"],
            description: jira["description"],
            status: typeof statusObj === "string" ? statusObj : statusObj?.["name"],
            updated: jira["updated"],
            testType: tt?.["name"],
          });
        }
        start += batch.length;
        const total = gqlRes.json().data?.getTests?.total ?? 0;
        if (batch.length === 0 || start >= total) break;
      }
    } else {
      const url = new URL(`${baseUrl}/tests`);
      if (spec.query?.trim()) url.searchParams.set("jql", spec.query.trim());
      if (cursor) url.searchParams.set("modifiedSince", cursor);

      const res = await almFetch<{ tests?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        url.toString(),
        { auth: effectiveAuth },
      );
      if (!res.ok) {
        throw new Error(`Xray tests fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
      }

      const raw = res.json();
      tests = Array.isArray(raw) ? raw : Array.isArray(raw.tests) ? raw.tests : [];
    }
    const upserted: AlmArtifact[] = [];
    const links: AlmLink[] = [];
    let latestModified = cursor;

    for (const tc of tests) {
      const key = String(tc["key"] ?? tc["issueId"] ?? "");
      if (!key) continue;
      const modified = typeof tc["updated"] === "string" ? tc["updated"] : undefined;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }

      upserted.push({
        externalId: key,
        kind: "test_case",
        uri: `${baseUrl}/tests/${encodeURIComponent(key)}`,
        webUrl: typeof tc["url"] === "string" ? tc["url"] : undefined,
        title: String(tc["summary"] ?? key),
        text: String(tc["description"] ?? ""),
        status: String(tc["status"] ?? "Active"),
        revision: modified,
        modifiedAt: modified,
        attributes: {
          testType: String(tc["testType"] ?? "Automated"),
        },
      });

      const reqs = Array.isArray(tc["requirements"]) ? tc["requirements"].map(String) : [];
      for (const reqId of reqs) {
        links.push({
          sourceId: key,
          targetId: reqId,
          relation: "verifies",
        });
      }
    }

    return {
      upserted,
      deletedIds: [],
      links,
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      snapshotVersion: `xray@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(`${baseUrl}/tests/${encodeURIComponent(link.sourceId)}/links`, {
        method: "POST",
        auth,
        body: { targetId: link.targetId, relation: link.relation },
      });
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
    const { baseUrl } = this.apiBase(spec);
    const projectKey = String(spec.options?.["projectKey"] ?? spec.parsed.params["project"] ?? "ENG");
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(`${baseUrl}/import/execution`, {
        method: "POST",
        auth,
        body: {
          info: {
            project: projectKey,
            summary: run.title,
            description: `ModelScript Run ${run.runId} | Commit: ${run.commitSha ?? "n/a"} | DAE: ${run.daeHash ?? "n/a"}`,
            startDate: run.timestamp,
          },
          tests: run.verifiesIds.map((testKey) => ({
            testKey,
            status: mapXrayStatus(run.status),
            comment: `Metrics: ${JSON.stringify(run.metrics)}${run.details ? ` | ${run.details}` : ""}`,
          })),
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["key"] !== undefined || data["id"] !== undefined) {
            createdIds[run.runId] = String(data["key"] ?? data["id"]);
          }
        } catch {
          // Ignore parse failure
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }
}
