// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { calculateCostCredits } from "../compute-profiles.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcJobSpec,
  HpcJobState,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "../hpc-types.js";
import { generateSbatchScript } from "../sbatch-generator.js";

export interface SlurmRestOptions {
  baseUrl: string; // e.g. "http://localhost:6820" or "https://slurm.cluster.internal"
  apiVersion?: "v0.0.38" | "v0.0.39" | "v0.0.40" | string; // default: "v0.0.39"
  jwtToken?: string | undefined; // Slurm JWT auth token
  username?: string | undefined; // Slurm user name (default: "slurm")
  timeoutMs?: number | undefined; // HTTP timeout in ms (default: 10000)
  fetchFn?: typeof fetch | undefined; // Injectable fetch for unit tests
}

export interface SlurmPartitionInfo {
  name: string;
  state: string;
  totalNodes: number;
  totalCpus: number;
  maxTimeMinutes: number;
  defaultMemoryMb?: number | undefined;
}

export interface SlurmNodeInfo {
  name: string;
  state: string;
  cpus: number;
  realMemoryMb: number;
  partitions: string[];
}

/**
 * Slurm HPC Cluster Driver communicating via the official Slurm REST API daemon (slurmrestd).
 * Supports JWT authentication and OpenAPI endpoints (v0.0.38, v0.0.39, v0.0.40).
 */
export class SlurmRestDriver implements HpcDriver {
  readonly type = "slurm-rest" as const;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly jwtToken?: string | undefined;
  private readonly username: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: SlurmRestOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiVersion = options.apiVersion || "v0.0.39";
    this.jwtToken = options.jwtToken || process.env["SLURM_JWT_TOKEN"];
    this.username = options.username || process.env["SLURM_USER"] || "slurm";
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-SLURM-USER-NAME": this.username,
    };
    if (this.jwtToken) {
      headers["X-SLURM-USER-TOKEN"] = this.jwtToken;
      headers["Authorization"] = `Bearer ${this.jwtToken}`;
    }
    return headers;
  }

  private async request<T = any>(endpoint: string, method = "GET", body?: any): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}/slurm/${this.apiVersion}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const requestInit: RequestInit = {
        method,
        headers: this.getHeaders(),
        signal: controller.signal,
      };
      if (body !== undefined) {
        requestInit.body = JSON.stringify(body);
      }
      const res = await this.fetchFn(url, requestInit);

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { rawText: text };
      }

      if (!res.ok) {
        const errorMsg =
          data.errors?.[0]?.error || data.error || `Slurm REST API error: HTTP ${res.status} (${method} ${endpoint})`;
        throw new Error(errorMsg);
      }

      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  public async submit(spec: HpcJobSpec): Promise<HpcSubmissionResult> {
    const sbatchScript = generateSbatchScript(spec);

    const payload = {
      script: sbatchScript,
      job: {
        name: spec.name,
        current_working_directory: spec.workingDir,
        standard_output: `slurm-${spec.jobId}.out`,
        standard_error: `slurm-${spec.jobId}.err`,
        partition: spec.resources.partition,
        tasks: spec.resources.tasksPerNode ?? 1,
        cpus_per_task: spec.resources.cpusPerTask ?? 1,
        nodes: spec.resources.nodes ? [spec.resources.nodes, spec.resources.nodes] : undefined,
        memory_per_node: spec.resources.memoryMb,
        time_limit: spec.resources.timeLimitMinutes,
        environment: spec.env || {},
      },
    };

    const res = await this.request<any>("/job/submit", "POST", payload);

    // Parse job_id from various Slurm REST formats:
    // Format A: { job_id: 12345 }
    // Format B: { jobs: [{ job_id: 12345 }] }
    // Format C: { job_submit_response: { job_id: 12345 } }
    let nativeJobId: string | undefined;

    if (res.data.job_id) {
      nativeJobId = String(res.data.job_id);
    } else if (Array.isArray(res.data.jobs) && res.data.jobs[0]?.job_id) {
      nativeJobId = String(res.data.jobs[0].job_id);
    } else if (res.data.job_submit_response?.job_id) {
      nativeJobId = String(res.data.job_submit_response.job_id);
    }

    if (!nativeJobId) {
      throw new Error(`Failed to parse job_id from Slurm REST response: ${JSON.stringify(res.data)}`);
    }

    return {
      nativeJobId,
      driverType: "slurm-rest",
      allocatedResources: spec.resources,
      estimatedCreditsPerHour: 10,
    };
  }

  public async pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }> {
    try {
      const res = await this.request<any>(`/job/${nativeJobId}`, "GET");
      const job = Array.isArray(res.data.jobs) ? res.data.jobs[0] : res.data.job || res.data;

      if (!job) {
        return { state: "FAILED", exitCode: -1 };
      }

      // Slurm REST represents state either as string or array of strings, e.g. ["RUNNING"] or "RUNNING"
      let rawState = "";
      if (Array.isArray(job.job_state)) {
        rawState = (job.job_state[0] || "").toUpperCase();
      } else if (typeof job.job_state === "string") {
        rawState = job.job_state.toUpperCase();
      }

      let state: HpcJobState = "FAILED";
      if (rawState.includes("COMPLETED")) {
        state = "COMPLETED";
      } else if (rawState.includes("RUNNING") || rawState.includes("COMPLETING")) {
        state = "RUNNING";
      } else if (rawState.includes("PENDING") || rawState.includes("CONFIGURING")) {
        state = "PENDING";
      } else if (rawState.includes("CANCELLED")) {
        state = "CANCELLED";
      } else {
        state = "FAILED";
      }

      // Exit code extraction
      let exitCode: number | undefined;
      if (typeof job.exit_code === "number") {
        exitCode = job.exit_code;
      } else if (typeof job.exit_code?.return_code === "number") {
        exitCode = job.exit_code.return_code;
      }

      return { state, exitCode };
    } catch {
      return { state: "FAILED", exitCode: -1 };
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    try {
      await this.request(`/job/${nativeJobId}`, "DELETE");
      return true;
    } catch {
      return false;
    }
  }

  public async getMetrics(nativeJobId: string, _workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics> {
    try {
      const res = await this.request<any>(`/job/${nativeJobId}`, "GET");
      const job = Array.isArray(res.data.jobs) ? res.data.jobs[0] : res.data.job || res.data;

      if (!job) {
        return {
          wallClockSeconds: 0,
          cpuCoreSeconds: 0,
          peakMemoryMb: 0,
          costCredits: 0,
          nativeJobId,
          exitCode: -1,
        };
      }

      // Parse time fields
      const elapsedSeconds =
        job.time?.elapsed ||
        job.time_elapsed ||
        (job.end_time && job.start_time ? Math.max(0, job.end_time - job.start_time) : 0);

      // CPU time = elapsed * alloc_cpus or total_cpu
      const allocCpus = job.job_resources?.allocated_cpus || job.cpus || profile.cpus || 1;
      const cpuCoreSeconds = job.time?.total_cpu || elapsedSeconds * allocCpus;

      // Peak memory
      const peakMemoryMb = Math.round(
        (job.memory?.max_rss || job.job_resources?.allocated_memory || profile.memoryMb) / (1024 * 1024),
      );

      const costCredits = calculateCostCredits(elapsedSeconds, profile);

      return {
        wallClockSeconds: elapsedSeconds,
        cpuCoreSeconds,
        peakMemoryMb: peakMemoryMb > 0 ? peakMemoryMb : profile.memoryMb,
        gpuSeconds: profile.gpus ? elapsedSeconds * profile.gpus : 0,
        costCredits,
        nativeJobId,
        exitCode: job.exit_code?.return_code ?? job.exit_code ?? 0,
      };
    } catch {
      return {
        wallClockSeconds: 0,
        cpuCoreSeconds: 0,
        peakMemoryMb: 0,
        costCredits: 0,
        nativeJobId,
        exitCode: -1,
      };
    }
  }

  public getLogPath(nativeJobId: string, workingDir: string): string {
    return path.join(workingDir, `slurm-${nativeJobId}.out`);
  }

  // ── Cluster Introspection & Diagnostics ──────────────────────────────

  public async ping(): Promise<{ ok: boolean; latencyMs: number; version?: string }> {
    const start = performance.now();
    try {
      const res = await this.request<any>("/ping", "GET");
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      return {
        ok: true,
        latencyMs,
        version: res.data?.meta?.slurm?.version || this.apiVersion,
      };
    } catch {
      return {
        ok: false,
        latencyMs: Math.round((performance.now() - start) * 10) / 10,
      };
    }
  }

  public async getPartitions(): Promise<SlurmPartitionInfo[]> {
    try {
      const res = await this.request<any>("/partitions", "GET");
      const partitions = res.data.partitions || [];
      return partitions.map((p: any) => ({
        name: p.name,
        state: (p.partition?.state || p.state || "UP").toUpperCase(),
        totalNodes: p.nodes?.total || p.total_nodes || 0,
        totalCpus: p.cpus?.total || p.total_cpus || 0,
        maxTimeMinutes: p.maximum_time?.minutes || p.max_time || 0,
        defaultMemoryMb: p.memory?.default || p.default_memory_mb,
      }));
    } catch {
      return [];
    }
  }

  public async getNodes(): Promise<SlurmNodeInfo[]> {
    try {
      const res = await this.request<any>("/nodes", "GET");
      const nodes = res.data.nodes || [];
      return nodes.map((n: any) => ({
        name: n.name,
        state: (n.state?.[0] || n.state || "UNKNOWN").toUpperCase(),
        cpus: n.cpus || 0,
        realMemoryMb: n.real_memory || 0,
        partitions: n.partitions || [],
      }));
    } catch {
      return [];
    }
  }
}
