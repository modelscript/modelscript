// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert";
import http from "node:http";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { threadRouter } from "../src/routes/thread.js";

test("Real-Time Collaborative Digital Thread SSE Stream", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/threads", threadRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  t.after(() => {
    server.close();
  });

  await t.test("1. SSE stream establishes connection and emits initial snapshot", async () => {
    const receivedEvents: { event: string; data: any }[] = [];

    const req = http.get(`http://localhost:${port}/api/v1/threads/stream`, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["content-type"], "text/event-stream");

      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n\n");
        while (lines.length > 1) {
          const rawMessage = lines.shift()!;
          const matchEvent = rawMessage.match(/^event:\s*(.+)$/m);
          const matchData = rawMessage.match(/^data:\s*(.+)$/m);
          if (matchEvent && matchData) {
            receivedEvents.push({
              event: matchEvent[1].trim(),
              data: JSON.parse(matchData[1].trim()),
            });
          }
        }
        buffer = lines[0];
      });
    });

    // Wait 50ms for init event
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(receivedEvents.length >= 1);
    assert.strictEqual(receivedEvents[0].event, "init");
    assert.strictEqual(receivedEvents[0].data.status, "connected");

    req.destroy();
  });

  await t.test("2. Reconciling a conflict broadcasts thread_updated event over SSE", async () => {
    const receivedEvents: { event: string; data: any }[] = [];

    const streamReq = http.get(`http://localhost:${port}/api/v1/threads/stream`, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n\n");
        while (lines.length > 1) {
          const rawMessage = lines.shift()!;
          const matchEvent = rawMessage.match(/^event:\s*(.+)$/m);
          const matchData = rawMessage.match(/^data:\s*(.+)$/m);
          if (matchEvent && matchData) {
            receivedEvents.push({
              event: matchEvent[1].trim(),
              data: JSON.parse(matchData[1].trim()),
            });
          }
        }
        buffer = lines[0];
      });
    });

    // Wait for connection to register
    await new Promise((r) => setTimeout(r, 60));

    // Post conflict reconciliation
    const postRes = await request(app)
      .post("/api/v1/threads/conflicts/reconcile")
      .send({
        conflictId: "conflict_bus_voltage",
        strategy: "physics-simplex",
      })
      .expect(200);

    assert.strictEqual(postRes.body.status, "resolved");

    // Wait 50ms for SSE event delivery
    await new Promise((r) => setTimeout(r, 60));

    const threadUpdateEvent = receivedEvents.find((e) => e.event === "thread_updated");
    assert.ok(threadUpdateEvent, "Expected thread_updated event to be received by SSE client");
    assert.strictEqual(threadUpdateEvent.data.conflictId, "conflict_bus_voltage");
    assert.strictEqual(threadUpdateEvent.data.status, "resolved");
    assert.strictEqual(threadUpdateEvent.data.strategy, "physics-simplex");

    streamReq.destroy();
  });
});
