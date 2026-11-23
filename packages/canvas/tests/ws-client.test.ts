// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CanvasCrdtStore } from "../src/collab/crdt-store.js";
import { CanvasWebSocketClient, type CanvasWsMessage, type WebSocketLike } from "../src/collab/ws-client.js";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";

class MockWebSocket implements WebSocketLike {
  public readyState = 0; // CONNECTING
  public sent: string[] = [];
  private listeners = new Map<string, ((ev: unknown) => void)[]>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 3;
    this.emit("close", undefined);
  }

  public addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  public open(): void {
    this.readyState = 1;
    this.emit("open", undefined);
  }

  public receive(msg: CanvasWsMessage): void {
    this.emit("message", { data: JSON.stringify(msg) });
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(ev);
    }
  }
}

describe("CanvasWebSocketClient Offline Queueing & Live Sync", () => {
  test("queues offline CRDT deltas and flushes them on connect, then merges remote deltas", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const aliceStore = new CanvasCrdtStore("peer_alice", board);
    const bobStore = new CanvasCrdtStore("peer_bob", board);

    let mockWs!: MockWebSocket;
    const client = new CanvasWebSocketClient({
      url: "ws://localhost:3000/api/v1/canvas/stream",
      boardId: board.id,
      userName: "Alice",
      store: aliceStore,
      createSocket: () => {
        mockWs = new MockWebSocket();
        return mockWs;
      },
    });

    // Edit while offline -> queued
    aliceStore.moveTile("tile_modelica", 680, 140);
    assert.equal(client.getPendingDeltaCount(), 1);

    // Connect -> sends join + flushes queued delta
    client.connect();
    mockWs.open();
    assert.equal(client.isConnected(), true);
    assert.equal(client.getPendingDeltaCount(), 0);
    assert.equal(mockWs.sent.length, 2);

    const parsedJoin = JSON.parse(mockWs.sent[0]!) as CanvasWsMessage;
    assert.equal(parsedJoin.type, "join");
    const parsedDelta = JSON.parse(mockWs.sent[1]!) as CanvasWsMessage;
    assert.equal(parsedDelta.type, "delta");

    // Receive remote delta + presence from Bob
    const bobDelta = bobStore.moveTile("tile_step", 700, 650)!;
    mockWs.receive({ type: "delta", boardId: board.id, delta: bobDelta });
    mockWs.receive({
      type: "presence",
      boardId: board.id,
      presence: {
        peerId: "peer_bob",
        userName: "Bob",
        color: "#f472b6",
        cursor: { x: 300, y: 200 },
        lastActiveMs: Date.now(),
      },
    });

    assert.equal(aliceStore.toDocument().tiles.tile_step?.bounds.x, 700);
    assert.equal(aliceStore.getActivePeers().length, 1);

    client.dispose();
  });
});
