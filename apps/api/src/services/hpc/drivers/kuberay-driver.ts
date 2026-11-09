// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { calculateCostCredits, getComputeProfile } from "../compute-profiles.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcJobSpec,
  HpcJobState,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { quoteShellArg } from "../sbatch-generator.js";

export interface KubeRayOptions {
  baseUrl: string; // e.g. "http://localhost:8265" or "http://kuberay-head.cluster:8265"
  token?: string | undefined; // optional auth bearer token
  timeoutMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
}

interface RayJobResponse {
  job_id?: string | undefined;
  submission_id?: string | undefined;
  status?: string | undefined;
  message?: string | undefined;
  error_type?: string | undefined;
  start_time?: number | undefined;
  end_time?: number | undefined;
  entrypoint?: string | undefined;
}

/**
 * Cloud-native KubeRay / Ray Job Submission Driver.
 * Dispatches distributed python, simulation, and surrogate workloads to Ray clusters
 * via the Ray Job Submission REST API.
 */
export class KubeRayDriver implements HpcDriver {
  readonly type = "kuberay" as const;
  private readonly baseUrl: string;
  private readonly token?: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: KubeRayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async request<T = Record<string, unknown>>(
    endpoint: string,
    method = "GET",
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const init: RequestInit = {
        method,
        headers: this.getHeaders(),
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }
      const res = await this.fetchFn(url, init);
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { rawText: text };
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || `Ray Job API error: HTTP ${res.status} (${method} ${endpoint})`);
      }

      return { status: res.status, data: data as T };
    } finally {
      clearTimeout(timer);
    }
  }

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    fs.mkdirSync(spec.workingDir, { recursive: true });

    const safeCommand = quoteShellArg(spec.command);
    const fullArgs = spec.args.map((a) => quoteShellArg(String(a))).join(" ");
    const entrypoint = fullArgs ? `${safeCommand} ${fullArgs}` : safeCommand;

    const payload = {
      entrypoint,
      submission_id: spec.jobId,
      runtime_env: {
        env_vars: spec.env || {},
      },
      num_cpus: spec.resources.cpusPerTask || 1,
      num_gpus: spec.resources.gpus || 0,
    };

    const res = await this.request<{ submission_id?: string; job_id?: string }>("/api/jobs/", "POST", payload);
    const nativeJobId = res.data.submission_id || res.data.job_id || spec.jobId;
    const profile = getComputeProfile(spec.profileId);

    return {
      nativeJobId,
      driverType: "kuberay",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: profile.costCreditsPerHour,
    };
  }

  public async pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }> {
    try {
      const res = await this.request<RayJobResponse>(`/api/jobs/${nativeJobId}`, "GET");
      const rawStatus = (res.data.status || "").toUpperCase();

      let state: HpcJobState = "FAILED";
      let exitCode: number | undefined;

      if (rawStatus === "PENDING") {
        state = "PENDING";
      } else if (rawStatus === "RUNNING") {
        state = "RUNNING";
      } else if (rawStatus === "SUCCEEDED") {
        state = "COMPLETED";
        exitCode = 0;
      } else if (rawStatus === "STOPPED") {
        state = "CANCELLED";
        exitCode = 130;
      } else {
        state = "FAILED";
        exitCode = 1;
      }

      return { state, exitCode };
    } catch {
      return { state: "FAILED", exitCode: -1 };
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    try {
      await this.request(`/api/jobs/${nativeJobId}/stop`, "POST");
      return true;
    } catch {
      return false;
    }
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    try {
      const res = await this.request<RayJobResponse>(`/api/jobs/${nativeJobId}`, "GET");
      const startMs = res.data.start_time ?? 0;
      const endMs = res.data.end_time ?? Date.now();
      const elapsedSeconds = startMs > 0 && endMs >= startMs ? Math.round((endMs - startMs) / 1000) : 60;

      const costCredits = calculateCostCredits(elapsedSeconds, profile);
      const isSuccess = res.data.status === "SUCCEEDED";

      return {
        wallClockSeconds: elapsedSeconds,
        cpuCoreSeconds: elapsedSeconds * profile.cpus,
        peakMemoryMb: profile.memoryMb,
        gpuSeconds: profile.gpus ? elapsedSeconds * profile.gpus : 0,
        costCredits,
        nativeJobId,
        exitCode: isSuccess ? 0 : 1,
      };
    } catch {
      return {
        wallClockSeconds: 0,
        cpuCoreSeconds: 0,
        peakMemoryMb: profile.memoryMb,
        costCredits: 0,
        nativeJobId,
        exitCode: -1,
      };
    }
  }

  public getLogPath(nativeJobId: string, workingDir: string): string {
    return path.join(workingDir, `ray-${nativeJobId}.out`);
  }
}
