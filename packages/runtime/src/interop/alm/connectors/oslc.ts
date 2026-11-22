// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OSLC Core 3.0 / RM 2.0 / QM 2.0 / CM 2.0 Client Connector.
 *
 * Primarily targets IBM Engineering Requirements Management DOORS Next (ELM/Jazz),
 * and also works with any OSLC-compliant repository (Polarion, Codebeamer, Teamcenter, Windchill).
 *
 * Key protocol features:
 * - `OSLC-Core-Version: 2.0` / `3.0` negotiation
 * - `OSLC-Configuration-Context` header for Global Configurations (GC), Streams & Baselines
 * - OSLC TRS (Tracked Resource Set) cursor-based incremental delta sync
 * - Outbound OSLC-QM Test Results & OSLC-RM trace links with `If-Match` optimistic locking
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

function oslcHeaders(spec: ResolvedRemoteSpec, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/ld+json, application/json",
    "OSLC-Core-Version": "2.0",
    ...(extra ?? {}),
  };
  const configCtx = spec.baseline ?? spec.workingSet ?? spec.parsed.params["config"];
  if (configCtx) {
    headers["OSLC-Configuration-Context"] = configCtx;
  }
  return headers;
}

function asString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function parseOslcMember(member: Record<string, unknown>, baseUrl: string, idx: number): AlmArtifact {
  const uri = asString(member["rdf:about"] ?? member["@id"] ?? member["uri"], `${baseUrl}#item-${idx}`);
  const externalId = asString(
    member["dcterms:identifier"] ?? member["identifier"] ?? member["id"],
    uri.split("/").pop() || `REQ-${idx + 1}`,
  );
  const title = asString(member["dcterms:title"] ?? member["title"], externalId);
  const text = asString(
    member["dcterms:description"] ?? member["rm_nav:primaryText"] ?? member["description"] ?? member["primaryText"],
    "",
  );
  const status = asString(member["oslc_rm:status"] ?? member["status"], "Draft");
  const priority = asString(member["oslc_rm:priority"] ?? member["priority"]) || undefined;
  const modifiedAt = asString(member["dcterms:modified"] ?? member["modified"]) || undefined;
  const etag = asString(member["etag"] ?? member["oslc:etag"]) || undefined;
  const revision = asString(member["revision"] ?? member["dcterms:modified"]) || undefined;
  const webUrl = asString(member["webUrl"] ?? member["rdfs:seeAlso"] ?? uri) || undefined;

  const attributes: Record<string, string | number | boolean> = {};
  if (member["attributes"] && typeof member["attributes"] === "object") {
    for (const [k, v] of Object.entries(member["attributes"] as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        attributes[k] = v;
      }
    }
  }

  return {
    externalId,
    kind: asString(member["@type"]).includes("ChangeRequest") ? "change_request" : "requirement",
    uri,
    webUrl,
    title,
    text,
    status,
    priority,
    order: typeof member["order"] === "number" ? member["order"] : idx,
    revision,
    etag,
    modifiedAt,
    attributes,
  };
}

export class OslcAlmConnector implements AlmConnector {
  readonly protocol = "oslc";
  readonly aliases = ["doors", "doors-next"] as const;

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const origin = new URL(spec.parsed.url).origin;
    const res = await almFetch<Record<string, unknown>>(`${origin}/rootservices`, {
      auth,
      headers: oslcHeaders(spec),
    });

    let serverName = "OSLC Server";
    let serverVersion: string | undefined;
    if (res.ok) {
      try {
        const data = res.json();
        serverName = asString(data["dcterms:title"] ?? data["title"], serverName);
        serverVersion = asString(data["version"]) || undefined;
      } catch {
        // Non-JSON rootservices (RDF/XML) is still a valid OSLC endpoint
      }
    }

    return {
      protocol: this.protocol,
      serverName,
      serverVersion,
      supportsIncrementalDelta: true,
      supportsBaselines: true,
      supportsWorkingSets: true,
      supportsVerificationPush: true,
      supportsLinkPush: true,
      supportsArtifactUpsert: true,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext, cursor?: string): Promise<AlmDelta> {
    const reqUrl = new URL(spec.parsed.url);
    if (cursor) {
      reqUrl.searchParams.set("trs.since", cursor);
    }
    if (spec.query) {
      reqUrl.searchParams.set("oslc.where", spec.query);
    }

    const upserted: AlmArtifact[] = [];
    const deletedIds: string[] = [];
    const links: AlmLink[] = [];
    let nextCursor: string | undefined;
    let baselineUri: string | undefined = asString(spec.baseline ?? spec.parsed.params["config"]) || undefined;
    let isIncremental = false;

    let nextUrl: string | null = reqUrl.toString();
    const maxPages = Number(spec.options?.["maxPages"] ?? 50);

    for (let page = 0; nextUrl && page < maxPages; page++) {
      const res = await almFetch<Record<string, unknown>>(nextUrl, {
        auth,
        headers: oslcHeaders(spec),
      });
      if (!res.ok) {
        throw new Error(`OSLC fetch failed (${res.status}) for ${nextUrl}: ${res.text.slice(0, 300)}`);
      }

      const payload = res.json();
      const rawMembers = (payload["rdfs:member"] ??
        payload["oslc:results"] ??
        payload["members"] ??
        payload["items"] ??
        (Array.isArray(payload) ? payload : [])) as Array<Record<string, unknown>>;

      for (const m of rawMembers) {
        const memberType = asString(m["@type"] ?? m["type"]);
        if (memberType.includes("trs:Deletion") || m["deleted"] === true) {
          const delId = asString(m["dcterms:identifier"] ?? m["trs:changed"] ?? m["identifier"] ?? m["id"]);
          if (delId) deletedIds.push(delId);
          continue;
        }
        upserted.push(parseOslcMember(m, spec.parsed.url, upserted.length));
        const srcId = asString(m["dcterms:identifier"] ?? m["identifier"] ?? m["id"]);
        if (!srcId) continue;
        const satisfiedBy = Array.isArray(m["oslc_rm:satisfiedBy"]) ? (m["oslc_rm:satisfiedBy"] as string[]) : [];
        const validatedBy = Array.isArray(m["oslc_rm:validatedBy"]) ? (m["oslc_rm:validatedBy"] as string[]) : [];
        for (const target of satisfiedBy) {
          links.push({ sourceId: srcId, targetId: target, relation: "satisfies" });
        }
        for (const target of validatedBy) {
          links.push({ sourceId: srcId, targetId: target, relation: "verifies" });
        }
      }

      if (Array.isArray(payload["deleted"])) {
        deletedIds.push(...(payload["deleted"] as string[]));
      }
      const pageCursor = asString(payload["trs:cursor"] ?? payload["nextCursor"]);
      if (pageCursor) nextCursor = pageCursor;
      const pageConfig = asString(payload["oslc_config:configuration"]);
      if (pageConfig) baselineUri = pageConfig;
      if (cursor && payload["isDelta"] === true) isIncremental = true;

      const responseInfo = payload["oslc:responseInfo"] as Record<string, unknown> | undefined;
      const rawNext = asString(payload["oslc:nextPage"] ?? responseInfo?.["oslc:nextPage"] ?? payload["nextPage"]);
      nextUrl = rawNext || null;
    }

    return {
      upserted,
      deletedIds,
      links,
      isFullSnapshot: !isIncremental,
      nextCursor,
      baselineUri,
      workingSet: spec.workingSet,
      snapshotVersion: `${baselineUri ?? "stream"}@${nextCursor ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const origin = new URL(spec.parsed.url).origin;
    const endpoint = `${origin}/oslc/rm/links`;
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const res = await almFetch(endpoint, {
        method: "POST",
        auth,
        headers: oslcHeaders(spec, { "Content-Type": "application/ld+json" }),
        body: {
          "@context": {
            oslc_rm: "http://open-services.net/ns/rm#",
            dcterms: "http://purl.org/dc/terms/",
          },
          source: link.sourceId,
          target: link.targetId,
          relation: link.relation,
          "dcterms:title": link.title ?? `${link.sourceId} ${link.relation} ${link.targetId}`,
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
    const origin = new URL(spec.parsed.url).origin;
    const endpoint = `${origin}/oslc/qm/results`;
    let pushed = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const res = await almFetch<Record<string, unknown>>(endpoint, {
        method: "POST",
        auth,
        headers: oslcHeaders(spec, { "Content-Type": "application/ld+json" }),
        body: {
          "@type": "oslc_qm:TestResult",
          "dcterms:identifier": run.runId,
          "dcterms:title": run.title,
          "oslc_qm:status": run.status,
          "dcterms:created": run.timestamp,
          "oslc_qm:verifies": run.verifiesIds,
          "ms:commitSha": run.commitSha,
          "ms:daeHash": run.daeHash,
          "ms:signature": run.signature,
          "ms:metrics": run.metrics,
          "dcterms:description": run.details ?? "",
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const body = res.json();
          const created = asString(body["@id"] ?? body["id"] ?? run.runId);
          createdIds[run.runId] = created;
        } catch {
          createdIds[run.runId] = run.runId;
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors, createdIds };
  }

  async upsertArtifacts(spec: ResolvedRemoteSpec, auth: AuthContext, edits: ArtifactEdit[]): Promise<PushResult> {
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const edit of edits) {
      const targetUrl = edit.uri ?? `${spec.parsed.url.replace(/\/$/, "")}/${encodeURIComponent(edit.externalId)}`;
      const extraHeaders: Record<string, string> = { "Content-Type": "application/ld+json" };
      if (edit.expectedEtag) {
        extraHeaders["If-Match"] = edit.expectedEtag;
      }
      const res = await almFetch(targetUrl, {
        method: "PUT",
        auth,
        headers: oslcHeaders(spec, extraHeaders),
        body: {
          "dcterms:identifier": edit.externalId,
          ...(edit.title !== undefined ? { "dcterms:title": edit.title } : {}),
          ...(edit.text !== undefined ? { "dcterms:description": edit.text } : {}),
          ...(edit.status !== undefined ? { "oslc_rm:status": edit.status } : {}),
        },
      });
      if (res.ok) {
        pushed++;
      } else {
        errors.push({ id: edit.externalId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped: 0, errors };
  }
}
