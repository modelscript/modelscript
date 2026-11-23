// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasCrdtStore, type CanvasWsMessage } from "@modelscript/canvas";
import express from "express";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { describe } from "node:test";
import WebSocket from "ws";
import { canvasRouter } from "../src/routes/canvas.js";
import { attachCanvasWebSocket, CanvasRoomManager } from "../src/services/canvas-collab-service.js";

function waitForMessage(ws: WebSocket, predicate: (msg: CanvasWsMessage) => boolean): Promise<CanvasWsMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), 4000);
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString("utf8")) as CanvasWsMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

describe("Polyglot Spatial Canvas REST API & Multiplayer WebSocket Gateway", () => {
  test("serves boards, exports SSP XML, and syncs live CRDT deltas between two WebSocket peers", async () => {
    const manager = new CanvasRoomManager();
    const app = express();
    app.use(express.json());
    app.use("/api/v1/canvas", canvasRouter(manager));

    const server = http.createServer(app);
    const wss = attachCanvasWebSocket(server, manager);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/api/v1/canvas/stream`;

    try {
      // 1. REST: List seeded demo board & export SSP 1.0 XML
      const listRes = await fetch(`${baseUrl}/api/v1/canvas`);
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as { boards: { id: string; tileCount: number }[] };
      assert.equal(listBody.boards.length, 1);
      assert.equal(listBody.boards[0]?.id, "demo-polyglot-actuator");
      assert.equal(listBody.boards[0]?.tileCount, 6);

      const sspRes = await fetch(`${baseUrl}/api/v1/canvas/demo-polyglot-actuator/ssp`);
      assert.equal(sspRes.status, 200);
      const sspXml = await sspRes.text();
      assert.ok(sspXml.includes("<ssd:SystemStructureDescription"));
      assert.ok(sspXml.includes('startElement="tile_simulink"'));

      // 2. Multiplayer WebSocket: Connect Alice & Bob to the same board
      const wsAlice = new WebSocket(wsUrl);
      const wsBob = new WebSocket(wsUrl);

      await Promise.all([
        new Promise<void>((r) => wsAlice.once("open", () => r())),
        new Promise<void>((r) => wsBob.once("open", () => r())),
      ]);

      const aliceSyncPromise = waitForMessage(wsAlice, (m) => m.type === "full_sync");
      const bobSyncPromise = waitForMessage(wsBob, (m) => m.type === "full_sync");

      wsAlice.send(
        JSON.stringify({
          type: "join",
          boardId: "demo-polyglot-actuator",
          peerId: "alice",
          userName: "Alice",
          color: "#38bdf8",
        }),
      );
      wsBob.send(
        JSON.stringify({
          type: "join",
          boardId: "demo-polyglot-actuator",
          peerId: "bob",
          userName: "Bob",
          color: "#f472b6",
        }),
      );

      const [aliceSync, bobSync] = await Promise.all([aliceSyncPromise, bobSyncPromise]);
      assert.equal(aliceSync.type, "full_sync");
      assert.equal(bobSync.type, "full_sync");

      const aliceStore = new CanvasCrdtStore("alice");
      const bobStore = new CanvasCrdtStore("bob");
      aliceStore.mergeDelta(aliceSync.delta);
      bobStore.mergeDelta(bobSync.delta);

      // Alice drags the Modelica plant tile -> Bob receives CRDT delta in real time
      const bobDeltaPromise = waitForMessage(wsBob, (m) => m.type === "delta");
      const moveDelta = aliceStore.moveTile("tile_modelica", 777, 222)!;
      wsAlice.send(
        JSON.stringify({
          type: "delta",
          boardId: "demo-polyglot-actuator",
          delta: moveDelta,
        }),
      );

      const received = await bobDeltaPromise;
      assert.equal(received.type, "delta");
      bobStore.mergeDelta(received.delta);
      assert.equal(bobStore.toDocument().tiles.tile_modelica?.bounds.x, 777);
      assert.equal(manager.getBoard("demo-polyglot-actuator")?.tiles.tile_modelica?.bounds.x, 777);

      const svgRes = await fetch(`${baseUrl}/api/v1/canvas/demo-polyglot-actuator/svg`);
      assert.equal(svgRes.status, 200);
      const svgText = await svgRes.text();
      assert.ok(svgText.startsWith("<svg "));
      assert.ok(svgText.includes('data-tile-id="tile_step"'));

      wsAlice.close();
      wsBob.close();
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("persists spatial canvas boards durably as .mscanvas files across server restarts", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-canvas-store-"));

    try {
      const m1 = new CanvasRoomManager({ storageDir });
      const created = m1.createBoard({ id: "persistent-board", name: "Persistent System", template: "demo" });
      created.tiles.tile_step!.bounds.x = 999;
      m1.replaceBoard("persistent-board", created);
      m1.close();

      // Reopen fresh manager from same storage directory
      const m2 = new CanvasRoomManager({ storageDir });
      const restored = m2.getBoard("persistent-board");
      assert.ok(restored);
      assert.equal(restored.name, "Persistent System");
      assert.equal(restored.tiles.tile_step?.bounds.x, 999);
      m2.close();
    } finally {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });
});
