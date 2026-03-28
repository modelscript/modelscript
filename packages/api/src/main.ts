// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript API server entry point.
 *
 * Wires together:
 * - Express app with all route modules
 * - MQTT client for co-simulation participant discovery
 * - WebSocket server for live variable streaming
 * - Graceful shutdown handling
 */

import { CosimMqttClient, attachCosimWebSocket } from "@modelscript/cosim";
import { createApp } from "./app.js";

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const mqttUrl = process.env["MQTT_BROKER_URL"];

const app = createApp();

// ── Start HTTP server ──

const server = app.listen(port, () => {
  console.log(`ModelScript API server listening on port ${port}`);
});

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

  mqttClient
    .connect()
    .then(async () => {
      console.log(`MQTT connected to ${mqttUrl}`);
      if (mqttClient) {
        await mqttClient.subscribeParticipants();
        console.log(`MQTT participant discovery active (${mqttClient.participants.size} online)`);
      }
    })
    .catch((err: unknown) => {
      console.error("MQTT connection failed:", err instanceof Error ? err.message : err);
      console.warn("Co-simulation features will be unavailable.");
      mqttClient = null;
    });
}

// ── WebSocket streaming (attaches to the HTTP server upgrade event) ──

attachCosimWebSocket(server, mqttClient);
console.log("WebSocket co-simulation stream available at /api/v1/cosim/stream");

// ── Graceful shutdown ──

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close();

  // Disconnect MQTT
  if (mqttClient) {
    try {
      await mqttClient.disconnect();
      console.log("MQTT disconnected.");
    } catch {
      // Best-effort
    }
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
