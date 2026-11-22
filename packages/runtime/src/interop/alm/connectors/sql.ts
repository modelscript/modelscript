// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Relational Database / SQL-over-HTTP (PostgREST / Hasura / SQLite-HTTP / JDBC Proxy) Connector.
 *
 * Keeps `@modelscript/runtime` 100% browser/WASM-safe with zero native DB driver dependencies.
 * Supports:
 * - Pulling table rows (`GET <url>`) or executing parameterized SQL (`POST <url>` when `options.sqlMode === "query"`)
 * - Mapping row columns to `AlmArtifact` via `idField`, `titleField`, `textField`, `statusField`, `updatedField`
 * - Bidirectional row upsert (`upsertArtifacts`) via `POST`/`PATCH`
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

export class SqlAlmConnector implements AlmConnector {
  readonly protocol = "sql";
  readonly aliases = ["postgres", "mysql", "jdbc"] as const;

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const res = await almFetch(spec.parsed.url, { method: "GET", auth });
    return {
      protocol: this.protocol,
      serverName: `SQL Repository (${spec.parsed.host})`,
      serverVersion: res.ok ? "HTTP/SQL" : `HTTP ${res.status}`,
      supportsIncrementalDelta: true,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const updatedField = String(spec.options?.["updatedField"] ?? "updated_at");
    const idField = String(spec.options?.["idField"] ?? "id");
    const titleField = String(spec.options?.["titleField"] ?? "title");
    const textField = String(spec.options?.["textField"] ?? "description");
    const statusField = String(spec.options?.["statusField"] ?? "status");
    const kind = (spec.options?.["kind"] as AlmArtifactKind | undefined) ?? "requirement";

    let res;
    if (spec.options?.["sqlMode"] === "query" || spec.query?.trim().toUpperCase().startsWith("SELECT ")) {
      res = await almFetch<{ rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        spec.parsed.url,
        {
          method: "POST",
          auth,
          body: { sql: spec.query ?? "SELECT * FROM requirements", since: cursor },
        },
      );
    } else {
      const url = new URL(spec.parsed.url);
      if (cursor) url.searchParams.set(updatedField, `gt.${cursor}`);
      res = await almFetch<{ rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(url.toString(), {
        auth,
      });
    }

    if (!res.ok) {
      throw new Error(`SQL repository fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const raw = res.json();
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : [];
    const upserted: AlmArtifact[] = [];
    let latestUpdated = cursor;

    for (const row of rows) {
      const idVal = row[idField];
      if (idVal === undefined || idVal === null || String(idVal).length === 0) continue;
      const externalId = String(idVal);
      const updated = typeof row[updatedField] === "string" ? String(row[updatedField]) : undefined;
      if (updated && (!latestUpdated || updated > latestUpdated)) {
        latestUpdated = updated;
      }

      const attrs: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          attrs[k] = v;
        }
      }

      upserted.push({
        externalId,
        kind,
        uri: `${spec.parsed.url.replace(/\/+$/, "")}/${encodeURIComponent(externalId)}`,
        title: String(row[titleField] ?? externalId),
        text: String(row[textField] ?? ""),
        status: String(row[statusField] ?? "Active"),
        revision: updated,
        modifiedAt: updated,
        attributes: attrs,
      });
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestUpdated,
      snapshotVersion: `sql@${latestUpdated ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const endpoint = String(spec.options?.["linksUrl"] ?? `${spec.parsed.url.replace(/\/+$/, "")}_links`);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(endpoint, { method: "POST", auth, body: link });
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
    const endpoint = String(spec.options?.["runsUrl"] ?? `${spec.parsed.url.replace(/\/+$/, "")}_runs`);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const run of runs) {
      const res = await almFetch(endpoint, { method: "POST", auth, body: run });
      if (res.ok) pushed++;
      else errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
    }
    return { pushed, skipped: 0, errors };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    const idField = String(spec.options?.["idField"] ?? "id");
    const titleField = String(spec.options?.["titleField"] ?? "title");
    const textField = String(spec.options?.["textField"] ?? "description");
    const statusField = String(spec.options?.["statusField"] ?? "status");
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const url = new URL(spec.parsed.url);
      url.searchParams.set(idField, `eq.${edit.externalId}`);
      const patch: Record<string, unknown> = {};
      if (edit.title !== undefined) patch[titleField] = edit.title;
      if (edit.text !== undefined) patch[textField] = edit.text;
      if (edit.status !== undefined) patch[statusField] = edit.status;

      const res = await almFetch(url.toString(), {
        method: "PATCH",
        auth,
        headers: edit.expectedEtag ? { "If-Match": edit.expectedEtag } : undefined,
        body: patch,
      });
      if (res.ok) pushed++;
      else errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
    }

    return { pushed, skipped: 0, errors };
  }
}
