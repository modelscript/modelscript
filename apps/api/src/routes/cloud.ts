// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DataPackageLockJson } from "@modelscript/exchange";
import express, { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { simulateRateLimiter } from "../middleware/rate-limiter.js";
import { CaeSolverRunner, getValidatedGeometryPath, type CaeJobSpec } from "../services/cae-solver-runner.js";
import {
  CaeTelemetryStreamer,
  type CaeSolverType,
  type CaeTelemetryEvent,
} from "../services/cae-telemetry-streamer.js";
import {
  assertComputeJobAccess,
  failComputeJob,
  holdComputeEscrow,
  resolveComputeActor,
  runComputePreflight,
} from "../services/compute-job-lifecycle.js";
import { getComputeProfile, listComputeProfiles } from "../services/hpc/compute-profiles.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import type { HpcJobSpec, HpcUsageMetrics } from "../services/hpc/hpc-types.js";
import { prepareNativeSimulation, type NativeSimPrepResult } from "../services/simulation/native-sim-runner.js";
import type { LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { resolveDataPackageLockfile } from "../util/datapackage-indexer.js";
import { scanModelicaSource } from "../util/package-scanner.js";

export const ALLOWED_CLOUD_DOMAINS = new Set<string>(["modelica", "cfd", "fea", "monte-carlo"]);
const MAX_RETAINED_CLOUD_JOBS = 500;
const MAX_CLOUD_JOB_LOGS = 2000;
const MAX_RETAINED_PAYLOAD_BYTES = 256 * 1024; // 256 KB cap for in-memory replay payload
const MAX_SSE_SUBSCRIBERS_PER_JOB = 20;

export interface CloudDispatchPayload {
  domain: "modelica" | "cfd" | "fea" | "monte-carlo";
  name: string;
  engine?: "modelscript" | "omc" | undefined;
  profile?: string | undefined;
  sourceContent?: string | undefined;
  libraryName?: string | undefined;
  libraryVersion?: string | undefined;
  dependencies?: { name: string; version: string }[] | undefined;
  deck?:
    | {
        content: string;
        format: "cfg" | "inp";
      }
    | undefined;
  geometryPath?: string | undefined;
  experiment?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        numberOfIntervals?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  parameters?: Record<string, unknown> | undefined;
  monteCarlo?:
    | {
        samples: number;
        seed?: number | undefined;
      }
    | undefined;
}

export interface CloudJobRecord {
  jobId: string;
  nativeJobId?: string | undefined;
  dbJobId?: number | null | undefined;
  userId?: number | null | undefined;
  domain: string;
  name: string;
  profile: string;
  payload?: CloudDispatchPayload | undefined;
  lockfile?: DataPackageLockJson | undefined;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  logs: string[];
  resultPath?: string | undefined;
  tmpDir?: string | undefined;
  error?: string | undefined;
  startTime: number;
  endTime?: number | undefined;
  usage?: HpcUsageMetrics | undefined;
  subscribers: ((event: { type: string; data: unknown }) => void)[];
}

const activeJobs = new Map<string, CloudJobRecord>();
const jobCancelHandlers = new WeakMap<CloudJobRecord, () => Promise<void>>();
const jobEnqueueHandlers = new WeakMap<
  CloudJobRecord,
  (jobRecord: CloudJobRecord, payload: CloudDispatchPayload) => void
>();

function sanitizeDispositionName(value: string): string {
  return String(value || "job").replace(/[^a-zA-Z0-9_.-]/g, "_") || "job";
}

function appendJobLog(jobRecord: CloudJobRecord, line: string): void {
  if (jobRecord.logs.length >= MAX_CLOUD_JOB_LOGS) {
    jobRecord.logs.splice(0, jobRecord.logs.length - MAX_CLOUD_JOB_LOGS + 1);
  }
  jobRecord.logs.push(line);
}

function getRetainablePayload(payload: CloudDispatchPayload): CloudDispatchPayload | undefined {
  const sourceBytes = typeof payload.sourceContent === "string" ? Buffer.byteLength(payload.sourceContent, "utf8") : 0;
  const deckBytes = typeof payload.deck?.content === "string" ? Buffer.byteLength(payload.deck.content, "utf8") : 0;
  if (sourceBytes + deckBytes > MAX_RETAINED_PAYLOAD_BYTES) {
    return undefined;
  }
  return payload;
}

function pruneCloudJobs(): void {
  if (activeJobs.size <= MAX_RETAINED_CLOUD_JOBS) return;
  for (const [id, rec] of activeJobs.entries()) {
    if (activeJobs.size <= MAX_RETAINED_CLOUD_JOBS) break;
    if (rec.status === "completed" || rec.status === "failed" || rec.status === "cancelled") {
      if (rec.tmpDir) {
        try {
          fs.rmSync(rec.tmpDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup of evicted cloud job temp directory
        }
      }
      activeJobs.delete(id);
    }
  }
}

export function getActiveCloudJob(jobId: string): CloudJobRecord | undefined {
  return activeJobs.get(jobId);
}

/**
 * Cancels an active cloud job: terminates the underlying HPC / CAE process FIRST,
 * then marks the job cancelled, notifies SSE subscribers, and releases any held DB escrow.
 */
export async function cancelActiveCloudJob(
  jobId: string,
  database?: LibraryDatabase,
  reason = "User requested cancellation",
): Promise<{ found: boolean; alreadyTerminal: boolean; job?: CloudJobRecord | undefined }> {
  const job = activeJobs.get(jobId);
  if (!job) {
    return { found: false, alreadyTerminal: false };
  }
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    return { found: true, alreadyTerminal: true, job };
  }

  // Terminate the underlying CAE solver or HPC cluster job before updating status/escrow
  const cancelUnderlying = jobCancelHandlers.get(job);
  if (cancelUnderlying) {
    try {
      await cancelUnderlying();
    } catch {
      // Best-effort termination of underlying cluster process
    }
  }

  job.status = "cancelled";
  job.endTime = Date.now();
  appendJobLog(job, `[Cloud] Job was cancelled (${reason}).`);

  for (const sub of [...job.subscribers]) {
    try {
      sub({ type: "status", data: { status: "cancelled" } });
    } catch {
      // Ignore disconnected SSE subscriber errors
    }
  }

  if (database && job.dbJobId) {
    database.updateJobStatus(job.dbJobId, "CANCELLED");
    if (job.userId) {
      database.releaseUserEscrow(job.userId, job.dbJobId, reason);
    }
  }

  return { found: true, alreadyTerminal: false, job };
}

/**
 * Registers and enqueues a retried cloud job using the original job's execution handler.
 * Returns `false` if no execution handler or replay payload is available.
 */
export function enqueueRetriedCloudJob(
  existingJob: CloudJobRecord,
  retriedJob: CloudJobRecord,
  payload: CloudDispatchPayload,
): boolean {
  const enqueueFn = jobEnqueueHandlers.get(existingJob);
  if (!enqueueFn) {
    return false;
  }
  activeJobs.set(retriedJob.jobId, retriedJob);
  enqueueFn(retriedJob, payload);
  return true;
}

export function cloudRouter(storage: LibraryStorage, jobQueue: JobQueue, database?: LibraryDatabase): Router {
  const router = express.Router();
  const hpcEngine = new HpcEngine();
  const caeRunner = new CaeSolverRunner(hpcEngine);

  const CAE_CACHE_DIR = path.join(process.cwd(), "data", "physics-cache");
  if (!fs.existsSync(CAE_CACHE_DIR)) {
    fs.mkdirSync(CAE_CACHE_DIR, { recursive: true });
  }

  const enqueueCloudExecution = (jobRecord: CloudJobRecord, payload: CloudDispatchPayload): void => {
    const { domain = "modelica", name } = payload;
    const profile = getComputeProfile(jobRecord.profile);
    const jobId = jobRecord.jobId;
    const dbJobId = jobRecord.dbJobId ?? null;
    const userId = jobRecord.userId ?? null;

    jobEnqueueHandlers.set(jobRecord, enqueueCloudExecution);
    jobCancelHandlers.set(jobRecord, async () => {
      if (jobRecord.domain === "cfd" || jobRecord.domain === "fea") {
        caeRunner.cancelJob(jobRecord.jobId);
      } else {
        await hpcEngine.cancel(jobRecord.nativeJobId || jobRecord.jobId);
      }
    });

    const broadcast = (event: { type: string; data: unknown }) => {
      for (const sub of [...jobRecord.subscribers]) {
        try {
          sub(event);
        } catch {
          // Ignore disconnected SSE subscriber errors
        }
      }
    };

    jobQueue.enqueue(jobId, async () => {
      if ((jobRecord.status as string) === "cancelled") {
        return;
      }
      jobRecord.status = "running";
      appendJobLog(jobRecord, `[Cloud] Job started running on compute cluster.`);
      broadcast({ type: "status", data: { status: "running" } });

      if (domain === "cfd" || domain === "fea") {
        // Handle CAE (CalculiX or SU2)
        const format = payload.deck?.format || (domain === "cfd" ? "cfg" : "inp");
        const solver: CaeSolverType = domain === "cfd" ? "su2" : "calculix";
        const resultDir = path.join(CAE_CACHE_DIR, jobId);

        const streamer = new CaeTelemetryStreamer(solver);
        streamer.on("telemetry", (event: CaeTelemetryEvent) => {
          if (event.type === "iteration") {
            broadcast({ type: "iteration", data: event });
            if (event.rawLog) {
              appendJobLog(jobRecord, event.rawLog);
              broadcast({ type: "log", data: event.rawLog });
            }
          } else if (event.type === "phase") {
            if (event.message) {
              appendJobLog(jobRecord, `[${event.phase}] ${event.message}`);
              broadcast({ type: "log", data: `[${event.phase}] ${event.message}` });
            }
          } else if (event.type === "error") {
            appendJobLog(jobRecord, `[Error] ${event.message}`);
            broadcast({ type: "log", data: `[Error] ${event.message}` });
          }
        });

        let safeGeometryPath: string | undefined;
        if (payload.geometryPath && typeof payload.geometryPath === "string") {
          try {
            safeGeometryPath = getValidatedGeometryPath(payload.geometryPath);
          } catch {
            safeGeometryPath = undefined;
          }
        }

        const caeSpec: CaeJobSpec = {
          jobId,
          solver,
          deckContent: payload.deck?.content || payload.sourceContent || "",
          deckFormat: format,
          geometryPath: safeGeometryPath,
          cores: profile.cpus,
          profile: profile.id,
          resultDir,
        };

        try {
          const result = await caeRunner.executeJob(caeSpec, streamer);
          jobRecord.endTime = Date.now();
          jobRecord.usage = result.usage;

          if ((jobRecord.status as string) === "cancelled" || result.status === "cancelled") {
            jobRecord.status = "cancelled";
            return;
          }

          if (result.status === "completed") {
            jobRecord.status = "completed";
            jobRecord.resultPath = result.resultVtuPath || path.join(resultDir, "result.vtu");
            appendJobLog(jobRecord, `[Cloud] CAE computation completed successfully.`);
            broadcast({ type: "status", data: { status: "completed", resultPath: jobRecord.resultPath } });

            if (database && dbJobId) {
              database.updateJobStatus(dbJobId, "SUCCESS");
              if (result.usage) {
                const effectiveCost = result.simulatedFallback ? 0 : (result.usage.costCredits ?? 0);
                database.updateJobAccounting(dbJobId, {
                  ...result.usage,
                  costCredits: effectiveCost,
                });
                if (userId) {
                  database.settleUserEscrow(userId, dbJobId, effectiveCost, `Cloud CAE: ${name}`, {
                    profile: profile.id,
                    ...result.usage,
                    costCredits: effectiveCost,
                    simulatedFallback: Boolean(result.simulatedFallback),
                  });
                }
              }
              if (userId) {
                database.createNotification(userId, userId, "simulation_completed", null, {
                  jobId: jobRecord.jobId,
                  dbJobId,
                  name: name || caeSpec.solver,
                  domain: "cae",
                  solver: caeSpec.solver,
                  duration: ((jobRecord.endTime - jobRecord.startTime) / 1000).toFixed(2),
                  profile: profile.id,
                  status: "completed",
                });
              }
            }
          } else {
            jobRecord.status = "failed";
            jobRecord.error = result.error || "CAE solver failed";
            broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
            if (database && dbJobId) {
              failComputeJob({
                database,
                dbJobId,
                userId,
                error: jobRecord.error,
                fallbackMessage: "CAE solver failed",
              });
              if (userId) {
                database.createNotification(userId, userId, "simulation_failed", null, {
                  jobId: jobRecord.jobId,
                  dbJobId,
                  name: name || caeSpec.solver,
                  domain: "cae",
                  solver: caeSpec.solver,
                  error: jobRecord.error,
                  profile: profile.id,
                  status: "failed",
                });
              }
            }
          }
        } catch (err: unknown) {
          if ((jobRecord.status as string) === "cancelled") return;
          jobRecord.status = "failed";
          jobRecord.error = err instanceof Error ? err.message : String(err);
          broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
          if (database && dbJobId) {
            failComputeJob({
              database,
              dbJobId,
              userId,
              error: jobRecord.error,
              fallbackMessage: "CAE execution error",
            });
            if (userId) {
              database.createNotification(userId, userId, "simulation_failed", null, {
                jobId: jobRecord.jobId,
                dbJobId,
                name: name || caeSpec.solver,
                domain: "cae",
                solver: caeSpec.solver,
                error: jobRecord.error,
                profile: profile.id,
                status: "failed",
              });
            }
          }
        }
      } else {
        // Handle Modelica / Monte Carlo
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `modelscript-cloud-${jobId}-`));
        jobRecord.tmpDir = tmpDir;
        try {
          const mosScriptPath = path.join(tmpDir, "simulate.mos");
          const fileNamePrefix = path.basename(name).replace(/[^a-zA-Z0-9_]/g, "_") || "model";
          const adhocMoPath = path.resolve(tmpDir, `${fileNamePrefix}.mo`);
          if (!adhocMoPath.startsWith(tmpDir + path.sep)) {
            throw new Error("Invalid model file path");
          }

          const source = payload.sourceContent || "";
          fs.writeFileSync(adhocMoPath, source, "utf8");

          // Enforce simulation parameter bounds matching simulate.ts
          const rawStartTime = Number(payload.experiment?.startTime);
          const startTime = Number.isFinite(rawStartTime) ? rawStartTime : 0.0;
          const rawStopTime = Number(payload.experiment?.stopTime);
          const unboundedStopTime = Number.isFinite(rawStopTime) ? rawStopTime : startTime + 10.0;
          const stopTime = Math.min(Math.max(unboundedStopTime, startTime + 1e-6), startTime + 86_400);
          const rawIntervals = Number(payload.experiment?.numberOfIntervals);
          const numberOfIntervals = Number.isFinite(rawIntervals)
            ? Math.min(Math.max(1, Math.floor(rawIntervals)), 50_000)
            : 500;
          const rawTolerance = Number(payload.experiment?.tolerance);
          const tolerance = Number.isFinite(rawTolerance) ? Math.min(Math.max(rawTolerance, 1e-12), 1.0) : 1e-6;

          const safeModelName = String(name).replace(/[^a-zA-Z0-9_.]/g, "") || "Model";
          const simArgs = [
            safeModelName,
            `startTime=${startTime}`,
            `stopTime=${stopTime}`,
            `numberOfIntervals=${numberOfIntervals}`,
            `tolerance=${tolerance}`,
            `outputFormat="csv"`,
          ];
          if (payload.parameters && Object.keys(payload.parameters).length > 0) {
            const overrides = Object.entries(payload.parameters)
              .map(([k, v]) => {
                const safeKey = String(k).replace(/[^a-zA-Z0-9_.[\]]/g, "");
                const safeVal = String(v).replace(/["\r\n;\\]/g, "");
                return safeKey ? `${safeKey}=${safeVal}` : "";
              })
              .filter(Boolean)
              .join(",");
            if (overrides) {
              simArgs.push(`simflags="-override=${overrides}"`);
            }
          }

          const mosContents = `
loadFile("${adhocMoPath.replace(/\\/g, "/").replace(/"/g, "")}");
simulate(${simArgs.join(", ")});
getErrorString();
`;
          fs.writeFileSync(mosScriptPath, mosContents, "utf8");

          // Native ModelScript simulation engine vs OMC
          const enginePreference = payload.engine ?? "modelscript";
          let prep: NativeSimPrepResult | null = null;
          if (enginePreference !== "omc") {
            prep = await prepareNativeSimulation(tmpDir, {
              modelName: safeModelName,
              sourceFiles: [adhocMoPath],
              startTime,
              stopTime,
              numberOfIntervals,
              tolerance,
            });
          }

          const isNative = prep !== null;

          const isSandboxEnabled =
            process.env["HPC_SANDBOX_ENABLED"] === "true" ||
            (process.env["NODE_ENV"] === "production" && process.env["HPC_SANDBOX_ENABLED"] !== "false");

          const defaultSandbox = isSandboxEnabled
            ? {
                enabled: true,
                networkIsolation: true,
                readOnlyRoot: true,
                dropCapabilities: true,
                tmpfsSizeMb: 512,
              }
            : undefined;

          let hpcSpec: HpcJobSpec;
          if (isNative && prep) {
            hpcSpec = {
              jobId,
              name: `Cloud-${fileNamePrefix}`,
              command: "bash",
              args: [prep.runScript],
              workingDir: tmpDir,
              env: {
                OMP_NUM_THREADS: String(profile.cpus),
              },
              profileId: profile.id,
              ...(userId ? { userId } : {}),
              sandbox: defaultSandbox,
              resources: {
                cpusPerTask: profile.cpus,
                memoryMb: profile.memoryMb,
                partition: profile.partition,
                gpus: profile.gpus,
                networkIsolation: isSandboxEnabled,
              },
            };
          } else {
            hpcSpec = {
              jobId,
              name: `Cloud-${fileNamePrefix}`,
              command: "omc",
              args: [mosScriptPath],
              workingDir: tmpDir,
              env: {
                OMP_NUM_THREADS: String(profile.cpus),
              },
              profileId: profile.id,
              ...(userId ? { userId } : {}),
              sandbox: defaultSandbox,
              resources: {
                cpusPerTask: profile.cpus,
                memoryMb: profile.memoryMb,
                partition: profile.partition,
                gpus: profile.gpus,
                networkIsolation: isSandboxEnabled,
              },
            };
          }

          const { submission } = await hpcEngine.submitJob(hpcSpec, profile.id);
          jobRecord.nativeJobId = submission.nativeJobId;

          if ((jobRecord.status as string) === "cancelled") {
            await hpcEngine.cancel(submission.nativeJobId);
            return;
          }

          const usage = await hpcEngine.waitForCompletion(submission.nativeJobId, tmpDir, profile);

          if ((jobRecord.status as string) === "cancelled") {
            return;
          }

          const csvFilePath = path.resolve(tmpDir, `${fileNamePrefix}_res.csv`);
          if (csvFilePath.startsWith(tmpDir + path.sep) && fs.existsSync(csvFilePath)) {
            // Persist CSV result outside tmpDir so tmpDir is always cleaned up in finally
            const resultDir = path.resolve(os.tmpdir(), "modelscript-cloud-results");
            fs.mkdirSync(resultDir, { recursive: true });
            try {
              const existingFiles = fs.readdirSync(resultDir).filter((f) => f.endsWith("_res.csv"));
              if (existingFiles.length > 200) {
                const cutoffMs = Date.now() - 60 * 60 * 1000;
                for (const file of existingFiles) {
                  const fp = path.join(resultDir, file);
                  try {
                    const st = fs.statSync(fp);
                    if (st.mtimeMs < cutoffMs) {
                      fs.rmSync(fp, { force: true });
                    }
                  } catch {
                    // Ignore individual stat/rm errors during stale cache sweep
                  }
                }
              }
            } catch {
              // Best-effort stale cache sweep
            }
            const safeJobFileName = `${sanitizeDispositionName(path.basename(jobId))}_res.csv`;
            const persistedCsvPath = path.resolve(resultDir, safeJobFileName);
            const relPersisted = path.relative(resultDir, persistedCsvPath);
            if (!relPersisted || relPersisted.startsWith("..") || path.isAbsolute(relPersisted)) {
              throw new Error("Invalid CSV destination path");
            }
            fs.copyFileSync(csvFilePath, persistedCsvPath);

            jobRecord.status = "completed";
            jobRecord.resultPath = persistedCsvPath;
            jobRecord.usage = usage;
            jobRecord.endTime = Date.now();
            appendJobLog(
              jobRecord,
              `[Cloud] Modelica simulation completed in ${((jobRecord.endTime - jobRecord.startTime) / 1000).toFixed(1)}s.`,
            );
            broadcast({ type: "status", data: { status: "completed", resultPath: persistedCsvPath, usage } });

            if (database && dbJobId) {
              database.updateJobStatus(dbJobId, "SUCCESS");
              database.updateJobAccounting(dbJobId, usage);
              if (userId) {
                database.settleUserEscrow(userId, dbJobId, usage.costCredits ?? 0, `Cloud Sim: ${name}`, {
                  profile: profile.id,
                  ...usage,
                });
                database.createNotification(userId, userId, "simulation_completed", null, {
                  jobId: jobRecord.jobId,
                  dbJobId,
                  name,
                  domain: "modelica",
                  engine: isNative ? "modelscript" : "omc",
                  duration: ((jobRecord.endTime - jobRecord.startTime) / 1000).toFixed(2),
                  profile: profile.id,
                  status: "completed",
                });
              }
            }
          } else {
            jobRecord.status = "failed";
            const logPath = path.join(tmpDir, "simulate.log");
            let details = "";
            if (fs.existsSync(logPath)) {
              details = fs.readFileSync(logPath, "utf8");
            }
            jobRecord.error = details || "Simulation failed to produce CSV results";
            broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
            if (database && dbJobId) {
              failComputeJob({
                database,
                dbJobId,
                userId,
                error: jobRecord.error,
                fallbackMessage: "Simulation failed",
              });
              if (userId) {
                database.createNotification(userId, userId, "simulation_failed", null, {
                  jobId: jobRecord.jobId,
                  dbJobId,
                  name,
                  domain: "modelica",
                  engine: isNative ? "modelscript" : "omc",
                  error: jobRecord.error,
                  profile: profile.id,
                  status: "failed",
                });
              }
            }
          }
        } catch (err: unknown) {
          if ((jobRecord.status as string) === "cancelled") return;
          jobRecord.status = "failed";
          jobRecord.error = err instanceof Error ? err.message : String(err);
          broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
          if (database && dbJobId) {
            failComputeJob({
              database,
              dbJobId,
              userId,
              error: jobRecord.error,
              fallbackMessage: "Simulation error",
            });
            if (userId) {
              database.createNotification(userId, userId, "simulation_failed", null, {
                jobId: jobRecord.jobId,
                dbJobId,
                name,
                domain: "modelica",
                engine: payload.engine ?? "modelscript",
                error: jobRecord.error,
                profile: profile.id,
                status: "failed",
              });
            }
          }
        } finally {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // Best-effort cleanup of cloud job temp directory
          }
          jobRecord.tmpDir = undefined;
        }
      }
      pruneCloudJobs();
    });
  };

  // ── 1. GET /api/v1/cloud/profiles ──
  // List all available compute profiles with hardware specs & credit rates
  router.get("/cloud/profiles", (_req: Request, res: Response): void => {
    res.json({
      profiles: listComputeProfiles(),
    });
  });

  // ── 2. GET /api/v1/cloud/balance ──
  // Fetch current user wallet balance and quota status
  router.get("/cloud/balance", (req: Request, res: Response): void => {
    try {
      if (!database) {
        res.json({ balance: 1000, creditBalance: 1000, tier: "unlimited" });
        return;
      }
      const { userId } = resolveComputeActor(req, database);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const balance = database.getUserBalance(userId);
      const summary = database.getUserBillingSummary(userId);
      res.json({
        userId,
        balance,
        creditBalance: balance,
        totalSpent: summary.totalSpent,
        totalJobs: summary.totalJobs,
        totalCpuSeconds: summary.totalCpuSeconds,
        totalGpuSeconds: summary.totalGpuSeconds,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── 3. POST /api/v1/cloud/dispatch ──
  // Unified entry point for dispatching Modelica, CFD, FEA, or Monte Carlo jobs
  router.post(
    ["/cloud/dispatch", "/cloud/jobs", "/hpc/jobs"],
    simulateRateLimiter,
    enforceExportCompliance(() => database),
    async (req: Request, res: Response): Promise<void> => {
      const payload = (req.body ?? {}) as CloudDispatchPayload;
      const { domain = "modelica", name, profile: requestedProfile } = payload;

      if (typeof domain !== "string" || !ALLOWED_CLOUD_DOMAINS.has(domain)) {
        res.status(400).json({
          error: `Invalid domain '${String(domain)}'. Allowed domains: modelica, cfd, fea, monte-carlo.`,
        });
        return;
      }

      if (!name) {
        res.status(400).json({ error: "Missing required parameter: 'name'" });
        return;
      }

      if ((domain === "modelica" || domain === "monte-carlo") && typeof payload.sourceContent === "string") {
        const sourceViolations = scanModelicaSource(payload.sourceContent);
        if (sourceViolations.length > 0) {
          res.status(400).json({
            error: `Security violation in sourceContent: ${sourceViolations.join(", ")}`,
            violations: sourceViolations,
          });
          return;
        }
      }

      const preflight = runComputePreflight(req, res, database, {
        profileId: requestedProfile,
        allowAnonymous: process.env["NODE_ENV"] !== "production",
      });
      if (!preflight.allowed) {
        return;
      }
      const { userId, profile, estimatedCost } = preflight;

      const jobId = `cloud_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
      let lockfile: DataPackageLockJson | undefined;
      if (database) {
        try {
          const extraDeps: Record<string, string> = {};
          for (const dep of payload.dependencies ?? []) {
            if (dep?.name && dep?.version) {
              extraDeps[dep.name] = dep.version;
            }
          }
          const rootName = payload.libraryName || name;
          const rootVersion = payload.libraryVersion || "0.0.0";
          const solverName = domain === "cfd" ? "su2" : domain === "fea" ? "calculix" : (payload.engine ?? "omc");
          lockfile = resolveDataPackageLockfile(storage, database, rootName, rootVersion, {
            extraDependencies: extraDeps,
            sourceContent: payload.sourceContent || payload.deck?.content,
            engine: payload.engine ?? (domain === "modelica" ? "omc" : domain),
            experiment: payload.experiment
              ? {
                  solver: solverName,
                  startTime: payload.experiment.startTime,
                  stopTime: payload.experiment.stopTime,
                  interval: payload.experiment.interval,
                  numberOfIntervals: payload.experiment.numberOfIntervals,
                  tolerance: payload.experiment.tolerance,
                }
              : { solver: solverName },
          });
        } catch {
          // Non-fatal if lockfile generation fails
        }
      }

      const jobRecord: CloudJobRecord = {
        jobId,
        userId,
        domain,
        name,
        profile: profile.id,
        payload: getRetainablePayload(payload),
        lockfile,
        status: "queued",
        logs: [
          `[Cloud] Job ${jobId} queued with profile '${profile.name}' (${profile.cpus} CPUs, ${profile.memoryMb}MB RAM)`,
          ...(lockfile
            ? [`[Lockfile] Locked ${Object.keys(lockfile.packages).length} package(s) — environment reproducible`]
            : []),
        ],
        startTime: Date.now(),
        subscribers: [],
      };

      let dbJobId: number | null = null;
      const billingActive = Boolean(database && userId && estimatedCost > 0);
      if (database) {
        try {
          dbJobId = database.createJob(
            `Cloud [${domain.toUpperCase()}]: ${name}`,
            "RUNNING",
            "ADHOC",
            domain === "modelica" ? "omc" : domain,
            null,
            { jobId, profile: profile.id, domain, lockfilePackages: lockfile ? Object.keys(lockfile.packages) : [] },
            userId,
          );
          jobRecord.dbJobId = dbJobId;
        } catch (err) {
          console.error("[CloudRouter] Failed to create DB job record:", err);
          if (billingActive) {
            res.status(503).json({
              error: "Compute billing service temporarily unavailable. Please try again later.",
            });
            return;
          }
        }
      }

      if (database) {
        try {
          if (
            !holdComputeEscrow({
              database,
              res,
              userId,
              dbJobId,
              estimatedCost,
              description: `HPC Escrow Hold: Cloud [${domain.toUpperCase()}] ${name}`,
              metadata: { jobId, profile: profile.id, domain },
            })
          ) {
            return;
          }
        } catch (err) {
          console.error("[CloudRouter] Failed to hold compute escrow:", err);
          if (billingActive) {
            res.status(503).json({
              error: "Compute billing service temporarily unavailable. Please try again later.",
            });
            return;
          }
        }
      }

      // Only insert into activeJobs AFTER DB job creation and escrow succeed
      activeJobs.set(jobId, jobRecord);

      // Dispatch asynchronously to job queue
      enqueueCloudExecution(jobRecord, payload);

      res.status(202).json({
        jobId,
        dbJobId,
        status: "queued",
        profile: profile.id,
        lockfile,
        streamUrl: `/api/v1/cloud/jobs/${jobId}/events`,
        message: `Job ${jobId} successfully dispatched to Ansatz Cloud (powered by ModelScript) with profile '${profile.name}'.`,
      });
    },
  );

  // ── 4. GET /api/v1/cloud/jobs ──
  // List active and historical jobs (paginated)
  router.get("/cloud/jobs", (req: Request, res: Response): void => {
    const reqAny = req as { userId?: number | undefined };
    const actor = resolveComputeActor(req, database);
    const authUserId = actor.userId ?? reqAny.userId ?? undefined;
    if (process.env["NODE_ENV"] === "production" && !authUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const rawLimit = parseInt(String(req.query["limit"] ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const rawOffset = parseInt(String(req.query["offset"] ?? ""), 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const list: {
      jobId: string;
      dbJobId?: number | null | undefined;
      domain: string;
      name: string;
      profile: string;
      status: string;
      startTime: number;
      endTime?: number | undefined;
      costCredits?: number | undefined;
      error?: string | undefined;
    }[] = [];

    for (const [id, job] of activeJobs.entries()) {
      if (process.env["NODE_ENV"] === "production" && !actor.isAdmin) {
        if (job.userId === undefined || job.userId === null || job.userId !== authUserId) {
          continue;
        }
      } else if (
        authUserId !== undefined &&
        job.userId !== undefined &&
        job.userId !== null &&
        job.userId !== authUserId
      ) {
        continue;
      }
      list.push({
        jobId: id,
        dbJobId: job.dbJobId ?? null,
        domain: job.domain,
        name: job.name,
        profile: job.profile,
        status: job.status,
        startTime: job.startTime,
        endTime: job.endTime,
        costCredits: job.usage?.costCredits,
        error: job.error,
      });
    }

    const reversed = list.reverse();
    const total = reversed.length;
    const paginated = reversed.slice(offset, offset + limit);

    res.json({ jobs: paginated, total, limit, offset });
  });

  const allowUnownedCloudJob = () => process.env["NODE_ENV"] !== "production";

  // ── 5. GET /api/v1/cloud/jobs/:id ──
  // Inspect single job details and status
  router.get("/cloud/jobs/:id", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }

    const elapsed = (((job.endTime || Date.now()) - job.startTime) / 1000).toFixed(1);
    res.json({
      jobId: job.jobId,
      domain: job.domain,
      name: job.name,
      profile: job.profile,
      status: job.status,
      elapsedSeconds: parseFloat(elapsed),
      startTime: job.startTime,
      endTime: job.endTime,
      usage: job.usage,
      lockfile: job.lockfile,
      error: job.error,
      hasResult: Boolean(job.resultPath && fs.existsSync(job.resultPath)),
    });
  });

  // ── 5b. GET /api/v1/cloud/jobs/:id/lockfile ──
  // Export the reproducible datapackage.lock.json associated with this cloud job
  router.get("/cloud/jobs/:id/lockfile", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }
    if (!job.lockfile) {
      res.status(404).json({ error: `No lockfile recorded for job '${req.params["id"]}'` });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizeDispositionName(job.jobId)}.datapackage.lock.json"`,
    );
    res.json(job.lockfile);
  });

  // ── 6. GET /api/v1/cloud/jobs/:id/logs ──
  // Tail execution logs
  router.get("/cloud/jobs/:id/logs", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      logs: job.logs,
    });
  });

  // ── 7. GET /api/v1/cloud/jobs/:id/events ──
  // Real-time Server-Sent Events (SSE) stream for terminal, webview, and ansatz
  router.get("/cloud/jobs/:id/events", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }

    const isTerminal = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
    if (!isTerminal && job.subscribers.length >= MAX_SSE_SUBSCRIBERS_PER_JOB) {
      res.status(429).json({ error: "Too many active event stream subscribers for this job" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Send initial status
    res.write(`data: ${JSON.stringify({ type: "init", status: job.status, logs: job.logs })}\n\n`);

    // Immediately close stream if job is already in a terminal state
    if (isTerminal) {
      res.end();
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(heartbeat);
      const idx = job.subscribers.indexOf(listener);
      if (idx !== -1) {
        job.subscribers.splice(idx, 1);
      }
    };

    const listener = (event: { type: string; data: unknown }) => {
      if (res.writableEnded || res.destroyed) {
        cleanup();
        return;
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      const eventData = event.data as { status?: string | undefined } | null | undefined;
      if (
        event.type === "status" &&
        (eventData?.status === "completed" || eventData?.status === "failed" || eventData?.status === "cancelled")
      ) {
        cleanup();
        res.end();
      }
    };

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        cleanup();
        return;
      }
      try {
        res.write(": keepalive\n\n");
      } catch {
        cleanup();
      }
    }, 25_000);
    heartbeat.unref?.();

    job.subscribers.push(listener);

    req.on("close", cleanup);
  });

  // ── 8. GET /api/v1/cloud/jobs/:id/result ──
  // Stream or download result file (CSV or VTU)
  router.get("/cloud/jobs/:id/result", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Results for job '${req.params["id"]}' not available or job still in progress` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }
    if (!job.resultPath || !fs.existsSync(job.resultPath)) {
      res.status(404).json({ error: `Results for job '${req.params["id"]}' not available or job still in progress` });
      return;
    }

    const safeName = sanitizeDispositionName(job.name);
    const ext = path.extname(job.resultPath).toLowerCase();
    if (ext === ".csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}_res.csv"`);
    } else if (ext === ".vtu") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}_mesh.vtu"`);
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
    }

    fs.createReadStream(job.resultPath).pipe(res);
  });

  // ── 9. POST /api/v1/cloud/jobs/:id/cancel ──
  // Cancel active job
  router.post("/cloud/jobs/:id/cancel", async (req: Request, res: Response): Promise<void> => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (
      !assertComputeJobAccess(req, res, database, { ownerId: job.userId, allowWhenUnowned: allowUnownedCloudJob() })
    ) {
      return;
    }

    const result = await cancelActiveCloudJob(job.jobId, database, "User requested cancellation");
    if (result.alreadyTerminal) {
      res.json({ success: true, message: `Job ${job.jobId} is already ${job.status}.` });
      return;
    }

    res.json({ success: true, message: `Job ${job.jobId} cancelled.` });
  });

  // ── 10. POST /api/v1/cloud/jobs/:id/retry ──
  // Re-dispatch a failed or cancelled cloud job
  router.post(
    "/cloud/jobs/:id/retry",
    simulateRateLimiter,
    enforceExportCompliance(() => database),
    (req: Request, res: Response): void => {
      const existing = activeJobs.get(req.params["id"] as string);
      if (!existing) {
        res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
        return;
      }
      if (
        !assertComputeJobAccess(req, res, database, {
          ownerId: existing.userId,
          allowWhenUnowned: allowUnownedCloudJob(),
        })
      ) {
        return;
      }

      if (!existing.payload) {
        res.status(400).json({
          error: "Cannot retry job: original dispatch payload is unavailable. Please submit a new dispatch request.",
        });
        return;
      }

      // Bill and preflight the calling actor (reqUserId), not the original job owner
      const preflight = runComputePreflight(req, res, database, {
        profileId: existing.profile,
        allowAnonymous: process.env["NODE_ENV"] !== "production",
      });
      if (!preflight.allowed) {
        return;
      }
      const { userId, estimatedCost } = preflight;

      const newJobId = `cloud-${existing.domain}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      const retryPayload = existing.payload;
      const retried: CloudJobRecord = {
        jobId: newJobId,
        domain: existing.domain,
        name: existing.name,
        profile: existing.profile,
        payload: getRetainablePayload(retryPayload),
        status: "queued",
        startTime: Date.now(),
        logs: [`[Cloud] Retried from job ${existing.jobId}`],
        subscribers: [],
        userId,
      };

      let dbJobId: number | null = null;
      const billingActive = Boolean(database && userId && estimatedCost > 0);
      if (database) {
        try {
          dbJobId = database.createJob(
            `Cloud [${existing.domain.toUpperCase()}]: ${existing.name} (Retry)`,
            "RUNNING",
            "ADHOC",
            existing.domain === "modelica" ? "omc" : existing.domain,
            null,
            { jobId: newJobId, previousJobId: existing.jobId, profile: existing.profile, domain: existing.domain },
            userId,
          );
          retried.dbJobId = dbJobId;
        } catch (err) {
          console.error("[CloudRouter] Failed to create DB job record for retry:", err);
          if (billingActive) {
            res.status(503).json({
              error: "Compute billing service temporarily unavailable. Please try again later.",
            });
            return;
          }
        }
      }

      if (database) {
        try {
          if (
            !holdComputeEscrow({
              database,
              res,
              userId,
              dbJobId,
              estimatedCost,
              description: `HPC Escrow Hold (Retry): Cloud [${existing.domain.toUpperCase()}] ${existing.name}`,
              metadata: {
                jobId: newJobId,
                previousJobId: existing.jobId,
                profile: existing.profile,
                domain: existing.domain,
              },
            })
          ) {
            return;
          }
        } catch (err) {
          console.error("[CloudRouter] Failed to hold compute escrow for retry:", err);
          if (billingActive) {
            res.status(503).json({
              error: "Compute billing service temporarily unavailable. Please try again later.",
            });
            return;
          }
        }
      }

      activeJobs.set(newJobId, retried);
      enqueueCloudExecution(retried, retryPayload);

      res.status(202).json({
        success: true,
        jobId: newJobId,
        previousJobId: existing.jobId,
        status: "queued",
        streamUrl: `/api/v1/cloud/jobs/${newJobId}/events`,
      });
    },
  );

  return router;
}
