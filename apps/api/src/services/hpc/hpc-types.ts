// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core type definitions for ModelScript HPC (High-Performance Computing) orchestration.
 */

export type HpcJobState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface HpcResourceSpec {
  nodes?: number | undefined;
  tasksPerNode?: number | undefined;
  cpusPerTask?: number | undefined;
  gpus?: number | undefined;
  gpuType?: "a100" | "v100" | "t4" | "h100" | undefined;
  memoryMb?: number | undefined;
  timeLimitMinutes?: number | undefined;
  partition?: string | undefined;
  account?: string | undefined;
  qos?: string | undefined;
}

export interface ComputeProfile {
  id: string;
  name: string;
  description: string;
  partition: string;
  cpus: number;
  memoryMb: number;
  gpus?: number | undefined;
  gpuType?: "a100" | "v100" | "t4" | "h100" | undefined;
  tasksPerNode?: number | undefined;
  nodes?: number | undefined;
  costCreditsPerHour: number;
}

import type { JobStagingManifest } from "./staging/staging-types.js";

export interface HpcJobSpec {
  jobId: string;
  name: string;
  command: string;
  args: string[];
  workingDir: string;
  profileId?: string | undefined;
  resources: HpcResourceSpec;
  env?: Record<string, string> | undefined;
  modules?: string[] | undefined;
  apptainerImage?: string | undefined;
  stagingManifest?: JobStagingManifest | undefined;
}

export interface HpcUsageMetrics {
  wallClockSeconds: number;
  cpuCoreSeconds: number;
  peakMemoryMb: number;
  gpuSeconds?: number | undefined;
  costCredits: number;
  nativeJobId?: string | undefined;
  exitCode?: number | undefined;
}

export interface HpcSubmissionResult {
  nativeJobId: string;
  driverType: "local" | "slurm" | "slurm-rest" | "mock";
  allocatedResources: HpcResourceSpec;
  estimatedCreditsPerHour: number;
}

export interface HpcDriver {
  readonly type: "local" | "slurm" | "slurm-rest" | "mock";
  submit(spec: HpcJobSpec): Promise<HpcSubmissionResult>;
  pollStatus(nativeJobId: string): Promise<{ state: HpcJobState; exitCode?: number | undefined }>;
  cancel(nativeJobId: string): Promise<boolean>;
  getMetrics(nativeJobId: string, workingDir: string, profile: ComputeProfile): Promise<HpcUsageMetrics>;
  getLogPath(nativeJobId: string, workingDir: string): string;
}
