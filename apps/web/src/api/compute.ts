// SPDX-License-Identifier: AGPL-3.0-or-later

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
  tolerance?: number | undefined;
  solver?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
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

export const submitSimulationJob = submitCloudSimulation;

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

export interface ClusterPartitionInfo {
  name: string;
  label?: string | undefined;
  state: string;
  nodesTotal?: number | undefined;
  nodesIdle?: number | undefined;
  cpusPerNode?: number | undefined;
  memoryGb?: number | undefined;
  gpus?: string | number | undefined;
  maxTime?: string | undefined;
  costCreditsPerMin?: number | undefined;
  solvers?: string[] | undefined;
}

export interface ClusterNodeInfo {
  name: string;
  partition?: string | undefined;
  state: string;
  cpus?: number | undefined;
  cpusAlloc?: number | undefined;
  cpusTotal?: number | undefined;
  memoryGb?: number | undefined;
  memoryUsedGb?: number | undefined;
  memoryTotalGb?: number | undefined;
  load?: number | undefined;
  loadAvg?: number | string | undefined;
}

export interface ClusterStatus {
  backend: "slurm-rest" | "slurm" | "local-process" | string;
  connected: boolean;
  latencyMs: number;
  version?: string | undefined;
  stagingBackend?: string | undefined;
  partitions: ClusterPartitionInfo[];
  nodesCount: number;
  nodes?: ClusterNodeInfo[] | undefined;
  maxTime?: string | undefined;
  gpus?: string | number | undefined;
  vramPerNode?: string | undefined;
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
  dbJobId?: number | null | undefined;
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
  studyKind?: string | undefined;
  standardFormat?: StudyStandardFormat | undefined;
  templateSlug?: string | undefined;
  modelName?: string | undefined;
  targetArtifact?: string | undefined;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  executionTarget?: string | undefined;
  sampleCount?: number | undefined;
  kpis?:
    | { id: string; label: string; value: number | string; unit?: string | undefined; status?: string | undefined }[]
    | undefined;
}

export interface ComputeJobStep {
  id: number;
  name: string;
  status: string;
  started_at?: string | undefined;
  completed_at?: string | null | undefined;
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
  metadata?: string | Record<string, unknown> | undefined;
  studyResults?: unknown | undefined;
  steps?: ComputeJobStep[] | undefined;
  job?: ComputeJob | undefined;
}

function mapToComputeJob(data: any, fallbackId: string | number): ComputeJob {
  const raw = data?.job && typeof data.job === "object" ? data.job : data || {};
  const steps: ComputeJobStep[] = Array.isArray(data?.steps) ? data.steps : Array.isArray(raw?.steps) ? raw.steps : [];

  let parsedMeta: Record<string, unknown> = {};
  try {
    if (typeof raw.metadata === "string") {
      parsedMeta = JSON.parse(raw.metadata);
    } else if (raw.metadata && typeof raw.metadata === "object") {
      parsedMeta = raw.metadata;
    }
  } catch {}

  const studyResults = data?.studyResults || raw?.studyResults || parsedMeta?.studyResults;
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
    domain:
      raw.domain ||
      parsedMeta?.modelDomain ||
      (raw.solver === "su2" ? "cfd" : raw.solver === "calculix" ? "fea" : "simulation"),
    solver: raw.solver || parsedMeta?.solver || studyResults?.solver,
    profile: raw.profile || raw.compute_profile || raw.computeProfile || parsedMeta?.computeProfile || "standard",
    started_at: startedIso,
    startedAt: raw.startedAt ?? raw.startTime ?? startedIso,
    completed_at: completedIso,
    completedAt: raw.completedAt ?? raw.endTime ?? completedIso,
    elapsedSeconds: raw.elapsedSeconds ?? raw.cpu_seconds,
    costCredits: raw.costCredits ?? raw.cost_credits ?? raw.usage?.costCredits,
    usage: raw.usage,
    error: raw.error,
    hasResult: raw.hasResult ?? Boolean(raw.resultPath || studyResults),
    resultPath: raw.resultPath,
    metadata: raw.metadata,
    studyResults,
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
  const seenDbIds = new Set<string>();

  try {
    const cloudRes = await api.get<{ jobs: any[] }>("/cloud/jobs");
    if (cloudRes.data?.jobs && Array.isArray(cloudRes.data.jobs)) {
      for (const j of cloudRes.data.jobs) {
        // Use canonical dbJobId when available so we never duplicate SQLite jobs
        const canonicalId = j.dbJobId ? String(j.dbJobId) : `cloud-${String(j.jobId ?? j.id ?? "")}`;
        if (seenDbIds.has(canonicalId)) continue;
        seenDbIds.add(canonicalId);

        jobs.push({
          id: j.dbJobId ?? canonicalId,
          dbJobId: j.dbJobId ?? null,
          name: j.name || `Job #${canonicalId.slice(0, 8)}`,
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
        const canonicalId = String(j.id ?? "");
        if (seenDbIds.has(canonicalId)) continue;
        seenDbIds.add(canonicalId);

        jobs.push({
          id: j.id,
          dbJobId: typeof j.id === "number" ? j.id : Number(j.id) || null,
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
  } catch {
    // Ignore error fetching cae jobs
  }

  return jobs;
};

// ── Background Jobs & Engineering Study Templates API ───────────────

export const getDbJobs = async (): Promise<{ jobs: any[] }> => {
  const { data } = await api.get("/jobs");
  return data;
};

export type StudyStandardFormat = "sedml" | "ssp-ssv" | "dakota";

export interface StudyInstanceArtifactPayload {
  standardFormat: StudyStandardFormat;
  filename: string;
  fileName?: string | undefined;
  fileExtension?: ".sedml" | ".ssv" | ".dakota" | undefined;
  mimeType: string;
  sourceContent: string;
  templateSlug: string;
  templateVersion?: string | undefined;
  modelId: string;
  modelName: string;
  modelDomain: string;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  executionTarget: string;
  computeProfile?: string | undefined;
  inputs: Record<string, number | string | boolean>;
  parameterBindings: { parameterName: string; nominalValue: number; min?: number; max?: number; unit?: string }[];
  observables: string[];
  createdAt: string;
}

export interface StudyGalleryFilters {
  q?: string | undefined;
  sourceType?: string | undefined;
  standardFormat?: string | undefined;
  kind?: string | undefined;
  category?: string | undefined;
  domain?: string | undefined;
  target?: string | undefined;
}

export interface StudyPresetPayload {
  id: string;
  label: string;
  description: string;
  targetHint?: string | undefined;
  target?: string | undefined;
  profile?: "standard" | "high-cpu" | "gpu-a100" | undefined;
  values: Record<string, number | string | boolean>;
}

export interface StudyInputFieldPayload {
  key: string;
  label: string;
  type: "number" | "integer" | "select" | "boolean" | "text" | string;
  unit?: string | undefined;
  defaultValue: number | string | boolean;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  options?: { value: string; label: string }[] | undefined;
  description?: string | undefined;
  group?: string | undefined;
}

export interface StudyDefinitionPayload {
  schemaVersion?: string | undefined;
  standardFormat?: StudyStandardFormat | undefined;
  id?: string | undefined;
  slug: string;
  name: string;
  version?: string | undefined;
  kind?: string | undefined;
  archetype?: string | undefined;
  category?: string | undefined;
  sourceType?: "official" | "package" | "community" | string | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  artifactPath?: string | null | undefined;
  targetModel?: string | null | undefined;
  targetArtifact?: string | null | undefined;
  bundledInRelease?: boolean | undefined;
  authorUsername?: string | undefined;
  standardAlignment?: string | undefined;
  solver?: string | undefined;
  estimatedDuration?: string | undefined;
  icon?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  featured?: boolean | undefined;
  starsCount?: number | undefined;
  runsCount?: number | undefined;
  modelContract?:
    | {
        domains?: string[] | undefined;
        dialects?: string[] | undefined;
        parameterSlots?: { slotId: string; label: string; description?: string; unit?: string }[] | undefined;
        observableSlots?: { slotId: string; label: string; description?: string; unit?: string }[] | undefined;
      }
    | undefined;
  inputs?: StudyInputFieldPayload[] | undefined;
  presets?: StudyPresetPayload[] | undefined;
  execution?:
    | {
        supportedTargets?: string[] | undefined;
        defaultTarget?: string | undefined;
        recommendedSolver?: string | undefined;
        recommendedProfile?: "wasm-edge" | "standard" | "high-cpu" | "gpu-a100" | string | undefined;
        estimatedCredits?: number | undefined;
        pipelineSteps?: string[] | undefined;
      }
    | undefined;
  steps?:
    | (string | { id?: string; name?: string; title?: string; description?: string; command?: string })[]
    | undefined;
}

export interface CompatibleModelItem {
  id: string;
  name?: string | undefined;
  title?: string | undefined;
  qualifiedName?: string | undefined;
  modelName?: string | undefined;
  domain?: string | undefined;
  dialect?: string | undefined;
  source?: string | undefined;
  sourceType?: string | undefined;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  description?: string | undefined;
  summary?: string | undefined;
  parameters: {
    name: string;
    type?: string | undefined;
    defaultValue?: number | string | boolean | undefined;
    value?: number | undefined;
    unit?: string | undefined;
    min?: number | undefined;
    max?: number | undefined;
    description?: string | undefined;
  }[];
  observables: {
    name: string;
    type?: string | undefined;
    unit?: string | undefined;
    description?: string | undefined;
  }[];
  code?: string | undefined;
}

export interface StudyEnsembleBand {
  observable?: string | undefined;
  variable?: string | undefined;
  unit?: string | undefined;
  time?: number[] | undefined;
  t?: number[] | undefined;
  mean: number[];
  p05: number[];
  p50: number[];
  p95: number[];
  min?: number[] | undefined;
  max?: number[] | undefined;
}

export interface StudyTimeSeries {
  time?: number[] | undefined;
  t?: number[] | undefined;
  series?: Record<string, number[]> | undefined;
  variables?: { name: string; unit?: string | undefined; values: number[] }[] | undefined;
}

export interface StudyRunResultsPayload {
  studyKind: string;
  standardFormat?: StudyStandardFormat | undefined;
  studyInstance?: StudyInstanceArtifactPayload | undefined;
  templateSlug: string;
  templateName: string;
  modelName: string;
  modelDomain?: string | undefined;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  executionTarget: string;
  computeProfile: string;
  solver: string;
  sampleCount: number;
  kpis: {
    id: string;
    label: string;
    value: number | string;
    unit?: string | undefined;
    status?: "pass" | "warn" | "fail" | "info" | string | undefined;
  }[];
  timeSeries?: StudyTimeSeries | undefined;
  ensembleBands?: StudyEnsembleBand[] | undefined;
  sobolIndices?: { parameter: string; firstOrder: number; totalOrder: number }[] | undefined;
  sweepPoints?:
    | {
        sampleIndex: number;
        parameters: Record<string, number>;
        metrics: Record<string, number>;
        status: string;
        feasible?: boolean | undefined;
        paretoOptimal?: boolean | undefined;
      }[]
    | undefined;
  complianceMatrix?:
    | {
        caseId?: string | undefined;
        clause?: string | undefined;
        standardRef?: string | undefined;
        description?: string | undefined;
        requirement?: string | undefined;
        measuredValue?: string | undefined;
        measured?: string | undefined;
        limitSpec?: string | undefined;
        passed?: boolean | undefined;
        status?: "PASS" | "WARN" | "FAIL" | string | undefined;
      }[]
    | undefined;
  provenance?:
    | {
        studySchemaVersion?: string | undefined;
        templateSlug?: string | undefined;
        templateVersion?: string | undefined;
        modelName?: string | undefined;
        packageName?: string | undefined;
        packageVersion?: string | undefined;
        sha256Lock?: string | undefined;
        sha256LockHash?: string | undefined;
        completedAt?: string | undefined;
        executionTarget?: string | undefined;
        computeProfile?: string | undefined;
      }
    | undefined;
}

export const getJobTemplates = async (
  filters?: StudyGalleryFilters,
): Promise<{
  templates: StudyDefinitionPayload[];
  studyDefinitions?: StudyDefinitionPayload[];
  facets?: {
    bySource: Record<string, number>;
    byStandard?: Record<string, number>;
    byKind: Record<string, number>;
    byCategory: Record<string, number>;
    byDomain: Record<string, number>;
    byTarget: Record<string, number>;
  };
}> => {
  const { data } = await api.get("/jobs/templates", { params: filters });
  return data;
};

export const createStudyTemplate = async (payload: {
  name: string;
  slug?: string;
  description: string;
  kind: string;
  category: string;
  standardFormat?: StudyStandardFormat;
  rawStandardContent?: string;
  filename?: string;
  packageName?: string;
  packageVersion?: string;
  tags?: string[];
  modelContract?: unknown;
  inputs?: unknown[];
  execution?: unknown;
  outputs?: unknown;
}): Promise<unknown> => {
  const { data } = await api.post("/jobs/templates", payload);
  return data;
};

export const synthesizeStudyInstance = async (payload: {
  templateIdOrSlug?: string | number | undefined;
  templateSlug?: string | number | undefined;
  standardFormat?: StudyStandardFormat | undefined;
  modelId?: string | undefined;
  modelName?: string | undefined;
  modelDomain?: string | undefined;
  dialect?: string | undefined;
  modelCode?: string | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  executionTarget?: string | undefined;
  computeProfile?: string | undefined;
  presetId?: string | undefined;
  inputs?: Record<string, number | string | boolean> | undefined;
  studyInputs?: Record<string, number | string | boolean> | undefined;
  parameterOverrides?: Record<string, number> | undefined;
  observables?: string[] | undefined;
  saveInstanceToPackage?: string | boolean | undefined;
}): Promise<{
  studyDefinition: StudyDefinitionPayload;
  model: CompatibleModelItem;
  studyInstance: StudyInstanceArtifactPayload;
}> => {
  const { data } = await api.post("/jobs/synthesize", payload);
  return data;
};

export const runStudyJob = async (payload: {
  templateSlug?: string | undefined;
  templateIdOrSlug?: string | number | undefined;
  name?: string | undefined;
  modelName?: string | undefined;
  modelDomain?: string | undefined;
  modelCode?: string | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  targetArtifact?: string | undefined;
  executionTarget?: string | undefined;
  computeProfile?: string | undefined;
  standardFormat?: StudyStandardFormat | undefined;
  inputs?: Record<string, unknown> | undefined;
  parameterOverrides?: Record<string, number> | undefined;
  saveInstanceToPackage?: string | boolean | undefined;
  [key: string]: unknown;
}): Promise<unknown> => {
  const { data } = await api.post("/jobs/runs", payload);
  return data;
};

export const rerunStudyJob = async (
  jobId: string | number,
  overrides?: {
    executionTarget?: string;
    computeProfile?: string;
    inputs?: Record<string, number | string | boolean>;
    studyInstanceSource?: string;
  },
): Promise<unknown> => {
  const { data } = await api.post(`/jobs/${jobId}/rerun`, overrides || {});
  return data;
};

export const saveJobAsStudyTemplate = async (
  jobId: string | number,
  payload?: {
    name?: string;
    slug?: string;
    description?: string;
    packageName?: string;
    packageVersion?: string;
    standardFormat?: StudyStandardFormat;
  },
): Promise<{
  id: number;
  slug: string;
  studyDefinition: StudyDefinitionPayload;
  template?: { id: number; slug: string; name: string } | undefined;
}> => {
  const { data } = await api.post(`/jobs/${jobId}/save-as-template`, payload || {});
  return data;
};

export interface LinkedStudyJobItemPayload {
  id: number;
  name: string;
  status: string;
  type: string;
  createdAt: string;
  completedAt?: string | null | undefined;
  templateSlug: string;
  studyKind: string;
  standardFormat: StudyStandardFormat;
  modelName: string;
  modelDomain: string;
  targetArtifact?: string | null | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  executionTarget: string;
  computeProfile: string;
  sampleCount: number;
  kpis: { id: string; label: string; value: number | string; unit?: string | undefined; status?: string | undefined }[];
  studyInstance?: StudyInstanceArtifactPayload | undefined;
}

export const getLinkedPackageStudies = async (params: {
  package?: string | undefined;
  version?: string | undefined;
  artifact?: string | undefined;
  model?: string | undefined;
  domain?: string | undefined;
}): Promise<{
  bundledStudies: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  linkedTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  compatibleTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
  linkedJobs: LinkedStudyJobItemPayload[];
}> => {
  const { data } = await api.get("/jobs/linked", { params });
  return data;
};

export const getJobStudyInstance = async (
  jobId: string | number,
): Promise<{ studyInstance: StudyInstanceArtifactPayload }> => {
  const { data } = await api.get(`/jobs/${jobId}/study-instance`);
  return data;
};

export const getCompatibleModels = async (params?: {
  templateSlug?: string;
  domain?: string;
  q?: string;
  limit?: number;
}): Promise<{ models: CompatibleModelItem[] }> => {
  const { data } = await api.get("/jobs/compatible-models", { params });
  return data;
};

export const inspectModelSource = async (
  code: string,
  modelNameHint?: string,
): Promise<{
  modelName: string;
  parameters: unknown[];
  observables: unknown[];
}> => {
  const { data } = await api.post("/jobs/inspect-model", { code, modelNameHint });
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
