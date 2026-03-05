// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { JobQueue } from "../jobs.js";
import type { LibraryStorage } from "../storage.js";
import { extractZipToDir, findLibraryRoot } from "../util/zip.js";

const execFileAsync = promisify(execFile);

export function simulateRouter(storage: LibraryStorage, jobQueue: JobQueue): express.Router {
  const router = express.Router();

  // POST /api/v1/simulate
  // Request body: { libraryName: "MyLib", libraryVersion: "1.0", modelName: "MyLib.TestModel" }
  router.post("/simulate", async (req, res) => {
    const { libraryName, libraryVersion, modelName } = req.body;

    if (!libraryName || !libraryVersion || !modelName) {
      return res.status(400).json({ error: "Missing required fields: libraryName, libraryVersion, modelName" });
    }

    // Determine if the library exists and read its buffer
    const libraryResult = storage.read(libraryName, libraryVersion);
    if (!libraryResult) {
      return res.status(404).json({ error: "Library not found" });
    }

    const jobId = `simulate-${libraryName}-${libraryVersion}-${modelName}-${Date.now()}`;

    jobQueue.enqueue(jobId, async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-simulate-"));
      try {
        // Extract the library to the temp directory
        await extractZipToDir(libraryResult.buffer, tmpDir);

        const libraryRoot = findLibraryRoot(tmpDir);
        if (!libraryRoot) {
          throw new Error("Could not find package.mo in the extracted zip");
        }

        const mosScriptPath = path.join(tmpDir, "simulate.mos");
        const packageMoPath = path.join(libraryRoot, "package.mo");

        // The OpenModelica simulate command will generate a ModelName_res.mat file
        const mosContents = `
loadFile("${packageMoPath}");
simulate(${modelName});
getErrorString();
`;

        fs.writeFileSync(mosScriptPath, mosContents, "utf8");

        // Execute OpenModelica Compiler (omc)
        await execFileAsync("omc", [mosScriptPath], { cwd: tmpDir });

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
