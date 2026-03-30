// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU management REST routes.
 *
 * Provides endpoints for uploading, listing, inspecting, and deleting
 * FMU archives. Uploaded FMUs are stored on disk and their
 * modelDescription.xml is automatically parsed for metadata extraction.
 */

import type { FmiScalarVariable, StoredFmu } from "@modelscript/cosim";
import { FmuStorage } from "@modelscript/cosim";
import express from "express";

/**
 * Create FMU management router.
 *
 * @param storage Optional pre-configured FmuStorage instance
 */
export function fmuRouter(storage?: FmuStorage): express.Router {
  const router = express.Router();
  const fmuStorage = storage ?? new FmuStorage();

  // POST /api/v1/fmus — Upload an FMU archive
  router.post("/", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
    const filename = (req.headers["x-filename"] as string) ?? "upload.fmu";
    const id = filename.replace(/\.fmu$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + Date.now();

    if (!req.body || (req.body as Buffer).length === 0) {
      return res.status(400).json({ error: "Empty request body. Send the FMU file as raw binary." });
    }

    try {
      const stored = fmuStorage.store(id, filename, req.body as Buffer);
      res.status(201).json({
        id: stored.id,
        filename: stored.filename,
        modelName: stored.modelDescription.modelName,
        guid: stored.modelDescription.guid,
        supportsCoSimulation: stored.modelDescription.supportsCoSimulation,
        supportsModelExchange: stored.modelDescription.supportsModelExchange,
        variableCount: stored.modelDescription.variables.length,
        sizeBytes: stored.sizeBytes,
        uploadedAt: stored.uploadedAt,
      });
    } catch (err) {
      res.status(422).json({
        error: err instanceof Error ? err.message : "Failed to process FMU archive",
      });
    }
  });

  // GET /api/v1/fmus — List all uploaded FMUs
  router.get("/", (_req, res) => {
    const fmus = fmuStorage.list();
    res.json({
      fmus: fmus.map((f: StoredFmu) => ({
        id: f.id,
        filename: f.filename,
        modelName: f.modelDescription.modelName,
        supportsCoSimulation: f.modelDescription.supportsCoSimulation,
        variableCount: f.modelDescription.variables.length,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.uploadedAt,
      })),
    });
  });

  // GET /api/v1/fmus/:id — Get FMU metadata (full parsed modelDescription.xml)
  router.get("/:id", (req, res) => {
    const id = req.params["id"] ?? "";
    const fmu = fmuStorage.get(id);
    if (!fmu) {
      return res.status(404).json({ error: "FMU not found" });
    }
    res.json(fmu);
  });

  // GET /api/v1/fmus/:id/variables — Get FMU variables grouped by causality
  router.get("/:id/variables", (req, res) => {
    const id = req.params["id"] ?? "";
    const fmu = fmuStorage.get(id);
    if (!fmu) {
      return res.status(404).json({ error: "FMU not found" });
    }

    const variables = fmu.modelDescription.variables;
    res.json({
      inputs: variables.filter((v: FmiScalarVariable) => v.causality === "input"),
      outputs: variables.filter((v: FmiScalarVariable) => v.causality === "output"),
      parameters: variables.filter((v: FmiScalarVariable) => v.causality === "parameter"),
      local: variables.filter((v: FmiScalarVariable) => v.causality === "local"),
      total: variables.length,
    });
  });

  // GET /api/v1/fmus/:id/description — Get raw modelDescription.xml
  router.get("/:id/description", (req, res) => {
    const id = req.params["id"] ?? "";
    const xml = fmuStorage.getModelDescription(id);
    if (!xml) {
      return res.status(404).json({ error: "FMU not found" });
    }
    res.type("application/xml").send(xml);
  });

  // GET /api/v1/fmus/:id/download — Download the raw FMU archive
  router.get("/:id/download", (req, res) => {
    const id = req.params["id"] ?? "";
    const fmu = fmuStorage.get(id);
    const archive = fmuStorage.getArchive(id);
    if (!fmu || !archive) {
      return res.status(404).json({ error: "FMU not found" });
    }
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${fmu.filename}"`);
    res.send(archive);
  });

  // DELETE /api/v1/fmus/:id — Delete an FMU
  router.delete("/:id", (req, res) => {
    const id = req.params["id"] ?? "";
    const deleted = fmuStorage.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: "FMU not found" });
    }
    res.json({ ok: true, id });
  });

  return router;
}
