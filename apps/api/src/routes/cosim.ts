// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation REST routes.
 *
 * Provides endpoints for session management, participant enrollment,
 * MQTT participant discovery, variable couplings, and orchestrator control.
 */

import type { CosimMqttClient } from "@modelscript/cosim";
import { FmuJsParticipant, FmuStorage, Orchestrator, SessionManager } from "@modelscript/cosim";
import express from "express";

const sessionManager = new SessionManager();
const fmuStorage = new FmuStorage();

/** Track running orchestrators by session ID for pause/stop. */
const orchestrators = new Map<string, Orchestrator>();

/**
 * Create the co-simulation router.
 * @param mqttClient  Optional MQTT client (null in environments without MQTT broker)
 */
export function cosimRouter(mqttClient: CosimMqttClient | null): express.Router {
  const router = express.Router();

  // ── Session Management ──

  // POST /api/v1/cosim/sessions — Create a new co-simulation session
  router.post("/sessions", (req, res) => {
    const { startTime = 0, stopTime = 10, stepSize = 0.01, realtimeFactor = 0 } = req.body as Record<string, number>;

    const session = sessionManager.createSession({ startTime, stopTime, stepSize }, realtimeFactor);

    res.status(201).json(session.toJSON());
  });

  // GET /api/v1/cosim/sessions — List all sessions
  router.get("/sessions", (_req, res) => {
    const sessions = sessionManager.listSessions().map((s: { toJSON(): unknown }) => s.toJSON());
    res.json({ sessions });
  });

  // GET /api/v1/cosim/sessions/:id — Get session status
  router.get("/sessions/:id", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session.toJSON());
  });

  // ── Participant Enrollment ──

  // POST /api/v1/cosim/sessions/:id/participants/fmu — Add an FMU participant
  router.post("/sessions/:id/participants/fmu", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { fmuId, participantId } = req.body as { fmuId?: string; participantId?: string };
    if (!fmuId) {
      return res.status(400).json({ error: "Missing required field: fmuId" });
    }

    const pid = participantId ?? `fmu-${fmuId}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const participant = new FmuJsParticipant({
        id: pid,
        fmuId,
        storage: fmuStorage,
      });
      session.addParticipant(participant);
      res.status(201).json({
        ok: true,
        participantId: pid,
        modelName: participant.modelName,
        variables: participant.metadata.variables.length,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/v1/cosim/sessions/:id/participants — List session participants
  router.get("/sessions/:id/participants", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const participants = Array.from(session.participants.values()).map((p) => ({
      id: p.id,
      modelName: p.modelName,
      type: p.metadata.type,
      variables: p.metadata.variables.length,
    }));
    res.json({ participants });
  });

  // DELETE /api/v1/cosim/sessions/:id/participants/:pid — Remove a participant
  router.delete("/sessions/:id/participants/:pid", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    try {
      session.removeParticipant(req.params["pid"] ?? "");
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Couplings ──

  // POST /api/v1/cosim/sessions/:id/couplings — Define variable couplings
  router.post("/sessions/:id/couplings", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { from, to } = req.body as {
      from?: { participantId?: string; variableName?: string };
      to?: { participantId?: string; variableName?: string };
    };

    if (!from?.participantId || !from?.variableName || !to?.participantId || !to?.variableName) {
      return res.status(400).json({ error: "Missing coupling fields: from/to with participantId and variableName" });
    }

    try {
      session.addCoupling({
        from: { participantId: from.participantId, variableName: from.variableName },
        to: { participantId: to.participantId, variableName: to.variableName },
      });
      res.json({ ok: true, couplings: session.coupling.getAll() });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Orchestrator Control ──

  // POST /api/v1/cosim/sessions/:id/start — Start co-simulation
  router.post("/sessions/:id/start", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.state !== "created") {
      return res.status(400).json({ error: `Cannot start session in state '${session.state}'` });
    }

    const orchestrator = new Orchestrator(session, mqttClient, {
      onComplete: () => {
        console.log(`[cosim] Session ${session.sessionId} completed`);
        orchestrators.delete(session.sessionId);
      },
      onError: (err: Error) => {
        console.error(`[cosim] Session ${session.sessionId} error:`, err.message);
        orchestrators.delete(session.sessionId);
      },
    });

    orchestrators.set(session.sessionId, orchestrator);

    // Run asynchronously — don't await
    void orchestrator.run();

    res.json({ ok: true, state: "initializing", sessionId: session.sessionId });
  });

  // POST /api/v1/cosim/sessions/:id/pause — Pause simulation
  router.post("/sessions/:id/pause", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    const orchestrator = orchestrators.get(sessionId);
    if (!orchestrator) {
      return res.status(404).json({ error: "No running orchestrator for this session" });
    }
    orchestrator.pause();
    res.json({ ok: true, state: "paused" });
  });

  // POST /api/v1/cosim/sessions/:id/resume — Resume simulation
  router.post("/sessions/:id/resume", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    const orchestrator = orchestrators.get(sessionId);
    if (!orchestrator) {
      return res.status(404).json({ error: "No running orchestrator for this session" });
    }
    orchestrator.resume();
    res.json({ ok: true, state: "running" });
  });

  // POST /api/v1/cosim/sessions/:id/stop — Stop and terminate
  router.post("/sessions/:id/stop", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    const orchestrator = orchestrators.get(sessionId);
    if (!orchestrator) {
      return res.status(404).json({ error: "No running orchestrator for this session" });
    }
    orchestrator.abort();
    orchestrators.delete(sessionId);
    res.json({ ok: true, state: "stopping" });
  });

  // DELETE /api/v1/cosim/sessions/:id — Remove completed/failed session
  router.delete("/sessions/:id", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    orchestrators.delete(sessionId);
    sessionManager.removeSession(sessionId);
    res.json({ ok: true });
  });

  return router;
}

/**
 * Create the MQTT participant discovery router.
 * @param mqttClient  MQTT client that has subscribed to participant metadata
 */
export function mqttParticipantsRouter(mqttClient: CosimMqttClient | null): express.Router {
  const router = express.Router();

  // GET /api/v1/mqtt/participants — List all active MQTT participants
  router.get("/", (_req, res) => {
    if (!mqttClient) {
      return res.json({ participants: [], connected: false });
    }

    const participants = Array.from(mqttClient.participants.values());
    res.json({
      participants,
      connected: mqttClient.connected,
    });
  });

  // GET /api/v1/mqtt/participants/:id — Get participant metadata
  router.get("/:id", (req, res) => {
    if (!mqttClient) {
      return res.status(503).json({ error: "MQTT not connected" });
    }

    const meta = mqttClient.participants.get(req.params["id"] ?? "");
    if (!meta) {
      return res.status(404).json({ error: "Participant not found" });
    }

    res.json(meta);
  });

  // GET /api/v1/mqtt/participants/:id/variables — Get variable snapshot
  router.get("/:id/variables", (req, res) => {
    if (!mqttClient) {
      return res.status(503).json({ error: "MQTT not connected" });
    }

    const meta = mqttClient.participants.get(req.params["id"] ?? "");
    if (!meta) {
      return res.status(404).json({ error: "Participant not found" });
    }

    res.json({ variables: meta.variables });
  });

  // GET /api/v1/mqtt/participants/:id/tree — Get as Modelica-compatible tree node
  router.get("/:id/tree", (req, res) => {
    if (!mqttClient) {
      return res.status(503).json({ error: "MQTT not connected" });
    }

    const meta = mqttClient.participants.get(req.params["id"] ?? "");
    if (!meta) {
      return res.status(404).json({ error: "Participant not found" });
    }

    const treeNode = {
      id: `mqtt://${meta.participantId}`,
      name: meta.modelName,
      compositeName: `mqtt://${meta.participantId}`,
      classKind: meta.classKind,
      hasChildren: false,
      iconSvg: meta.iconSvg,
      variables: meta.variables,
      mqttParticipant: true,
      participantId: meta.participantId,
    };

    res.json(treeNode);
  });

  // POST /api/v1/mqtt/participants/:id/variables — Set input variable values
  router.post("/:id/variables", (req, res) => {
    if (!mqttClient) {
      return res.status(503).json({ error: "MQTT not connected" });
    }

    const meta = mqttClient.participants.get(req.params["id"] ?? "");
    if (!meta) {
      return res.status(404).json({ error: "Participant not found" });
    }

    const { values } = req.body as { values?: Record<string, number> };
    if (!values || typeof values !== "object") {
      return res.status(400).json({ error: "Missing 'values' object in request body" });
    }

    res.json({ ok: true, published: Object.keys(values).length });
  });

  return router;
}
