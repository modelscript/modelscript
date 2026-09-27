// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { CaeResultProcessor } from "../services/cae-result-processor.js";
import { CaeSolverRunner, type CaeJobSpec } from "../services/cae-solver-runner.js";
import { CaeSweepOrchestrator, type CaeSweepSpec } from "../services/cae-sweep-orchestrator.js";
import { CaeTelemetryStreamer, type CaeSolverType } from "../services/cae-telemetry-streamer.js";
import { listComputeProfiles } from "../services/hpc/compute-profiles.js";
import { SlurmRestDriver } from "../services/hpc/drivers/slurm-rest-driver.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";

const CAE_CACHE_DIR = path.join(process.cwd(), "data", "physics-cache");

function ensureCaeDir(): void {
  if (!fs.existsSync(CAE_CACHE_DIR)) {
    fs.mkdirSync(CAE_CACHE_DIR, { recursive: true });
  }
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sanitizeHash(hash: string): string {
  const safe = path.basename(hash).replace(/[^a-f0-9]/gi, "");
  if (!safe || safe.length < 8) {
    throw new Error("Invalid hash identifier");
  }
  return safe;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB
});

export function caeRouter(jobQueue: JobQueue, database: LibraryDatabase): Router {
  const router = express.Router();
  const runner = new CaeSolverRunner();
  const activeStreamers = new Map<string, CaeTelemetryStreamer>();
  const sweepOrchestrator = new CaeSweepOrchestrator(runner, CAE_CACHE_DIR);

  ensureCaeDir();

  // 0. List Available Compute Profiles & Costs
  router.get("/cae/profiles", (_req, res) => {
    res.json({ profiles: listComputeProfiles() });
  });

  // 1. Upload Mesh or CAD Geometry with CAS deduplication
  router.post("/cae/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const hash = sha256(req.file.buffer);
    const safe = sanitizeHash(hash);
    const safeFileName =
      path.basename(req.file.originalname || "payload.dat").replace(/[^a-zA-Z0-9._-]/g, "_") || "payload.dat";
    const targetDir = path.join(CAE_CACHE_DIR, safe);
    const resolvedDir = path.resolve(targetDir);
    const targetFile = path.resolve(resolvedDir, safeFileName);
    if (!targetFile.startsWith(resolvedDir + path.sep)) {
      return res.status(400).json({ error: "Invalid filename." });
    }

    if (fs.existsSync(targetFile)) {
      return res.json({ hash, cached: true, message: "File already cached." });
    }

    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.writeFileSync(targetFile, req.file.buffer);

    res.json({ hash, cached: false, filename: req.file.originalname, message: "File cached successfully." });
  });

  router.post("/cae/jobs", express.json({ limit: "50mb" }), async (req, res) => {
    try {
      const { solver = "calculix", title, deck, geometry, options = {} } = req.body;

      if (!deck || (!deck.content && !deck.casHash)) {
        return res.status(400).json({ error: "Missing required deck content or casHash." });
      }

      const solverType: CaeSolverType = solver === "su2" ? "su2" : solver === "openfoam" ? "openfoam" : "calculix";
      let deckContent = deck.content;

      if (!deckContent && deck.casHash) {
        const safe = sanitizeHash(deck.casHash);
        const deckDir = path.join(CAE_CACHE_DIR, safe);
        const files = fs.readdirSync(deckDir);
        const firstFile = files[0];
        if (!firstFile) {
          return res.status(404).json({ error: "Deck not found in CAS cache." });
        }
        deckContent = fs.readFileSync(path.join(deckDir, firstFile), "utf8");
      }

      // Geometry file path
      let geomPath: string | undefined;
      if (geometry?.casHash) {
        const safeGeom = sanitizeHash(geometry.casHash);
        const geomDir = path.join(CAE_CACHE_DIR, safeGeom);
        if (fs.existsSync(geomDir)) {
          const geomFiles = fs.readdirSync(geomDir);
          const firstGeom = geomFiles[0];
          if (firstGeom) {
            geomPath = path.join(geomDir, firstGeom);
          }
        }
      }

      // Pre-flight quota check
      const profile = options.profile || "standard";
      const userId = resolveRequestUserId(req, database);
      if (userId) {
        const quota = checkComputeQuota(userId, profile, database);
        if (!quota.allowed) {
          return res.status(402).json({
            error: "Payment Required: Insufficient Compute Credits",
            message: quota.reason,
            balance: quota.userBalance,
            required: quota.estimatedCost,
            profile: quota.profileId,
          });
        }
      }

      // Create DB job
      const deckHash = sha256(deckContent);
      const resultDir = path.join(CAE_CACHE_DIR, "results", `${solverType}_${deckHash.slice(0, 16)}`);
      const dbJobId = database.createJob(
        `CAE ${solverType.toUpperCase()}: ${title || "Simulation"}`,
        "RUNNING",
        "ADHOC",
        "ide",
        null,
        { resultDir },
        userId,
      );

      const streamer = new CaeTelemetryStreamer(solverType);
      activeStreamers.set(dbJobId.toString(), streamer);

      const jobSpec: CaeJobSpec = {
        jobId: dbJobId.toString(),
        solver: solverType,
        deckContent,
        deckFormat: deck.format || (solverType === "su2" ? "cfg" : "inp"),
        geometryPath: geomPath,
        cores: options.cores || 4,
        timeoutSeconds: options.timeoutSeconds || 1800,
        runner: options.runner || "auto",
        profile,
        resultDir,
      };

      // Enqueue job execution
      jobQueue.enqueue(`cae-${dbJobId}`, async () => {
        try {
          const result = await runner.executeJob(jobSpec, streamer);
          if (result.status === "completed") {
            database.updateJobStatus(dbJobId, "SUCCESS");
            if (result.usage) {
              database.updateJobAccounting(dbJobId, {
                computeProfile: result.profile || profile,
                cpuSeconds: result.usage.cpuCoreSeconds,
                peakMemoryMb: result.usage.peakMemoryMb,
                gpuSeconds: result.usage.gpuSeconds,
                costCredits: result.usage.costCredits,
              });

              if (userId && result.usage.costCredits > 0) {
                database.deductUserCredits(
                  userId,
                  result.usage.costCredits,
                  dbJobId,
                  `CAE ${solverType.toUpperCase()}: ${title || "Simulation"}`,
                  { profile: result.profile || profile, ...result.usage },
                );
              }
            }
            const status = jobQueue.getStatus(`cae-${dbJobId}`);
            if (status && result.resultVtuPath) status.resultPath = result.resultVtuPath;
          } else if (result.status === "cancelled") {
            database.updateJobStatus(dbJobId, "FAILED");
          } else {
            database.updateJobStatus(dbJobId, "FAILED");
          }
        } catch {
          database.updateJobStatus(dbJobId, "FAILED");
        }
      });

      res.json({
        jobId: dbJobId.toString(),
        status: "queued",
        solver: solverType,
        profile,
        resultDir,
      });
    } catch (err) {
      console.error("POST /cae/jobs ERROR:", err);
      return res.status(500).json({ error: String(err), stack: (err as any)?.stack });
    }
  });

  // 3. Get CAE Job Status
  router.get("/cae/jobs/:id", (req, res) => {
    const dbJob = database.getJob(parseInt(req.params.id, 10));
    if (!dbJob) {
      return res.status(404).json({ error: "Job not found." });
    }

    const queueStatus = jobQueue.getStatus(`cae-${req.params.id}`);
    const resolvedStatus =
      queueStatus?.status || (dbJob.status === "SUCCESS" ? "completed" : dbJob.status.toLowerCase());
    res.json({
      jobId: dbJob.id.toString(),
      name: dbJob.name,
      status: resolvedStatus,
      createdAt: dbJob.started_at,
      completedAt: dbJob.completed_at,
      resultPath: queueStatus?.resultPath,
      profile: dbJob.compute_profile,
      usage: {
        cpuSeconds: dbJob.cpu_seconds,
        peakMemoryMb: dbJob.peak_memory_mb,
        gpuSeconds: dbJob.gpu_seconds,
        costCredits: dbJob.cost_credits,
      },
    });
  });

  // 3b. List User's Completed HPC Jobs with Artifacts
  router.get("/cae/user-jobs", (req, res) => {
    try {
      const userId = resolveRequestUserId(req, database);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const limit = Math.min(50, Math.max(1, parseInt(req.query["limit"] as string, 10) || 20));
      const jobs = database.getUserCompletedHpcJobs(userId, limit);
      res.json({ jobs, count: jobs.length });
    } catch (err: any) {
      console.error("[CaeRouter] GET /cae/user-jobs error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // 3c. Get Cluster Health & Diagnostics
  router.get("/cae/cluster/status", async (req, res) => {
    try {
      const hpcEngine = new HpcEngine();
      const driver = hpcEngine.getDriver();
      const stager = hpcEngine.getStager();

      let connected = true;
      let latencyMs = 0;
      let version: string | undefined;
      let partitions: any[] = [];
      let nodes: any[] = [];

      if (driver instanceof SlurmRestDriver) {
        const pingRes = await driver.ping();
        connected = pingRes.ok;
        latencyMs = pingRes.latencyMs;
        version = pingRes.version;
        if (connected) {
          partitions = await driver.getPartitions();
          nodes = await driver.getNodes();
        }
      } else if (driver.type === "slurm") {
        version = "slurm (local CLI)";
      } else {
        version = "local-process";
      }

      res.json({
        backend: driver.type,
        connected,
        latencyMs,
        version,
        stagingBackend: stager.type,
        partitions,
        nodesCount: nodes.length,
        nodes,
      });
    } catch (err: any) {
      console.error("[CaeRouter] GET /cae/cluster/status error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // 3d. Get CAE Job Reproduction Specification
  router.get("/cae/jobs/:id/reproduce-spec", (req, res) => {
    try {
      const dbJob = database.getJob(parseInt(req.params.id, 10));
      if (!dbJob) return res.status(404).json({ error: "Job not found." });

      const metadata = (dbJob.metadata ? JSON.parse(dbJob.metadata) : {}) as {
        resultDir?: string;
        solver?: string;
        profile?: string;
        title?: string;
      };

      const resultDir = metadata.resultDir;
      let jobSpec: any = null;
      if (resultDir) {
        const specFile = path.join(resultDir, "job_spec.json");
        if (fs.existsSync(specFile)) {
          try {
            jobSpec = JSON.parse(fs.readFileSync(specFile, "utf8"));
          } catch {}
        }
      }

      let solver = metadata.solver || "calculix";
      if (!metadata.solver && dbJob.name) {
        if (dbJob.name.includes("SU2")) solver = "su2";
        else if (dbJob.name.includes("OPENFOAM")) solver = "openfoam";
      }

      res.json({
        jobId: dbJob.id,
        name: dbJob.name,
        solver,
        profile: dbJob.compute_profile || "standard",
        deckContent: jobSpec?.deckContent || null,
        deckFormat: jobSpec?.deckFormat || (solver === "su2" ? "cfg" : "inp"),
        geometryPath: jobSpec?.geometryPath || null,
        cores: jobSpec?.cores || 4,
        costCredits: dbJob.cost_credits || 0,
        cpuSeconds: dbJob.cpu_seconds || 0,
      });
    } catch (err: any) {
      console.error("[CaeRouter] GET /cae/jobs/:id/reproduce-spec error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // 4. Cancel CAE Job
  router.delete("/cae/jobs/:id", (req, res) => {
    const cancelled = runner.cancelJob(req.params.id);
    database.updateJobStatus(parseInt(req.params.id, 10), "FAILED");
    res.json({ cancelled });
  });

  // 5. Real-Time Telemetry Stream (Server-Sent Events)
  router.get("/cae/jobs/:id/events", (req, res) => {
    const streamer = activeStreamers.get(req.params.id);
    if (!streamer) {
      // If job is already done or not found, send single completion or error event
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "phase", phase: "Stream Unavailable or Completed" })}\n\n`);
      return res.end();
    }

    streamer.attachSseStream(res);
  });

  // 6. Download Result VTU
  router.get("/cae/jobs/:id/results", (req, res) => {
    const dbJob = database.getJob(parseInt(req.params.id, 10));
    if (!dbJob) return res.status(404).json({ error: "Job not found." });

    const metadata = (dbJob.metadata ? JSON.parse(dbJob.metadata) : {}) as { resultDir?: string };
    const resultDir = metadata.resultDir;
    if (!resultDir) return res.status(404).json({ error: "No result directory recorded." });

    const vtuPath = path.join(resultDir, "result.vtu");
    if (!fs.existsSync(vtuPath)) {
      return res.status(404).json({ error: "Result .vtu file not yet ready." });
    }

    res.setHeader("Content-Type", "application/xml");
    res.sendFile(vtuPath);
  });

  // 7. Get Scalar Summary JSON (KPIs)
  router.get("/cae/jobs/:id/scalars", (req, res) => {
    const dbJob = database.getJob(parseInt(req.params.id, 10));
    if (!dbJob) return res.status(404).json({ error: "Job not found." });

    const metadata = (dbJob.metadata ? JSON.parse(dbJob.metadata) : {}) as { resultDir?: string };
    const resultDir = metadata.resultDir;
    if (!resultDir) return res.status(404).json({ error: "No result directory recorded." });

    const scalarsPath = path.join(resultDir, "scalars.json");
    if (!fs.existsSync(scalarsPath)) {
      return res.status(404).json({ error: "Scalars not yet computed." });
    }

    res.sendFile(scalarsPath);
  });

  // 8. Get 3D FEA/CFD Mesh Payload JSON for Webview
  router.get("/cae/jobs/:id/mesh-payload", (req, res) => {
    const dbJob = database.getJob(parseInt(req.params.id, 10));
    if (!dbJob) return res.status(404).json({ error: "Job not found." });

    const metadata = (dbJob.metadata ? JSON.parse(dbJob.metadata) : {}) as { resultDir?: string };
    const resultDir = metadata.resultDir;
    if (!resultDir) return res.status(404).json({ error: "No result directory recorded." });

    const meshPayloadPath = path.join(resultDir, "mesh_payload.json");
    if (fs.existsSync(meshPayloadPath)) {
      return res.sendFile(meshPayloadPath);
    }

    // Fallback: convert result.vtu if mesh_payload.json was not pre-generated
    const vtuPath = path.join(resultDir, "result.vtu");
    if (fs.existsSync(vtuPath)) {
      const vtuXml = fs.readFileSync(vtuPath, "utf8");
      const payload = CaeResultProcessor.parseVtuToMeshPayload(vtuXml);
      fs.writeFileSync(meshPayloadPath, JSON.stringify(payload), "utf8");
      return res.json(payload);
    }

    return res.status(404).json({ error: "Mesh payload not yet ready." });
  });

  // --- Automated Parametric DoE Sweep Orchestrator Routes ---

  // 9. Submit a new Parametric DoE Sweep
  router.post("/cae/sweeps", express.json({ limit: "50mb" }), (req, res) => {
    const { title, solver = "calculix", templateDeck, deckFormat, geometry, sampling, options } = req.body;

    if (!templateDeck) {
      return res.status(400).json({ error: "Missing required 'templateDeck' string." });
    }
    if (!sampling || !sampling.parameters || !Array.isArray(sampling.parameters) || sampling.parameters.length === 0) {
      return res.status(400).json({ error: "Missing required 'sampling.parameters' array." });
    }

    const sweepSpec: CaeSweepSpec = {
      title,
      solver: solver === "su2" ? "su2" : solver === "openfoam" ? "openfoam" : "calculix",
      templateDeck,
      deckFormat: deckFormat || (solver === "su2" ? "cfg" : "inp"),
      geometry,
      sampling: {
        strategy: sampling.strategy || "lhs",
        sampleCount: sampling.sampleCount || 10,
        concurrency: sampling.concurrency || 4,
        parameters: sampling.parameters,
      },
      options: options || {},
    };

    const state = sweepOrchestrator.submitSweep(sweepSpec);
    res.json({
      sweepId: state.sweepId,
      title: state.title,
      status: state.status,
      totalRuns: state.totalRuns,
      strategy: state.strategy,
      concurrency: sweepSpec.sampling.concurrency,
    });
  });

  // 10. List All Sweeps
  router.get("/cae/sweeps", (_req, res) => {
    const allSweeps = sweepOrchestrator.getAllSweeps().map((s) => ({
      sweepId: s.sweepId,
      title: s.title,
      solver: s.solver,
      strategy: s.strategy,
      status: s.status,
      totalRuns: s.totalRuns,
      completedRuns: s.completedRuns,
      failedRuns: s.failedRuns,
      progressPercent: s.progressPercent,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    }));
    res.json(allSweeps);
  });

  // 11. Get Sweep Details & Run Table
  router.get("/cae/sweeps/:id", (req, res) => {
    const sweep = sweepOrchestrator.getSweep(req.params.id);
    if (!sweep) {
      return res.status(404).json({ error: `Sweep '${req.params.id}' not found.` });
    }
    res.json(sweep);
  });

  // 12. Cancel Sweep
  router.delete("/cae/sweeps/:id", (req, res) => {
    const cancelled = sweepOrchestrator.cancelSweep(req.params.id);
    if (!cancelled) {
      return res.status(404).json({ error: `Sweep '${req.params.id}' not found.` });
    }
    res.json({ cancelled: true, sweepId: req.params.id });
  });

  // 13. Real-Time Telemetry Stream for Multi-Job Sweep (SSE)
  router.get("/cae/sweeps/:id/events", (req, res) => {
    const sweep = sweepOrchestrator.getSweep(req.params.id);
    if (!sweep) {
      return res.status(404).json({ error: `Sweep '${req.params.id}' not found.` });
    }
    sweepOrchestrator.attachSseStream(req.params.id, res);
  });

  // 14. Compile and Extract SnapshotMatrixDataset from Completed Sweep
  router.get("/cae/sweeps/:id/dataset", (req, res) => {
    try {
      const targetField = (req.query["targetField"] as string) || "vonMisesStress";
      const dataset = sweepOrchestrator.extractDataset(req.params.id, targetField);
      res.json({
        M: dataset.numSnapshots,
        N: dataset.numFeatures,
        numSnapshots: dataset.numSnapshots,
        numFeatures: dataset.numFeatures,
        p: dataset.parameterNames.length,
        q: dataset.scalarOutputNames.length,
        parameterNames: dataset.parameterNames,
        scalarNames: dataset.scalarOutputNames,
        snapshotMatrix: Array.from(dataset.snapshots),
        parameters: Array.from(dataset.parameters),
        scalarOutputs: Array.from(dataset.scalarOutputs),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to extract dataset from sweep." });
    }
  });

  // 15. 1-Click Surrogate Training from Sweep
  router.post("/cae/sweeps/:id/train-surrogate", express.json(), async (req, res) => {
    try {
      const options = req.body || {};
      const trainResult = await sweepOrchestrator.trainSurrogate(req.params.id, options);
      res.json(trainResult);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to train surrogate from sweep." });
    }
  });

  return router;
}
