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
  // Request body: { libraryName?: string, libraryVersion?: string, modelName: string, modelSource?: string, dependencies?: { name: string; version: string }[] }
  router.post("/simulate", async (req, res) => {
    const { libraryName, libraryVersion, modelName, modelSource, dependencies = [] } = req.body;

    if (!modelName) {
      return res.status(400).json({ error: "Missing required field: modelName" });
    }

    if (!modelSource && (!libraryName || !libraryVersion)) {
      return res.status(400).json({ error: "Either modelSource or (libraryName and libraryVersion) must be provided" });
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
        const mosContents = `
${loadModels.join("\n")}
${loadFiles.map((f) => `loadFile("${f}");`).join("\n")}
${adhocMoPath ? `loadFile("${adhocMoPath}");` : ""}
simulate(${qualifiedModelName}, outputFormat="csv", fileNamePrefix="${fileNamePrefix}");
getErrorString();
`;

        fs.writeFileSync(mosScriptPath, mosContents, "utf8");

        // Execute OpenModelica Compiler (omc) with MODELICAPATH
        const { stdout, stderr } = await execFileAsync("omc", [mosScriptPath], {
          cwd: tmpDir,
          env: { ...process.env, MODELICAPATH: modelicaPath },
        });

        const csvFilePath = path.join(tmpDir, `${fileNamePrefix}_res.csv`);

        if (!fs.existsSync(csvFilePath)) {
          const logPath = path.join(tmpDir, "simulate.log");
          let details = "";
          if (fs.existsSync(logPath)) {
            details = fs.readFileSync(logPath, "utf8");
          }
          const files = fs.readdirSync(tmpDir);
          throw new Error(
            `Simulation failed to produce a .csv result file.\nExpected path: ${csvFilePath}\nFiles in tmpDir: ${files.join(
              ", ",
            )}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}\nLOG: ${details}`,
          );
        }

        // Store the result path on the job so the GET route can stream it back
        const status = jobQueue.getStatus(jobId);
        if (status) {
          status.resultPath = csvFilePath;
        }
      } catch (err) {
        // If it's a simulation failure, we might want to keep the tmp dir for debugging
        // but for now, we'll just log the error and clean up.
        console.error(`Simulation Job ${jobId} failed:`, err);
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

    res.json(status);
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
