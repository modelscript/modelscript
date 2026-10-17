// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { getComputeProfile } from "./compute-profiles.js";
import { LocalProcessDriver, type LocalDriverOptions } from "./drivers/local-driver.js";
import { SlurmDriver } from "./drivers/slurm-driver.js";
import { SlurmRestDriver } from "./drivers/slurm-rest-driver.js";
import type { ComputeProfile, HpcDriver, HpcJobSpec, HpcSubmissionResult, HpcUsageMetrics } from "./hpc-types.js";
import { validateResourceLimits } from "./quota-guard.js";
import { getObjectStager, type ObjectStager } from "./staging/index.js";

export interface HpcEngineOptions {
  driver?: HpcDriver | undefined;
  stager?: ObjectStager | undefined;
  defaultBackend?: "local" | "slurm" | "slurm-rest" | "mock" | undefined;
  localOptions?: LocalDriverOptions | undefined;
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
      const backend = (process.env["HPC_BACKEND"] || options.defaultBackend || "local").toLowerCase();
      if (backend === "slurm-rest" || (backend === "slurm" && process.env["SLURM_REST_URL"])) {
        this.driver = new SlurmRestDriver({
          baseUrl: process.env["SLURM_REST_URL"] || "http://localhost:6820",
          jwtToken: process.env["SLURM_JWT_TOKEN"],
          username: process.env["SLURM_USER"],
        });
      } else if (backend === "slurm") {
        this.driver = new SlurmDriver();
      } else {
        this.driver = new LocalProcessDriver(options.localOptions);
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

    // Enforce profile and platform hard resource limits
    const limitCheck = validateResourceLimits(spec.resources, profile);
    if (!limitCheck.valid) {
      throw new Error(limitCheck.reason || "Requested compute resources exceed platform limits.");
    }

    // If remote S3 staging is active, stage inputs and attach manifest
    let stagingManifest = spec.stagingManifest;
    if (!stagingManifest && this.stager.type === "s3" && fs.existsSync(spec.workingDir)) {
      const inputFiles: Record<string, string> = {};
      const entries = fs.readdirSync(spec.workingDir);
      for (const entry of entries) {
        const fullPath = path.join(spec.workingDir, entry);
        if (
          fs.statSync(fullPath).isFile() &&
          !entry.startsWith("slurm-") &&
          entry !== "output.log" &&
          entry !== "result.vtu"
        ) {
          inputFiles[entry] = fullPath;
        }
      }

      stagingManifest = await this.stager.createJobStagingManifest(spec.jobId, inputFiles, [
        "result.vtu",
        "scalars.json",
        "output.log",
        "residuals.csv",
      ]);
    }

    // Merge profile defaults into spec resources if not explicitly set
    const mergedSpec: HpcJobSpec = {
      ...spec,
      profileId: profile.id,
      stagingManifest,
      resources: {
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
        account: spec.resources.account,
        qos: spec.resources.qos,
      },
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
  ): Promise<HpcUsageMetrics> {
    const logPath = this.driver.getLogPath(nativeJobId, workingDir);
    let bytesRead = 0;

    // Polling loop
    while (true) {
      // 1. Read any new log content
      if (onLogChunk && fs.existsSync(logPath)) {
        try {
          const stats = fs.statSync(logPath);
          if (stats.size > bytesRead) {
            const stream = fs.createReadStream(logPath, { start: bytesRead, end: stats.size });
            for await (const chunk of stream) {
              onLogChunk(chunk.toString("utf8"));
            }
            bytesRead = stats.size;
          }
        } catch {
          // File may be temporarily locked
        }
      }

      // 2. Check job status
      const status = await this.driver.pollStatus(nativeJobId);
      if (status.state === "COMPLETED" || status.state === "FAILED" || status.state === "CANCELLED") {
        // Read any final log trailing bytes
        if (onLogChunk && fs.existsSync(logPath)) {
          try {
            const stats = fs.statSync(logPath);
            if (stats.size > bytesRead) {
              const stream = fs.createReadStream(logPath, { start: bytesRead, end: stats.size });
              for await (const chunk of stream) {
                onLogChunk(chunk.toString("utf8"));
              }
              bytesRead = stats.size;
            }
          } catch {
            // ignore
          }
        }

        // If remote S3 staging was active, pull back remote outputs to workingDir
        const logicalJobId = this.nativeToLogicalJobId.get(nativeJobId) ?? nativeJobId;
        this.nativeToLogicalJobId.delete(nativeJobId);

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
                } catch {
                  // optional output file may not exist
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
            } catch {
              // ignore
            }
          }
        }

        const metrics = await this.driver.getMetrics(nativeJobId, workingDir, profile);
        metrics.exitCode = status.exitCode;
        return metrics;
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  public async cancel(nativeJobId: string): Promise<boolean> {
    this.nativeToLogicalJobId.delete(nativeJobId);
    return this.driver.cancel(nativeJobId);
  }
}
