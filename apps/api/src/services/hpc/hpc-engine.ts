// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../../database.js";
import { getComputeProfile } from "./compute-profiles.js";
import { KubeRayDriver } from "./drivers/kuberay-driver.js";
import { LocalProcessDriver, type LocalDriverOptions } from "./drivers/local-driver.js";
import { PbsDriver } from "./drivers/pbs-driver.js";
import { SlurmDriver } from "./drivers/slurm-driver.js";
import { SlurmRestDriver } from "./drivers/slurm-rest-driver.js";
import type {
  ComputeProfile,
  HpcDriver,
  HpcDriverType,
  HpcJobSpec,
  HpcSubmissionResult,
  HpcUsageMetrics,
} from "./hpc-types.js";
import { validateResourceLimits } from "./quota-guard.js";
import { getObjectStager, type ObjectStager } from "./staging/index.js";

export interface HpcEngineOptions {
  driver?: HpcDriver | undefined;
  stager?: ObjectStager | undefined;
  defaultBackend?: "local" | "slurm" | "slurm-rest" | "pbs" | "kuberay" | "mock" | undefined;
  localOptions?: LocalDriverOptions | undefined;
}

export interface WaitForCompletionOptions {
  signal?: AbortSignal | undefined;
  maxDeadlineMs?: number | undefined;
  maxConsecutivePollErrors?: number | undefined;
}

function collectInputFilesRecursive(
  baseDir: string,
  currentDir: string,
  result: Record<string, string>,
  depth = 0,
): void {
  if (depth > 8) return;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(baseDir, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      collectInputFilesRecursive(baseDir, fullPath, result, depth + 1);
    } else if (entry.isFile()) {
      if (
        entry.name.startsWith("slurm-") ||
        entry.name.startsWith("pbs-") ||
        entry.name === "output.log" ||
        entry.name === "result.vtu" ||
        entry.name === "run.sbatch" ||
        entry.name === "run.pbs"
      ) {
        continue;
      }
      result[relPath] = fullPath;
    }
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new Error("HPC job wait aborted.");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("HPC job wait aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Unified HPC Engine coordinating job dispatch, compute profiles, remote staging, and cost metrics.
 */
export class HpcEngine {
  private readonly driver: HpcDriver;
  private readonly stager: ObjectStager;
  private readonly nativeToLogicalJobId = new Map<string, string>();

  constructor(options: HpcEngineOptions = {}) {
    if (options.driver) {
      this.driver = options.driver;
    } else {
      const explicitBackend = process.env["HPC_BACKEND"]?.trim().toLowerCase();
      const backend =
        explicitBackend ||
        options.defaultBackend?.toLowerCase() ||
        (process.env["RAY_DASHBOARD_URL"] ? "kuberay" : "local");

      if (backend === "slurm-rest" || (backend === "slurm" && process.env["SLURM_REST_URL"])) {
        this.driver = new SlurmRestDriver({
          baseUrl: process.env["SLURM_REST_URL"] || "http://localhost:6820",
          jwtToken: process.env["SLURM_JWT_TOKEN"],
          username: process.env["SLURM_USER"],
        });
      } else if (backend === "slurm") {
        this.driver = new SlurmDriver();
      } else if (backend === "pbs") {
        this.driver = new PbsDriver();
      } else if (backend === "kuberay") {
        this.driver = new KubeRayDriver({
          baseUrl: process.env["RAY_DASHBOARD_URL"] || "http://localhost:8265",
          token: process.env["RAY_TOKEN"],
        });
      } else if (backend === "local") {
        this.driver = new LocalProcessDriver(options.localOptions);
      } else {
        throw new Error(`Unknown HPC_BACKEND '${backend}'. Expected one of: local, slurm, slurm-rest, pbs, kuberay.`);
      }
    }

    this.stager = options.stager ?? getObjectStager();
  }

  public getDriver(): HpcDriver {
    return this.driver;
  }

  public getStager(): ObjectStager {
    return this.stager;
  }

  /**
   * Prepares and submits a job using the requested compute profile and object staging if configured.
   */
  public async submitJob(
    spec: HpcJobSpec,
    profileId?: string,
  ): Promise<{ submission: HpcSubmissionResult; profile: ComputeProfile }> {
    const profile = getComputeProfile(profileId || spec.profileId);

    // Merge profile defaults into spec resources FIRST, then enforce profile and platform hard limits
    const mergedResources = {
      cpusPerTask: spec.resources.cpusPerTask ?? profile.cpus,
      memoryMb: spec.resources.memoryMb ?? profile.memoryMb,
      partition: spec.resources.partition ?? profile.partition,
      gpus: spec.resources.gpus ?? profile.gpus,
      gpuType: spec.resources.gpuType ?? profile.gpuType,
      tasksPerNode: spec.resources.tasksPerNode ?? profile.tasksPerNode ?? 1,
      nodes: spec.resources.nodes ?? profile.nodes ?? 1,
      timeLimitMinutes: spec.resources.timeLimitMinutes,
      maxWallClockSeconds: spec.resources.maxWallClockSeconds,
      networkIsolation: spec.resources.networkIsolation,
      cpuMaxLimitPercent: spec.resources.cpuMaxLimitPercent,
      memoryMaxMb: spec.resources.memoryMaxMb,
      account: spec.resources.account,
      qos: spec.resources.qos,
    };

    const limitCheck = validateResourceLimits(mergedResources, profile);
    if (!limitCheck.valid) {
      throw new Error(limitCheck.reason || "Requested compute resources exceed platform limits.");
    }

    // If remote S3 staging is active, recursively stage inputs and attach manifest
    let stagingManifest = spec.stagingManifest;
    if (!stagingManifest && this.stager.type === "s3" && fs.existsSync(spec.workingDir)) {
      const inputFiles: Record<string, string> = {};
      collectInputFilesRecursive(spec.workingDir, spec.workingDir, inputFiles);

      const maxWalltimeSeconds =
        mergedResources.maxWallClockSeconds ??
        (mergedResources.timeLimitMinutes
          ? mergedResources.timeLimitMinutes * 60
          : (profile.maxWallClockMinutes ?? 30) * 60);

      stagingManifest = await this.stager.createJobStagingManifest(
        spec.jobId,
        inputFiles,
        ["result.vtu", "scalars.json", "output.log", "residuals.csv"],
        { maxWalltimeSeconds },
      );
    }

    const mergedSpec: HpcJobSpec = {
      ...spec,
      profileId: profile.id,
      stagingManifest,
      resources: mergedResources,
    };

    const submission = await this.driver.submit(mergedSpec);
    this.nativeToLogicalJobId.set(submission.nativeJobId, spec.jobId);
    return { submission, profile };
  }

  /**
   * Awaits job completion, continuously polling status and streaming log chunks.
   */
  public async waitForCompletion(
    nativeJobId: string,
    workingDir: string,
    profile: ComputeProfile,
    onLogChunk?: (chunk: string) => void,
    pollIntervalMs = 500,
    options?: WaitForCompletionOptions,
  ): Promise<HpcUsageMetrics> {
    const logPath = this.driver.getLogPath(nativeJobId, workingDir);
    const signal = options?.signal;
    const maxConsecutivePollErrors = options?.maxConsecutivePollErrors ?? 5;
    const defaultMaxMs = ((profile.maxWallClockMinutes ?? 240) * 60 + 300) * 1000;
    const deadlineTs = Date.now() + (options?.maxDeadlineMs ?? defaultMaxMs);

    let bytesRead = 0;
    let consecutivePollErrors = 0;

    const readNewLocalLogBytes = async () => {
      if (!onLogChunk || !fs.existsSync(logPath)) return;
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > bytesRead) {
          const stream = fs.createReadStream(logPath, { start: bytesRead, end: stats.size - 1 });
          for await (const chunk of stream) {
            onLogChunk(chunk.toString("utf8"));
          }
          bytesRead = stats.size;
        }
      } catch (err) {
        console.warn(`[HpcEngine] Temporary error reading local log ${logPath}:`, err);
      }
    };

    const readNewRemoteLogBytes = async (logicalJobId: string) => {
      if (!onLogChunk || !this.stager.readLogChunk) return;
      const candidateKeys = [`jobs/${logicalJobId}/outputs/output.log`, `jobs/${nativeJobId}/outputs/output.log`];
      for (const key of candidateKeys) {
        try {
          const res = await this.stager.readLogChunk(key, bytesRead);
          if (res && res.chunk.length > 0) {
            onLogChunk(res.chunk);
            bytesRead = res.totalBytes;
            break;
          }
        } catch {
          // Remote file may not exist yet
        }
      }
    };

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error(`Wait for HPC job ${nativeJobId} was aborted.`);
        }
        if (Date.now() > deadlineTs) {
          throw new Error(`Wait for HPC job ${nativeJobId} exceeded maximum deadline.`);
        }

        const logicalJobId = this.nativeToLogicalJobId.get(nativeJobId) ?? nativeJobId;

        // 1. Read any new log content (local or remote in-flight)
        if (onLogChunk) {
          if (fs.existsSync(logPath)) {
            await readNewLocalLogBytes();
          } else if (this.stager.readLogChunk) {
            await readNewRemoteLogBytes(logicalJobId);
          }
        }

        // 2. Check job status with exponential backoff on transient poll errors
        let status: { state: string; exitCode?: number | undefined };
        try {
          status = await this.driver.pollStatus(nativeJobId);
          consecutivePollErrors = 0;
        } catch (err) {
          consecutivePollErrors++;
          console.warn(
            `[HpcEngine] Transient pollStatus error (${consecutivePollErrors}/${maxConsecutivePollErrors}) for job ${nativeJobId}:`,
            err,
          );
          if (consecutivePollErrors >= maxConsecutivePollErrors) {
            throw err;
          }
          const backoffMs = Math.min(30_000, pollIntervalMs * Math.pow(2, consecutivePollErrors - 1));
          await sleepWithAbort(backoffMs, signal);
          continue;
        }

        if (status.state === "COMPLETED" || status.state === "FAILED" || status.state === "CANCELLED") {
          // Read any final log trailing bytes
          if (onLogChunk) {
            if (fs.existsSync(logPath)) {
              await readNewLocalLogBytes();
            } else if (this.stager.readLogChunk) {
              await readNewRemoteLogBytes(logicalJobId);
            }
          }

          // If remote S3 staging was active, pull back remote outputs to workingDir
          if (this.stager.type === "s3") {
            const expectedOutputs = ["result.vtu", "scalars.json", "output.log", "residuals.csv"];
            const candidateJobIds = logicalJobId !== nativeJobId ? [logicalJobId, nativeJobId] : [logicalJobId];
            for (const filename of expectedOutputs) {
              const targetPath = path.join(workingDir, filename);
              if (!fs.existsSync(targetPath)) {
                for (const candidateId of candidateJobIds) {
                  const remoteKey = `jobs/${candidateId}/outputs/${filename}`;
                  try {
                    if (await this.stager.hasObject(remoteKey)) {
                      await this.stager.downloadFile(remoteKey, targetPath);
                      break;
                    }
                  } catch (err) {
                    console.warn(`[HpcEngine] Optional S3 output download failed for ${remoteKey}:`, err);
                  }
                }
              }
            }

            // Stream downloaded remote output.log if local log was not present
            const remoteLogTarget = path.join(workingDir, "output.log");
            if (onLogChunk && bytesRead === 0 && fs.existsSync(remoteLogTarget)) {
              try {
                const content = fs.readFileSync(remoteLogTarget, "utf8");
                if (content) onLogChunk(content);
              } catch (err) {
                console.warn(`[HpcEngine] Failed to read downloaded output.log at ${remoteLogTarget}:`, err);
              }
            }
          }

          const metrics = await this.driver.getMetrics(nativeJobId, workingDir, profile);
          metrics.exitCode = status.exitCode;
          return metrics;
        }

        await sleepWithAbort(pollIntervalMs, signal);
      }
    } finally {
      this.nativeToLogicalJobId.delete(nativeJobId);
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    this.nativeToLogicalJobId.delete(nativeJobId);
    return this.driver.cancel(nativeJobId);
  }

  public async healthCheck(): Promise<{
    ok: boolean;
    driver: HpcDriverType;
    stager: string;
    details?: string | undefined;
  }> {
    if (typeof this.driver.healthCheck === "function") {
      const res = await this.driver.healthCheck();
      return { ok: res.ok, driver: this.driver.type, stager: this.stager.type, details: res.details };
    }
    if (this.driver instanceof SlurmRestDriver) {
      const ping = await this.driver.ping();
      return {
        ok: ping.ok,
        driver: this.driver.type,
        stager: this.stager.type,
        details: ping.ok ? `slurmrestd ${ping.version ?? ""} (${ping.latencyMs}ms)` : "slurmrestd unreachable",
      };
    }
    return { ok: true, driver: this.driver.type, stager: this.stager.type, details: `${this.driver.type} ready` };
  }

  public async shutdown(): Promise<void> {
    if (typeof this.driver.shutdown === "function") {
      await this.driver.shutdown();
    }
    this.nativeToLogicalJobId.clear();
  }

  /**
   * Reconciles orphaned jobs left in RUNNING/PENDING/QUEUED state in the database after an API restart,
   * marking them FAILED and releasing any held credit escrow.
   */
  public async reconcileOrphanedJobs(database: LibraryDatabase): Promise<{ reconciled: number; failed: number }> {
    let reconciled = 0;
    let failed = 0;
    try {
      const orphaned = database.db
        .prepare(`SELECT id, user_id, status FROM jobs WHERE status IN ('RUNNING', 'PENDING', 'QUEUED')`)
        .all() as Array<{ id: number; user_id: number | null; status: string }>;

      for (const job of orphaned) {
        reconciled++;
        try {
          database.updateJobStatus(job.id, "FAILED");
          if (job.user_id) {
            database.releaseUserEscrow(job.user_id, job.id, "API server restarted before job completion");
          }
          failed++;
        } catch (err) {
          console.error(`[HpcEngine] Failed to reconcile orphaned job #${job.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[HpcEngine] Error querying orphaned jobs for reconciliation:", err);
    }
    return { reconciled, failed };
  }
}

let sharedHpcEngine: HpcEngine | null = null;

/**
 * Returns the process-wide shared HpcEngine singleton.
 */
export function getSharedHpcEngine(options?: HpcEngineOptions): HpcEngine {
  if (!sharedHpcEngine) {
    sharedHpcEngine = new HpcEngine(options);
  }
  return sharedHpcEngine;
}

/**
 * Resets the shared HpcEngine singleton (primarily for testing and graceful shutdown).
 */
export function resetSharedHpcEngine(): void {
  sharedHpcEngine = null;
}
