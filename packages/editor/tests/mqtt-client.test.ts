// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IClientOptions, MqttClient as MqttJsClient } from "mqtt";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import {
  AnsatzMqttClient,
  MAX_VALUE_CACHE_ENTRIES,
  type MqttConnectionState,
  type MqttParticipantMeta,
} from "../src/workbench/util/mqtt-client.js";

class MockMqttClient extends EventEmitter {
  readonly subscribed: Array<{ topic: string; opts?: unknown }> = [];
  readonly unsubscribed: string[] = [];
  ended = false;
  endForce: boolean | undefined;

  subscribe(topic: string, opts?: unknown): this {
    this.subscribed.push({ topic, opts });
    return this;
  }

  unsubscribe(topic: string): this {
    this.unsubscribed.push(topic);
    return this;
  }

  end(force?: boolean): this {
    this.ended = true;
    this.endForce = force;
    // Real mqtt.js emits "close" when ending; emitting here verifies listener detachment.
    this.emit("close");
    return this;
  }
}

function createHarness(maxCacheEntries?: number) {
  const createdClients: Array<{ url: string; opts: IClientOptions; mock: MockMqttClient }> = [];
  const client = new AnsatzMqttClient({
    maxCacheEntries,
    connectFn: (url, opts) => {
      const mock = new MockMqttClient();
      createdClients.push({ url, opts, mock });
      return mock as unknown as MqttJsClient;
    },
  });
  return { client, createdClients };
}

describe("AnsatzMqttClient", () => {
  it("exports MAX_VALUE_CACHE_ENTRIES = 1000 and enforces the default cap", () => {
    assert.equal(MAX_VALUE_CACHE_ENTRIES, 1000);
    const { client, createdClients } = createHarness();
    client.connect("ws://localhost:9001");
    const mock = createdClients[0]!.mock;

    for (let i = 0; i < 1050; i++) {
      mock.emit("message", `modelscript/site/s/area/a/line/l/cell/p1/data/v${i}`, Buffer.from(String(i)));
    }

    assert.equal(client.cacheSize, MAX_VALUE_CACHE_ENTRIES);
    assert.equal(client.getLatestValue("p1", "v0"), undefined);
    assert.equal(client.getLatestValue("p1", "v49"), undefined);
    assert.equal(client.getLatestValue("p1", "v50"), 50);
    assert.equal(client.getLatestValue("p1", "v1049"), 1049);

    client.disconnect();
  });

  it("evicts the oldest untouched key when valueCache exceeds maxCacheEntries", () => {
    const { client, createdClients } = createHarness(3);
    client.connect("ws://localhost:9001");
    const mock = createdClients[0]!.mock;

    const emitVar = (name: string, value: number) => {
      mock.emit("message", `modelscript/site/s/area/a/line/l/cell/p1/data/${name}`, Buffer.from(String(value)));
    };

    emitVar("a", 1);
    emitVar("b", 2);
    emitVar("c", 3);
    assert.equal(client.cacheSize, 3);

    // Refresh "a" so "b" becomes the oldest untouched entry
    emitVar("a", 10);
    emitVar("d", 4);

    assert.equal(client.cacheSize, 3);
    assert.equal(client.getLatestValue("p1", "b"), undefined);
    assert.equal(client.getLatestValue("p1", "a"), 10);
    assert.equal(client.getLatestValue("p1", "c"), 3);
    assert.equal(client.getLatestValue("p1", "d"), 4);

    client.disconnect();
  });

  it("handles participant metadata birth, death, and malformed payloads", () => {
    const { client, createdClients } = createHarness();
    const events: Array<{ id: string; meta: MqttParticipantMeta | null }> = [];
    const unsub = client.onParticipantChange((id, meta) => {
      events.push({ id, meta });
    });

    client.connect("ws://localhost:9001");
    const mock = createdClients[0]!.mock;

    const meta: MqttParticipantMeta = {
      participantId: "plant1",
      modelName: "ThermalPlant",
      type: "fmu",
      classKind: "model",
      variables: [{ name: "T", causality: "output", type: "Real", unit: "K" }],
      timestamp: "2026-01-01T00:00:00Z",
    };

    // Birth message
    mock.emit("message", "modelscript/site/s1/area/a1/participants/plant1/meta", Buffer.from(JSON.stringify(meta)));
    assert.equal(client.participants.size, 1);
    assert.deepEqual(client.participants.get("plant1"), meta);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { id: "plant1", meta });

    // Malformed JSON should be silently ignored
    mock.emit("message", "modelscript/site/s1/area/a1/participants/plant2/meta", Buffer.from("{bad json"));
    assert.equal(client.participants.size, 1);
    assert.equal(events.length, 1);

    // Death message (empty payload)
    mock.emit("message", "modelscript/site/s1/area/a1/participants/plant1/meta", Buffer.alloc(0));
    assert.equal(client.participants.size, 0);
    assert.equal(events.length, 2);
    assert.deepEqual(events[1], { id: "plant1", meta: null });

    unsub();
    client.disconnect();
  });

  it("dispatches scalar and _batch variable updates and ignores non-numeric payloads", () => {
    const { client, createdClients } = createHarness(10);
    const received: Array<{ pid: string; variable: string; value: number }> = [];
    const unsub = client.onVariableUpdate((pid, variable, value) => {
      received.push({ pid, variable, value });
    });

    client.connect("ws://localhost:9001");
    const mock = createdClients[0]!.mock;

    // Scalar numeric update
    mock.emit("message", "modelscript/site/s1/area/a1/line/sim1/cell/p1/data/motor/rpm", Buffer.from("1450.5"));
    assert.equal(client.getLatestValue("p1", "motor/rpm"), 1450.5);

    // Non-numeric scalar ignored
    mock.emit("message", "modelscript/site/s1/area/a1/line/sim1/cell/p1/data/status", Buffer.from("running"));
    assert.equal(client.getLatestValue("p1", "status"), undefined);

    // Batched update (with one invalid entry)
    mock.emit(
      "message",
      "modelscript/site/s1/area/a1/line/sim1/cell/p1/data/_batch",
      Buffer.from(JSON.stringify({ voltage: 230.1, current: 4.2, label: "ignored" })),
    );
    assert.equal(client.getLatestValue("p1", "voltage"), 230.1);
    assert.equal(client.getLatestValue("p1", "current"), 4.2);
    assert.equal(client.getLatestValue("p1", "label"), undefined);

    // Malformed batch ignored
    mock.emit("message", "modelscript/site/s1/area/a1/line/sim1/cell/p1/data/_batch", Buffer.from("not-json"));

    // Unrelated topic ignored
    mock.emit("message", "other/topic/path", Buffer.from("123"));

    const p1Values = client.getParticipantValues("p1");
    assert.equal(p1Values.size, 3);
    assert.equal(p1Values.get("motor/rpm"), 1450.5);
    assert.equal(p1Values.get("voltage"), 230.1);
    assert.equal(p1Values.get("current"), 4.2);

    assert.deepEqual(received, [
      { pid: "p1", variable: "motor/rpm", value: 1450.5 },
      { pid: "p1", variable: "voltage", value: 230.1 },
      { pid: "p1", variable: "current", value: 4.2 },
    ]);

    // Unsubscribe stops further callbacks
    unsub();
    mock.emit("message", "modelscript/site/s1/area/a1/line/sim1/cell/p1/data/voltage", Buffer.from("240"));
    assert.equal(received.length, 3);
    assert.equal(client.getLatestValue("p1", "voltage"), 240);

    client.disconnect();
  });

  it("subscribes/unsubscribes participant topics and cleans up on disconnect()", () => {
    const { client, createdClients } = createHarness();
    const states: MqttConnectionState[] = [];
    const unsubState = client.onStateChange((s) => states.push(s));

    client.connect("ws://broker.local:9001");
    // Second connect while active is a no-op
    client.connect("ws://broker.local:9001");
    assert.equal(createdClients.length, 1);

    const mock = createdClients[0]!.mock;
    assert.equal(client.connectionState, "connecting");

    mock.emit("connect");
    assert.equal(client.connectionState, "connected");
    assert.deepEqual(mock.subscribed[0], {
      topic: "modelscript/site/+/area/+/participants/+/meta",
      opts: { qos: 1 },
    });

    client.subscribeParticipant("sess-42", "cell-7");
    assert.deepEqual(mock.subscribed[1], {
      topic: "modelscript/site/+/area/+/line/sess-42/cell/cell-7/data/#",
      opts: { qos: 0 },
    });

    client.unsubscribeParticipant("sess-42", "cell-7");
    assert.deepEqual(mock.unsubscribed, ["modelscript/site/+/area/+/line/sess-42/cell/cell-7/data/#"]);

    // Populate cache and participants, then test clearCache()
    mock.emit("message", "modelscript/site/s/area/a/line/l/cell/c1/data/x", Buffer.from("7"));
    mock.emit(
      "message",
      "modelscript/site/s/area/a/participants/c1/meta",
      Buffer.from(
        JSON.stringify({
          participantId: "c1",
          modelName: "M",
          type: "fmu",
          classKind: "model",
          variables: [],
          timestamp: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    assert.equal(client.cacheSize, 1);
    assert.equal(client.participants.size, 1);

    client.clearCache();
    assert.equal(client.cacheSize, 0);
    assert.equal(client.participants.size, 1);

    // Re-populate before disconnect
    mock.emit("message", "modelscript/site/s/area/a/line/l/cell/c1/data/x", Buffer.from("8"));
    assert.equal(client.cacheSize, 1);

    client.disconnect();

    assert.equal(mock.ended, true);
    assert.equal(mock.endForce, true);
    assert.equal(client.connectionState, "disconnected");
    assert.equal(client.cacheSize, 0);
    assert.equal(client.participants.size, 0);

    // All client event listeners must be detached so stale events cannot fire
    assert.equal(mock.listenerCount("connect"), 0);
    assert.equal(mock.listenerCount("error"), 0);
    assert.equal(mock.listenerCount("close"), 0);
    assert.equal(mock.listenerCount("message"), 0);

    const stateCountAfterDisconnect = states.length;
    mock.emit("connect");
    mock.emit("close");
    mock.emit("message", "modelscript/site/s/area/a/line/l/cell/c1/data/x", Buffer.from("99"));
    assert.equal(states.length, stateCountAfterDisconnect);
    assert.equal(client.cacheSize, 0);

    // Reconnecting after disconnect creates a fresh client
    client.connect("ws://broker.local:9001");
    assert.equal(createdClients.length, 2);
    assert.equal(client.connectionState, "connecting");

    unsubState();
    client.disconnect();
  });

  it("handles subscriber self-unsubscription during dispatch without skipping other listeners", () => {
    const { client, createdClients } = createHarness();
    client.connect("ws://localhost:9001");
    const mock = createdClients[0]!.mock;

    const calls: string[] = [];
    let unsubFirst: (() => void) | null = null;
    unsubFirst = client.onVariableUpdate(() => {
      calls.push("first");
      unsubFirst?.();
    });
    const unsubSecond = client.onVariableUpdate(() => {
      calls.push("second");
    });

    mock.emit("message", "modelscript/site/s/area/a/line/l/cell/p1/data/x", Buffer.from("1"));
    mock.emit("message", "modelscript/site/s/area/a/line/l/cell/p1/data/x", Buffer.from("2"));

    assert.deepEqual(calls, ["first", "second", "second"]);

    unsubSecond();
    client.disconnect();
  });
});
