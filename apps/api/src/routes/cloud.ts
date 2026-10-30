// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DataPackageLockJson } from "@modelscript/exchange";
import express, { type Request, type Response, type Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
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
import { resolveDataPackageLockfile } from "../util/datapackage-indexer.js";

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

export function cloudRouter(storage: LibraryStorage, jobQueue: JobQueue, database?: LibraryDatabase): Router {
  const router = express.Router();
  router.use(defaultApiLimiter);
  const hpcEngine = new HpcEngine();
  const caeRunner = new CaeSolverRunner(hpcEngine);

  const CAE_CACHE_DIR = path.join(process.cwd(), "data", "physics-cache");
  if (!fs.existsSync(CAE_CACHE_DIR)) {
    fs.mkdirSync(CAE_CACHE_DIR, { recursive: true });
  }

  const isAuthorizedForCloudJob = (req: Request, job: CloudJobRecord): boolean => {
    if (process.env["NODE_ENV"] === "test") return true;
    const reqAny = req as Request & {
      user?: { id?: number | undefined; role?: string | undefined; accountType?: string | undefined } | undefined;
      userId?: number | undefined;
    };
    const isAdmin = reqAny.user?.role === "admin" || reqAny.user?.accountType === "admin";
    if (isAdmin) return true;
    const reqUserId = reqAny.user?.id ?? reqAny.userId ?? (database ? resolveRequestUserId(req, database) : null);
    if (job.userId !== undefined && job.userId !== null && job.userId !== reqUserId) {
      return false;
    }
    return true;
  };

  const enqueueCloudExecution = (jobRecord: CloudJobRecord, payload: CloudDispatchPayload): void => {
    const { domain = "modelica", name } = payload;
    const profile = getComputeProfile(jobRecord.profile);
    const jobId = jobRecord.jobId;
    const dbJobId = jobRecord.dbJobId ?? null;
    const userId = jobRecord.userId ?? null;

    const broadcast = (event: { type: string; data: unknown }) => {
      for (const sub of jobRecord.subscribers) {
        try {
          sub(event);
        } catch {}
      }
    };

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

          const safeModelName = String(name).replace(/[^a-zA-Z0-9_.]/g, "") || "Model";
          const simArgs = [
            safeModelName,
            `startTime=${Number(startTime) || 0}`,
            `stopTime=${Number(stopTime) || 10}`,
            `numberOfIntervals=${Math.max(1, Math.floor(Number(numberOfIntervals) || 500))}`,
            `tolerance=${Number(tolerance) || 1e-6}`,
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
    ["/cloud/dispatch", "/cloud/jobs", "/hpc/jobs"],
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
      if (process.env["NODE_ENV"] === "production" && !userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

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
        payload,
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
            { jobId, profile: profile.id, domain, lockfilePackages: lockfile ? Object.keys(lockfile.packages) : [] },
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

      // Dispatch asynchronously to job queue
      enqueueCloudExecution(jobRecord, payload);

      res.status(202).json({
        jobId,
        status: "queued",
        profile: profile.id,
        lockfile,
        streamUrl: `/api/v1/cloud/jobs/${jobId}/events`,
        message: `Job ${jobId} successfully dispatched to Ansatz Cloud (powered by ModelScript) with profile '${profile.name}'.`,
      });
    },
  );

  // ── 4. GET /api/v1/cloud/jobs ──
  // List active and historical jobs
  router.get("/cloud/jobs", (req: Request, res: Response): void => {
    const reqAny = req as { user?: { id?: number | undefined } | undefined; userId?: number | undefined };
    const authUserId =
      reqAny.user?.id ?? reqAny.userId ?? (database ? resolveRequestUserId(req, database) : null) ?? undefined;
    if (process.env["NODE_ENV"] === "production" && !authUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

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
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
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
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!job.lockfile) {
      res.status(404).json({ error: `No lockfile recorded for job '${req.params["id"]}'` });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${job.jobId}.datapackage.lock.json"`);
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
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
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
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
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
    if (!job) {
      res.status(404).json({ error: `Results for job '${req.params["id"]}' not available or job still in progress` });
      return;
    }
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!job.resultPath || !fs.existsSync(job.resultPath)) {
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
    if (!isAuthorizedForCloudJob(req, job)) {
      res.status(403).json({ error: "Forbidden" });
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

  // ── 10. POST /api/v1/cloud/jobs/:id/retry ──
  // Re-dispatch a failed or cancelled cloud job
  router.post("/cloud/jobs/:id/retry", (req: Request, res: Response): void => {
    const existing = activeJobs.get(req.params["id"] as string);
    if (!existing) {
      res.status(404).json({ error: `Job '${req.params["id"]}' not found` });
      return;
    }
    if (!isAuthorizedForCloudJob(req, existing)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const reqUserId = database ? resolveRequestUserId(req, database) : null;
    const userId = existing.userId ?? reqUserId;
    if (process.env["NODE_ENV"] === "production" && !userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    let estimatedCost = 0;
    if (database && userId) {
      const quota = checkComputeQuota(userId, existing.profile, database);
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

    const newJobId = `cloud-${existing.domain}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const retryPayload: CloudDispatchPayload = existing.payload ?? {
      domain: (existing.domain as CloudDispatchPayload["domain"]) || "modelica",
      name: existing.name,
      profile: existing.profile,
    };
    const retried: CloudJobRecord = {
      jobId: newJobId,
      domain: existing.domain,
      name: existing.name,
      profile: existing.profile,
      payload: retryPayload,
      status: "queued",
      startTime: Date.now(),
      logs: [`[Cloud] Retried from job ${existing.jobId}`],
      subscribers: [],
      userId,
    };

    let dbJobId: number | null = null;
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
      } catch {
        // Optional tracking
      }
    }

    if (database && userId && dbJobId && estimatedCost > 0) {
      const holdRes = database.holdUserCredits(
        userId,
        estimatedCost,
        dbJobId,
        `HPC Escrow Hold (Retry): Cloud [${existing.domain.toUpperCase()}] ${existing.name}`,
        { jobId: newJobId, previousJobId: existing.jobId, profile: existing.profile, domain: existing.domain },
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

    activeJobs.set(newJobId, retried);

    if (existing.payload) {
      enqueueCloudExecution(retried, retryPayload);
    }

    res.status(202).json({
      success: true,
      jobId: newJobId,
      previousJobId: existing.jobId,
      status: "queued",
      streamUrl: `/api/v1/cloud/jobs/${newJobId}/events`,
    });
  });

  return router;
}
