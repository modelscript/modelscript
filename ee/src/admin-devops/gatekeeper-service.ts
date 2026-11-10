// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

/**
 * ModelScript Enterprise Edition — Grid Code Gatekeeper Webhook & API Service.
 *
 * Exposes REST and webhook endpoints for automated interconnection screening:
 * - `POST /api/v1/grid-gatekeeper/evaluate`
 * - `GET  /api/v1/grid-gatekeeper/health`
 */

import express, { type Request, type Response, type Router } from "express";
import {
  runGatekeeperScreeningPipeline,
  type GatekeeperSubmissionPackage,
} from "./gatekeeper-pipeline.js";

/**
 * Creates the Grid Code Gatekeeper Express router.
 */
export function createGatekeeperRouter(): Router {
  const router = express.Router();

  router.get("/grid-gatekeeper/health", (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      service: "Grid Code Gatekeeper CI/CD Engine",
      supportedStandards: [
        "NERC-MOD-032-1",
        "NERC-MOD-025-2",
        "NERC-MOD-026-1",
        "NERC-MOD-027-1",
        "NERC-TPL-001-4",
        "NERC-PRC-019-2",
        "NERC-PRC-024-3",
        "IEEE-2800-2022",
        "FERC-Order-901",
      ],
      stages: [
        "1. MOD-032 Static Completeness & Parameter Bounds",
        "2. Flat-Start Equilibrium & Initialization",
        "3. Short-Circuit Ratio (SCR) Weak-Grid Stability",
        "4. IEEE 2800 / PRC-024 Ride-Through Verification",
        "5. EMT vs. RMS Model Parity (FERC Order 901)",
      ],
    });
  });

  router.post("/grid-gatekeeper/evaluate", (req: Request, res: Response): void => {
    const pkg = req.body as Partial<GatekeeperSubmissionPackage>;
    if (!pkg || !pkg.plantName) {
      res.status(400).json({ error: "Missing required submission field: 'plantName'." });
      return;
    }

    const submission: GatekeeperSubmissionPackage = {
      submissionId: pkg.submissionId || `SUB-${Date.now()}`,
      developerOrganization: pkg.developerOrganization || "Independent Power Producer",
      plantName: pkg.plantName,
      gridInterconnection: pkg.gridInterconnection || "Eastern",
      ratedMva: pkg.ratedMva ?? 100.0,
      poiKv: pkg.poiKv ?? 230.0,
      hasRawPowerFlow: pkg.hasRawPowerFlow ?? true,
      hasDyrDynamics: pkg.hasDyrDynamics ?? true,
      hasPscadModel: pkg.hasPscadModel ?? true,
      hasWasmFirmware: pkg.hasWasmFirmware ?? true,
      staticDiagnosticCount: pkg.staticDiagnosticCount,
      flatStartMaxDriftPercent: pkg.flatStartMaxDriftPercent,
      lowestStableScr: pkg.lowestStableScr,
      lvrtPass: pkg.lvrtPass,
      hvrtPass: pkg.hvrtPass,
      emtRmsNrmse: pkg.emtRmsNrmse,
    };

    const scorecard = runGatekeeperScreeningPipeline(submission);
    res.json(scorecard);
  });

  return router;
}
