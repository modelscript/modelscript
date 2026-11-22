// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JFrog Artifactory (REST API) Binary & FMU Provenance Connector.
 *
 * Supports:
 * - Pulling repository artifacts (`/api/storage/{repo}/{path}?list&deep=1`) with SHA-256 checksums
 * - Pushing traceability & verification attestation properties directly onto artifacts
 *   (`PUT /api/storage/{repo}/{path}?properties=...`)
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

export class ArtifactoryAlmConnector implements AlmConnector {
  readonly protocol = "artifactory";
  readonly aliases = ["jfrog"] as const;

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string; repoPath: string } {
    const parsed = new URL(spec.parsed.url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    const idx = trimmed.indexOf("/artifactory/");
    if (idx >= 0) {
      return {
        baseUrl: `${parsed.origin}${trimmed.slice(0, idx + "/artifactory".length)}`,
        repoPath: trimmed.slice(idx + "/artifactory/".length),
      };
    }
    return {
      baseUrl: `${parsed.origin}/artifactory`,
      repoPath: trimmed.replace(/^\/+/, ""),
    };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${baseUrl}/api/system/version`, { auth });
    let serverVersion: string | undefined;
    if (res.ok) {
      try {
        const info = res.json();
        if (info["version"]) serverVersion = String(info["version"]);
      } catch {
        // Ignore parse failure
      }
    }
    return {
      protocol: this.protocol,
      serverName: "JFrog Artifactory",
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
    const { baseUrl, repoPath } = this.apiBase(spec);
    const url = `${baseUrl}/api/storage/${repoPath}?list&deep=1`;
    const res = await almFetch<{ files?: Array<Record<string, unknown>> }>(url, { auth });
    if (!res.ok) {
      throw new Error(`Artifactory storage list failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const files = res.json().files ?? [];
    const upserted: AlmArtifact[] = [];
    let latestModified = cursor;

    for (const file of files) {
      if (file["folder"] === true) continue;
      const relUri = String(file["uri"] ?? "");
      if (!relUri) continue;
      const modified = typeof file["lastModified"] === "string" ? file["lastModified"] : undefined;
      if (cursor && modified && modified <= cursor) continue;
      if (modified && (!latestModified || modified > latestModified)) {
        latestModified = modified;
      }
      const cleanPath = `${repoPath}${relUri.startsWith("/") ? relUri : `/${relUri}`}`;
      const sha256 = String(file["sha2"] ?? file["sha256"] ?? "");

      upserted.push({
        externalId: cleanPath,
        kind: "document_section",
        uri: `${baseUrl}/api/storage/${cleanPath}`,
        webUrl: `${baseUrl}/${cleanPath}`,
        title: relUri.split("/").filter(Boolean).pop() ?? cleanPath,
        text: `Artifact ${cleanPath} (size=${String(file["size"] ?? 0)}, sha256=${sha256 || "n/a"})`,
        status: "Published",
        revision: sha256 ? sha256.slice(0, 12) : modified,
        modifiedAt: modified,
        attributes: {
          sha256,
          sizeBytes: Number(file["size"] ?? 0),
        },
      });
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: !cursor,
      nextCursor: latestModified,
      snapshotVersion: `artifactory@${latestModified ?? new Date().toISOString()}`,
    };
  }

  async pushLinks(spec: ResolvedRemoteSpec, auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    const { baseUrl } = this.apiBase(spec);
    let pushed = 0;
    const errors: PushResult["errors"] = [];

    for (const link of links) {
      const prop = `modelscript.${link.relation}=${encodeURIComponent(link.sourceId)}`;
      const endpoint = `${baseUrl}/api/storage/${link.targetId.replace(/^\/+/, "")}?properties=${prop}`;
      const res = await almFetch(endpoint, { method: "PUT", auth });
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
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];

    for (const run of runs) {
      if (run.verifiesIds.length === 0) {
        skipped++;
        continue;
      }
      for (const artifactPath of run.verifiesIds) {
        const props = [
          `modelscript.verify.status=${encodeURIComponent(run.status)}`,
          `modelscript.verify.runId=${encodeURIComponent(run.runId)}`,
          ...(run.daeHash ? [`modelscript.verify.daeHash=${encodeURIComponent(run.daeHash)}`] : []),
        ].join(";");
        const endpoint = `${baseUrl}/api/storage/${artifactPath.replace(/^\/+/, "")}?properties=${props}`;
        const res = await almFetch(endpoint, { method: "PUT", auth });
        if (res.ok) pushed++;
        else
          errors.push({ id: `${run.runId}:${artifactPath}`, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped, errors };
  }
}
