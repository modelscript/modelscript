// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { CaeSolverRunner, type CaeJobSpec } from "../services/cae-solver-runner.js";
import {
  CaeTelemetryStreamer,
  type CaeSolverType,
  type CaeTelemetryEvent,
} from "../services/cae-telemetry-streamer.js";
import { getComputeProfile, listComputeProfiles } from "../services/hpc/compute-profiles.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import type { HpcJobSpec, HpcUsageMetrics } from "../services/hpc/hpc-types.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";
import type { LibraryStorage } from "../storage.js";

export interface CloudDispatchPayload {
  domain: "modelica" | "cfd" | "fea" | "monte-carlo";
  name: string;
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
  dbJobId?: number | null | undefined;
  userId?: number | null | undefined;
  domain: string;
  name: string;
  profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  logs: string[];
  resultPath?: string | undefined;
  error?: string | undefined;
  startTime: number;
  endTime?: number | undefined;
  usage?: HpcUsageMetrics | undefined;
  subscribers: ((event: { type: string; data: unknown }) => void)[];
}

const activeJobs = new Map<string, CloudJobRecord>();

export function cloudRouter(storage: LibraryStorage, jobQueue: JobQueue, database?: LibraryDatabase): Router {
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
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── 3. POST /api/v1/cloud/dispatch ──
  // Unified entry point for dispatching Modelica, CFD, FEA, or Monte Carlo jobs
  router.post("/cloud/dispatch", async (req: Request, res: Response): Promise<void> => {
    const payload = req.body as CloudDispatchPayload;
    const { domain = "modelica", name, profile: requestedProfile } = payload;

    if (!name) {
      res.status(400).json({ error: "Missing required parameter: 'name'" });
      return;
    }

    const profile = getComputeProfile(requestedProfile);
    const userId = database ? resolveRequestUserId(req, database) : null;

    // Pre-flight quota check
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

    const broadcast = (event: { type: string; data: unknown }) => {
      for (const sub of jobRecord.subscribers) {
        try {
          sub(event);
        } catch {}
      }
    };

    // Dispatch asynchronously to job queue
    jobQueue.enqueue(jobId, async () => {
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

        const caeSpec: CaeJobSpec = {
          jobId,
          solver,
          deckContent: payload.deck?.content || payload.sourceContent || "",
          deckFormat: format,
          geometryPath: payload.geometryPath,
          cores: profile.cpus,
          profile: profile.id,
          resultDir,
        };

        try {
          const result = await caeRunner.executeJob(caeSpec, streamer);
          jobRecord.endTime = Date.now();
          jobRecord.usage = result.usage;

          if (result.status === "completed") {
            jobRecord.status = "completed";
            jobRecord.resultPath = result.resultVtuPath || path.join(resultDir, "results.vtu");
            jobRecord.logs.push(`[Cloud] CAE computation completed successfully.`);
            broadcast({ type: "status", data: { status: "completed", resultPath: jobRecord.resultPath } });

            if (database && dbJobId) {
              database.updateJobStatus(dbJobId, "SUCCESS");
              if (result.usage) {
                database.updateJobAccounting(dbJobId, result.usage);
                if (userId && result.usage.costCredits > 0) {
                  database.deductUserCredits(userId, result.usage.costCredits, dbJobId, `Cloud CAE: ${name}`, {
                    profile: profile.id,
                    ...result.usage,
                  });
                }
              }
            }
          } else {
            jobRecord.status = "failed";
            jobRecord.error = result.error || "CAE solver failed";
            broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
            if (database && dbJobId) {
              database.updateJobStatus(dbJobId, "FAILED");
            }
          }
        } catch (err: any) {
          jobRecord.status = "failed";
          jobRecord.error = err.message || String(err);
          broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
          if (database && dbJobId) {
            database.updateJobStatus(dbJobId, "FAILED");
          }
        }
      } else {
        // Handle Modelica / Monte Carlo
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `modelscript-cloud-${jobId}-`));
        try {
          const mosScriptPath = path.join(tmpDir, "simulate.mos");
          const fileNamePrefix = name.replace(/[^a-zA-Z0-9_]/g, "_");
          const adhocMoPath = path.join(tmpDir, `${fileNamePrefix}.mo`);

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

          const mosContents = `
loadFile("${adhocMoPath}");
simulate(${simArgs.join(", ")});
getErrorString();
`;
          fs.writeFileSync(mosScriptPath, mosContents, "utf8");

          const hpcSpec: HpcJobSpec = {
            jobId,
            name: `Cloud-${fileNamePrefix}`,
            command: "omc",
            args: [mosScriptPath],
            workingDir: tmpDir,
            env: {
              ...process.env,
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

          const { submission } = await hpcEngine.submitJob(hpcSpec, profile.id);
          const usage = await hpcEngine.waitForCompletion(submission.nativeJobId, tmpDir, profile);

          const csvFilePath = path.join(tmpDir, `${fileNamePrefix}_res.csv`);
          if (fs.existsSync(csvFilePath)) {
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
              if (userId && usage.costCredits > 0) {
                database.deductUserCredits(userId, usage.costCredits, dbJobId, `Cloud Sim: ${name}`, {
                  profile: profile.id,
                  ...usage,
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
              database.updateJobStatus(dbJobId, "FAILED");
            }
          }
        } catch (err: any) {
          jobRecord.status = "failed";
          jobRecord.error = err.message || String(err);
          broadcast({ type: "status", data: { status: "failed", error: jobRecord.error } });
          if (database && dbJobId) {
            database.updateJobStatus(dbJobId, "FAILED");
          }
        }
      }
    });

    res.status(202).json({
      jobId,
      status: "queued",
      profile: profile.id,
      streamUrl: `/api/v1/cloud/jobs/${jobId}/events`,
      message: `Job ${jobId} successfully dispatched to ModelScript Cloud with profile '${profile.name}'.`,
    });
  });

  // ── 4. GET /api/v1/cloud/jobs ──
  // List active and historical jobs
  router.get("/cloud/jobs", (req: Request, res: Response): void => {
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
    const job = activeJobs.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params.id}' not found` });
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
    const job = activeJobs.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params.id}' not found` });
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
    const job = activeJobs.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params.id}' not found` });
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
      if (
        event.type === "status" &&
        ((event.data as any)?.status === "completed" || (event.data as any)?.status === "failed")
      ) {
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
    const job = activeJobs.get(req.params.id as string);
    if (!job || !job.resultPath || !fs.existsSync(job.resultPath)) {
      res.status(404).json({ error: `Results for job '${req.params.id}' not available or job still in progress` });
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
    const job = activeJobs.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: `Job '${req.params.id}' not found` });
      return;
    }

    job.status = "cancelled";
    job.logs.push("[Cloud] Job was cancelled by user request.");
    for (const sub of job.subscribers) {
      try {
        sub({ type: "status", data: { status: "cancelled" } });
      } catch {}
    }

    if (database && job.dbJobId) {
      database.updateJobStatus(job.dbJobId, "CANCELLED");
    }

    res.json({ success: true, message: `Job ${job.jobId} cancelled.` });
  });

  return router;
}
