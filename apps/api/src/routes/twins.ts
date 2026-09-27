// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { twinManager } from "../services/twin/index.js";

export function twinsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/twins
   * Deploy a new operational digital twin instance bound to a hardware serial number.
   */
  router.post("/", async (req: Request, res: Response): Promise<void> => {
    const { serialNumber, name, modelicaClass, config, initialParameters } = req.body;

    if (!serialNumber || typeof serialNumber !== "string") {
      res.status(400).json({ error: "serialNumber is required" });
      return;
    }

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const instance = database.getInstanceBySerialNumber(serialNumber);
    if (!instance) {
      res.status(404).json({ error: `Hardware instance with serial '${serialNumber}' not found` });
      return;
    }

    const twinConfig = config && typeof config === "object" ? JSON.stringify(config) : config || "{}";
    const currentParams =
      initialParameters && typeof initialParameters === "object"
        ? JSON.stringify(initialParameters)
        : JSON.stringify({ R_th: 0.15, P_loss: 100.0, C_th: 20.0, T_amb: 25.0 });

    try {
      const twinId = database.createTwin({
        instanceId: instance.id,
        name,
        modelicaClass: modelicaClass || "Powertrain.InverterCoolingCircuit",
        config: twinConfig,
        currentParameters: currentParams,
      });

      const twin = database.getTwin(twinId);
      res.status(201).json({ twin });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/twins
   * List registered digital twins.
   */
  router.get("/", (req: Request, res: Response): void => {
    const limit = Math.min(Number(req.query["limit"]) || 50, 100);
    const twins = database.listTwins(limit);
    res.json({ twins });
  });

  /**
   * GET /api/v1/twins/:id
   * Get full state of a digital twin.
   */
  router.get("/:id", async (req: Request, res: Response): Promise<void> => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    const twin = database.getTwin(twinId);
    if (!twin) {
      res.status(404).json({ error: `Digital Twin #${twinId} not found` });
      return;
    }

    try {
      const session = await twinManager.getOrCreateSession(twinId, database);
      const proposals = database.listTwinProposals(twinId);
      const adaptations = database.listTwinAdaptations(twinId, 10);

      res.json({
        twin,
        activeSession: {
          currentParameters: session.currentParameters,
          healthScore: session.healthScore,
          status: session.status,
          sampleCount: session.buffer.getSampleCount(),
          timeRange: session.buffer.getTimeRange(),
        },
        proposals,
        recentAdaptations: adaptations,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/twins/:id/telemetry
   * Ingest real-time telemetry sample batch or single point.
   */
  router.post("/:id/telemetry", async (req: Request, res: Response): Promise<void> => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    const { timestamp, channels, samples } = req.body;

    try {
      if (Array.isArray(samples)) {
        let lastResult: any;
        for (const sample of samples) {
          lastResult = await twinManager.ingestTelemetry(
            twinId,
            Number(sample.timestamp ?? sample.t),
            sample.channels ?? sample.y ?? [],
            database,
          );
        }
        res.json({ success: true, processed: samples.length, lastResult });
        return;
      }

      if (typeof timestamp !== "number" || !Array.isArray(channels)) {
        res
          .status(400)
          .json({ error: "Payload must provide 'timestamp' (number) and 'channels' (array) or 'samples' (array)" });
        return;
      }

      const result = await twinManager.ingestTelemetry(twinId, timestamp, channels, database);
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/twins/:id/stream
   * Real-time Server-Sent Events stream of telemetry, residuals, and drift events.
   */
  router.get("/:id/stream", async (req: Request, res: Response): Promise<void> => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    try {
      await twinManager.getOrCreateSession(twinId, database);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const unsubscribe = twinManager.subscribe(twinId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Send initial hello
      res.write(`data: ${JSON.stringify({ type: "connected", twinId })}\n\n`);

      req.on("close", () => {
        unsubscribe();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/twins/:id/adapt
   * Trigger on-demand MHE calibration (manual override).
   */
  router.post("/:id/adapt", async (req: Request, res: Response): Promise<void> => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    const reason = req.body?.reason || "manual";

    try {
      const result = await twinManager.adaptTwin(twinId, reason, database);
      res.json({
        success: true,
        converged: result.converged,
        iterations: result.iterations,
        lossBefore: result.lossBefore,
        lossAfter: result.lossAfter,
        calibratedParameters: result.calibratedParameters,
        parameterDeltas: result.parameterDeltas,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/twins/:id/prognostics
   * Run forward predictive simulation under projected mission profile; return RUL.
   */
  router.post("/:id/prognostics", async (req: Request, res: Response): Promise<void> => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    const dutyStressTempK = Number(req.body?.dutyStressTempK) || 343.15;
    const currentDamage = Number(req.body?.currentDamage) || 0.35;

    try {
      const forecast = await twinManager.predictPrognostics(twinId, dutyStressTempK, currentDamage, database);
      res.json(forecast);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/twins/:id/proposals
   * List pending Physics PRs for this twin.
   */
  router.get("/:id/proposals", (req: Request, res: Response): void => {
    const twinId = Number(req.params["id"]);
    if (isNaN(twinId)) {
      res.status(400).json({ error: "Invalid twin ID" });
      return;
    }

    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const proposals = database.listTwinProposals(twinId, status);
    res.json({ proposals });
  });

  /**
   * POST /api/v1/twins/:id/proposals/:proposalId/approve
   * Approve a Physics PR: commits calibrated parameters to active baseline.
   */
  router.post("/:id/proposals/:proposalId/approve", async (req: Request, res: Response): Promise<void> => {
    const proposalId = Number(req.params["proposalId"]);
    const twinId = Number(req.params["id"]);
    if (isNaN(proposalId) || isNaN(twinId)) {
      res.status(400).json({ error: "Invalid proposal or twin ID" });
      return;
    }

    const reviewerId = Number(req.body?.reviewerId) || 1;
    const notes = req.body?.notes;

    const ok = database.reviewTwinProposal(proposalId, "approved", reviewerId, notes);
    if (!ok) {
      res.status(400).json({ error: "Proposal cannot be approved (not found or already closed)" });
      return;
    }

    const proposal = database.getTwinProposal(proposalId);
    if (proposal) {
      try {
        const session = await twinManager.getOrCreateSession(twinId, database);
        const updatedParams = JSON.parse(proposal.updated_parameters);
        for (const [k, v] of Object.entries(updatedParams)) {
          session.currentParameters[k] = Number(v);
        }
      } catch (err) {
        console.error("Failed to sync session parameters:", err);
      }
    }

    res.json({ success: true, status: "approved", proposal });
  });

  /**
   * POST /api/v1/twins/:id/proposals/:proposalId/reject
   * Reject a Physics PR with explanation notes.
   */
  router.post("/:id/proposals/:proposalId/reject", (req: Request, res: Response): void => {
    const proposalId = Number(req.params["proposalId"]);
    if (isNaN(proposalId)) {
      res.status(400).json({ error: "Invalid proposal ID" });
      return;
    }

    const reviewerId = Number(req.body?.reviewerId) || 1;
    const notes = req.body?.notes;

    const ok = database.reviewTwinProposal(proposalId, "rejected", reviewerId, notes);
    if (!ok) {
      res.status(400).json({ error: "Proposal cannot be rejected (not found or already closed)" });
      return;
    }

    const proposal = database.getTwinProposal(proposalId);
    res.json({ success: true, status: "rejected", proposal });
  });

  return router;
}
