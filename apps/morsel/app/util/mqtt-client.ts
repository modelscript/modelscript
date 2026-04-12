// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-side MQTT client for Morsel.
 *
 * Provides a singleton MQTT client that runs in the browser via WebSocket.
 * Used by the MQTT model tree and real-time simulation integration to
 * receive live variable updates from MQTT participants.
 *
 * This is separate from @modelscript/cosim's CosimMqttClient which is
 * designed for server-side Node.js usage.
 */

import type { MqttClient as MqttJsClient } from "mqtt";
import mqtt from "mqtt";

/** Connection state. */
export type MqttConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Variable update callback. */
export type VariableUpdateCallback = (participantId: string, variable: string, value: number) => void;

/** Participant metadata from MQTT retained messages. */
export interface MqttParticipantMeta {
  participantId: string;
  modelName: string;
  type: string;
  classKind: string;
  description?: string;
  variables: {
    name: string;
    causality: "input" | "output" | "parameter" | "local";
    type: string;
    unit?: string;
    start?: number;
  }[];
  iconSvg?: string;
  timestamp: string;
}

/**
 * Singleton MQTT client for the Morsel browser environment.
 *
 * Connects to the MQTT broker via WebSocket (port 9001) and provides:
 * - Live variable value caching
 * - Participant discovery from retained messages
 * - Event-driven variable update callbacks
 */
export class MorselMqttClient {
  private client: MqttJsClient | null = null;
  private state: MqttConnectionState = "disconnected";
  private stateListeners: ((state: MqttConnectionState) => void)[] = [];

  /** Latest values per topic key (`{participantId}/{variableName}`). */
  private readonly valueCache = new Map<string, number>();

  /** Active participant metadata from retained messages. */
  readonly participants = new Map<string, MqttParticipantMeta>();

  /** Variable update callbacks. */
  private variableCallbacks: VariableUpdateCallback[] = [];

  /** Participant change callbacks. */
  private participantCallbacks: ((id: string, meta: MqttParticipantMeta | null) => void)[] = [];

  /** Connect to the MQTT broker via WebSocket. */
  connect(brokerWsUrl = `ws://${window.location.hostname}:9001`): void {
    if (this.client) return;

    this.setState("connecting");

    this.client = mqtt.connect(brokerWsUrl, {
      clientId: `morsel-${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
    }) as MqttJsClient;

    this.client.on("connect", () => {
      this.setState("connected");
      // Subscribe to participant discovery
      this.client?.subscribe("modelscript/site/+/area/+/participants/+/meta", { qos: 1 });
    });

    this.client.on("error", () => {
      this.setState("error");
    });

    this.client.on("close", () => {
      this.setState("disconnected");
    });

    this.client.on("message", (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload);
    });
  }

  /** Disconnect from the broker. */
  disconnect(): void {
    if (!this.client) return;
    this.client.end(true);
    this.client = null;
    this.valueCache.clear();
    this.participants.clear();
    this.setState("disconnected");
  }

  /** Current connection state. */
  get connectionState(): MqttConnectionState {
    return this.state;
  }

  /** Subscribe to variable data for a specific participant in a session. */
  subscribeParticipant(sessionId: string, participantId: string): void {
    const topic = `modelscript/site/+/area/+/line/${sessionId}/cell/${participantId}/data/#`;
    this.client?.subscribe(topic, { qos: 0 });
  }

  /** Unsubscribe from a participant's variable data. */
  unsubscribeParticipant(sessionId: string, participantId: string): void {
    const topic = `modelscript/site/+/area/+/line/${sessionId}/cell/${participantId}/data/#`;
    this.client?.unsubscribe(topic);
  }

  /** Get the latest cached value for a variable. */
  getLatestValue(participantId: string, variable: string): number | undefined {
    return this.valueCache.get(`${participantId}/${variable}`);
  }

  /** Get all cached values for a participant. */
  getParticipantValues(participantId: string): Map<string, number> {
    const result = new Map<string, number>();
    const prefix = `${participantId}/`;
    for (const [key, value] of this.valueCache) {
      if (key.startsWith(prefix)) {
        result.set(key.slice(prefix.length), value);
      }
    }
    return result;
  }

  /** Register a variable update callback. */
  onVariableUpdate(callback: VariableUpdateCallback): () => void {
    this.variableCallbacks.push(callback);
    return () => {
      this.variableCallbacks = this.variableCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Register a participant change callback. */
  onParticipantChange(callback: (id: string, meta: MqttParticipantMeta | null) => void): () => void {
    this.participantCallbacks.push(callback);
    return () => {
      this.participantCallbacks = this.participantCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Register a connection state change callback. */
  onStateChange(callback: (state: MqttConnectionState) => void): () => void {
    this.stateListeners.push(callback);
    return () => {
      this.stateListeners = this.stateListeners.filter((cb) => cb !== callback);
    };
  }

  // ── Internal ──

  private setState(state: MqttConnectionState): void {
    this.state = state;
    for (const cb of this.stateListeners) cb(state);
  }

  private handleMessage(topic: string, payload: Buffer): void {
    // Participant meta (birth/death)
    const metaMatch = topic.match(/\/participants\/([^/]+)\/meta$/);
    if (metaMatch?.[1]) {
      const pid = metaMatch[1];
      if (payload.length === 0) {
        this.participants.delete(pid);
        for (const cb of this.participantCallbacks) cb(pid, null);
      } else {
        try {
          const meta = JSON.parse(payload.toString()) as MqttParticipantMeta;
          this.participants.set(pid, meta);
          for (const cb of this.participantCallbacks) cb(pid, meta);
        } catch {
          // Malformed message
        }
      }
      return;
    }

    // Variable data
    const dataMatch = topic.match(/\/cell\/([^/]+)\/data\/(.+)$/);
    if (dataMatch?.[1] && dataMatch[2]) {
      const participantId = dataMatch[1];
      const variableName = dataMatch[2];

      if (variableName === "_batch") {
        // Batched update
        try {
          const batch = JSON.parse(payload.toString()) as Record<string, number>;
          for (const [name, value] of Object.entries(batch)) {
            this.valueCache.set(`${participantId}/${name}`, value);
            for (const cb of this.variableCallbacks) cb(participantId, name, value);
          }
        } catch {
          // Malformed batch
        }
      } else {
        const value = parseFloat(payload.toString());
        if (!isNaN(value)) {
          this.valueCache.set(`${participantId}/${variableName}`, value);
          for (const cb of this.variableCallbacks) cb(participantId, variableName, value);
        }
      }
    }
  }
}

/** Global singleton instance. */
let instance: MorselMqttClient | null = null;

/** Get or create the global MQTT client instance. */
export function getMorselMqttClient(): MorselMqttClient {
  if (!instance) {
    instance = new MorselMqttClient();
  }
  return instance;
}
