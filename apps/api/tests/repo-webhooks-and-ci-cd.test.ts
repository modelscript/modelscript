// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

test("Repository Webhooks & Automated CI/CD Publishing Pipeline", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const alice = db.createUser("alice", "alice@example.com", "hash", { emailVerified: true });
  const bob = db.createUser("bob", "bob@example.com", "hash", { emailVerified: true });

  const aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);
  const bobToken = jwt.sign({ id: bob.id, username: bob.username }, JWT_SECRET);

  // Alice links a GitHub repo
  db.linkRepo(alice.id, "github", "123456", "alice/modelica-chassis", "main", "Vehicle dynamics modeling");
  const aliceRepos = db.getLinkedRepos(alice.id);
  const repoId = aliceRepos[0].id;
  assert.ok(repoId);

  const ghSecret = "super-secret-gh-key-999";
  let webhookId: number;

  await t.test("Alice creates and lists a GitHub webhook for her repository", async () => {
    const res = await request(app)
      .post(`/api/v1/repos/${repoId}/webhooks`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        provider: "github",
        secret: ghSecret,
        events: ["push", "release"],
        autoPublish: true,
        tagPattern: "^v?([0-9]+\\.[0-9]+\\.[0-9]+)$",
      })
      .expect(201);

    webhookId = res.body.webhook.id;
    assert.strictEqual(res.body.webhook.provider, "github");
    assert.strictEqual(res.body.webhook.secret, ghSecret);
    assert.strictEqual(res.body.webhook.auto_publish, 1);

    // List webhooks
    const listRes = await request(app)
      .get(`/api/v1/repos/${repoId}/webhooks`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    assert.strictEqual(listRes.body.webhooks.length, 1);
    assert.strictEqual(listRes.body.webhooks[0].id, webhookId);

    // Bob cannot view Alice's webhooks
    await request(app).get(`/api/v1/repos/${repoId}/webhooks`).set("Authorization", `Bearer ${bobToken}`).expect(404);
  });

  await t.test("GitHub Ping event is acknowledged with pong", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/incoming/github")
      .set("x-github-event", "ping")
      .send({ zen: "Approachable is better than simple." })
      .expect(200);

    assert.strictEqual(res.body.message, "pong");
    assert.strictEqual(res.body.zen, "Approachable is better than simple.");
  });

  await t.test("GitHub Webhook rejects requests with invalid or missing HMAC signature", async () => {
    const payload = {
      repository: { full_name: "alice/modelica-chassis" },
      ref: "refs/tags/v1.0.0",
    };

    // Missing signature
    await request(app).post("/api/v1/webhooks/incoming/github").set("x-github-event", "push").send(payload).expect(401);

    // Wrong signature
    await request(app)
      .post("/api/v1/webhooks/incoming/github")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", "sha256=0000000000000000000000000000000000000000000000000000000000000000")
      .send(payload)
      .expect(401);
  });

  await t.test("GitHub Webhook verifies HMAC and accepts versioned tag push", async () => {
    const payloadObj = {
      repository: { full_name: "alice/modelica-chassis" },
      ref: "refs/tags/v2.1.0",
      commits: [{ id: "abc1234", message: "Release v2.1.0" }],
    };
    const payloadJson = JSON.stringify(payloadObj);
    const signature = "sha256=" + crypto.createHmac("sha256", ghSecret).update(payloadJson).digest("hex");

    const res = await request(app)
      .post("/api/v1/webhooks/incoming/github")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", signature)
      .set("Content-Type", "application/json")
      .send(payloadJson)
      .expect(202);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.matched, true);
    assert.strictEqual(res.body.version, "2.1.0");
    assert.strictEqual(res.body.tag, "v2.1.0");
    assert.strictEqual(res.body.autoPublish, true);
    assert.ok(res.body.deliveryId);
  });

  await t.test("GitLab Webhook accepts tag push with valid secret token", async () => {
    // Link GitLab repo
    db.linkRepo(alice.id, "gitlab", "78910", "alice/battery-pack", "main", "Battery electrochemical models");
    const glRepos = db.getLinkedRepos(alice.id);
    const glRepo = glRepos.find((r) => r.project === "battery-pack");
    assert.ok(glRepo);

    const glSecret = "gl-test-token-777";
    await request(app)
      .post(`/api/v1/repos/${glRepo.id}/webhooks`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        provider: "gitlab",
        secret: glSecret,
        autoPublish: true,
      })
      .expect(201);

    const glPayload = {
      project: { path_with_namespace: "alice/battery-pack" },
      ref: "refs/tags/v3.0.5",
    };

    // 1. Invalid token fails
    await request(app)
      .post("/api/v1/webhooks/incoming/gitlab")
      .set("x-gitlab-event", "Tag Push Hook")
      .set("x-gitlab-token", "wrong-secret")
      .send(glPayload)
      .expect(401);

    // 2. Valid token succeeds
    const res = await request(app)
      .post("/api/v1/webhooks/incoming/gitlab")
      .set("x-gitlab-event", "Tag Push Hook")
      .set("x-gitlab-token", glSecret)
      .send(glPayload)
      .expect(202);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.matched, true);
    assert.strictEqual(res.body.version, "3.0.5");
    assert.strictEqual(res.body.tag, "v3.0.5");
  });

  await t.test("Alice deletes webhook and subsequent deliveries are rejected", async () => {
    await request(app)
      .delete(`/api/v1/repos/${repoId}/webhooks/${webhookId}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    const payloadObj = {
      repository: { full_name: "alice/modelica-chassis" },
      ref: "refs/tags/v2.2.0",
    };
    const payloadJson = JSON.stringify(payloadObj);
    const signature = "sha256=" + crypto.createHmac("sha256", ghSecret).update(payloadJson).digest("hex");

    await request(app)
      .post("/api/v1/webhooks/incoming/github")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", signature)
      .set("Content-Type", "application/json")
      .send(payloadJson)
      .expect(404);
  });
});
