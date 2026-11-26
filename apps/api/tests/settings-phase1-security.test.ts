// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
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
import { generateTotpCode, generateTotpSecret } from "../src/util/totp.js";

test("Phase 1 Security: Push IDOR/SSRF, Social Graph Export Isolation, and Account Deletion Re-Auth & GDPR Erasure", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-phase1-security-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const signToken = (user: { id: number; username: string; email: string }) =>
    jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: "1h" });

  await t.test("Push subscription SSRF protection rejects private/loopback/metadata URLs", async () => {
    const hash = await bcrypt.hash("Pass1234!", 4);
    const alice = db.createUser("push_ssrf_alice", "push_ssrf_alice@test.local", hash, { emailVerified: true });
    const token = signToken(alice);

    const loopbackRes = await request(app)
      .post("/api/v1/users/me/push-subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        endpoint: "http://127.0.0.1:8080/internal-hook",
        keys: { p256dh: "test-p256dh-key", auth: "test-auth-secret" },
      });
    assert.strictEqual(loopbackRes.status, 400);

    const metadataRes = await request(app)
      .post("/api/v1/users/me/push-subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        endpoint: "http://169.254.169.254/latest/meta-data/",
        keys: { p256dh: "test-p256dh-key", auth: "test-auth-secret" },
      });
    assert.strictEqual(metadataRes.status, 400);

    const validRes = await request(app)
      .post("/api/v1/users/me/push-subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        endpoint: "https://fcm.googleapis.com/fcm/send/example-token-123",
        keys: { p256dh: "test-p256dh-key", auth: "test-auth-secret" },
      });
    assert.strictEqual(validRes.status, 201);
    assert.ok(validRes.body.subscription?.id);
  });

  await t.test("Push subscription DELETE enforces ownership (prevents IDOR) and validates ID", async () => {
    const hash = await bcrypt.hash("Pass1234!", 4);
    const userA = db.createUser("push_idor_a", "push_idor_a@test.local", hash, { emailVerified: true });
    const userB = db.createUser("push_idor_b", "push_idor_b@test.local", hash, { emailVerified: true });
    const tokenA = signToken(userA);
    const tokenB = signToken(userB);

    const subARes = await request(app)
      .post("/api/v1/users/me/push-subscriptions")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        endpoint: "https://fcm.googleapis.com/fcm/send/user-a-sub",
        keys: { p256dh: "key-a", auth: "auth-a" },
      })
      .expect(201);
    const subAId = subARes.body.subscription.id;

    const subBRes = await request(app)
      .post("/api/v1/users/me/push-subscriptions")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({
        endpoint: "https://fcm.googleapis.com/fcm/send/user-b-sub",
        keys: { p256dh: "key-b", auth: "auth-b" },
      })
      .expect(201);
    const subBId = subBRes.body.subscription.id;

    // Invalid IDs return 400
    await request(app)
      .delete("/api/v1/users/me/push-subscriptions/not-a-number")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(400);
    await request(app)
      .delete("/api/v1/users/me/push-subscriptions/0")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(400);
    await request(app)
      .delete("/api/v1/users/me/push-subscriptions/-3")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(400);

    // User A cannot delete User B's subscription
    await request(app)
      .delete(`/api/v1/users/me/push-subscriptions/${subBId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(404);

    // Verify User B's subscription still exists
    const userBSubs = db.listPushSubscriptions(userB.id);
    assert.strictEqual(userBSubs.length, 1);
    assert.strictEqual(userBSubs[0]?.id, subBId);

    // User A can delete their own subscription
    const delOwnRes = await request(app)
      .delete(`/api/v1/users/me/push-subscriptions/${subAId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    assert.strictEqual(delOwnRes.body.success, true);
    assert.strictEqual(db.listPushSubscriptions(userA.id).length, 0);
  });

  await t.test("Social graph JSON export with type=following does not leak private blocks or mutes", async () => {
    const hash = await bcrypt.hash("Pass1234!", 4);
    const owner = db.createUser("graph_owner", "graph_owner@test.local", hash, { emailVerified: true });
    const followed = db.createUser("graph_followed", "graph_followed@test.local", hash, { emailVerified: true });
    const blocked = db.createUser("graph_blocked", "graph_blocked@test.local", hash, { emailVerified: true });
    const muted = db.createUser("graph_muted", "graph_muted@test.local", hash, { emailVerified: true });
    const token = signToken(owner);

    db.followUser(owner.id, followed.id);
    db.blockUser(owner.id, blocked.id);
    db.muteUser(owner.id, muted.id);

    // Exporting following as JSON must NOT include blocks or mutes
    const followingRes = await request(app)
      .get("/api/v1/users/me/social-graph/export?format=json&type=following")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.strictEqual(followingRes.body.type, "following");
    assert.ok(Array.isArray(followingRes.body.following));
    assert.ok(followingRes.body.following.length >= 1);
    assert.strictEqual("blocks" in followingRes.body, false);
    assert.strictEqual("mutes" in followingRes.body, false);

    // Exporting blocks as JSON must NOT include following or mutes
    const blocksRes = await request(app)
      .get("/api/v1/users/me/social-graph/export?format=json&type=blocks")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.strictEqual(blocksRes.body.type, "blocks");
    assert.ok(Array.isArray(blocksRes.body.blocks));
    assert.ok(blocksRes.body.blocks.length >= 1);
    assert.strictEqual("following" in blocksRes.body, false);
    assert.strictEqual("mutes" in blocksRes.body, false);

    // Exporting mutes as JSON must NOT include following or blocks
    const mutesRes = await request(app)
      .get("/api/v1/users/me/social-graph/export?format=json&type=mutes")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.strictEqual(mutesRes.body.type, "mutes");
    assert.ok(Array.isArray(mutesRes.body.mutes));
    assert.ok(mutesRes.body.mutes.length >= 1);
    assert.strictEqual("following" in mutesRes.body, false);
    assert.strictEqual("blocks" in mutesRes.body, false);

    // Omitting type or passing type=all returns all three for backwards compatibility
    const allRes = await request(app)
      .get("/api/v1/users/me/social-graph/export?format=json")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.ok(Array.isArray(allRes.body.following));
    assert.ok(Array.isArray(allRes.body.blocks));
    assert.ok(Array.isArray(allRes.body.mutes));
  });

  await t.test(
    "DELETE /users/me requires password re-auth and erases all PII while keeping anonymized posts",
    async () => {
      const plainPassword = "CorrectHorseBatteryStaple!99";
      const hash = await bcrypt.hash(plainPassword, 4);
      const user = db.createUser("del_pwd_user", "del_pwd_user@test.local", hash, { emailVerified: true });
      const token = signToken(user);

      // Populate PII & credentials on the user
      db.db
        .prepare(
          `UPDATE users
         SET location = 'Zurich, CH',
             website = 'https://example.org/researcher',
             profile_fields = '[{"name":"ORCID","value":"0000-0002-1825-0097"}]',
             also_known_as = '["https://mastodon.social/users/researcher"]',
             rsa_private_key = 'PRIVATE_KEY_DATA'
         WHERE id = ?`,
        )
        .run(user.id);
      db.upsertPushSubscription(user.id, "https://fcm.googleapis.com/fcm/send/del-user-sub", "p256dh", "auth");

      // Create a public post authored by this user to confirm anonymized authorship preservation
      const post = db.createPost(user.id, "Public engineering benchmark post");

      // 1. Missing password -> 400
      await request(app).delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).send({}).expect(400);

      // 2. Wrong password -> 401
      await request(app)
        .delete("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ password: "WrongPassword123!" })
        .expect(401);

      // 3. Correct password -> 200
      const delRes = await request(app)
        .delete("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ password: plainPassword })
        .expect(200);
      assert.strictEqual(delRes.body.success, true);

      // Verify all PII fields erased/anonymized in raw DB row
      const anonymized = db.db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as Record<string, unknown>;
      assert.ok(anonymized);
      assert.strictEqual(anonymized["email"], `deleted_${user.id}@deleted.modelscript.local`);
      assert.strictEqual(anonymized["username"], `deleted_${user.id}`);
      assert.strictEqual(anonymized["status"], "deleted");
      assert.strictEqual(anonymized["password_hash"], null);
      assert.strictEqual(anonymized["location"], null);
      assert.strictEqual(anonymized["website"], null);
      assert.strictEqual(anonymized["avatar_url"], null);
      assert.strictEqual(anonymized["banner_url"], null);
      assert.strictEqual(anonymized["profile_fields"], "[]");
      assert.strictEqual(anonymized["also_known_as"], "[]");
      assert.strictEqual(anonymized["rsa_private_key"], null);
      assert.strictEqual(db.listPushSubscriptions(user.id).length, 0);

      // Verify public post remains intact under anonymized author
      const preservedPost = db.db.prepare(`SELECT id, author_id, content FROM posts WHERE id = ?`).get(post.id) as
        { id: string; author_id: number; content: string } | undefined;
      assert.ok(preservedPost);
      assert.strictEqual(preservedPost.author_id, user.id);
      assert.strictEqual(preservedPost.content, "Public engineering benchmark post");
    },
  );

  await t.test("DELETE /users/me requires valid 2FA TOTP code when 2FA is enabled", async () => {
    const plainPassword = "TwoFactorPassword!42";
    const hash = await bcrypt.hash(plainPassword, 4);
    const user = db.createUser("del_2fa_user", "del_2fa_user@test.local", hash, { emailVerified: true });
    const token = signToken(user);

    const secret = generateTotpSecret();
    db.db.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?`).run(secret, user.id);

    // Missing totpCode -> 401
    await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: plainPassword })
      .expect(401);

    // Wrong totpCode -> 401
    await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: plainPassword, totpCode: "000000" })
      .expect(401);

    // Valid password + valid totpCode -> 200
    const validCode = generateTotpCode(secret);
    const delRes = await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: plainPassword, totpCode: validCode })
      .expect(200);
    assert.strictEqual(delRes.body.success, true);

    const anonymized = db.getUserById(user.id);
    assert.strictEqual(anonymized?.status, "deleted");
    assert.strictEqual(anonymized?.totp_secret, null);
    assert.strictEqual(anonymized?.totp_enabled, 0);
  });

  await t.test("DELETE /users/me for SSO-only account (no password, no 2FA) requires confirmUsername", async () => {
    const user = db.createUser("sso_only_user", "sso_only@test.local", null as unknown as string, {
      emailVerified: true,
    });
    // Ensure password_hash is NULL in DB
    db.db.prepare(`UPDATE users SET password_hash = NULL WHERE id = ?`).run(user.id);
    const token = signToken(user);

    // Missing confirmUsername -> 400
    await request(app).delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).send({}).expect(400);

    // Wrong confirmUsername -> 400
    await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirmUsername: "wrong_user" })
      .expect(400);

    // Matching confirmUsername -> 200
    const delRes = await request(app)
      .delete("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirmUsername: "sso_only_user" })
      .expect(200);
    assert.strictEqual(delRes.body.success, true);
    assert.strictEqual(db.getUserById(user.id)?.status, "deleted");
  });
});
