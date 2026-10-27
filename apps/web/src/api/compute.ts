// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import { api } from "./client";

export interface ComputeProfileInfo {
  id: string;
  name: string;
  description: string;
  cpus: number;
  memoryMb: number;
  gpus: number;
  gpuType?: string | undefined;
  partition: string;
  costCreditsPerHour: number;
}

export const getComputeProfiles = async (): Promise<ComputeProfileInfo[]> => {
  try {
    const { data } = await api.get<{ profiles: ComputeProfileInfo[] }>("/cae/profiles");
    return data.profiles;
  } catch {
    return [
      {
        id: "standard",
        name: "Standard Compute",
        description: "General ODE, 2D FEA and fast simulation runs",
        cpus: 4,
        memoryMb: 16384,
        gpus: 0,
        partition: "compute",
        costCreditsPerHour: 10,
      },
      {
        id: "high-memory",
        name: "High Memory",
        description: "Large 3D FEA solid models and dense matrices",
        cpus: 16,
        memoryMb: 262144,
        gpus: 0,
        partition: "highmem",
        costCreditsPerHour: 35,
      },
      {
        id: "gpu-a100",
        name: "GPU-Accelerated (NVIDIA A100)",
        description: "Machine learning surrogates, neural operators, GPU CFD",
        cpus: 8,
        memoryMb: 65536,
        gpus: 1,
        gpuType: "a100",
        partition: "gpu",
        costCreditsPerHour: 80,
      },
      {
        id: "hpc-mpi-64",
        name: "Multi-Node MPI Cluster (64 Cores)",
        description: "High-resolution turbulent CFD and multi-domain models",
        cpus: 64,
        memoryMb: 131072,
        gpus: 0,
        partition: "mpi",
        costCreditsPerHour: 150,
      },
    ];
  }
};

export interface HpcJobSummary {
  id: number;
  name: string;
  status: string;
  solver: string;
  computeProfile: string;
  cpuSeconds: number;
  gpuSeconds: number;
  costCredits: number;
  startedAt: string;
  completedAt: string | null;
  hasVtu: boolean;
  hasScalars: boolean;
  scalars?: Record<string, any> | undefined;
  resultDir?: string | undefined;
}

export interface ArtifactViewFromJobResult {
  id: number;
  artifactId: number;
  suggestedCaption: string;
  viewConfig: Record<string, unknown>;
}

export const getUserHpcJobs = async (limit = 20): Promise<HpcJobSummary[]> => {
  try {
    const { data } = await api.get<{ jobs: HpcJobSummary[]; count: number }>("/cae/user-jobs", {
      params: { limit },
    });
    return data.jobs || [];
  } catch {
    return [];
  }
};

export const createArtifactViewFromHpcJob = async (
  jobId: number,
  options?: { colormap?: string | undefined; activeField?: string | undefined; title?: string | undefined },
): Promise<ArtifactViewFromJobResult> => {
  const { data } = await api.post<ArtifactViewFromJobResult>("/social/artifact-views/from-hpc-job", {
    jobId,
    ...options,
  });
  return data;
};

export const getHpcJobReproduceSpec = async (jobId: number) => {
  const { data } = await api.get(`/cae/jobs/${jobId}/reproduce-spec`);
  return data;
};

// ── Cloud Simulation API ──────────────────────────────────────────

export interface CloudSimulationRequest {
  modelName: string;
  modelSource?: string | undefined;
  libraryName?: string | undefined;
  libraryVersion?: string | undefined;
  dependencies?: { name: string; version: string }[] | undefined;
  profile?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  numberOfIntervals?: number | undefined;
}

export interface CloudSimulationStatus {
  id: string;
  status: "pending" | "processing" | "queued" | "running" | "completed" | "success" | "failed" | string;
  profile?: string | undefined;
  usage?:
    | {
        cpuSeconds: number;
        gpuSeconds: number;
        costCredits: number;
        exitCode: number;
      }
    | undefined;
  error?: string | undefined;
}

export const submitCloudSimulation = async (req: CloudSimulationRequest): Promise<{ jobId: string }> => {
  const { data } = await api.post<{ jobId: string }>("/simulate", req);
  return data;
};

export const getCloudSimulationStatus = async (jobId: string): Promise<CloudSimulationStatus> => {
  const { data } = await api.get<CloudSimulationStatus>(`/simulate/${jobId}`);
  return data;
};

export const getCloudSimulationResultCsv = async (jobId: string): Promise<string> => {
  const { data } = await api.get<string>(`/simulate/${jobId}/result`, {
    responseType: "text",
  });
  return data;
};

// ── Cluster Health & Live HPC Queues ───────────────────────────────

export interface ClusterStatus {
  backend: "slurm-rest" | "slurm" | "local-process" | string;
  connected: boolean;
  latencyMs: number;
  version?: string | undefined;
  stagingBackend?: string | undefined;
  partitions: { name: string; state: string }[];
  nodesCount: number;
  nodes?: { name: string; state: string }[] | undefined;
}

export const getClusterStatus = async (): Promise<ClusterStatus> => {
  try {
    const { data } = await api.get<ClusterStatus>("/cae/cluster/status");
    return data;
  } catch {
    return {
      backend: "offline",
      connected: false,
      latencyMs: 0,
      version: "unavailable",
      partitions: [],
      nodesCount: 0,
      nodes: [],
    };
  }
};

export interface UnifiedJob {
  id: string | number;
  name: string;
  domain: string;
  profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "SUCCESS" | "FAILED" | string;
  progress?: number | undefined;
  costCredits?: number | undefined;
  elapsedSeconds?: number | undefined;
  startedAt?: string | number | undefined;
  hasVtu?: boolean | undefined;
  hasCsv?: boolean | undefined;
}

export interface ComputeJobStep {
  id: number;
  name: string;
  status: string;
}

export interface ComputeJob {
  id: string | number;
  jobId?: string | undefined;
  name: string;
  status: string;
  type?: string | undefined;
  domain?: string | undefined;
  solver?: string | undefined;
  profile?: string | undefined;
  started_at?: string | undefined;
  startedAt?: string | number | undefined;
  completed_at?: string | null | undefined;
  completedAt?: string | number | null | undefined;
  elapsedSeconds?: number | undefined;
  costCredits?: number | undefined;
  usage?: Record<string, any> | undefined;
  error?: string | undefined;
  hasResult?: boolean | undefined;
  resultPath?: string | undefined;
  metadata?: string | Record<string, any> | undefined;
  steps?: ComputeJobStep[] | undefined;
  job?: ComputeJob | undefined;
}

function mapToComputeJob(data: any, fallbackId: string | number): ComputeJob {
  const raw = data?.job && typeof data.job === "object" ? data.job : data || {};
  const steps: ComputeJobStep[] = Array.isArray(data?.steps) ? data.steps : Array.isArray(raw?.steps) ? raw.steps : [];

  const resolvedId = raw.id ?? raw.jobId ?? fallbackId;
  const startedIso =
    raw.started_at ??
    raw.createdAt ??
    (typeof raw.startTime === "number"
      ? new Date(raw.startTime).toISOString()
      : typeof raw.startedAt === "string"
        ? raw.startedAt
        : undefined);
  const completedIso =
    raw.completed_at ??
    raw.completedAt ??
    (typeof raw.endTime === "number" ? new Date(raw.endTime).toISOString() : null);

  const baseJob: ComputeJob = {
    id: resolvedId,
    jobId: String(raw.jobId ?? resolvedId),
    name: raw.name || `Job #${String(resolvedId)}`,
    status: String(raw.status || "queued"),
    type:
      raw.type ||
      (raw.domain ? String(raw.domain).toUpperCase() : raw.solver ? String(raw.solver).toUpperCase() : "SIMULATION"),
    domain: raw.domain || (raw.solver === "su2" ? "cfd" : raw.solver === "calculix" ? "fea" : "simulation"),
    solver: raw.solver,
    profile: raw.profile || raw.compute_profile || raw.computeProfile || "standard",
    started_at: startedIso,
    startedAt: raw.startedAt ?? raw.startTime ?? startedIso,
    completed_at: completedIso,
    completedAt: raw.completedAt ?? raw.endTime ?? completedIso,
    elapsedSeconds: raw.elapsedSeconds,
    costCredits: raw.costCredits ?? raw.cost_credits ?? raw.usage?.costCredits,
    usage: raw.usage,
    error: raw.error,
    hasResult: raw.hasResult ?? Boolean(raw.resultPath),
    resultPath: raw.resultPath,
    metadata: raw.metadata,
    steps,
  };

  return {
    ...baseJob,
    job: baseJob,
    steps,
  };
}

export const getUnifiedUserJobs = async (limit = 50): Promise<UnifiedJob[]> => {
  const jobs: UnifiedJob[] = [];

  try {
    const cloudRes = await api.get<{ jobs: any[] }>("/cloud/jobs");
    if (cloudRes.data?.jobs && Array.isArray(cloudRes.data.jobs)) {
      for (const j of cloudRes.data.jobs) {
        const rawCloudId = String(j.jobId ?? j.id ?? "");
        const prefixedId = rawCloudId.startsWith("cloud-") ? rawCloudId : `cloud-${rawCloudId}`;
        jobs.push({
          id: prefixedId,
          name: j.name || `Job #${rawCloudId.slice(0, 8)}`,
          domain: j.domain || "modelica",
          profile: j.profile || "standard",
          status: j.status,
          costCredits: j.costCredits,
          startedAt: j.startTime,
        });
      }
    }
  } catch {
    // Ignore error fetching jobs
  }

  try {
    const caeRes = await api.get<{ jobs: any[] }>("/cae/user-jobs", { params: { limit } });
    if (caeRes.data?.jobs && Array.isArray(caeRes.data.jobs)) {
      for (const j of caeRes.data.jobs) {
        const rawCaeId = String(j.id ?? "");
        const prefixedId = rawCaeId.startsWith("cae-") ? rawCaeId : `cae-${rawCaeId}`;
        if (!jobs.some((existing) => String(existing.id) === prefixedId || String(existing.id) === rawCaeId)) {
          jobs.push({
            id: prefixedId,
            name: j.name,
            domain: j.solver === "su2" ? "cfd" : j.solver === "calculix" ? "fea" : "simulation",
            profile: j.computeProfile || "standard",
            status: j.status === "SUCCESS" ? "completed" : j.status === "FAILED" ? "failed" : "running",
            costCredits: j.costCredits,
            startedAt: j.startedAt,
            hasVtu: j.hasVtu,
            hasCsv: j.hasScalars,
          });
        }
      }
    }
  } catch {
    // Ignore error fetching cae jobs
  }

  return jobs;
};

// ── Background Jobs & Script Templates API ──────────────────────────

export const getDbJobs = async (): Promise<{ jobs: any[] }> => {
  const { data } = await api.get("/jobs");
  return data;
};

export const getJobTemplates = async (): Promise<{ templates: any[] }> => {
  const { data } = await api.get("/jobs/templates");
  return data;
};

export const getJob = async (id: string | number): Promise<ComputeJob> => {
  const strId = String(id);
  if (strId.startsWith("cloud-")) {
    const rawId = strId.slice("cloud-".length);
    try {
      const { data } = await api.get(`/cloud/jobs/${rawId}`);
      return mapToComputeJob(data, rawId);
    } catch {
      const { data } = await api.get(`/jobs/${rawId}`);
      return mapToComputeJob(data, rawId);
    }
  }
  if (strId.startsWith("cae-")) {
    const rawId = strId.slice("cae-".length);
    try {
      const { data } = await api.get(`/cae/jobs/${rawId}`);
      return mapToComputeJob(data, rawId);
    } catch {
      const { data } = await api.get(`/jobs/${rawId}`);
      return mapToComputeJob(data, rawId);
    }
  }
  const { data } = await api.get(`/jobs/${strId}`);
  return mapToComputeJob(data, strId);
};

export const getJobDetails = getJob;

export const getJobLogs = async (id: string | number): Promise<any> => {
  const strId = String(id);
  if (strId.startsWith("cloud-")) {
    const rawId = strId.slice("cloud-".length);
    try {
      const { data } = await api.get(`/cloud/jobs/${rawId}/logs`);
      return Array.isArray(data?.logs) ? data.logs.join("\n") : data;
    } catch {
      const { data } = await api.get(`/jobs/${rawId}/logs`);
      return data;
    }
  }
  if (strId.startsWith("cae-")) {
    const rawId = strId.slice("cae-".length);
    try {
      const { data } = await api.get(`/cae/jobs/${rawId}/logs`);
      return Array.isArray(data?.logs) ? data.logs.join("\n") : data;
    } catch {
      const { data } = await api.get(`/jobs/${rawId}/logs`);
      return data;
    }
  }
  const { data } = await api.get(`/jobs/${strId}/logs`);
  return data;
};

export const cancelJob = async (id: string | number): Promise<any> => {
  const strId = String(id);
  if (strId.startsWith("cloud-")) {
    const rawId = strId.slice("cloud-".length);
    try {
      const { data } = await api.post(`/cloud/jobs/${rawId}/cancel`);
      return data;
    } catch {
      const { data } = await api.post(`/jobs/${rawId}/cancel`);
      return data;
    }
  }
  if (strId.startsWith("cae-")) {
    const rawId = strId.slice("cae-".length);
    try {
      const { data } = await api.post(`/cae/jobs/${rawId}/cancel`);
      return data;
    } catch {
      try {
        const { data } = await api.delete(`/cae/jobs/${rawId}`);
        return data;
      } catch {
        const { data } = await api.post(`/jobs/${rawId}/cancel`);
        return data;
      }
    }
  }
  const { data } = await api.post(`/jobs/${strId}/cancel`);
  return data;
};

export const cancelDbJob = cancelJob;

export const retryJob = async (id: string | number): Promise<ComputeJob> => {
  const strId = String(id);
  if (strId.startsWith("cloud-")) {
    const rawId = strId.slice("cloud-".length);
    try {
      const { data } = await api.post(`/cloud/jobs/${rawId}/retry`);
      return mapToComputeJob(data, rawId);
    } catch {
      const { data } = await api.post(`/jobs/${rawId}/retry`);
      return mapToComputeJob(data, rawId);
    }
  }
  if (strId.startsWith("cae-")) {
    const rawId = strId.slice("cae-".length);
    try {
      const { data } = await api.post(`/cae/jobs/${rawId}/retry`);
      return mapToComputeJob(data, rawId);
    } catch {
      const { data } = await api.post(`/jobs/${rawId}/retry`);
      return mapToComputeJob(data, rawId);
    }
  }
  const { data } = await api.post(`/jobs/${strId}/retry`);
  return mapToComputeJob(data, strId);
};

export const getJobTemplate = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/jobs/templates/${id}`);
  return data;
};

export const runJobTemplate = async (id: string | number, payload?: any): Promise<any> => {
  const { data } = await api.post(`/jobs/templates/${id}/run`, payload || {});
  return data;
};

// ── Dev & System API ────────────────────────────────────────────────
export const resetDevDb = async (): Promise<any> => {
  const { data } = await api.post("/dev/reset");
  return data;
};

// ── MQTT API ────────────────────────────────────────────────────────
export const getMqttParticipants = async (
  apiBaseUrl?: string,
): Promise<{ participants: any[]; connected: boolean }> => {
  if (apiBaseUrl) {
    const res = await axios.get(`${apiBaseUrl}/api/v1/mqtt/participants`, { timeout: 10000 });
    return res.data;
  }
  const { data } = await api.get("/mqtt/participants");
  return data;
};

// ── Cloud HPC & Simulation API ──────────────────────────────────────
export const getCloudProfiles = async (): Promise<{ profiles: any[] }> => {
  const { data } = await api.get("/cloud/profiles");
  return data;
};

export const getCloudBalance = async (): Promise<{ balance: number }> => {
  const { data } = await api.get("/cloud/balance");
  return data;
};

export const dispatchCloudJob = async (payload: any): Promise<{ jobId: string }> => {
  const { data } = await api.post("/cloud/dispatch", payload);
  return data;
};

export const getCloudJobResult = async (jobId: string | number): Promise<string> => {
  const { data } = await api.get(`/cloud/jobs/${jobId}/result`, { responseType: "text" });
  return data;
};

export const getSimulationJobResult = async (jobId: string | number): Promise<string> => {
  const { data } = await api.get(`/simulate/${jobId}/result`, { responseType: "text" });
  return data;
};

// ── Physics & CAD API ───────────────────────────────────────────────
export const flattenPhysicsStudy = async (className: string): Promise<any> => {
  const { data } = await api.get("/physics/flattenStudy", { params: { className } });
  return data;
};

export const uploadPhysicsGeometry = async (formData: FormData): Promise<{ hash: string }> => {
  const { data } = await api.post("/physics/upload", formData);
  return data;
};

export const runPhysicsJob = async (payload: { geometryHash: string; config: any }): Promise<{ jobId: string }> => {
  const { data } = await api.post("/physics/run", payload);
  return data;
};

export const convertCadGeometry = async (url: string): Promise<any> => {
  const { data } = await api.get("/cad/convert", { params: { url } });
  return data;
};
