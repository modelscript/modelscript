// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before, describe } from "node:test";
import { Db } from "../src/commands/db.js";

describe("CLI Database Management (msx db)", () => {
  let server: http.Server;
  let serverPort = 0;
  let receivedMethod = "";
  let receivedUrl = "";
  let receivedBody = "";

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

  test("msx db status queries /api/v1/admin/db/status", async () => {
    server = http.createServer((req, res) => {
      receivedMethod = req.method ?? "";
      receivedUrl = req.url ?? "";
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            currentVersion: "0001_baseline_schema",
            applied: [{ name: "0001_baseline_schema", applied_at: "2026-09-30 22:00:00", execution_ms: 12 }],
            pending: [],
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
      await (Db.handler as any)({
        action: "status",
        apiUrl: `http://127.0.0.1:${serverPort}`,
      });

      assert.equal(receivedMethod, "GET");
      assert.equal(receivedUrl, "/api/v1/admin/db/status");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("msx db upgrade triggers POST /api/v1/admin/db/upgrade with options", async () => {
    server = http.createServer((req, res) => {
      receivedMethod = req.method ?? "";
      receivedUrl = req.url ?? "";
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            appliedCount: 1,
            backupPath: "/data/modelscript.db.bak-12345",
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
      await (Db.handler as any)({
        action: "upgrade",
        dryRun: false,
        skipBackup: false,
        apiUrl: `http://127.0.0.1:${serverPort}`,
      });

      assert.equal(receivedMethod, "POST");
      assert.equal(receivedUrl, "/api/v1/admin/db/upgrade");
      const parsedBody = JSON.parse(receivedBody);
      assert.equal(parsedBody.dryRun, false);
      assert.equal(parsedBody.skipBackup, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("msx db verify checks physical and foreign key integrity", async () => {
    server = http.createServer((req, res) => {
      receivedMethod = req.method ?? "";
      receivedUrl = req.url ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          foreignKeysOk: true,
          integrityOk: true,
        }),
      );
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    try {
      await (Db.handler as any)({
        action: "verify",
        apiUrl: `http://127.0.0.1:${serverPort}`,
      });

      assert.equal(receivedMethod, "GET");
      assert.equal(receivedUrl, "/api/v1/admin/db/verify");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
