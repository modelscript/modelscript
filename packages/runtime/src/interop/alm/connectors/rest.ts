// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Declarative RESTful Repository Connector (Syndeia RESTful Repository equivalent).
 *
 * Allows connecting any COTS, GOTS, or internal REST/JSON API (e.g., GitHub/GitLab Issues,
 * PTC Onshape, Confluence, JFrog Artifactory, Apache Airflow, or custom databases) via
 * `modelscript.yaml` field-path options without writing a custom TypeScript connector.
 *
 * Supported `spec.options`:
 * - `itemsPath`: dot-path to the array of items in the JSON response (omit if root is an array)
 * - `idField`: dot-path to external ID (default `"id"`)
 * - `titleField`: dot-path to title (default `"title"`)
 * - `textField`: dot-path to body/description (default `"description"`)
 * - `statusField`: dot-path to status (default `"status"`)
 * - `updatedField`: dot-path to ISO timestamp (default `"updatedAt"`)
 * - `webUrlField`: dot-path to clickable web URL (default `"url"`)
 * - `kind`: `"requirement" | "change_request" | "test_case" | "document_section"` (default `"requirement"`)
 * - `cursorParam`: query parameter name for incremental sync (default `"since"`)
 * - `pushLinksUrl`: optional URL (absolute or relative to origin) for `pushLinks`
 * - `pushRunsUrl`: optional URL (absolute or relative to origin) for `pushVerificationRuns`
 */

import type {
  AlmArtifact,
  AlmArtifactKind,
  AlmDelta,
  AlmLink,
  AlmVerificationRun,
  AuthContext,
  PushResult,
  RemoteCapabilities,
} from "../alm_ir.js";
import type { AlmConnector, ResolvedRemoteSpec } from "../connector_spi.js";
import { almFetch } from "../http_client.js";

function readDotPath(obj: unknown, dotPath: string): unknown {
  if (!dotPath) return obj;
  let cur: unknown = obj;
  for (const part of dotPath.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolvePushUrl(origin: string, configured: string | undefined, fallback: string): string {
  if (!configured) return fallback;
  if (configured.startsWith("http://") || configured.startsWith("https://")) return configured;
  return `${origin}${configured.startsWith("/") ? configured : `/${configured}`}`;
}

export class GenericRestAlmConnector implements AlmConnector {
  readonly protocol = "rest";
  readonly aliases = ["http", "openapi"] as const;

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const res = await almFetch(spec.parsed.url, { method: "GET", auth });
    return {
      protocol: this.protocol,
      serverName: `RESTful Repository (${spec.parsed.host})`,
      serverVersion: res.ok ? "HTTP 200" : `HTTP ${res.status}`,
      supportsIncrementalDelta: Boolean(spec.options?.["cursorParam"] ?? true),
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: Boolean(spec.options?.["pushRunsUrl"]),
      supportsLinkPush: Boolean(spec.options?.["pushLinksUrl"]),
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const url = new URL(spec.parsed.url);
    const cursorParam = String(spec.options?.["cursorParam"] ?? "since");
    if (cursor && cursorParam) {
      url.searchParams.set(cursorParam, cursor);
    }
    if (spec.query?.trim()) {
      const queryParam = String(spec.options?.["queryParam"] ?? "q");
      url.searchParams.set(queryParam, spec.query.trim());
    }

    const res = await almFetch<unknown>(url.toString(), { auth });
    if (!res.ok) {
      throw new Error(`RESTful repository fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const payload = res.json();
    const itemsPath = typeof spec.options?.["itemsPath"] === "string" ? spec.options["itemsPath"] : "";
    const rawItems = itemsPath ? readDotPath(payload, itemsPath) : payload;
    const items = Array.isArray(rawItems) ? rawItems : [];

    const idField = String(spec.options?.["idField"] ?? "id");
    const titleField = String(spec.options?.["titleField"] ?? "title");
    const textField = String(spec.options?.["textField"] ?? "description");
    const statusField = String(spec.options?.["statusField"] ?? "status");
    const updatedField = String(spec.options?.["updatedField"] ?? "updatedAt");
    const webUrlField = String(spec.options?.["webUrlField"] ?? "url");
    const kind = (spec.options?.["kind"] as AlmArtifactKind | undefined) ?? "requirement";

    const upserted: AlmArtifact[] = [];
    let latestUpdated = cursor;

    for (const item of items) {
      const idVal = readDotPath(item, idField);
      if (idVal === undefined || idVal === null || String(idVal).length === 0) continue;
      const externalId = String(idVal);
      const updatedRaw = readDotPath(item, updatedField);
      const updated = typeof updatedRaw === "string" ? updatedRaw : undefined;
      if (updated && (!latestUpdated || updated > latestUpdated)) {
        latestUpdated = updated;
      }
      const webUrlRaw = readDotPath(item, webUrlField);

      upserted.push({
        externalId,
        kind,
        uri: `${url.origin}${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(externalId)}`,
        webUrl: typeof webUrlRaw === "string" ? webUrlRaw : undefined,
        title: String(readDotPath(item, titleField) ?? externalId),
        text: String(readDotPath(item, textField) ?? ""),
        status: String(readDotPath(item, statusField) ?? "Active"),
        revision: updated,
        modifiedAt: updated,
        attributes: {
          sourceHost: spec.parsed.host,
        },
      });
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `rest@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const parsed = new URL(spec.parsed.url);
    const endpoint = resolvePushUrl(
      parsed.origin,
      typeof spec.options?.["pushLinksUrl"] === "string" ? spec.options["pushLinksUrl"] : undefined,
      `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/links`,
    );

    let pushed = 0;
    const errors: PushResult["errors"] = [];
    for (const link of links) {
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        body: link,
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
    const parsed = new URL(spec.parsed.url);
    const endpoint = resolvePushUrl(
      parsed.origin,
      typeof spec.options?.["pushRunsUrl"] === "string" ? spec.options["pushRunsUrl"] : undefined,
      `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/verification-runs`,
    );

    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(endpoint, {
        method: "POST",
        auth,
        body: run,
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["id"] !== undefined) createdIds[run.runId] = String(data["id"]);
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
