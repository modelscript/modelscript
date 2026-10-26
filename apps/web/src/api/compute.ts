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

export const getUnifiedUserJobs = async (limit = 50): Promise<UnifiedJob[]> => {
  const jobs: UnifiedJob[] = [];

  try {
    const cloudRes = await api.get<{ jobs: any[] }>("/cloud/jobs");
    if (cloudRes.data?.jobs && Array.isArray(cloudRes.data.jobs)) {
      for (const j of cloudRes.data.jobs) {
        jobs.push({
          id: j.jobId,
          name: j.name || `Job #${String(j.jobId).slice(0, 8)}`,
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
        if (!jobs.some((existing) => String(existing.id) === String(j.id))) {
          jobs.push({
            id: j.id,
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

export const getJobLogs = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/jobs/${id}/logs`);
  return data;
};

export const getJobDetails = async (id: string | number): Promise<{ job: any; steps?: any[] | undefined }> => {
  const { data } = await api.get(`/jobs/${id}`);
  return data;
};

export const getJobTemplate = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/jobs/templates/${id}`);
  return data;
};

export const runJobTemplate = async (id: string | number, payload?: any): Promise<any> => {
  const { data } = await api.post(`/jobs/templates/${id}/run`, payload || {});
  return data;
};

export const cancelDbJob = async (id: string | number): Promise<any> => {
  const { data } = await api.post(`/jobs/${id}/cancel`);
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
