// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance Computing (HPC) Domain & Cluster Configuration Types.
 * Defines declarative job specifications for Slurm, PBS, and KubeRay clusters,
 * automated parallel domain decomposition (decomposePar), and in-situ telemetry streaming.
 */

export type HpcScheduler = "slurm" | "pbs" | "kuberay";

export type HpcJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type DecompositionMethod = "scotch" | "metis" | "hierarchical" | "simple";

export interface ParallelDecompositionSpec {
  /** Parallel graph partitioning method (Scotch or METIS recommended for unstructured CFD). */
  method: DecompositionMethod;
  /** Total number of MPI ranks / subdomains (e.g. 64, 128, 512). */
  numberOfSubdomains: number;
  /** Simple/hierarchical directional split [nx, ny, nz] if method is simple/hierarchical. */
  directionalSplit?: [number, number, number];
  /** Geometric bounding weights delta (default: 0.001). */
  delta?: number;
}

export interface HpcClusterConfig {
  /** Cluster head node endpoint / Slurm REST API URL (e.g., "hpc.internal:6820" or "ssh://cluster"). */
  endpoint: string;
  /** HPC Workload Manager / Scheduler. */
  scheduler: HpcScheduler;
  /** Slurm partition / queue name (e.g., "gpu-h100", "compute-zen4"). */
  partition: string;
  /** Total number of physical compute nodes. */
  nodes: number;
  /** MPI tasks per compute node. */
  tasksPerNode: number;
  /** OpenMP / multi-threading CPUs allocated per task (default: 1). */
  cpusPerTask?: number;
  /** Number of GPUs requested per node (e.g., 4 or 8 for A100/H100). */
  gpusPerNode?: number;
  /** Walltime limit formatted as "HH:MM:SS" (e.g., "02:00:00"). */
  walltime: string;
  /** Memory allocation per node in MB or GB string (e.g., "128GB"). */
  memoryPerNode?: string;
  /** Slurm account / project charge allocation. */
  account?: string;
  /** Quality of Service (QOS). */
  qos?: string;
  /** Modules to load prior to execution (e.g. ["openfoam/v2312", "openmpi/4.1.5"]). */
  modules?: string[];
  /** Environment variables to export across compute nodes. */
  env?: Record<string, string>;
}

export interface InSituCutPlaneSpec {
  planeId: string;
  origin: [number, number, number];
  normal: [number, number, number];
  fields: string[]; // e.g. ["U", "p", "k", "omega"]
}

export interface InSituProbeSpec {
  probeId: string;
  position: [number, number, number];
  fields: string[];
}

export interface InSituTelemetryConfig {
  enabled: boolean;
  sampleIntervalSteps: number;
  cutPlanes?: InSituCutPlaneSpec[];
  probes?: InSituProbeSpec[];
  compression?: "none" | "zstd" | "lz4";
  streamProtocol?: "websocket" | "arrow-flight" | "binary-ipc";
}

export interface CfdSimulationJobSpec {
  jobId: string;
  modelName: string;
  solver: "openfoam-v2312" | "openfoam-v2206" | "su2" | "icoFoam" | "simpleFoam" | "pimpleFoam";
  caseDir: string;
  cluster: HpcClusterConfig;
  decomposition: ParallelDecompositionSpec;
  telemetry?: InSituTelemetryConfig;
  couplingInterfaces?: {
    patchName: string;
    modelicaPort: string;
    updateFrequencyHz: number;
  }[];
}

export interface InSituTelemetrySlice {
  planeId: string;
  time: number;
  step: number;
  origin: [number, number, number];
  normal: [number, number, number];
  numVertices: number;
  numTriangles: number;
  positions: Float32Array; // x, y, z triplets
  indices: Uint32Array; // triangle indices
  fields: Record<string, Float32Array>; // scalar or vector components
}
