// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-side MQTT client for Ansatz.
 *
 * Provides a singleton MQTT client that runs in the browser via WebSocket.
 * Used by the MQTT model tree and real-time simulation integration to
 * receive live variable updates from MQTT participants.
 *
 * This is separate from @modelscript/diagram/cosim's CosimMqttClient which is
 * designed for server-side Node.js usage.
 */

import type { IClientOptions, MqttClient as MqttJsClient } from "mqtt";
import mqtt from "mqtt";

/** Default maximum number of cached variable entries retained in `valueCache`. */
export const MAX_VALUE_CACHE_ENTRIES = 1000;

/** Connection state. */
export type MqttConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Variable update callback. */
export type VariableUpdateCallback = (participantId: string, variable: string, value: number) => void;

/** Optional configuration for `AnsatzMqttClient`. */
export interface AnsatzMqttClientOptions {
  /** Maximum number of entries retained in the variable value cache (default: 1000). */
  maxCacheEntries?: number | undefined;
  /** Custom MQTT connector factory (primarily for testing). */
  connectFn?: ((brokerUrl: string, opts: IClientOptions) => MqttJsClient) | undefined;
}

/** Participant metadata from MQTT retained messages. */
export interface MqttParticipantMeta {
  participantId: string;
  modelName: string;
  type: string;
  classKind: string;
  description?: string | undefined;
  variables: {
    name: string;
    causality: "input" | "output" | "parameter" | "local";
    type: string;
    unit?: string | undefined;
    start?: number | undefined;
  }[];
  iconSvg?: string | undefined;
  timestamp: string;
}

/**
 * Singleton MQTT client for the Ansatz browser environment.
 *
 * Connects to the MQTT broker via WebSocket (port 9001) and provides:
 * - Live variable value caching
 * - Participant discovery from retained messages
 * - Event-driven variable update callbacks
 */
export class AnsatzMqttClient {
  private client: MqttJsClient | null = null;
  private boundHandlers: {
    connect: () => void;
    error: () => void;
    close: () => void;
    message: (topic: string, payload: Buffer) => void;
  } | null = null;
  private state: MqttConnectionState = "disconnected";
  private stateListeners: ((state: MqttConnectionState) => void)[] = [];

  /** Maximum number of entries retained in `valueCache`. */
  private readonly maxCacheEntries: number;

  /** Custom or default MQTT connect function. */
  private readonly connectFn: (brokerUrl: string, opts: IClientOptions) => MqttJsClient;

  /** Latest values per topic key (`{participantId}/{variableName}`). */
  private readonly valueCache = new Map<string, number>();

  /** Active participant metadata from retained messages. */
  readonly participants = new Map<string, MqttParticipantMeta>();

  /** Variable update callbacks. */
  private variableCallbacks: VariableUpdateCallback[] = [];

  /** Participant change callbacks. */
  private participantCallbacks: ((id: string, meta: MqttParticipantMeta | null) => void)[] = [];

  constructor(options: AnsatzMqttClientOptions = {}) {
    const requestedMax = options.maxCacheEntries ?? MAX_VALUE_CACHE_ENTRIES;
    this.maxCacheEntries = Number.isFinite(requestedMax)
      ? Math.max(1, Math.floor(requestedMax))
      : MAX_VALUE_CACHE_ENTRIES;
    this.connectFn = options.connectFn ?? ((url, opts) => mqtt.connect(url, opts));
  }

  /** Connect to the MQTT broker via WebSocket. */
  connect(brokerWsUrl?: string): void {
    if (this.client) return;

    if (!brokerWsUrl) {
      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const protocol = isHttps ? "wss:" : "ws:";
      const host = typeof window !== "undefined" ? window.location.host : "localhost";
      brokerWsUrl = isHttps
        ? `${protocol}//${host}/mqtt`
        : `ws://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:9001`;
    }

    this.setState("connecting");

    const client = this.connectFn(brokerWsUrl, {
      clientId: `ansatz-${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 5_000,
    });
    this.client = client;

    const onConnect = () => {
      this.setState("connected");
      // Subscribe to participant discovery
      this.client?.subscribe("modelscript/site/+/area/+/participants/+/meta", { qos: 1 });
    };
    const onError = () => {
      this.setState("error");
    };
    const onClose = () => {
      this.setState("disconnected");
    };
    const onMessage = (topic: string, payload: Buffer) => {
      this.handleMessage(topic, payload);
    };

    this.boundHandlers = {
      connect: onConnect,
      error: onError,
      close: onClose,
      message: onMessage,
    };

    client.on("connect", onConnect);
    client.on("error", onError);
    client.on("close", onClose);
    client.on("message", onMessage);
  }

  /** Disconnect from the broker, detach listeners, and clear cached telemetry state. */
  disconnect(): void {
    const client = this.client;
    this.client = null;
    if (client) {
      if (this.boundHandlers) {
        client.removeListener("connect", this.boundHandlers.connect);
        client.removeListener("error", this.boundHandlers.error);
        client.removeListener("close", this.boundHandlers.close);
        client.removeListener("message", this.boundHandlers.message);
        this.boundHandlers = null;
      }
      client.end(true);
    }
    this.clearCache();
    this.participants.clear();
    if (client || this.state !== "disconnected") {
      this.setState("disconnected");
    }
  }

  /** Clear all cached variable values without disconnecting. */
  clearCache(): void {
    this.valueCache.clear();
  }

  /** Number of entries currently stored in the variable value cache. */
  get cacheSize(): number {
    return this.valueCache.size;
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
    for (const cb of [...this.stateListeners]) cb(state);
  }

  private setCachedValue(key: string, value: number): void {
    if (this.valueCache.has(key)) {
      // Refresh recency so oldest untouched key is evicted first.
      this.valueCache.delete(key);
    }
    this.valueCache.set(key, value);
    while (this.valueCache.size > this.maxCacheEntries) {
      const oldestKey = this.valueCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.valueCache.delete(oldestKey);
    }
  }

  private handleMessage(topic: string, payload: Buffer): void {
    // Participant meta (birth/death)
    const metaMatch = topic.match(/\/participants\/([^/]+)\/meta$/);
    if (metaMatch?.[1]) {
      const pid = metaMatch[1];
      if (payload.length === 0) {
        this.participants.delete(pid);
        for (const cb of [...this.participantCallbacks]) cb(pid, null);
      } else {
        try {
          const meta = JSON.parse(payload.toString()) as MqttParticipantMeta;
          this.participants.set(pid, meta);
          for (const cb of [...this.participantCallbacks]) cb(pid, meta);
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
          const batch = JSON.parse(payload.toString()) as Record<string, unknown>;
          for (const [name, value] of Object.entries(batch)) {
            if (typeof value === "number" && !Number.isNaN(value)) {
              this.setCachedValue(`${participantId}/${name}`, value);
              for (const cb of [...this.variableCallbacks]) cb(participantId, name, value);
            }
          }
        } catch {
          // Malformed batch
        }
      } else {
        const value = parseFloat(payload.toString());
        if (!Number.isNaN(value)) {
          this.setCachedValue(`${participantId}/${variableName}`, value);
          for (const cb of [...this.variableCallbacks]) cb(participantId, variableName, value);
        }
      }
    }
  }
}

/** Global singleton instance. */
let instance: AnsatzMqttClient | null = null;

/** Get or create the global MQTT client instance. */
export function getAnsatzMqttClient(): AnsatzMqttClient {
  if (!instance) {
    instance = new AnsatzMqttClient();
  }
  return instance;
}
