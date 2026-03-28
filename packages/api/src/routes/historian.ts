// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Historian REST routes.
 *
 * Provides endpoints for querying historical co-simulation data stored
 * in TimescaleDB, including time-series telemetry, session metadata,
 * and replay control.
 */

import express from "express";

/** Historian query parameters. */
interface HistorianQueryParams {
  sessionId?: string;
  participantId?: string;
  variableName?: string;
  from?: string;
  to?: string;
  limit?: string;
  aggregate?: string;
  interval?: string;
}

/**
 * Create the historian router.
 *
 * Note: In production, this would accept a database pool (pg.Pool) for
 * querying TimescaleDB. For now, the routes define the API contract and
 * return placeholder responses until the database layer is wired in.
 */
export function historianRouter(): express.Router {
  const router = express.Router();

  // GET /api/v1/historian/sessions — List recorded sessions
  router.get("/sessions", (_req, res) => {
    // TODO: query from sessions table
    res.json({ sessions: [] });
  });

  // GET /api/v1/historian/sessions/:id — Get session metadata
  router.get("/sessions/:id", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    // TODO: query from sessions table
    res.json({
      sessionId,
      startTime: null,
      stopTime: null,
      participantCount: 0,
      sampleCount: 0,
    });
  });

  // GET /api/v1/historian/telemetry — Query telemetry data
  router.get("/telemetry", (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }

    // Validate time range
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const limit = query.limit ? parseInt(query.limit, 10) : 1000;

    // TODO: query from telemetry hypertable with optional aggregation
    res.json({
      sessionId: query.sessionId,
      participantId: query.participantId ?? null,
      variableName: query.variableName ?? null,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      aggregate: query.aggregate ?? null,
      interval: query.interval ?? null,
      limit,
      data: [],
    });
  });

  // GET /api/v1/historian/telemetry/latest — Get latest values for all variables
  router.get("/telemetry/latest", (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }

    // TODO: query latest values using TimescaleDB last() aggregate
    res.json({
      sessionId: query.sessionId,
      values: {},
    });
  });

  // GET /api/v1/historian/telemetry/aggregate — Time-bucketed aggregates
  router.get("/telemetry/aggregate", (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }

    const interval = query.interval ?? "1s";

    // TODO: use TimescaleDB time_bucket() for downsampled queries
    res.json({
      sessionId: query.sessionId,
      interval,
      buckets: [],
    });
  });

  // POST /api/v1/historian/replay — Start replaying a session
  router.post("/replay", (req, res) => {
    const {
      sessionId,
      from,
      to,
      speedFactor = 1.0,
    } = req.body as {
      sessionId?: string;
      from?: string;
      to?: string;
      speedFactor?: number;
    };

    if (!sessionId) {
      return res.status(400).json({ error: "Missing required field: sessionId" });
    }

    // TODO: instantiate HistorianReplayer and start async replay
    res.json({
      ok: true,
      sessionId,
      from: from ?? null,
      to: to ?? null,
      speedFactor,
      state: "playing",
    });
  });

  // POST /api/v1/historian/replay/pause — Pause replay
  router.post("/replay/pause", (_req, res) => {
    // TODO: call replayer.pause()
    res.json({ ok: true, state: "paused" });
  });

  // POST /api/v1/historian/replay/resume — Resume replay
  router.post("/replay/resume", (_req, res) => {
    // TODO: call replayer.resume()
    res.json({ ok: true, state: "playing" });
  });

  // POST /api/v1/historian/replay/stop — Stop replay
  router.post("/replay/stop", (_req, res) => {
    // TODO: call replayer.stop()
    res.json({ ok: true, state: "idle" });
  });

  // DELETE /api/v1/historian/sessions/:id — Delete recorded session data
  router.delete("/sessions/:id", (req, res) => {
    const sessionId = req.params["id"] ?? "";
    // TODO: delete from telemetry and sessions tables
    res.json({ ok: true, sessionId });
  });

  return router;
}
