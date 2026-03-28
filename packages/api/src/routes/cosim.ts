// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation REST routes.
 *
 * Provides endpoints for session management, MQTT participant discovery,
 * and historian queries.
 */

import type { CosimMqttClient } from "@modelscript/cosim";
import { Orchestrator, SessionManager } from "@modelscript/cosim";
import express from "express";

const sessionManager = new SessionManager();

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
      },
      onError: (err: Error) => {
        console.error(`[cosim] Session ${session.sessionId} error:`, err.message);
      },
    });

    // Run asynchronously — don't await
    void orchestrator.run();

    res.json({ ok: true, state: "initializing", sessionId: session.sessionId });
  });

  // POST /api/v1/cosim/sessions/:id/pause — Pause simulation
  router.post("/sessions/:id/pause", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ ok: true, state: session.state });
  });

  // POST /api/v1/cosim/sessions/:id/stop — Stop and terminate
  router.post("/sessions/:id/stop", (req, res) => {
    const session = sessionManager.getSession(req.params["id"] ?? "");
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ ok: true, state: session.state });
  });

  // DELETE /api/v1/cosim/sessions/:id — Remove completed/failed session
  router.delete("/sessions/:id", (req, res) => {
    sessionManager.removeSession(req.params["id"] ?? "");
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

    // Return in the same format as the library tree nodes
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
