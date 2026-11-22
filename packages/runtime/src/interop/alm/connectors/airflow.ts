// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Apache Airflow (Stable REST API v1) Digital Pipeline Connector.
 *
 * Supports:
 * - Pulling DAG definitions (`/api/v1/dags`) as digital-thread pipeline artifacts
 * - Triggering DAG runs (`POST /api/v1/dags/{dag_id}/dagRuns`) when pushing verification runs
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

export class AirflowAlmConnector implements AlmConnector {
  readonly protocol = "airflow";

  private apiBase(spec: ResolvedRemoteSpec): { baseUrl: string; origin: string; dagId?: string | undefined } {
    const parsed = new URL(spec.parsed.url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    const baseUrl = trimmed.includes("/api/v1")
      ? `${parsed.origin}${trimmed.replace(/\/api\/v1.*$/, "/api/v1")}`
      : `${parsed.origin}/api/v1`;
    const dagId = spec.options?.["dagId"] !== undefined ? String(spec.options["dagId"]) : spec.parsed.params["dagId"];
    return { baseUrl, origin: parsed.origin, dagId };
  }

  async discover(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<RemoteCapabilities> {
    const { baseUrl } = this.apiBase(spec);
    const res = await almFetch<Record<string, unknown>>(`${baseUrl}/version`, { auth });
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
      serverName: "Apache Airflow",
      serverVersion,
      supportsIncrementalDelta: false,
      supportsBaselines: false,
      supportsWorkingSets: false,
      supportsVerificationPush: true,
      supportsLinkPush: false,
      supportsArtifactUpsert: false,
    };
  }

  async fetchDelta(spec: ResolvedRemoteSpec, auth: AuthContext): Promise<AlmDelta> {
    const { baseUrl, origin } = this.apiBase(spec);
    const url = new URL(`${baseUrl}/dags`);
    if (spec.options?.["tags"]) url.searchParams.set("tags", String(spec.options["tags"]));
    url.searchParams.set("limit", String(spec.options?.["limit"] ?? 100));

    const res = await almFetch<{ dags?: Array<Record<string, unknown>> }>(url.toString(), { auth });
    if (!res.ok) {
      throw new Error(`Airflow DAGs fetch failed (${res.status}): ${res.text.slice(0, 300)}`);
    }

    const dags = res.json().dags ?? [];
    const upserted: AlmArtifact[] = [];

    for (const dag of dags) {
      const id = String(dag["dag_id"] ?? "");
      if (!id) continue;
      const isPaused = Boolean(dag["is_paused"]);
      upserted.push({
        externalId: id,
        kind: "document_section",
        uri: `${baseUrl}/dags/${encodeURIComponent(id)}`,
        webUrl: `${origin}/dags/${encodeURIComponent(id)}/grid`,
        title: String(dag["dag_display_name"] ?? id),
        text: String(dag["description"] ?? `Airflow DAG ${id}`),
        status: isPaused ? "Paused" : "Active",
        attributes: {
          isPaused,
          scheduleInterval: String(dag["timetable_description"] ?? ""),
        },
      });
    }

    return {
      upserted,
      deletedIds: [],
      links: [],
      isFullSnapshot: true,
      snapshotVersion: `airflow@${new Date().toISOString()}`,
    };
  }

  async pushLinks(_spec: ResolvedRemoteSpec, _auth: AuthContext, links: AlmLink[]): Promise<PushResult> {
    return { pushed: 0, skipped: links.length, errors: [] };
  }

  async pushVerificationRuns(
    spec: ResolvedRemoteSpec,
    auth: AuthContext,
    runs: AlmVerificationRun[],
  ): Promise<PushResult> {
    const { baseUrl, dagId } = this.apiBase(spec);
    let pushed = 0;
    let skipped = 0;
    const errors: PushResult["errors"] = [];
    const createdIds: Record<string, string> = {};

    for (const run of runs) {
      const targetDag = dagId ?? run.verifiesIds[0];
      if (!targetDag) {
        skipped++;
        continue;
      }
      const res = await almFetch<Record<string, unknown>>(`${baseUrl}/dags/${encodeURIComponent(targetDag)}/dagRuns`, {
        method: "POST",
        auth,
        body: {
          dag_run_id: `modelscript_${run.runId}`,
          conf: {
            runId: run.runId,
            title: run.title,
            status: run.status,
            commitSha: run.commitSha,
            daeHash: run.daeHash,
            metrics: run.metrics,
          },
        },
      });
      if (res.ok) {
        pushed++;
        try {
          const data = res.json();
          if (data["dag_run_id"]) createdIds[run.runId] = String(data["dag_run_id"]);
        } catch {
          // Ignore parse failure
        }
      } else {
        errors.push({ id: run.runId, message: res.text.slice(0, 200), statusCode: res.status });
      }
    }

    return { pushed, skipped, errors, createdIds };
  }
}
