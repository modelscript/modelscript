/* eslint-disable @typescript-eslint/no-non-null-assertion */
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Physics simulation API routes.
 *
 * Handles CFD/FEA job submission, status polling, and result retrieval
 * with content-addressable upload deduplication for .step geometry files.
 */

import express, { type Router } from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";

const PHYSICS_CACHE_DIR = path.join(process.cwd(), "data", "physics-cache");

/** Ensure cache directories exist. */
function ensureCacheDir(): void {
  if (!fs.existsSync(PHYSICS_CACHE_DIR)) {
    fs.mkdirSync(PHYSICS_CACHE_DIR, { recursive: true });
  }
}

/** Compute SHA-256 hash of a buffer. */
function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Resolve the cached geometry path for a given hash. */
function geometryCachePath(hash: string): string {
  return path.join(PHYSICS_CACHE_DIR, hash, "geometry.step");
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

export function physicsRouter(jobQueue: JobQueue, database: LibraryDatabase): Router {
  const router = express.Router();
  ensureCacheDir();

  // ── Upload .step geometry with CAS deduplication ──

  router.post("/physics/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const hash = sha256(req.file.buffer);
    const cachedPath = geometryCachePath(hash);

    if (fs.existsSync(cachedPath)) {
      return res.json({ hash, cached: true, message: "Geometry already cached." });
    }

    const dir = path.dirname(cachedPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachedPath, req.file.buffer);

    res.json({ hash, cached: false, message: "Geometry uploaded and cached." });
  });

  // ── Check if a geometry hash already exists (HEAD request) ──

  router.head("/physics/upload/:hash", (req, res) => {
    const cachedPath = geometryCachePath(req.params.hash);
    if (fs.existsSync(cachedPath)) {
      return res.status(200).end();
    }
    res.status(404).end();
  });

  // ── Flatten a study class for dynamic UI parameters ──

  router.get("/physics/flattenStudy", (req, res) => {
    const className = (req.query["className"] as string) || "";

    // This mocks the LSP's modelscript/flattenStudy endpoint for the web IDE.
    // In the future, this should invoke the actual StudyFlattener against the DB.

    if (className.toUpperCase().includes("CFD")) {
      return res.json({
        workflowClass: "ModelScript.Studies.CFD",
        parameters: {
          endTime: 1.0,
          timeStep: 0.01,
          fluidDensity: 1.225,
          kinematicViscosity: 1.5e-5,
          inletVelocity: 10.0,
        },
      });
    }

    // Default to FEA schema
    return res.json({
      workflowClass: "ModelScript.Studies.StaticStructuralFEA",
      parameters: {
        meshResolution: 0.01,
        elementOrder: 2,
        materialDensity: 7850,
        youngsModulus: 200e9,
        poissonsRatio: 0.3,
        forceZ: -15.0,
      },
    });
  });

  // ── Submit a physics simulation job ──

  router.post("/physics/run", express.json(), (req, res) => {
    const { geometryHash, config } = req.body as {
      geometryHash: string;
      config: Record<string, unknown>;
    };

    if (!geometryHash || !config) {
      return res.status(400).json({ error: "Missing geometryHash or config." });
    }

    const cachedGeometry = geometryCachePath(geometryHash);
    if (!fs.existsSync(cachedGeometry)) {
      return res.status(404).json({ error: "Geometry not found in cache. Upload it first via /physics/upload." });
    }

    let simType = (config.type as string) || "unknown";
    if (config.workflowClass) {
      if (String(config.workflowClass).includes("FEA")) simType = "FEA";
      else if (String(config.workflowClass).includes("CFD")) simType = "CFD";
      else simType = String(config.workflowClass);
    }
    const configHash = sha256(Buffer.from(JSON.stringify(config)));

    // Check if a result already exists for this exact config + geometry combination
    const resultDir = path.join(PHYSICS_CACHE_DIR, geometryHash, configHash);

    // Create job in the database
    const dbJobId = database.createJob(`Physics ${simType}`, "RUNNING", "ADHOC", "ide", null, { resultDir });
    const cachedResult = path.join(resultDir, "result.vtu");
    const cachedScalars = path.join(resultDir, "scalars.json");

    if (fs.existsSync(cachedResult) && fs.existsSync(cachedScalars)) {
      database.updateJobStatus(dbJobId, "SUCCESS");
      return res.json({
        jobId: dbJobId.toString(),
        status: "completed",
        cached: true,
        resultDir,
      });
    }

    jobQueue.enqueue(`physics-${dbJobId}`, async () => {
      let currentStepId: number | null = null;
      fs.mkdirSync(resultDir, { recursive: true });
      const logStream = fs.createWriteStream(path.join(resultDir, "output.log"), { flags: "a" });
      let tmpDir = "";

      try {
        currentStepId = database.createJobStep(dbJobId, "Prepare Environment", "RUNNING");
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `modelscript-physics-${simType}-`));

        // Write the study configuration to a temp file
        const studyPath = path.join(tmpDir, "study.json");
        fs.writeFileSync(studyPath, JSON.stringify(config, null, 2), "utf8");

        // Symlink the geometry into the working directory
        const geomLink = path.join(tmpDir, "geometry.step");
        fs.symlinkSync(cachedGeometry, geomLink);

        // Determine which runner script to use
        const scriptName = simType === "FEA" ? "run_fea.py" : "run_cfd.py";
        const runnerScript = path.resolve(process.cwd(), "scripts", "physics", scriptName);
        database.updateJobStepStatus(currentStepId, "SUCCESS");

        // Execute the solver
        currentStepId = database.createJobStep(dbJobId, "Run Solver", "RUNNING");
        await new Promise<void>((resolve, reject) => {
          const child = spawn("python3", [runnerScript, "--config", studyPath], {
            cwd: tmpDir,
            env: { ...process.env },
          });

          child.stdout.on("data", (data) => logStream.write(data));
          child.stderr.on("data", (data) => logStream.write(data));

          child.on("error", reject);
          child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Solver exited with code ${code}`));
          });
        });
        database.updateJobStepStatus(currentStepId, "SUCCESS");

        // Process results
        currentStepId = database.createJobStep(dbJobId, "Process Results", "RUNNING");

        const vtuFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtu"));
        if (vtuFiles.length === 0) throw new Error(`Solver produced no .vtu output.`);

        fs.copyFileSync(path.join(tmpDir, vtuFiles[0]!), cachedResult);
        fs.copyFileSync(studyPath, path.join(resultDir, "study.json"));

        const scalars = extractScalarsFromVtu(cachedResult);
        fs.writeFileSync(cachedScalars, JSON.stringify(scalars, null, 2), "utf8");

        database.updateJobStepStatus(currentStepId, "SUCCESS");
        database.updateJobStatus(dbJobId, "SUCCESS");

        const status = jobQueue.getStatus(`physics-${dbJobId}`);
        if (status) status.resultPath = cachedResult;
      } catch (err) {
        logStream.write(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
        if (currentStepId) database.updateJobStepStatus(currentStepId, "FAILED");
        database.updateJobStatus(dbJobId, "FAILED");
      } finally {
        logStream.end();
        if (tmpDir && fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });

    res.json({ jobId: dbJobId.toString(), status: "pending" });
  });

  // ── Submit a CAM compilation job ──

  router.post("/physics/run-cam", express.json(), (req, res) => {
    const { geometryHash, config } = req.body as {
      geometryHash: string;
      config: Record<string, unknown>;
    };

    if (!geometryHash || !config) {
      return res.status(400).json({ error: "Missing geometryHash or config." });
    }

    const cachedGeometry = geometryCachePath(geometryHash);
    if (!fs.existsSync(cachedGeometry)) {
      return res.status(404).json({ error: "Geometry not found in cache. Upload it first via /physics/upload." });
    }

    const configHash = sha256(Buffer.from(JSON.stringify(config)));
    const resultDir = path.join(PHYSICS_CACHE_DIR, geometryHash, "cam_" + configHash);

    // Create job in the database
    const dbJobId = database.createJob(`CAM Generation`, "RUNNING", "ADHOC", "ide", null, { resultDir });
    const cachedResult = path.join(resultDir, "toolpath.gcode");

    if (fs.existsSync(cachedResult)) {
      database.updateJobStatus(dbJobId, "SUCCESS");
      return res.json({
        jobId: dbJobId.toString(),
        status: "completed",
        cached: true,
        resultDir,
      });
    }

    fs.mkdirSync(resultDir, { recursive: true });

    // Convert to js path because TS files are transpiled to dist/ in production,
    // but we use tsx watch during dev. For safety, we use the tsx compatible path or worker path.
    const ext = path.extname(import.meta.url) === ".ts" ? "ts" : "js";
    const camWorkerPath = path.resolve(process.cwd(), "apps", "api", "src", "workers", `camWorker.${ext}`);

    // We use enqueueProcess for CPU-intensive/isolated tasks
    jobQueue.enqueueProcess(`cam-${dbJobId}`, camWorkerPath, {
      stepFilePath: cachedGeometry,
      outputGcodePath: cachedResult,
      config,
    });

    // We also need to mark it in the db when it finishes, but enqueueProcess currently just tracks it in memory.
    // In a real app we'd attach a callback or poll the queue, but for scaffolding we'll let it finish.

    res.json({ jobId: dbJobId.toString(), status: "pending" });
  });

  // ── Poll job status ──

  router.get("/physics/:jobId", (req, res) => {
    const status = jobQueue.getStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({ error: "Job not found." });
    }
    res.json(status);
  });

  // ── Download full .vtu result ──

  router.get("/physics/:jobId/result", (req, res) => {
    const status = jobQueue.getStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: "Job not found." });
    if (status.status !== "completed" || !status.resultPath) {
      return res.status(400).json({ error: "Job not completed yet." });
    }
    if (!fs.existsSync(status.resultPath)) {
      return res.status(500).json({ error: "Result file missing." });
    }
    res.sendFile(status.resultPath);
  });

  // ── Download GCode result ──

  router.get("/physics/cam/:jobId/gcode", (req, res) => {
    const status = jobQueue.getStatus(`cam-${req.params.jobId}`);
    if (!status) return res.status(404).json({ error: "Job not found." });
    if (status.status !== "completed") {
      return res.status(400).json({ error: "Job not completed yet." });
    }
    // For camWorker, we might not have set status.resultPath if jobQueue.enqueueProcess doesn't return data,
    // but we know the path format.
    // To be safe, we rely on the DB or the known resultDir. For now, let's just use a simplified approach:
    // In a full implementation, we would query the database for the resultDir.
    return res.status(501).json({ error: "Endpoint requires DB result extraction." });
  });

  // ── Extract a specific scalar from the result (server-side) ──

  router.get("/physics/:jobId/result/scalar", (req, res) => {
    const status = jobQueue.getStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: "Job not found." });
    if (status.status !== "completed" || !status.resultPath) {
      return res.status(400).json({ error: "Job not completed yet." });
    }

    // Look for the pre-extracted scalars.json next to the result
    const scalarsPath = path.join(path.dirname(status.resultPath), "scalars.json");
    if (!fs.existsSync(scalarsPath)) {
      return res.status(404).json({ error: "Scalar summary not available." });
    }

    const scalars = JSON.parse(fs.readFileSync(scalarsPath, "utf8"));
    const field = req.query.field as string | undefined;

    if (field && scalars[field] !== undefined) {
      return res.json({ [field]: scalars[field] });
    }

    res.json(scalars);
  });

  return router;
}

// ── VTU Scalar Extraction ──────────────────────────────────────────

/**
 * Parse a VTU XML file and extract per-field scalar summaries
 * (min, max, mean) for all point data arrays.
 *
 * This runs server-side to avoid sending huge .vtu files to the client
 * when only scalar values are needed (e.g., for Modelica parameter binding).
 */
function extractScalarsFromVtu(vtuPath: string): Record<string, Record<string, number>> {
  const xml = fs.readFileSync(vtuPath, "utf8");
  const result: Record<string, Record<string, number>> = {};

  // Simple regex-based extraction for ASCII VTU format
  // Matches <DataArray ... Name="FieldName" ...> data </DataArray> within <PointData>
  const pointDataMatch = xml.match(/<PointData>([\s\S]*?)<\/PointData>/);
  if (!pointDataMatch) return result;

  const dataArrayRegex = /<DataArray[^>]*Name="([^"]+)"[^>]*NumberOfComponents="(\d+)"[^>]*>([\s\S]*?)<\/DataArray>/g;
  let match;

  while ((match = dataArrayRegex.exec(pointDataMatch[1]!)) !== null) {
    const name = match[1]!;
    const numComponents = parseInt(match[2]!, 10);
    const rawData = match[3]!.trim().split(/\s+/).map(Number);

    if (numComponents === 1) {
      // Scalar field: compute min, max, mean
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const v of rawData) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const mean = rawData.length > 0 ? sum / rawData.length : 0;

      result[`max${name}`] = { value: max };
      result[`min${name}`] = { value: min };
      result[`mean${name}`] = { value: mean };
    } else if (numComponents === 3) {
      // Vector field: compute magnitude stats
      let maxMag = 0;
      let sumMag = 0;
      const count = rawData.length / 3;
      for (let i = 0; i < count; i++) {
        const vx = rawData[i * 3] ?? 0;
        const vy = rawData[i * 3 + 1] ?? 0;
        const vz = rawData[i * 3 + 2] ?? 0;
        const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (mag > maxMag) maxMag = mag;
        sumMag += mag;
      }
      result[`max${name}Magnitude`] = { value: maxMag };
      result[`mean${name}Magnitude`] = { value: count > 0 ? sumMag / count : 0 };
    }
  }

  return result;
}
