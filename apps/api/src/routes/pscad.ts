// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";

/**
 * REST routes for PSCAD `.pscx`/`.pslx` linting, EMT simulation, and IEEE 2800-2022 verification
 * used by Ansatz (`apps/web`).
 */
export function pscadRouter(): express.Router {
  const router = express.Router();

  // POST /api/v1/pscad/lint
  router.post("/lint", async (req, res) => {
    try {
      const { documentText, sources } = req.body ?? {};
      if (typeof documentText !== "string" || documentText.length === 0) {
        res.status(400).json({ error: "Missing documentText" });
        return;
      }
      const { parsePscx, lintPscx, registerPscadSource } = await import("@modelscript/pscad");
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (s && typeof s.uri === "string" && typeof s.text === "string") {
            registerPscadSource(s.uri, s.text);
          }
        }
      }
      const project = parsePscx(documentText);
      const diagnostics = lintPscx(project);
      res.json({ project: project.name, diagnostics });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/v1/pscad/simulate
  router.post("/simulate", async (req, res) => {
    try {
      const { documentText, sources, durationSec, timeStepSec, verifyIeee2800, strict, faultSpec } = req.body ?? {};
      if (typeof documentText !== "string" || documentText.length === 0) {
        res.status(400).json({ error: "Missing documentText" });
        return;
      }
      const { registerPscadSource, runPscadSimulationPipeline } = await import("@modelscript/pscad");
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (s && typeof s.uri === "string" && typeof s.text === "string") {
            registerPscadSource(s.uri, s.text);
          }
        }
      }
      const result = runPscadSimulationPipeline({
        documentText,
        runSimulation: true,
        durationSec: typeof durationSec === "number" ? durationSec : undefined,
        timeStepSec: typeof timeStepSec === "number" ? timeStepSec : undefined,
        verifyIeee2800: Boolean(verifyIeee2800),
        strict: Boolean(strict),
        faultSpec: faultSpec && typeof faultSpec === "object" ? faultSpec : undefined,
        exportComtrade: false,
        exportOut: false,
        exportPsout: false,
      });

      const sim = result.simulationResult;
      const busVoltages: Record<string, number[]> = {};
      if (sim?.busVoltages) {
        for (const [k, v] of sim.busVoltages.entries()) {
          busVoltages[k] = Array.from(v);
        }
      }
      const branchCurrents: Record<string, number[]> = {};
      if (sim?.branchCurrents) {
        for (const [k, v] of sim.branchCurrents.entries()) {
          branchCurrents[k] = Array.from(v);
        }
      }

      res.json({
        project: result.project,
        settings: result.settings,
        diagnostics: result.diagnostics,
        simulationReport: result.simulationReport,
        complianceReport: result.complianceReport,
        simulationResult: sim
          ? {
              time: Array.from(sim.time),
              busVoltages,
              branchCurrents,
            }
          : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
