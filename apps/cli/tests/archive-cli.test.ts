// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Archive } from "../src/commands/archive.js";

describe("CLI Archive Management (msx archive)", () => {
  let server: http.Server;
  let serverPort = 0;
  const requests: { method: string; url: string; body: string }[] = [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-archive-test-"));
  const outputFile = path.join(tmpDir, "test-archive.zip");

  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWrite: typeof process.stdout.write;

  before(() => {
    origLog = console.log;
    origError = console.error;
    origWrite = process.stdout.write;
    console.log = () => {};
    console.error = () => {};
    (process.stdout as any).write = () => true;
  });

  after(() => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origWrite;
  });

  test("msx archive status queries /api/v1/users/me/export/status", async () => {
    requests.length = 0;
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ method: req.method ?? "", url: req.url ?? "", body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            job: {
              id: "export_123",
              status: "queued",
              queuePosition: 2,
              format: "zip",
              createdAt: "2026-10-01T00:00:00Z",
            },
            concurrency: 2,
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    try {
      process.env.MODELSCRIPT_API_TOKEN = "test-token";
      await (Archive.handler as any)({
        action: "status",
        apiUrl: `http://127.0.0.1:${serverPort}`,
      });

      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0]?.method, "GET");
      assert.strictEqual(requests[0]?.url, "/api/v1/users/me/export/status");
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("msx archive request enqueues, polls, and downloads archive", async () => {
    requests.length = 0;
    let pollCount = 0;

    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({ method: req.method ?? "", url: req.url ?? "", body });

        if (req.method === "POST" && req.url === "/api/v1/users/me/export") {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              job: {
                id: "export_456",
                status: "queued",
                queuePosition: 1,
                concurrency: 2,
              },
            }),
          );
        } else if (req.method === "GET" && req.url?.startsWith("/api/v1/users/me/export/status")) {
          pollCount++;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              job: {
                id: "export_456",
                status: pollCount >= 2 ? "completed" : "processing",
                format: "zip",
                fileSizeBytes: 1024,
              },
              concurrency: 2,
            }),
          );
        } else if (req.method === "GET" && req.url?.startsWith("/api/v1/users/me/export/download")) {
          res.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="modelscript-archive.zip"',
          });
          res.end(Buffer.from("PK\x03\x04test_zip_payload"));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    try {
      process.env.MODELSCRIPT_API_TOKEN = "test-token";
      await (Archive.handler as any)({
        action: "request",
        apiUrl: `http://127.0.0.1:${serverPort}`,
        output: outputFile,
        wait: true,
      });

      assert.ok(requests.some((r) => r.method === "POST" && r.url === "/api/v1/users/me/export"));
      assert.ok(requests.some((r) => r.method === "GET" && r.url?.startsWith("/api/v1/users/me/export/status")));
      assert.ok(requests.some((r) => r.method === "GET" && r.url?.startsWith("/api/v1/users/me/export/download")));
      assert.ok(fs.existsSync(outputFile));
      assert.strictEqual(fs.readFileSync(outputFile, "utf-8"), "PK\x03\x04test_zip_payload");
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
