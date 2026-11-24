// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import {
  assertComputeJobAccess,
  completeComputeJob,
  failComputeJob,
  formatComputeJobStatus,
  holdComputeEscrow,
  runComputePreflight,
  sendComputeJobResultFile,
} from "../services/compute-job-lifecycle.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import type { HpcJobSpec } from "../services/hpc/hpc-types.js";
import { prepareNativeSimulation, type NativeSimPrepResult } from "../services/simulation/native-sim-runner.js";
import type { LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { scanModelicaSource } from "../util/package-scanner.js";

/**
 * Creates the Express router handling `/api/v1/simulate` job submission, status polling
 * (`/api/v1/simulate/:jobId`), and CSV trajectory retrieval (`/api/v1/simulate/:jobId/result`),
 * enforcing export-compliance checks and compute credit quotas.
 */
export function simulateRouter(
  storage: LibraryStorage,
  jobQueue: JobQueue,
  database?: LibraryDatabase,
): express.Router {
  const router = express.Router();
  const hpcEngine = new HpcEngine();
  const jobOwners = new Map<string, number>();

  const checkSimJobAccess = (req: express.Request, res: express.Response, jobId: string): boolean => {
    const allowInTest = !process.env["STRICT_SIM_AUTH"];
    if (allowInTest && process.env["NODE_ENV"] === "test") return true;

    let ownerId = jobOwners.get(jobId);
    if (ownerId === undefined && database) {
      const dbJob = database.getJobByMetadataKey("jobId", jobId);
      if (dbJob && dbJob.user_id !== null) {
        ownerId = dbJob.user_id;
        jobOwners.set(jobId, ownerId);
      }
    }
    return assertComputeJobAccess(req, res, database, {
      allowInTest,
      ownerId,
      allowWhenUnowned: process.env["ALLOW_ANONYMOUS_SIMULATION"] === "true",
    });
  };

  // POST /api/v1/simulate
  // Request body: { libraryName?: string, libraryVersion?: string, modelName: string, modelSource?: string, dependencies?: { name: string; version: string }[], profile?: string }
  router.post(
    "/simulate",
    enforceExportCompliance(() => database),
    async (req, res) => {
      const { libraryName, libraryVersion, modelName, modelSource, dependencies = [] } = req.body;

      if (!modelName) {
        return res.status(400).json({ error: "Missing required field: modelName" });
      }

      if (!modelSource && (!libraryName || !libraryVersion)) {
        return res
          .status(400)
          .json({ error: "Either modelSource or (libraryName and libraryVersion) must be provided" });
      }

      if (typeof modelSource === "string") {
        const sourceViolations = scanModelicaSource(modelSource);
        if (sourceViolations.length > 0) {
          return res.status(400).json({
            error: `Security violation in modelSource: ${sourceViolations.join(", ")}`,
            violations: sourceViolations,
          });
        }
      }

      // Pre-flight auth, sandboxing & quota check
      const preflight = runComputePreflight(req, res, database, {
        profileId: req.body.profile as string | undefined,
        allowAnonymous:
          process.env["ALLOW_ANONYMOUS_SIMULATION"] === "true" ||
          (process.env["NODE_ENV"] === "test" && !process.env["STRICT_SIM_AUTH"]),
      });
      if (!preflight.allowed) return;
      const { userId, profile, estimatedCost } = preflight;

      const allLibraries = dependencies.slice();
      if (libraryName && libraryVersion) {
        allLibraries.unshift({ name: libraryName, version: libraryVersion });
      }

      // Check if all libraries (including dependencies) are available and pre-extracted
      const libraryPaths: string[] = [];
      const loadModels: string[] = [];
      const loadFiles: string[] = [];
      const standardLibraries = ["Modelica", "ModelicaReference", "ModelicaServices", "Complex"];

      for (const lib of allLibraries) {
        if (standardLibraries.includes(lib.name)) {
          const safeVer = lib.version ? String(lib.version).replace(/[^a-zA-Z0-9_.-]/g, "") : "";
          loadModels.push(safeVer ? `loadModel(${lib.name}, {"${safeVer}"});` : `loadModel(${lib.name});`);
          continue;
        }

        if (!storage.exists(lib.name, lib.version)) {
          return res.status(404).json({ error: `Library ${lib.name}@${lib.version} not found` });
        }

        const extPath = storage.getExtractedPath(lib.name, lib.version);
        if (!fs.existsSync(extPath)) {
          return res.status(400).json({
            error: `Library ${lib.name}@${lib.version} is not yet processed or extraction failed.`,
          });
        }
        libraryPaths.push(path.dirname(extPath)); // MODELICAPATH expects the parent of the library folder
        loadFiles.push(path.join(extPath, "package.mo"));
      }

      // Deduplicate and join paths for MODELICAPATH
      const modelicaPath = Array.from(new Set(libraryPaths)).join(path.delimiter);

      const safeLibNamePart = String(libraryName || "adhoc").replace(/[^a-zA-Z0-9_.-]/g, "_");
      const safeLibVerPart = String(libraryVersion || "0.0").replace(/[^a-zA-Z0-9_.-]/g, "_");
      const safeModelJobPart = String(modelName).replace(/[^a-zA-Z0-9_.-]/g, "_");
      const jobId = `simulate-${safeLibNamePart}-${safeLibVerPart}-${safeModelJobPart}-${crypto.randomUUID()}`;
      if (userId) {
        if (jobOwners.size >= 5000) {
          const oldest = jobOwners.keys().next().value;
          if (oldest !== undefined) jobOwners.delete(oldest);
        }
        jobOwners.set(jobId, userId);
      }

      let dbJobId: number | null = null;
      if (database) {
        try {
          dbJobId = database.createJob(
            `Simulation: ${modelName}`,
            "RUNNING",
            "ADHOC",
            req.body.engine === "omc" ? "omc" : "modelscript",
            null,
            {
              jobId,
              profile: profile.id,
            },
            userId,
          );
          if (
            !holdComputeEscrow({
              database,
              res,
              userId,
              dbJobId,
              estimatedCost,
              description: `HPC Escrow Hold: Simulation ${modelName}`,
              metadata: { jobId, profile: profile.id },
              errorTitle: "Payment Required:Insufficient Compute Credits",
              profileId: profile.id,
            })
          ) {
            return;
          }
        } catch {
          // DB tracking is optional
        }
      }

      jobQueue.enqueue(jobId, async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-simulate-"));
        try {
          const mosScriptPath = path.join(tmpDir, "simulate.mos");

          // If we have ad-hoc source, write it to a file and load it
          let adhocMoPath: string | null = null;
          if (modelSource) {
            adhocMoPath = path.join(tmpDir, "adhoc.mo");
            fs.writeFileSync(adhocMoPath, modelSource, "utf8");
          }

          // Build fully qualified model name by extracting the `within` clause
          // from the model source. When the source has `within A.B.C;`, OMC loads
          // the class into that package, so simulate() needs `A.B.C.ClassName`.
          const safeModelName = String(modelName).replace(/[^a-zA-Z0-9_.]/g, "") || "Model";
          let qualifiedModelName = safeModelName;
          if (modelSource) {
            const withinMatch = modelSource.match(/^\s*within\s+([\w.]+)\s*;/m);
            if (withinMatch?.[1]) {
              qualifiedModelName = `${withinMatch[1]}.${safeModelName}`;
            }
          }

          // Use a simple fileNamePrefix so the CSV output path is predictable and safe from path traversal
          const fileNamePrefix = safeModelName.replace(/[^a-zA-Z0-9_]/g, "_") || "model";
          const simArgs = [qualifiedModelName, `outputFormat="csv"`, `fileNamePrefix="${fileNamePrefix}"`];
          const boundedIntervals = req.body.numberOfIntervals
            ? Math.min(Math.max(1, Math.floor(Number(req.body.numberOfIntervals) || 500)), 50_000)
            : undefined;
          if (boundedIntervals) {
            simArgs.push(`numberOfIntervals=${boundedIntervals}`);
          }

          const mosContents = `
${loadModels.join("\n")}
${loadFiles.map((f) => `loadFile("${f}");`).join("\n")}
${adhocMoPath ? `loadFile("${adhocMoPath}");` : ""}
simulate(${simArgs.join(", ")});
getErrorString();
`;

          fs.writeFileSync(mosScriptPath, mosContents, "utf8");

          // Native ModelScript simulation engine vs OMC
          const enginePreference = req.body.engine ?? "modelscript";
          let prep: NativeSimPrepResult | null = null;
          if (enginePreference !== "omc") {
            const safeStartTime = Number.isFinite(Number(req.body.startTime)) ? Number(req.body.startTime) : undefined;
            const safeStopTime = Number.isFinite(Number(req.body.stopTime))
              ? Math.min(Math.max(Number(req.body.stopTime), (safeStartTime ?? 0) + 1e-6), 86_400)
              : undefined;

            const duration = (safeStopTime ?? 1) - (safeStartTime ?? 0);
            let safeStepSize: number | undefined = undefined;
            if (req.body.stepSize !== undefined && Number.isFinite(Number(req.body.stepSize))) {
              const rawStep = Math.abs(Number(req.body.stepSize));
              const minStep = duration > 0 ? duration / 500_000 : 1e-6;
              safeStepSize = Math.max(rawStep, minStep);
            }
            let safeTolerance: number | undefined = undefined;
            if (req.body.tolerance !== undefined && Number.isFinite(Number(req.body.tolerance))) {
              safeTolerance = Math.min(Math.max(Number(req.body.tolerance), 1e-12), 1.0);
            }

            prep = await prepareNativeSimulation(tmpDir, {
              modelName: qualifiedModelName,
              sourceFiles: [...loadFiles, ...(adhocMoPath ? [adhocMoPath] : [])],
              libraryPaths,
              startTime: safeStartTime,
              stopTime: safeStopTime,
              stepSize: safeStepSize,
              numberOfIntervals: boundedIntervals,
              solver: req.body.solver === "cvode" ? "cvode" : "rk4",
              tolerance: safeTolerance,
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
              name: `MSX-${fileNamePrefix}`,
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
              name: `OMC-${fileNamePrefix}`,
              command: "omc",
              args: [mosScriptPath],
              workingDir: tmpDir,
              env: {
                MODELICAPATH: modelicaPath,
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
          const usage = await hpcEngine.waitForCompletion(submission.nativeJobId, tmpDir, profile);

          let csvFilePath = path.join(tmpDir, `${fileNamePrefix}_res.csv`);
          if (!fs.existsSync(csvFilePath)) {
            const qualifiedPrefix = qualifiedModelName.replace(/[^a-zA-Z0-9_]/g, "_");
            const qualifiedCsvPath = path.join(tmpDir, `${qualifiedPrefix}_res.csv`);
            if (fs.existsSync(qualifiedCsvPath)) {
              csvFilePath = qualifiedCsvPath;
            }
          }

          if (!fs.existsSync(csvFilePath)) {
            const logPath = path.join(tmpDir, "simulate.log");
            let details = "";
            if (fs.existsSync(logPath)) {
              details = fs.readFileSync(logPath, "utf8");
            }
            const slurmLog = path.join(tmpDir, `slurm-${submission.nativeJobId}.out`);
            let slurmDetails = "";
            if (fs.existsSync(slurmLog)) {
              slurmDetails = fs.readFileSync(slurmLog, "utf8");
            }
            const files = fs.readdirSync(tmpDir);
            throw new Error(
              `Simulation failed to produce a .csv result file (exitCode: ${usage.exitCode}).\nExpected path: ${csvFilePath}\nFiles in tmpDir: ${files.join(
                ", ",
              )}\nLOG: ${details}\nSLURM: ${slurmDetails}`,
            );
          }

          // Persist the CSV result outside tmpDir so tmpDir can be cleaned up in finally
          const resultDir = path.resolve(os.tmpdir(), "modelscript-simulate-results");
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
                } catch {}
              }
            }
          } catch {}
          const safeJobFileName = `${path.basename(jobId).replace(/[^a-zA-Z0-9_.-]/g, "_")}_res.csv`;
          const persistedCsvPath = path.resolve(resultDir, safeJobFileName);
          const relPersisted = path.relative(resultDir, persistedCsvPath);
          if (!relPersisted || relPersisted.startsWith("..") || path.isAbsolute(relPersisted)) {
            throw new Error("Invalid CSV destination path");
          }
          fs.copyFileSync(csvFilePath, persistedCsvPath);

          // Store the result path on the job so the GET route can stream it back
          const status = jobQueue.getStatus(jobId);
          if (status) {
            status.resultPath = persistedCsvPath;
            status.profile = profile.id;
            status.usage = usage;
          }

          completeComputeJob({
            database,
            dbJobId,
            userId,
            costCredits: usage.costCredits ?? 0,
            description: `Simulation: ${modelName}`,
            metadata: { profile: profile.id, ...usage },
            accounting: usage,
            notificationType: "simulation_completed",
            grantReferralReward: true,
          });
        } catch (err) {
          failComputeJob({
            database,
            dbJobId,
            userId,
            error: err,
            fallbackMessage: "Simulation execution failed",
          });
          console.error("Simulation Job %s failed:", jobId, err);
          throw err;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });

      res.json({ jobId });
      return;
    },
  );

  // GET /api/v1/simulate/:jobId
  router.get("/simulate/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const status = jobQueue.getStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (!checkSimJobAccess(req, res, jobId)) {
      return;
    }

    res.json(formatComputeJobStatus(status));
    return;
  });

  // GET /api/v1/simulate/:jobId/result
  router.get("/simulate/:jobId/result", async (req, res) => {
    const { jobId } = req.params;
    const status = jobQueue.getStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (!checkSimJobAccess(req, res, jobId)) {
      return;
    }

    sendComputeJobResultFile(res, status, {
      notCompleted: "Simulation not completed yet",
      missingFile: "Result file missing but job completed.",
    });
    return;
  });

  return router;
}
