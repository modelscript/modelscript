// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { CaeSolverRunner, getValidatedGeometryPath, type CaeJobSpec } from "../services/cae-solver-runner.js";
import {
  CaeTelemetryStreamer,
  type CaeSolverType,
  type CaeTelemetryEvent,
} from "../services/cae-telemetry-streamer.js";
import { getComputeProfile, listComputeProfiles } from "../services/hpc/compute-profiles.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import type { HpcJobSpec, HpcUsageMetrics } from "../services/hpc/hpc-types.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";
import { prepareNativeSimulation, type NativeSimPrepResult } from "../services/simulation/native-sim-runner.js";
import type { LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";

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

const MAX_RETAINED_CLOUD_JOBS = 500;
const activeJobs = new Map<string, CloudJobRecord>();

function pruneCloudJobs(): void {
  if (activeJobs.size <= MAX_RETAINED_CLOUD_JOBS) return;
  for (const [id, rec] of activeJobs.entries()) {
    if (activeJobs.size <= MAX_RETAINED_CLOUD_JOBS) break;
    if (rec.status === "completed" || rec.status === "failed" || rec.status === "cancelled") {
      if (rec.tmpDir) {
        try {
          fs.rmSync(rec.tmpDir, { recursive: true, force: true });
        } catch {}
      }
      activeJobs.delete(id);
    }
  }
}

export function getActiveCloudJob(jobId: string): CloudJobRecord | undefined {
  return activeJobs.get(jobId);
}

export function cloudRouter(_storage: LibraryStorage, jobQueue: JobQueue, database?: LibraryDatabase): Router {
  const router = express.Router();
  const hpcEngine = new HpcEngine();
  const caeRunner = new CaeSolverRunner(hpcEngine);

  const CAE_CACHE_DIR = path.join(process.cwd(), "data", "physics-cache");
  if (!fs.existsSync(CAE_CACHE_DIR)) {
    fs.mkdirSync(CAE_CACHE_DIR, { recursive: true });
  }

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
      const userId = resolveRequestUserId(req, database);
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
    "/cloud/dispatch",
    enforceExportCompliance(() => database),
    async (req: Request, res: Response): Promise<void> => {
      const payload = req.body as CloudDispatchPayload;
      const { domain = "modelica", name, profile: requestedProfile } = payload;

      if (!name) {
        res.status(400).json({ error: "Missing required parameter: 'name'" });
        return;
      }

      const profile = getComputeProfile(requestedProfile);
      const userId = database ? resolveRequestUserId(req, database) : null;

      // Pre-flight quota check
      let estimatedCost = 0;
      if (database && userId) {
        const quota = checkComputeQuota(userId, profile.id, database);
        if (!quota.allowed) {
          res.status(402).json({
            error: "Payment Required: Insufficient Compute Credits",
            message: quota.reason,
            balance: quota.userBalance,
            required: quota.estimatedCost,
            profile: quota.profileId,
          });
          return;
        }
        estimatedCost = quota.estimatedCost;
      }

      const jobId = `cloud_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const jobRecord: CloudJobRecord = {
        jobId,
        userId,
        domain,
        name,
        profile: profile.id,
        status: "queued",
        logs: [
          `[Cloud] Job ${jobId} queued with profile '${profile.name}' (${profile.cpus} CPUs, ${profile.memoryMb}MB RAM)`,
        ],
        startTime: Date.now(),
        subscribers: [],
      };
      activeJobs.set(jobId, jobRecord);

      let dbJobId: number | null = null;
      if (database) {
        try {
          dbJobId = database.createJob(
            `Cloud [${domain.toUpperCase()}]: ${name}`,
            "RUNNING",
            "ADHOC",
            domain === "modelica" ? "omc" : domain,
            null,
            { jobId, profile: profile.id, domain },
            userId,
          );
          jobRecord.dbJobId = dbJobId;
        } catch {
          // Optional tracking
        }
      }

      if (database && userId && dbJobId && estimatedCost > 0) {
        const holdRes = database.holdUserCredits(
          userId,
          estimatedCost,
          dbJobId,
          `HPC Escrow Hold: Cloud [${domain.toUpperCase()}] ${name}`,
          { jobId, profile: profile.id, domain },
        );
        if (!holdRes.success) {
          database.updateJobStatus(dbJobId, "FAILED");
          res.status(402).json({
            error: "Payment Required: Escrow Hold Failed",
            message: holdRes.reason,
            balance: holdRes.newBalance,
            required: estimatedCost,
          });
          return;
        }
      }

      const broadcast = (event: { type: string; data: unknown }) => {
        for (const sub of jobRecord.subscribers) {
          try {
            sub(event);
          } catch {}
        }
      };

      // Dispatch asynchronously to job queue
      jobQueue.enqueue(jobId, async () => {
        if ((jobRecord.status as string) === "cancelled") {
          return;
        }
        jobRecord.status = "running";
        jobRecord.logs.push(`[Cloud] Job started running on compute cluster.`);
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
                jobRecord.logs.push(event.rawLog);
                broadcast({ type: "log", data: event.rawLog });
              }
            } else if (event.type === "phase") {
              if (event.message) {
                jobRecord.logs.push(`[${event.phase}] ${event.message}`);
                broadcast({ type: "log", data: `[${event.phase}] ${event.message}` });
              }
            } else if (event.type === "error") {
              jobRecord.logs.push(`[Error] ${event.message}`);
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
              jobRecord.logs.push(`[Cloud] CAE computation completed successfully.`);
              broadcast({ type: "status", data: { status: "completed", resultPath: jobRecord.resultPath } });

              if (database && dbJobId) {
                database.updateJobStatus(dbJobId, "SUCCESS");
                if (result.usage) {
                  database.updateJobAccounting(dbJobId, result.usage);
                  if (userId) {
                    database.settleUserEscrow(userId, dbJobId, result.usage.costCredits ?? 0, `Cloud CAE: ${name}`, {
                      profile: profile.id,
                      ...result.usage,
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
                database.updateJobStatus(dbJobId, "FAILED");
                if (userId) {
                  database.releaseUserEscrow(userId, dbJobId, jobRecord.error || "CAE solver failed");
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
              database.updateJobStatus(dbJobId, "FAILED");
              if (userId) {
                database.releaseUserEscrow(userId, dbJobId, jobRecord.error || "CAE execution error");
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

            const stopTime = payload.experiment?.stopTime ?? 10.0;
            const startTime = payload.experiment?.startTime ?? 0.0;
            const numberOfIntervals = payload.experiment?.numberOfIntervals ?? 500;
            const tolerance = payload.experiment?.tolerance ?? 1e-6;

            const simArgs = [
              name,
              `startTime=${startTime}`,
              `stopTime=${stopTime}`,
              `numberOfIntervals=${numberOfIntervals}`,
              `tolerance=${tolerance}`,
              `outputFormat="csv"`,
            ];
            if (payload.parameters && Object.keys(payload.parameters).length > 0) {
              const overrides = Object.entries(payload.parameters)
                .map(([k, v]) => `${k}=${v}`)
                .join(",");
              simArgs.push(`simflags="-override=${overrides}"`);
            }

            const mosContents = `
loadFile("${adhocMoPath}");
simulate(${simArgs.join(", ")});
getErrorString();
`;
            fs.writeFileSync(mosScriptPath, mosContents, "utf8");

            // Native ModelScript simulation engine vs OMC
            const enginePreference = payload.engine ?? "modelscript";
            let prep: NativeSimPrepResult | null = null;
            if (enginePreference !== "omc") {
              prep = await prepareNativeSimulation(tmpDir, {
                modelName: name,
                sourceFiles: [adhocMoPath],
                startTime,
                stopTime,
                numberOfIntervals,
                tolerance,
              });
            }

            const isNative = prep !== null;

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
                resources: {
                  cpusPerTask: profile.cpus,
                  memoryMb: profile.memoryMb,
                  partition: profile.partition,
                  gpus: profile.gpus,
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
                resources: {
                  cpusPerTask: profile.cpus,
                  memoryMb: profile.memoryMb,
                  partition: profile.partition,
                  gpus: profile.gpus,
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
              jobRecord.status = "completed";
              jobRecord.resultPath = csvFilePath;
              jobRecord.usage = usage;
              jobRecord.endTime = Date.now();
              jobRecord.logs.push(
                `[Cloud] Modelica simulation completed in ${((jobRecord.endTime - jobRecord.startTime) / 1000).toFixed(1)}s.`,
              );
              broadcast({ type: "status", data: { status: "completed", resultPath: csvFilePath, usage } });

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
              fs.rmSync(tmpDir, { recursive: true, force: true });
              jobRecord.error = details || "Simulation failed to produce CSV results";
              broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
              if (database && dbJobId) {
                database.updateJobStatus(dbJobId, "FAILED");
                if (userId) {
                  database.releaseUserEscrow(userId, dbJobId, jobRecord.error || "Simulation failed");
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
            fs.rmSync(tmpDir, { recursive: true, force: true });
            jobRecord.status = "failed";
            jobRecord.error = err instanceof Error ? err.message : String(err);
            broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
            if (database && dbJobId) {
              database.updateJobStatus(dbJobId, "FAILED");
              if (userId) {
                database.releaseUserEscrow(userId, dbJobId, jobRecord.error || "Simulation error");
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
          }
        }
        pruneCloudJobs();
      });

      res.status(202).json({
        jobId,
        status: "queued",
        profile: profile.id,
        streamUrl: `/api/v1/cloud/jobs/${jobId}/events`,
        message: `Job ${jobId} successfully dispatched to ModelScript Cloud with profile '${profile.name}'.`,
      });
    },
  );

  // ── 4. GET /api/v1/cloud/jobs ──
  // List active and historical jobs
  router.get("/cloud/jobs", (req: Request, res: Response): void => {
    const reqAny = req as { user?: { id?: number | undefined } | undefined; userId?: number | undefined };
    const authUserId = reqAny.user?.id ?? reqAny.userId;

    const list: {
      jobId: string;
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
      if (authUserId !== undefined && job.userId !== undefined && job.userId !== null && job.userId !== authUserId) {
        continue;
      }
      list.push({
        jobId: id,
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

    res.json({ jobs: list.reverse() });
  });

  // ── 5. GET /api/v1/cloud/jobs/:id ──
  // Inspect single job details and status
  router.get("/cloud/jobs/:id", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
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
      error: job.error,
      hasResult: Boolean(job.resultPath && fs.existsSync(job.resultPath)),
    });
  });

  // ── 6. GET /api/v1/cloud/jobs/:id/logs ──
  // Tail execution logs
  router.get("/cloud/jobs/:id/logs", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      logs: job.logs,
    });
  });

  // ── 7. GET /api/v1/cloud/jobs/:id/events ──
  // Real-time Server-Sent Events (SSE) stream for terminal, webview, and morsel
  router.get("/cloud/jobs/:id/events", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Send initial status
    res.write(`data: ${JSON.stringify({ type: "init", status: job.status, logs: job.logs })}\n\n`);

    const listener = (event: { type: string; data: unknown }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      const eventData = event.data as { status?: string | undefined } | null | undefined;
      if (event.type === "status" && (eventData?.status === "completed" || eventData?.status === "failed")) {
        res.end();
      }
    };

    job.subscribers.push(listener);

    req.on("close", () => {
      const idx = job.subscribers.indexOf(listener);
      if (idx !== -1) {
        job.subscribers.splice(idx, 1);
      }
    });
  });

  // ── 8. GET /api/v1/cloud/jobs/:id/result ──
  // Stream or download result file (CSV or VTU)
  router.get("/cloud/jobs/:id/result", (req: Request, res: Response): void => {
    const job = activeJobs.get(req.params["id"] as string);
    if (!job || !job.resultPath || !fs.existsSync(job.resultPath)) {
      res.status(404).json({ error: `Results for job '${req.params["id"]}' not available or job still in progress` });
      return;
    }

    const ext = path.extname(job.resultPath).toLowerCase();
    if (ext === ".csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${job.name}_res.csv"`);
    } else if (ext === ".vtu") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${job.name}_mesh.vtu"`);
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

    if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
      res.json({ success: true, message: `Job ${job.jobId} is already ${job.status}.` });
      return;
    }

    job.status = "cancelled";
    job.endTime = Date.now();
    job.logs.push("[Cloud] Job was cancelled by user request.");

    // Terminate the underlying CAE solver or HPC cluster job
    if (job.domain === "cfd" || job.domain === "fea") {
      caeRunner.cancelJob(job.jobId);
    } else {
      await hpcEngine.cancel(job.nativeJobId || job.jobId);
    }

    for (const sub of job.subscribers) {
      try {
        sub({ type: "status", data: { status: "cancelled" } });
      } catch {}
    }

    if (database && job.dbJobId) {
      database.updateJobStatus(job.dbJobId, "CANCELLED");
      if (job.userId) {
        database.releaseUserEscrow(job.userId, job.dbJobId, "User requested cancellation");
      }
    }

    res.json({ success: true, message: `Job ${job.jobId} cancelled.` });
  });

  return router;
}
