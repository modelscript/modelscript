// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";

const execFileAsync = promisify(execFile);

export function simulateRouter(storage: LibraryStorage, jobQueue: JobQueue): express.Router {
  const router = express.Router();

  // POST /api/v1/simulate
  // Request body: { libraryName: "MyLib", libraryVersion: "1.0", modelName: "MyLib.TestModel", dependencies?: { name: string; version: string }[] }
  router.post("/simulate", async (req, res) => {
    const { libraryName, libraryVersion, modelName, dependencies = [] } = req.body;

    if (!libraryName || !libraryVersion || !modelName) {
      return res.status(400).json({ error: "Missing required fields: libraryName, libraryVersion, modelName" });
    }

    const allLibraries = [{ name: libraryName, version: libraryVersion }, ...dependencies];

    // Check if all libraries (including dependencies) are available and pre-extracted
    const libraryPaths: string[] = [];
    for (const lib of allLibraries) {
      if (!storage.exists(lib.name, lib.version)) {
        return res.status(404).json({ error: `Library ${lib.name}@${lib.version} not found` });
      }

      const extPath = storage.getExtractedPath(lib.name, lib.version);
      if (!fs.existsSync(extPath)) {
        // If not pre-extracted for some reason, we could trigger extraction or return error
        // For now, let's assume background processing might be pending or failed.
        return res.status(400).json({
          error: `Library ${lib.name}@${lib.version} is not yet processed or extraction failed.`,
        });
      }
      libraryPaths.push(path.dirname(extPath)); // MODELICAPATH expects the parent of the library folder
    }

    // Deduplicate and join paths for MODELICAPATH
    const modelicaPath = Array.from(new Set(libraryPaths)).join(path.delimiter);

    const jobId = `simulate-${libraryName}-${libraryVersion}-${modelName}-${Date.now()}`;

    jobQueue.enqueue(jobId, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-simulate-"));
      try {
        const mosScriptPath = path.join(tmpDir, "simulate.mos");

        // Use the pre-extracted main package.mo
        const mainLibPath = storage.getExtractedPath(libraryName, libraryVersion);
        const mainPackageMoPath = path.join(mainLibPath, "package.mo");

        const mosContents = `
loadFile("${mainPackageMoPath}");
simulate(${modelName});
getErrorString();
`;

        fs.writeFileSync(mosScriptPath, mosContents, "utf8");

        // Execute OpenModelica Compiler (omc) with MODELICAPATH
        await execFileAsync("omc", [mosScriptPath], {
          cwd: tmpDir,
          env: { ...process.env, MODELICAPATH: modelicaPath },
        });

        const segments = modelName.split(".");
        const shortModelName = segments[segments.length - 1] ?? modelName;
        const matFilePath = path.join(tmpDir, `${shortModelName}_res.mat`);

        if (!fs.existsSync(matFilePath)) {
          throw new Error("Simulation did not produce a .mat result file.");
        }

        // Store the result path on the job so the GET route can stream it back
        const status = jobQueue.getStatus(jobId);
        if (status) {
          status.resultPath = matFilePath;
        }
      } catch (err) {
        // Clean up only if failed, we need the tmp dir to persist if succeeded
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
      }
    });

    res.json({ jobId });
  });

  // GET /api/v1/simulate/:jobId
  router.get("/simulate/:jobId", async (req, res) => {
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
      res.json(status);
    }
  });

  return router;
}
