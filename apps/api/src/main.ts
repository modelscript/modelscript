// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript API server entry point.
 *
 * Wires together:
 * - Express app with all route modules
 * - MQTT client for co-simulation participant discovery
 * - TimescaleDB pool for historian queries
 * - Historian recorder for live telemetry ingestion
 * - WebSocket server for live variable streaming
 * - Graceful shutdown handling
 */

import "./setup.js";

import { CosimMqttClient, HistorianRecorder, attachCosimWebSocket } from "@modelscript/cosim";
import { createApp } from "./app.js";

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const mqttUrl = process.env["MQTT_BROKER_URL"];
const timescaleUrl = process.env["TIMESCALE_URL"];

// ── TimescaleDB pool (optional — only if TIMESCALE_URL is set) ──

let dbPool: import("pg").Pool | null = null;

if (timescaleUrl) {
  // Lazy-load pg to avoid hard dependency when TimescaleDB is unavailable
  try {
    const { Pool } = await import("pg");
    dbPool = new Pool({ connectionString: timescaleUrl, max: 10 });
    // Test the connection
    await dbPool.query("SELECT 1");
    console.log("TimescaleDB connected.");
  } catch (err: unknown) {
    console.error("TimescaleDB connection failed:", err instanceof Error ? err.message : err);
    console.warn("Historian features will be unavailable.");
    dbPool = null;
  }
}

// ── MQTT client (optional — only if MQTT_BROKER_URL is set) ──

let mqttClient: CosimMqttClient | null = null;

if (mqttUrl) {
  mqttClient = new CosimMqttClient({
    brokerUrl: mqttUrl,
    clientId: `modelscript-api-${process.pid}`,
    unsContext: {
      site: process.env["COSIM_SITE"] ?? "default",
      area: process.env["COSIM_AREA"] ?? "default",
    },
  });

  try {
    await mqttClient.connect();
    console.log(`MQTT connected to ${mqttUrl}`);
    await mqttClient.subscribeParticipants();
    console.log(`MQTT participant discovery active (${mqttClient.participants.size} online)`);
  } catch (err: unknown) {
    console.error("MQTT connection failed:", err instanceof Error ? err.message : err);
    console.warn("Co-simulation features will be unavailable.");
    mqttClient = null;
  }
}

// ── Historian recorder (only when both MQTT and TimescaleDB are available) ──

let recorder: HistorianRecorder | null = null;

if (mqttClient && dbPool) {
  recorder = new HistorianRecorder(dbPool, mqttClient, {
    batchSize: 500,
    flushIntervalMs: 200,
  });
  console.log("Historian recorder ready (starts per-session).");
}

// ── Create Express app ──

const app = createApp({ mqttClient, dbPool, storage: undefined });

// ── Start HTTP server ──

const server = app.listen(port, () => {
  console.log(`ModelScript API server listening on port ${port}`);
});

// ── WebSocket streaming ──

attachCosimWebSocket(server, mqttClient);
console.log("WebSocket co-simulation stream available at /api/v1/cosim/stream");

// ── Graceful shutdown ──

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close();

  if (recorder) {
    try {
      await recorder.stopRecording();
    } catch {
      // Best-effort
    }
  }

  if (mqttClient) {
    try {
      await mqttClient.disconnect();
      console.log("MQTT disconnected.");
    } catch {
      // Best-effort
    }
  }

  if (dbPool) {
    try {
      await dbPool.end();
      console.log("TimescaleDB pool closed.");
    } catch {
      // Best-effort
    }
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
