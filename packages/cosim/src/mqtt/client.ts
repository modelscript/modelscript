// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MQTT client wrapper for the co-simulation engine.
 *
 * Provides a typed interface over mqtt.js with:
 * - Connection lifecycle management
 * - Typed publish/subscribe helpers
 * - Retained message tracking for participant discovery
 * - Last Will and Testament (LWT) for death certificates
 */

import type { IClientOptions, MqttClient as MqttJsClient } from "mqtt";
import mqtt from "mqtt";
import type { ControlMessage, ParticipantMetadata, StatusMessage, StepResult, VariableBatch } from "./protocol.js";
import { decodeMessage, encodeMessage } from "./protocol.js";
import type { UnsContext } from "./topics.js";
import {
  parseParticipantIdFromMetaTopic,
  participantMetaTopic,
  participantMetaWildcard,
  sessionControlTopic,
  sessionResultsTopic,
  sessionStatusTopic,
  variableBatchTopic,
  variableDataTopic,
  variableDataWildcard,
} from "./topics.js";

export interface MqttClientOptions {
  /** MQTT broker URL (e.g., mqtt://localhost:1883). */
  brokerUrl?: string;
  /** Custom stream builder for in-memory browser brokers. */
  streamBuilder?: () => unknown;
  /** Client ID (auto-generated if not provided). */
  clientId?: string | undefined;
  /** UNS context for topic construction. */
  unsContext: UnsContext;
}

type MessageHandler<T> = (message: T, topic: string) => void;

/**
 * Co-simulation MQTT client.
 *
 * Wraps mqtt.js with typed helpers for the UNS co-simulation protocol.
 */
export class CosimMqttClient {
  private client: MqttJsClient | null = null;
  private readonly brokerUrl: string | undefined;
  private readonly streamBuilder: (() => unknown) | undefined;
  private readonly clientId: string;
  readonly unsContext: UnsContext;

  /** Cache of active participants (from retained meta messages). */
  readonly participants = new Map<string, ParticipantMetadata>();

  /** Event handlers. */
  private controlHandlers: MessageHandler<ControlMessage>[] = [];
  private statusHandlers: MessageHandler<StatusMessage>[] = [];
  private variableHandlers: ((participantId: string, variableName: string, value: number) => void)[] = [];
  private resultHandlers: MessageHandler<StepResult>[] = [];
  private participantHandlers: ((participantId: string, meta: ParticipantMetadata | null) => void)[] = [];

  constructor(options: MqttClientOptions) {
    this.brokerUrl = options.brokerUrl;
    this.streamBuilder = options.streamBuilder;
    this.clientId = options.clientId ?? `modelscript-${Math.random().toString(36).slice(2, 10)}`;
    this.unsContext = options.unsContext;
  }

  /** Connect to the MQTT broker. */
  async connect(lwtParticipantId?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const opts: IClientOptions = {
        clientId: this.clientId,
        clean: true,
        connectTimeout: 10_000,
        reconnectPeriod: 5_000,
      };

      // Set Last Will and Testament for participant death certificate
      if (lwtParticipantId) {
        opts.will = {
          topic: participantMetaTopic(this.unsContext, lwtParticipantId),
          payload: Buffer.alloc(0), // Zero-length = death certificate
          qos: 1,
          retain: true,
        };
      }

      if (this.streamBuilder) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.client = mqtt.connect({ ...opts, builder: this.streamBuilder } as any);
      } else if (this.brokerUrl) {
        this.client = mqtt.connect(this.brokerUrl, opts);
      } else {
        reject(new Error("Must provide either brokerUrl or streamBuilder"));
        return;
      }

      this.client.on("connect", () => {
        resolve();
      });

      this.client.on("error", (err) => {
        reject(err);
      });

      this.client.on("message", (topic: string, payload: Buffer) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  /** Disconnect from the broker. */
  async disconnect(): Promise<void> {
    if (!this.client) return;
    return new Promise<void>((resolve) => {
      this.client?.end(false, undefined, () => {
        this.client = null;
        resolve();
      });
    });
  }

  /** Whether the client is connected. */
  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  // ── Publishing ──

  /** Publish participant metadata as a retained birth certificate. */
  publishMetadata(metadata: ParticipantMetadata): void {
    const topic = participantMetaTopic(this.unsContext, metadata.participantId);
    this.client?.publish(topic, encodeMessage(metadata), { qos: 1, retain: true });
  }

  /** Publish a control command to a session. */
  publishControl(sessionId: string, command: ControlMessage): void {
    const topic = sessionControlTopic(this.unsContext, sessionId);
    this.client?.publish(topic, encodeMessage(command), { qos: 1 });
  }

  /** Publish a status report from a participant. */
  publishStatus(sessionId: string, status: StatusMessage): void {
    const topic = sessionStatusTopic(this.unsContext, sessionId);
    this.client?.publish(topic, encodeMessage(status), { qos: 0 });
  }

  /** Publish aggregated step results. */
  publishResults(sessionId: string, result: StepResult): void {
    const topic = sessionResultsTopic(this.unsContext, sessionId);
    this.client?.publish(topic, encodeMessage(result), { qos: 0 });
  }

  /** Publish a single variable value. */
  publishVariable(sessionId: string, participantId: string, variableName: string, value: number): void {
    const topic = variableDataTopic(this.unsContext, sessionId, participantId, variableName);
    this.client?.publish(topic, Buffer.from(value.toString()), { qos: 0 });
  }

  /** Publish a batch of variable values. */
  publishVariableBatch(sessionId: string, participantId: string, batch: VariableBatch): void {
    const topic = variableBatchTopic(this.unsContext, sessionId, participantId);
    this.client?.publish(topic, encodeMessage(batch), { qos: 0 });
  }

  /** Clear a participant's birth certificate (explicit death). */
  publishDeath(participantId: string): void {
    const topic = participantMetaTopic(this.unsContext, participantId);
    this.client?.publish(topic, Buffer.alloc(0), { qos: 1, retain: true });
  }

  // ── Subscriptions ──

  /** Subscribe to participant discovery (birth/death certificates). */
  async subscribeParticipants(): Promise<void> {
    const topic = participantMetaWildcard(this.unsContext);
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Subscribe to session control messages. */
  async subscribeControl(sessionId: string): Promise<void> {
    const topic = sessionControlTopic(this.unsContext, sessionId);
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Subscribe to session status messages. */
  async subscribeStatus(sessionId: string): Promise<void> {
    const topic = sessionStatusTopic(this.unsContext, sessionId);
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Subscribe to all variable data from a participant. */
  async subscribeVariables(sessionId: string, participantId: string): Promise<void> {
    const topic = variableDataWildcard(this.unsContext, sessionId, participantId);
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Subscribe to session results. */
  async subscribeResults(sessionId: string): Promise<void> {
    const topic = sessionResultsTopic(this.unsContext, sessionId);
    return new Promise<void>((resolve, reject) => {
      this.client?.subscribe(topic, { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Event handlers ──

  onControl(handler: MessageHandler<ControlMessage>): void {
    this.controlHandlers.push(handler);
  }

  onStatus(handler: MessageHandler<StatusMessage>): void {
    this.statusHandlers.push(handler);
  }

  onVariable(handler: (participantId: string, variableName: string, value: number) => void): void {
    this.variableHandlers.push(handler);
  }

  onResult(handler: MessageHandler<StepResult>): void {
    this.resultHandlers.push(handler);
  }

  onParticipant(handler: (participantId: string, meta: ParticipantMetadata | null) => void): void {
    this.participantHandlers.push(handler);
  }

  // ── Internal message dispatch ──

  private handleMessage(topic: string, payload: Buffer): void {
    // Participant meta (birth/death)
    const metaPid = parseParticipantIdFromMetaTopic(topic);
    if (metaPid !== null) {
      if (payload.length === 0) {
        // Death certificate
        this.participants.delete(metaPid);
        for (const h of this.participantHandlers) h(metaPid, null);
      } else {
        const meta = decodeMessage<ParticipantMetadata>(payload);
        this.participants.set(metaPid, meta);
        for (const h of this.participantHandlers) h(metaPid, meta);
      }
      return;
    }

    // Control messages
    if (topic.endsWith("/control")) {
      const msg = decodeMessage<ControlMessage>(payload);
      for (const h of this.controlHandlers) h(msg, topic);
      return;
    }

    // Status messages
    if (topic.endsWith("/status")) {
      const msg = decodeMessage<StatusMessage>(payload);
      for (const h of this.statusHandlers) h(msg, topic);
      return;
    }

    // Results
    if (topic.endsWith("/results")) {
      const msg = decodeMessage<StepResult>(payload);
      for (const h of this.resultHandlers) h(msg, topic);
      return;
    }

    // Variable data
    const dataMatch = topic.match(/\/cell\/([^/]+)\/data\/(.+)$/);
    if (dataMatch?.[1] && dataMatch[2]) {
      const participantId = dataMatch[1];
      const variableName = dataMatch[2];

      if (variableName === "_batch") {
        const batch = decodeMessage<Record<string, number>>(payload);
        for (const [name, value] of Object.entries(batch)) {
          for (const h of this.variableHandlers) h(participantId, name, value);
        }
      } else {
        const value = parseFloat(payload.toString("utf-8"));
        if (!isNaN(value)) {
          for (const h of this.variableHandlers) h(participantId, variableName, value);
        }
      }
    }
  }
}
