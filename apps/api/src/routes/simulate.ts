// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import type { JobQueue } from "../jobs.js";
import { getComputeProfile } from "../services/hpc/compute-profiles.js";
import { HpcEngine } from "../services/hpc/hpc-engine.js";
import type { HpcJobSpec } from "../services/hpc/hpc-types.js";
import { checkComputeQuota, resolveRequestUserId } from "../services/hpc/quota-guard.js";
import type { LibraryStorage } from "../storage.js";
import { enforceExportCompliance } from "../util/compliance.js";

export function simulateRouter(
  storage: LibraryStorage,
  jobQueue: JobQueue,
  database?: LibraryDatabase,
): express.Router {
  const router = express.Router();
  const hpcEngine = new HpcEngine();

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

      // Pre-flight quota check
      const profile = getComputeProfile(req.body.profile as string | undefined);
      const userId = database ? resolveRequestUserId(req, database) : null;
      if (database && userId) {
        const quota = checkComputeQuota(userId, profile.id, database);
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
          loadModels.push(lib.version ? `loadModel(${lib.name}, {"${lib.version}"});` : `loadModel(${lib.name});`);
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

      const jobId = `simulate-${libraryName || "adhoc"}-${libraryVersion || "0.0"}-${modelName}-${Date.now()}`;

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
          let qualifiedModelName = modelName;
          if (modelSource) {
            const withinMatch = modelSource.match(/^\s*within\s+([\w.]+)\s*;/m);
            if (withinMatch?.[1]) {
              qualifiedModelName = `${withinMatch[1]}.${modelName}`;
            }
          }

          // Use a simple fileNamePrefix so the CSV output path is predictable
          const fileNamePrefix = modelName.replace(/\./g, "_");
          const simArgs = [qualifiedModelName, `outputFormat="csv"`, `fileNamePrefix="${fileNamePrefix}"`];
          if (req.body.numberOfIntervals) {
            simArgs.push(`numberOfIntervals=${req.body.numberOfIntervals}`);
          }

          const mosContents = `
${loadModels.join("\n")}
${loadFiles.map((f) => `loadFile("${f}");`).join("\n")}
${adhocMoPath ? `loadFile("${adhocMoPath}");` : ""}
simulate(${simArgs.join(", ")});
getErrorString();
`;

          fs.writeFileSync(mosScriptPath, mosContents, "utf8");

          const profile = getComputeProfile(req.body.profile as string | undefined);
          let dbJobId: number | null = null;
          if (database) {
            try {
              dbJobId = database.createJob(
                `Simulation: ${modelName}`,
                "RUNNING",
                "ADHOC",
                "omc",
                null,
                {
                  jobId,
                  profile: profile.id,
                },
                userId,
              );
            } catch {
              // DB tracking is optional
            }
          }

          const hpcSpec: HpcJobSpec = {
            jobId,
            name: `OMC-${fileNamePrefix}`,
            command: "omc",
            args: [mosScriptPath],
            workingDir: tmpDir,
            env: {
              ...process.env,
              MODELICAPATH: modelicaPath,
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

          // Store the result path on the job so the GET route can stream it back
          const status = jobQueue.getStatus(jobId);
          if (status) {
            status.resultPath = csvFilePath;
            status.profile = profile.id;
            status.usage = usage;
          }

          if (database && dbJobId) {
            database.completeJobWithBilling(dbJobId, usage, userId, `Simulation: ${modelName}`, {
              profile: profile.id,
              ...usage,
            });
          }
        } catch (err) {
          // If it's a simulation failure, we might want to keep the tmp dir for debugging
          // but for now, we'll just log the error and clean up.
          console.error("Simulation Job %s failed:", jobId, err);
          fs.rmSync(tmpDir, { recursive: true, force: true });
          throw err;
        }
      });

      res.json({ jobId });
    },
  );

  // GET /api/v1/simulate/:jobId
  router.get("/simulate/:jobId", async (req, res) => {
    const { jobId } = req.params;
    const status = jobQueue.getStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      ...status,
      profile: status.profile,
      usage: status.usage,
    });
  });

  // GET /api/v1/simulate/:jobId/result
  router.get("/simulate/:jobId/result", async (req, res) => {
    const { jobId } = req.params;
    const status = jobQueue.getStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (status.status === "completed" && status.resultPath) {
      if (fs.existsSync(status.resultPath)) {
        res.sendFile(status.resultPath);
      } else {
        res.status(500).json({ error: "Result file missing but job completed." });
      }
    } else {
      res.status(400).json({ error: "Simulation not completed yet" });
    }
  });

  return router;
}
