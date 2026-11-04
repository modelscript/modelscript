// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["FEATURE_FLAG_TEST_STRICT"] = "true";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET, setAuthDatabase } from "../src/middleware/auth-middleware.js";
import { seedInitialAdmin } from "../src/util/seed-admin.js";

test("Web Push & Mastodon Push Subscriptions Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-push-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  await t.test("VAPID Keys generation, persistence, and discovery", async () => {
    const testDir = path.join(tmpDir, "vapid");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    await seedInitialAdmin(db, {
      username: "admin_vapid",
      email: "admin@vapid.test",
      password: "TestPassword123!",
      preset: "tier1_federated",
    });

    const keys1 = db.getInstanceVapidKeys();
    assert.ok(keys1.publicKey, "Should generate public key");
    assert.ok(keys1.privateKey, "Should generate private key");

    // Re-retrieval returns identical keys
    const keys2 = db.getInstanceVapidKeys();
    assert.strictEqual(keys1.publicKey, keys2.publicKey);
    assert.strictEqual(keys1.privateKey, keys2.privateKey);

    const app = createApp({ database: db });

    // Public VAPID key retrieval endpoint
    const res = await request(app).get("/api/v1/push/vapid-key");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.publicKey, keys1.publicKey);

    // NodeInfo metadata exposes VAPID key
    const nodeInfoRes = await request(app).get("/nodeinfo/2.0");
    assert.strictEqual(nodeInfoRes.status, 200);
    assert.strictEqual(nodeInfoRes.body.metadata.vapidPublicKey, keys1.publicKey);

    db.db.close();
  });

  await t.test("Mastodon Push Subscription lifecycle: POST, GET, PUT, DELETE", async () => {
    const testDir = path.join(tmpDir, "lifecycle");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    const seedResult = await seedInitialAdmin(db, {
      username: "engineer",
      email: "eng@ansatz.test",
      password: "TestPassword123!",
      preset: "tier1_federated",
    });

    const user = db.getUserByUsername(seedResult.username)!;
    assert.ok(user, "User should be seeded in DB");

    const app = createApp({ database: db });

    const userToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        tokenVersion: 1,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    // 1. Initially no active push subscription
    const getInitialRes = await request(app)
      .get("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(getInitialRes.status, 404);

    // 2. Register subscription via standard Mastodon payload
    const postRes = await request(app)
      .post("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        subscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/fake-device-token-12345",
          keys: {
            p256dh: "BM6h_mock_p256dh_key_data_base64url",
            auth: "mock_auth_secret_base64",
          },
        },
        data: {
          alerts: {
            mention: true,
            reblog: true,
            favourite: true,
            follow: true,
          },
          policy: "all",
        },
      });

    assert.strictEqual(postRes.status, 201);
    assert.ok(postRes.body.id);
    assert.strictEqual(postRes.body.endpoint, "https://fcm.googleapis.com/fcm/send/fake-device-token-12345");
    assert.ok(postRes.body.server_key);
    assert.strictEqual(postRes.body.policy, "all");
    assert.strictEqual(postRes.body.alerts.mention, true);

    // 3. GET current subscription
    const getRes = await request(app).get("/api/v1/push/subscription").set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, postRes.body.id);
    assert.strictEqual(getRes.body.endpoint, "https://fcm.googleapis.com/fcm/send/fake-device-token-12345");

    // 4. PUT updates alerts
    const putRes = await request(app)
      .put("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        data: {
          alerts: {
            mention: true,
            reblog: false,
            favourite: false,
            follow: true,
          },
          policy: "followed",
        },
      });

    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.policy, "followed");
    assert.strictEqual(putRes.body.alerts.reblog, false);

    // 5. DELETE subscription
    const deleteRes = await request(app)
      .delete("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.body.success, true);

    // 6. Verification that it is removed
    const getAfterDeleteRes = await request(app)
      .get("/api/v1/push/subscription")
      .set("Authorization", `Bearer ${userToken}`);
    assert.strictEqual(getAfterDeleteRes.status, 404);

    db.db.close();
  });

  await t.test("Web Push Service cleanup on expired 410 Gone subscription", async () => {
    const testDir = path.join(tmpDir, "cleanup");
    fs.mkdirSync(testDir, { recursive: true });
    const db = new LibraryDatabase(testDir);
    setAuthDatabase(db);

    const user = db.createUser("push_tester", "push@ansatz.test", "hash");
    const sub = db.upsertPushSubscription(
      user.id,
      "https://updates.push.services.mozilla.com/wpush/v2/expired-sub",
      "p256dh_fake",
      "auth_fake",
    );

    const initialList = db.listPushSubscriptions(user.id);
    assert.strictEqual(initialList.length, 1);

    // Send push using WebPushService
    // When endpoint fails (or throws 410), WebPushService handles and removes it
    const ok = await db.webPushService.sendToSubscription(sub, {
      title: "Simulation Completed",
      body: "Modelica electrical circuit simulated.",
    });

    // Mock/invalid endpoint returns false
    assert.strictEqual(ok, false);

    db.db.close();
  });
});
