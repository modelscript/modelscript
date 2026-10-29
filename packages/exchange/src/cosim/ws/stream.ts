// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebSocket streaming for live co-simulation data.
 *
 * Provides a WebSocket server that streams real-time variable updates
 * from the MQTT broker to connected browser clients. Handles:
 *
 * - Per-session subscription management
 * - Variable filtering (subscribe to specific participants/variables)
 * - Automatic cleanup on disconnect
 * - Throttled updates to avoid overwhelming slow clients
 */

import type { IncomingMessage, Server } from "http";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import type { CosimMqttClient } from "../mqtt/client.js";

/** Client subscription state. */
interface ClientState {
  /** WebSocket connection. */
  ws: WsWebSocket;
  /** Subscribed participant IDs (empty = all). */
  participants: Set<string>;
  /** Subscribed variable names (empty = all). */
  variables: Set<string>;
  /** Throttle interval in ms (default: 50ms = 20 updates/sec). */
  throttleMs: number;
  /** Pending updates buffer (throttled). */
  pendingUpdates: Map<string, { participantId: string; variable: string; value: number; time: number }>;
  /** Flush timer. */
  flushTimer: ReturnType<typeof setInterval> | null;
}

/** WebSocket message types from client. */
interface WsClientMessage {
  type: "subscribe" | "unsubscribe" | "setThrottle";
  participants?: string[] | undefined;
  variables?: string[] | undefined;
  throttleMs?: number | undefined;
}

/** WebSocket message types to client. */
interface WsServerMessage {
  type: "update" | "batch" | "error" | "subscribed";
  data?: { participantId: string; variable: string; value: number; time: number }[] | undefined;
  error?: string | undefined;
}

/**
 * Create a WebSocket handler for co-simulation streaming.
 *
 * Forwards variable updates from the CosimMqttClient's `onVariable` callback
 * to subscribed WebSocket clients, with per-client filtering and throttling.
 *
 * Usage:
 * ```typescript
 * import { WebSocketServer } from 'ws';
 * const wss = new WebSocketServer({ noServer: true });
 * const handler = createCosimWebSocketHandler(mqttClient);
 *
 * server.on('upgrade', (req, socket, head) => {
 *   if (req.url?.startsWith('/api/v1/cosim/stream')) {
 *     wss.handleUpgrade(req, socket, head, (ws) => {
 *       handler(ws, req);
 *     });
 *   }
 * });
 * ```
 */
const MAX_SUBSCRIBED_PARTICIPANTS = 256;
const MAX_SUBSCRIBED_VARIABLES = 2048;
const MAX_PENDING_UPDATES = 4096;
const MAX_WS_CLIENTS = 256;

export function createCosimWebSocketHandler(
  mqttClient: CosimMqttClient | null,
): (ws: WsWebSocket, req: IncomingMessage) => void {
  const clients = new Set<ClientState>();

  // Forward MQTT variable updates to subscribed WebSocket clients
  if (mqttClient) {
    mqttClient.onVariable((participantId: string, variableName: string, value: number) => {
      const time = Date.now();

      for (const client of clients) {
        if (client.participants.size > 0 && !client.participants.has(participantId)) continue;
        if (client.variables.size > 0 && !client.variables.has(variableName)) continue;
        if (
          client.pendingUpdates.size >= MAX_PENDING_UPDATES &&
          !client.pendingUpdates.has(`${participantId}/${variableName}`)
        ) {
          continue;
        }

        // Buffer the update for throttled delivery
        const key = `${participantId}/${variableName}`;
        client.pendingUpdates.set(key, { participantId, variable: variableName, value, time });
      }
    });
  }

  return (ws: WsWebSocket, _req: IncomingMessage) => {
    if (clients.size >= MAX_WS_CLIENTS) {
      ws.close(1013, "Maximum concurrent co-simulation stream clients reached");
      return;
    }

    const state: ClientState = {
      ws,
      participants: new Set(),
      variables: new Set(),
      throttleMs: 50,
      pendingUpdates: new Map(),
      flushTimer: null,
    };

    clients.add(state);

    // Start flush timer
    state.flushTimer = setInterval(() => {
      if (state.pendingUpdates.size === 0) return;
      if (ws.readyState !== 1) return; // OPEN

      const updates = Array.from(state.pendingUpdates.values());
      state.pendingUpdates.clear();

      const msg: WsServerMessage = {
        type: "batch",
        data: updates,
      };

      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // Client disconnected
      }
    }, state.throttleMs);

    // Handle incoming messages
    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as WsClientMessage;

        switch (msg.type) {
          case "subscribe":
            if (Array.isArray(msg.participants)) {
              state.participants = new Set(
                msg.participants
                  .filter((p): p is string => typeof p === "string" && p.length <= 256)
                  .slice(0, MAX_SUBSCRIBED_PARTICIPANTS),
              );
            }
            if (Array.isArray(msg.variables)) {
              state.variables = new Set(
                msg.variables
                  .filter((v): v is string => typeof v === "string" && v.length <= 256)
                  .slice(0, MAX_SUBSCRIBED_VARIABLES),
              );
            }
            send(ws, { type: "subscribed" });
            break;

          case "unsubscribe":
            state.participants.clear();
            state.variables.clear();
            state.pendingUpdates.clear();
            send(ws, { type: "subscribed" });
            break;

          case "setThrottle":
            if (
              typeof msg.throttleMs === "number" &&
              Number.isFinite(msg.throttleMs) &&
              msg.throttleMs >= 10 &&
              msg.throttleMs <= 60_000
            ) {
              state.throttleMs = Math.floor(msg.throttleMs);
              // Restart flush timer with new interval
              if (state.flushTimer) clearInterval(state.flushTimer);
              state.flushTimer = setInterval(() => {
                if (state.pendingUpdates.size === 0) return;
                if (ws.readyState !== 1) return;
                const updates = Array.from(state.pendingUpdates.values());
                state.pendingUpdates.clear();
                send(ws, { type: "batch", data: updates });
              }, state.throttleMs);
            }
            break;
        }
      } catch {
        send(ws, { type: "error", error: "Invalid message format" });
      }
    });

    // Cleanup on disconnect
    ws.on("close", () => {
      if (state.flushTimer) clearInterval(state.flushTimer);
      clients.delete(state);
    });

    ws.on("error", () => {
      if (state.flushTimer) clearInterval(state.flushTimer);
      clients.delete(state);
    });
  };
}

/** Attach WebSocket upgrade handler to an HTTP server. */
export function attachCosimWebSocket(
  server: Server,
  mqttClient: CosimMqttClient | null,
  path = "/api/v1/cosim/stream",
): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const handler = createCosimWebSocketHandler(mqttClient);

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(path)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handler(ws, req);
      });
    } else if (!req.url?.startsWith("/api/v1/collab/stream")) {
      socket.destroy();
    }
  });
}

/** Helper to send a typed message. */
function send(ws: WsWebSocket, msg: WsServerMessage): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Ignore send errors on closing connections
  }
}
