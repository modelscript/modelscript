// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { getComputeProfile } from "./compute-profiles.js";
import { LocalProcessDriver } from "./drivers/local-driver.js";
import { SlurmDriver } from "./drivers/slurm-driver.js";
import { SlurmRestDriver } from "./drivers/slurm-rest-driver.js";
import type { ComputeProfile, HpcDriver, HpcJobSpec, HpcSubmissionResult, HpcUsageMetrics } from "./hpc-types.js";
import { getObjectStager, type ObjectStager } from "./staging/index.js";

export interface HpcEngineOptions {
  driver?: HpcDriver | undefined;
  stager?: ObjectStager | undefined;
  defaultBackend?: "local" | "slurm" | "slurm-rest" | "mock" | undefined;
}

/**
 * Unified HPC Engine coordinating job dispatch, compute profiles, remote staging, and cost metrics.
 */
export class HpcEngine {
  private readonly driver: HpcDriver;
  private readonly stager: ObjectStager;

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
        this.driver = new LocalProcessDriver();
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
      },
    };

    const submission = await this.driver.submit(mergedSpec);
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
            }
          } catch {
            // ignore
          }
        }

        // If remote S3 staging was active, pull back remote outputs to workingDir
        if (this.stager.type === "s3") {
          const expectedOutputs = ["result.vtu", "scalars.json", "output.log", "residuals.csv"];
          for (const filename of expectedOutputs) {
            const remoteKey = `jobs/${nativeJobId}/outputs/${filename}`;
            const targetPath = path.join(workingDir, filename);
            if (!fs.existsSync(targetPath)) {
              try {
                if (await this.stager.hasObject(remoteKey)) {
                  await this.stager.downloadFile(remoteKey, targetPath);
                }
              } catch {
                // optional output file may not exist
              }
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
    return this.driver.cancel(nativeJobId);
  }
}
