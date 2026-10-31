// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from "express";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { attachCollabWebSocket, attachWebSocketMaintenanceGate } from "../src/routes/collab-ws.js";
import { LibraryStorage } from "../src/storage.js";
import { getClientIp } from "../src/util/client-ip.js";
import { DEFAULT_GIT_CACHE_DIR } from "../src/util/local-git.js";

test("Cloudflare Tunnel & Ingress Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-tunnel-test-"));
  const db = new LibraryDatabase(path.join(tmpDir, "db"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      if (app.locals.decayWorkerInterval) clearInterval(app.locals.decayWorkerInterval);
      if (app.locals.rssWorkerInterval) clearInterval(app.locals.rssWorkerInterval);
      if (app.locals.logPurgeInterval) clearInterval(app.locals.logPurgeInterval);
      if (app.locals.autoBackupInterval) clearInterval(app.locals.autoBackupInterval);
      if (app.locals.federationWorker) app.locals.federationWorker.stop();
      if (app.locals.botMentionWorker) app.locals.botMentionWorker.stop();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const adminUser = db.createUser("super_admin", "admin@modelscript.test", "hash456", {
    accountType: "admin",
    emailVerified: true,
  });
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, email: adminUser.email, accountType: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test("getClientIp should correctly prioritize CF-Connecting-IP when trustProxy is enabled", () => {
    process.env["TRUST_PROXY"] = "true";

    const mockReq1 = {
      headers: {
        "cf-connecting-ip": "203.0.113.195",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      },
      ip: "10.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    assert.equal(getClientIp(mockReq1), "203.0.113.195");

    // Falls back to X-Forwarded-For if CF-Connecting-IP is absent
    const mockReq2 = {
      headers: {
        "x-forwarded-for": "198.51.100.42, 10.0.0.1",
      },
      ip: "10.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    assert.equal(getClientIp(mockReq2), "198.51.100.42");

    // Rejects spoofed CF-Ray when TRUST_PROXY is false and CLOUDFLARE_TUNNEL_TOKEN is not configured
    process.env["TRUST_PROXY"] = "false";
    delete process.env["CLOUDFLARE_TUNNEL_TOKEN"];
    const mockReq3 = {
      headers: {
        "cf-ray": "8d94e1b8c9d0-DFW",
        "cf-connecting-ip": "192.0.2.77",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    assert.equal(getClientIp(mockReq3), "127.0.0.1");

    // Detects CF-Ray even if TRUST_PROXY is false when CLOUDFLARE_TUNNEL_TOKEN is configured
    process.env["CLOUDFLARE_TUNNEL_TOKEN"] = "eyJhIjoiMTIzNDU2Nzg5MCJ9";
    assert.equal(getClientIp(mockReq3), "192.0.2.77");
    delete process.env["CLOUDFLARE_TUNNEL_TOKEN"];
    process.env["TRUST_PROXY"] = "true";
  });

  await t.test("POST /api/v1/admin/federation/verify-ingress requires admin authentication", async () => {
    const res = await request(app)
      .post("/api/v1/admin/federation/verify-ingress")
      .set("Authorization", "Bearer invalid-or-expired-token")
      .send({ targetUrl: "https://node.ansatz.social" });

    assert.equal(res.status, 401);
  });

  await t.test(
    "POST /api/v1/admin/federation/verify-ingress verifies public ingress and detects Cloudflare headers",
    async () => {
      // Test with invalid URL
      const invalidRes = await request(app)
        .post("/api/v1/admin/federation/verify-ingress")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ targetUrl: "not-a-valid-url" });

      assert.equal(invalidRes.status, 400);

      // Test with valid URL and Cloudflare headers
      const verifyRes = await request(app)
        .post("/api/v1/admin/federation/verify-ingress")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("CF-Ray", "8d94e1b8c9d0-IAD")
        .set("CF-Connecting-IP", "198.51.100.88")
        .send({ targetUrl: "https://homelab.ansatz.social" });

      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.body.domain, "homelab.ansatz.social");
      assert.equal(verifyRes.body.targetUrl, "https://homelab.ansatz.social");
      assert.equal(
        verifyRes.body.webfingerUrl,
        "https://homelab.ansatz.social/.well-known/webfinger?resource=acct:instance@homelab.ansatz.social",
      );
      assert.equal(verifyRes.body.inboxUrl, "https://homelab.ansatz.social/inbox");
      assert.equal(verifyRes.body.reachable, true);
      assert.equal(verifyRes.body.tunnelDetected, true);
      assert.equal(verifyRes.body.cfRay, "8d94e1b8c9d0-IAD");
    },
  );

  await t.test("Persistent FmuStorage and local-git cache paths avoid os.tmpdir() data loss", () => {
    const fmuStorage = app.locals["fmuStorage"] as { list?: () => unknown[] } | undefined;
    const fmuStorageDir = app.locals["fmuStorageDir"] as string | undefined;
    assert.ok(fmuStorage, "fmuStorage should be attached to app.locals");
    assert.equal(fmuStorageDir, path.resolve(db.dbDir, "fmus"));
    assert.ok(fs.existsSync(path.resolve(db.dbDir, "fmus")));
    assert.ok(
      !DEFAULT_GIT_CACHE_DIR.startsWith(os.tmpdir()),
      `Expected DEFAULT_GIT_CACHE_DIR (${DEFAULT_GIT_CACHE_DIR}) not to be in os.tmpdir()`,
    );
  });

  await t.test("ingressMode & tunnelToken persistence, redaction, and export-env snippet", async () => {
    const patchRes = await request(app)
      .patch("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ingressMode: "cloudflare",
        tunnelToken: "cf-secret-tunnel-token-999",
      });

    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.settings.ingressMode, "cloudflare");
    assert.equal(patchRes.body.settings.cloudflareTunnelConfigured, true);
    assert.equal("tunnelToken" in patchRes.body.settings, false);
    assert.equal("cloudflare_tunnel_token" in patchRes.body.settings, false);

    // Audit log must redact the raw tunnelToken
    const recentLogs = db.getAuditLogs(5, 0, "instance_settings_updated");
    assert.ok(recentLogs.length > 0);
    assert.ok(!JSON.stringify(recentLogs[0]).includes("cf-secret-tunnel-token-999"));
    assert.ok(JSON.stringify(recentLogs[0]).includes("[REDACTED]"));

    // Export env snippet must include MSX_INGRESS_MODE and CLOUDFLARE_TUNNEL_TOKEN
    const exportRes = await request(app)
      .get("/api/v1/admin/settings/export-env")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.body.envText, /MSX_INGRESS_MODE=cloudflare/);
    assert.match(exportRes.body.envText, /CLOUDFLARE_TUNNEL_TOKEN=cf-secret-tunnel-token-999/);
  });

  await t.test("GET /api/v1/instance/branding and /api/v1/instance/banner return buildVersion", async () => {
    process.env["MSX_BUILD_SHA"] = "git-sha-deadbeef";
    try {
      const brandingRes = await request(app).get("/api/v1/instance/branding");
      assert.equal(brandingRes.status, 200);
      assert.equal(brandingRes.body.buildVersion, "git-sha-deadbeef");
      assert.equal(brandingRes.body.ingressMode, "cloudflare");
      assert.equal(brandingRes.body.cloudflareTunnelConfigured, true);

      const bannerRes = await request(app).get("/api/v1/instance/banner");
      assert.equal(bannerRes.status, 200);
      assert.equal(bannerRes.body.buildVersion, "git-sha-deadbeef");
    } finally {
      delete process.env["MSX_BUILD_SHA"];
    }
  });

  await t.test("AUDIT_HMAC_SECRET signs new entries while preserving legacy chain verification", () => {
    delete process.env["AUDIT_HMAC_SECRET"];
    db.logAudit({
      actorId: adminUser.id,
      action: "legacy.entry",
      resourceType: "system",
      resourceId: "1",
      ipAddress: "127.0.0.1",
    });
    const beforeChain = db.verifyAuditLogChain();
    assert.equal(beforeChain.valid, true);

    process.env["AUDIT_HMAC_SECRET"] = "custom-enterprise-hmac-key-2026";
    try {
      db.logAudit({
        actorId: adminUser.id,
        action: "custom.secret.entry",
        resourceType: "system",
        resourceId: "2",
        ipAddress: "127.0.0.1",
      });

      const afterChain = db.verifyAuditLogChain();
      assert.equal(afterChain.valid, true);
      assert.equal(afterChain.verifiedEntries, beforeChain.verifiedEntries + 1);
    } finally {
      delete process.env["AUDIT_HMAC_SECRET"];
    }
  });

  await t.test("WebSocket upgrade is rejected with 503 during lockdown maintenance mode", async () => {
    const httpServer = http.createServer(app);
    attachWebSocketMaintenanceGate(httpServer, db);
    attachCollabWebSocket(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const addr = httpServer.address() as net.AddressInfo;

    try {
      db.updateInstanceSettings({ maintenanceLevel: "lockdown" }, adminUser.id);
      assert.equal(db.getMaintenanceState().mode, "lockdown");

      const rawResponse = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(addr.port, "127.0.0.1", () => {
          const key = Buffer.from("1234567890123456").toString("base64");
          socket.write(
            [
              "GET /api/v1/collab/test-room HTTP/1.1",
              `Host: 127.0.0.1:${addr.port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              `Sec-WebSocket-Key: ${key}`,
              "Sec-WebSocket-Version: 13",
              "",
              "",
            ].join("\r\n"),
          );
        });
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });
        socket.on("end", () => resolve(data));
        socket.on("close", () => resolve(data));
        socket.on("error", reject);
      });

      assert.match(rawResponse, /^HTTP\/1\.1 503 Service Unavailable/);
    } finally {
      db.updateInstanceSettings({ maintenanceLevel: "off" }, adminUser.id);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  await t.test("createHotBackup replicates .db and .sha256 to S3 when STORAGE_BACKEND=s3", async () => {
    const uploadedObjects = new Map<string, Buffer>();
    const mockS3Server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (req.method === "PUT" && req.url) {
          uploadedObjects.set(req.url, Buffer.concat(chunks));
          res.writeHead(200, { ETag: '"mock-etag"' });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => mockS3Server.listen(0, "127.0.0.1", resolve));
    const s3Addr = mockS3Server.address() as net.AddressInfo;

    process.env["STORAGE_BACKEND"] = "s3";
    process.env["S3_BUCKET"] = "ansatz-backups";
    process.env["S3_ENDPOINT"] = `http://127.0.0.1:${s3Addr.port}`;
    process.env["S3_FORCE_PATH_STYLE"] = "true";

    try {
      const snap = db.createHotBackup("s3-test");
      await db.waitForPendingBackupReplications();

      const expectedDbKey = `/ansatz-backups/backups/${snap.fileName}`;
      const expectedShaKey = `/ansatz-backups/backups/${snap.fileName}.sha256`;

      assert.ok(uploadedObjects.has(expectedDbKey), `Expected S3 PUT for ${expectedDbKey}`);
      assert.ok(uploadedObjects.has(expectedShaKey), `Expected S3 PUT for ${expectedShaKey}`);
      assert.equal(uploadedObjects.get(expectedDbKey)?.byteLength, snap.sizeBytes);
      assert.equal(uploadedObjects.get(expectedShaKey)?.toString("utf8"), snap.sha256);
    } finally {
      delete process.env["STORAGE_BACKEND"];
      delete process.env["S3_BUCKET"];
      delete process.env["S3_ENDPOINT"];
      delete process.env["S3_FORCE_PATH_STYLE"];
      await new Promise<void>((resolve) => mockS3Server.close(() => resolve()));
    }
  });
});
