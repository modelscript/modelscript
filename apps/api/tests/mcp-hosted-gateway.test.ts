// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Hosted MCP Gateway & Metered Tool Execution", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-gateway-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const testUser = db.createUser("mcp_agent_user", "agent@modelscript.test", "hashed_pwd", "MCP User");
  const token = jwt.sign({ id: testUser.id, username: testUser.username }, JWT_SECRET);

  await t.test("rejects SSE connection with invalid token", async () => {
    const res = await request(app).get("/api/v1/mcp/sse").set("Authorization", "Bearer invalid-token");

    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error);
  });

  await t.test("rejects POST message with invalid session ID", async () => {
    const res = await request(app)
      .post("/api/v1/mcp/messages?sessionId=non-existent-session-id")
      .send({ jsonrpc: "2.0", method: "test", id: 1 });

    assert.strictEqual(res.status, 404);
  });

  await t.test("establishes SSE connection with valid JWT token and emits endpoint event", async () => {
    const http = await import("node:http");
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/mcp/sse?token=${token}`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      assert.strictEqual(response.status, 200);
      assert.ok(response.headers.get("content-type")?.includes("text/event-stream"));

      const reader = response.body?.getReader();
      assert.ok(reader);

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      assert.ok(
        text.includes("event: endpoint") || text.includes("/api/v1/mcp/messages?sessionId="),
        `Expected endpoint event in SSE stream, got: ${text}`,
      );
      controller.abort();
    } catch (err: any) {
      if (err.name !== "AbortError") throw err;
    } finally {
      server.close();
    }
  });
});
