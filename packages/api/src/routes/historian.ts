import type { CosimMqttClient } from "@modelscript/cosim";
import { HistorianReplayer } from "@modelscript/cosim";
import express from "express";
import type { Pool } from "pg";

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

/** Active replayer tracking. */
const activeReplayers = new Map<string, HistorianReplayer>();

/**
 * Create the historian router.
 * @param pool  PostgreSQL/TimescaleDB connection pool (null = stubs)
 * @param mqttClient  MQTT client for replay publishing (null = stub responses)
 */
export function historianRouter(pool: Pool | null, mqttClient?: CosimMqttClient | null): express.Router {
  const router = express.Router();

  // GET /api/v1/historian/sessions — List recorded sessions
  router.get("/sessions", async (_req, res) => {
    if (!pool) return res.json({ sessions: [] });

    try {
      const result = await pool.query(`SELECT id, start_time, stop_time, state FROM sessions ORDER BY start_time DESC`);
      res.json({
        sessions: result.rows.map(
          (r: { id: string; start_time: Date | null; stop_time: Date | null; state: string }) => ({
            id: r.id,
            startTime: r.start_time?.toISOString() ?? null,
            stopTime: r.stop_time?.toISOString() ?? null,
            state: r.state,
          }),
        ),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
  });

  // GET /api/v1/historian/sessions/:id — Get session metadata
  router.get("/sessions/:id", async (req, res) => {
    const sessionId = req.params["id"] ?? "";
    if (!pool) return res.json({ sessionId, startTime: null, stopTime: null, participantCount: 0, sampleCount: 0 });

    try {
      const sessionResult = await pool.query(
        `SELECT id, start_time, stop_time, state, metadata FROM sessions WHERE id = $1`,
        [sessionId],
      );

      if (sessionResult.rows.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }

      const row = sessionResult.rows[0] as {
        id: string;
        start_time: Date | null;
        stop_time: Date | null;
        state: string;
        metadata: unknown;
      };

      const countResult = await pool.query(`SELECT COUNT(*) as count FROM telemetry WHERE session_id = $1`, [
        sessionId,
      ]);
      const sampleCount = parseInt(String((countResult.rows[0] as { count: string }).count), 10);

      const participantResult = await pool.query(
        `SELECT COUNT(DISTINCT participant_id) as count FROM telemetry WHERE session_id = $1`,
        [sessionId],
      );
      const participantCount = parseInt(String((participantResult.rows[0] as { count: string }).count), 10);

      res.json({
        sessionId: row.id,
        startTime: row.start_time?.toISOString() ?? null,
        stopTime: row.stop_time?.toISOString() ?? null,
        state: row.state,
        metadata: row.metadata,
        participantCount,
        sampleCount,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
  });

  // GET /api/v1/historian/telemetry — Query telemetry data
  router.get("/telemetry", async (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }
    if (!pool) return res.json({ sessionId: query.sessionId, data: [] });

    try {
      const limit = query.limit ? parseInt(query.limit, 10) : 1000;
      const params: unknown[] = [query.sessionId];
      let sql = `SELECT time, participant_id, variable_name, value FROM telemetry WHERE session_id = $1`;

      if (query.participantId) {
        params.push(query.participantId);
        sql += ` AND participant_id = $${params.length}`;
      }
      if (query.variableName) {
        params.push(query.variableName);
        sql += ` AND variable_name = $${params.length}`;
      }
      if (query.from) {
        params.push(new Date(query.from));
        sql += ` AND time >= $${params.length}`;
      }
      if (query.to) {
        params.push(new Date(query.to));
        sql += ` AND time <= $${params.length}`;
      }

      sql += ` ORDER BY time`;
      params.push(limit);
      sql += ` LIMIT $${params.length}`;

      const result = await pool.query(sql, params);
      res.json({
        sessionId: query.sessionId,
        data: result.rows.map((r: { time: Date; participant_id: string; variable_name: string; value: number }) => ({
          time: r.time.toISOString(),
          participantId: r.participant_id,
          variableName: r.variable_name,
          value: r.value,
        })),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
  });

  // GET /api/v1/historian/telemetry/latest — Get latest values for all variables
  router.get("/telemetry/latest", async (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }
    if (!pool) return res.json({ sessionId: query.sessionId, values: {} });

    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (participant_id, variable_name)
           participant_id, variable_name, value, time
         FROM telemetry
         WHERE session_id = $1
         ORDER BY participant_id, variable_name, time DESC`,
        [query.sessionId],
      );

      const values: Record<string, Record<string, number>> = {};
      for (const row of result.rows as {
        participant_id: string;
        variable_name: string;
        value: number;
      }[]) {
        const pid = row.participant_id;
        values[pid] = values[pid] ?? {};
        values[pid][row.variable_name] = row.value;
      }

      res.json({ sessionId: query.sessionId, values });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
  });

  // GET /api/v1/historian/telemetry/aggregate — Time-bucketed aggregates
  router.get("/telemetry/aggregate", async (req, res) => {
    const query = req.query as HistorianQueryParams;

    if (!query.sessionId) {
      return res.status(400).json({ error: "Missing required parameter: sessionId" });
    }
    if (!pool) return res.json({ sessionId: query.sessionId, interval: query.interval ?? "1s", buckets: [] });

    try {
      const intervalStr = query.interval ?? "1 second";
      const agg = query.aggregate === "min" ? "min" : query.aggregate === "max" ? "max" : "avg";
      const params: unknown[] = [intervalStr, query.sessionId];
      let sql = `SELECT time_bucket($1::interval, time) AS bucket,
                        participant_id, variable_name, ${agg}(value) AS value
                 FROM telemetry WHERE session_id = $2`;

      if (query.participantId) {
        params.push(query.participantId);
        sql += ` AND participant_id = $${params.length}`;
      }
      if (query.variableName) {
        params.push(query.variableName);
        sql += ` AND variable_name = $${params.length}`;
      }
      if (query.from) {
        params.push(new Date(query.from));
        sql += ` AND time >= $${params.length}`;
      }
      if (query.to) {
        params.push(new Date(query.to));
        sql += ` AND time <= $${params.length}`;
      }

      sql += ` GROUP BY bucket, participant_id, variable_name ORDER BY bucket`;

      const result = await pool.query(sql, params);
      res.json({
        sessionId: query.sessionId,
        interval: intervalStr,
        buckets: result.rows.map(
          (r: { bucket: Date; participant_id: string; variable_name: string; value: number }) => ({
            time: r.bucket.toISOString(),
            participantId: r.participant_id,
            variableName: r.variable_name,
            value: r.value,
          }),
        ),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
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

    if (!pool || !mqttClient) {
      return res.status(503).json({ error: "Historian replay requires TimescaleDB and MQTT" });
    }

    const replayId = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const replayer = new HistorianReplayer(pool, mqttClient);
    activeReplayers.set(replayId, replayer);

    // Start replay asynchronously
    const replayFrom = from ? new Date(from) : new Date(0);
    const replayTo = to ? new Date(to) : new Date();

    void replayer
      .replay({
        sessionId,
        from: replayFrom,
        to: replayTo,
        speedFactor,
      })
      .then(() => {
        // Auto-cleanup on completion
        if (replayer.state === "completed" || replayer.state === "error") {
          activeReplayers.delete(replayId);
        }
      });

    res.json({ ok: true, replayId, sessionId, speedFactor, state: replayer.state });
  });

  // POST /api/v1/historian/replay/:id/pause — Pause replay
  router.post("/replay/:id/pause", (req, res) => {
    const replayer = activeReplayers.get(req.params["id"] ?? "");
    if (!replayer) return res.status(404).json({ error: "Replay not found" });
    replayer.pause();
    res.json({ ok: true, state: replayer.state });
  });

  // POST /api/v1/historian/replay/:id/resume — Resume replay
  router.post("/replay/:id/resume", (req, res) => {
    const replayer = activeReplayers.get(req.params["id"] ?? "");
    if (!replayer) return res.status(404).json({ error: "Replay not found" });
    replayer.resume();
    res.json({ ok: true, state: replayer.state });
  });

  // POST /api/v1/historian/replay/:id/stop — Stop replay
  router.post("/replay/:id/stop", (req, res) => {
    const replayId = req.params["id"] ?? "";
    const replayer = activeReplayers.get(replayId);
    if (!replayer) return res.status(404).json({ error: "Replay not found" });
    replayer.stop();
    activeReplayers.delete(replayId);
    res.json({ ok: true, state: "idle" });
  });

  // GET /api/v1/historian/replay/:id — Get replay status
  router.get("/replay/:id", (req, res) => {
    const replayer = activeReplayers.get(req.params["id"] ?? "");
    if (!replayer) return res.status(404).json({ error: "Replay not found" });
    res.json({ state: replayer.state, error: replayer.error });
  });

  // DELETE /api/v1/historian/sessions/:id — Delete recorded session data
  router.delete("/sessions/:id", async (req, res) => {
    const sessionId = req.params["id"] ?? "";
    if (!pool) return res.json({ ok: true, sessionId });

    try {
      await pool.query(`DELETE FROM telemetry WHERE session_id = $1`, [sessionId]);
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      res.json({ ok: true, sessionId });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Database error" });
    }
  });

  return router;
}
