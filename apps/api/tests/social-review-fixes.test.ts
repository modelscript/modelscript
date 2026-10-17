// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
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

test("Social Web App Review Fixes Regression Suite (Phases 1-4)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-review-fixes-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const passwordHash = await bcrypt.hash("CorrectHorseBatteryStaple!1", 10);
  const alice = db.createUser("alice_rev", "alice_rev@modelscript.test", passwordHash, {
    emailVerified: true,
  });
  const bob = db.createUser("bob_rev", "bob_rev@modelscript.test", passwordHash, {
    emailVerified: true,
  });

  const aliceToken = jwt.sign(
    { id: alice.id, username: alice.username, email: alice.email, tokenVersion: 1 },
    JWT_SECRET,
  );
  const bobToken = jwt.sign({ id: bob.id, username: bob.username, email: bob.email, tokenVersion: 1 }, JWT_SECRET);

  await t.test("2FA setup/verify enforces server-issued pending secret and disable requires verification", async () => {
    const setupRes = await request(app).post("/api/v1/auth/2fa/setup").set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(setupRes.status, 200);
    assert.ok(setupRes.body.secret);
    assert.ok(setupRes.body.otpAuthUri);
    assert.strictEqual(setupRes.body.otpAuthUri, setupRes.body.otpauthUri);

    // Attempt to verify with a forged secret not issued by /2fa/setup
    const forgedSecret = generateTotpSecret();
    const forgedCode = generateTotpCode(forgedSecret);
    const forgedRes = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ secret: forgedSecret, code: forgedCode });
    assert.strictEqual(forgedRes.status, 400);

    // Verify with the server-issued setup secret (without needing client to re-send secret)
    const validCode = generateTotpCode(setupRes.body.secret);
    const enableRes = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ code: validCode });
    assert.strictEqual(enableRes.status, 200);
    assert.strictEqual(enableRes.body.success, true);

    // Disabling 2FA without password or code must fail
    const disableUnverified = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ password: "CorrectHorseBatteryStaple!1" });
    assert.strictEqual(disableUnverified.status, 400);

    // Disabling 2FA with valid password + TOTP code succeeds
    const disableVerified = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({
        password: "CorrectHorseBatteryStaple!1",
        code: generateTotpCode(setupRes.body.secret),
      });
    assert.strictEqual(disableVerified.status, 200);
    assert.strictEqual(disableVerified.body.success, true);
  });

  await t.test("User mute/unmute endpoints and profile column whitelist protection", async () => {
    const muteRes = await request(app)
      .post(`/api/v1/users/${bob.username}/mute`)
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(muteRes.status, 200);
    assert.strictEqual(muteRes.body.muted, true);
    assert.strictEqual(db.isUserMuted(alice.id, bob.id), true);

    const unmuteRes = await request(app)
      .delete(`/api/v1/users/${bob.username}/mute`)
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(unmuteRes.status, 200);
    assert.strictEqual(unmuteRes.body.muted, false);
    assert.strictEqual(db.isUserMuted(alice.id, bob.id), false);

    // Ensure updateProfile ignores non-whitelisted fields
    db.updateProfile(alice.id, {
      display_name: "Alice Verified",
      ...({ account_type: "admin", credit_balance: 999999 } as any),
    });
    const updatedAlice = db.getUserById(alice.id)!;
    assert.strictEqual(updatedAlice.display_name, "Alice Verified");
    assert.strictEqual(updatedAlice.account_type, "user");
  });

  await t.test(
    "Post creation persists client_signature, embeds artifact_view, and returns dual quote/repost shapes",
    async () => {
      const artifactId = db.createArtifactView(
        alice.id,
        "modelica-code",
        "inline",
        JSON.stringify({ code: "model Pendulum Real theta; end Pendulum;" }),
        "Pendulum Model",
      );

      const createRes = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          content: "Signed pendulum model #modelica #robotics",
          artifact_view_id: artifactId,
          client_signature: "sig_base64_xyz123",
          key_id_string: "device-key-1",
        });

      assert.strictEqual(createRes.status, 201);
      const postId = createRes.body.post.id;
      assert.strictEqual(createRes.body.post.client_signature, "sig_base64_xyz123");
      assert.strictEqual(createRes.body.post.key_id_string, "device-key-1");
      assert.ok(createRes.body.post.artifact_view, "Expected hydrated artifact_view on post");
      assert.strictEqual(createRes.body.post.artifact_view.id, artifactId);

      // Create a quote post and a repost from Bob
      const quoteRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${bobToken}`).send({
        content: "Great pendulum model!",
        quote_post_id: postId,
      });
      assert.strictEqual(quoteRes.status, 201);

      const repostRes = await request(app)
        .post(`/api/v1/social/posts/${postId}/repost`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(repostRes.status, 200);

      const quotesGet = await request(app).get(`/api/v1/social/posts/${postId}/quotes`);
      assert.strictEqual(quotesGet.status, 200);
      assert.ok(Array.isArray(quotesGet.body.quotes));
      assert.ok(Array.isArray(quotesGet.body.posts));
      assert.strictEqual(quotesGet.body.quotes.length, 1);
      assert.strictEqual(quotesGet.body.posts.length, 1);

      const repostsGet = await request(app).get(`/api/v1/social/posts/${postId}/reposts`);
      assert.strictEqual(repostsGet.status, 200);
      assert.ok(Array.isArray(repostsGet.body.reposts));
      assert.ok(Array.isArray(repostsGet.body.posts));
      assert.strictEqual(repostsGet.body.reposts.length, 1);
      assert.strictEqual(repostsGet.body.posts.length, 1);
    },
  );

  await t.test("Subscribed RSS feed posts appear in Home and Following timelines", async () => {
    const feedId = db.createRssProfile(
      "https://engineering-daily.example.com/rss.xml",
      "Engineering Daily RSS",
      "Daily simulation updates",
      "https://engineering-daily.example.com",
      "",
      "rss_eng_daily",
    );
    const feedRecord = db.getRssFeedByUrl("https://engineering-daily.example.com/rss.xml");
    assert.ok(feedRecord);

    db.subscribeToRssFeed(alice.id, feedId);
    const rssPost = db.createPost(feedRecord.user_id, "New CFD mesh benchmark published via RSS!");

    const homePosts = db.getHomeTimeline(alice.id, 20, 0);
    assert.ok(
      homePosts.some((p) => p.id === rssPost.id),
      "Expected subscribed RSS post in getHomeTimeline",
    );

    const followingPosts = db.getFollowingTimeline(alice.id, 20, "recent", 0);
    assert.ok(
      followingPosts.some((p) => p.id === rssPost.id),
      "Expected subscribed RSS post in getFollowingTimeline",
    );
  });

  await t.test("GDPR exportUserData and getUserArchiveData return authored posts and published packages", async () => {
    const pkg = db.getOrCreatePackage("@alice_rev/thermal-solver");
    db.storePackageVersion(
      pkg.id,
      "1.2.0",
      "/tmp/thermal-solver-1.2.0.tgz",
      "deadbeef",
      "sha512-xyz",
      1024,
      JSON.stringify({ name: "@alice_rev/thermal-solver", version: "1.2.0" }),
      null,
      alice.id,
    );

    const exported = db.exportUserData(alice.id) as any;
    assert.ok(exported);
    assert.ok(Array.isArray(exported.posts));
    assert.ok(exported.posts.length >= 1, "Expected authored posts in exportUserData");
    assert.ok(Array.isArray(exported.libraries));
    assert.ok(
      exported.libraries.some((lib: any) => lib.name === "@alice_rev/thermal-solver" && lib.version === "1.2.0"),
      "Expected published package in exportUserData",
    );

    const archiveData = db.getUserArchiveData(alice.id);
    assert.ok(archiveData.posts.length >= 1, "Expected authored posts in getUserArchiveData");
    assert.ok(
      archiveData.libraries.some((lib: any) => lib.name === "@alice_rev/thermal-solver" && lib.version === "1.2.0"),
      "Expected published package in getUserArchiveData",
    );
  });

  await t.test("OAuth account linking signs state JWT and rejects forged unsigned state", async () => {
    // 1. Valid link initiation via cookie/token produces signed JWT state
    const linkInit = await request(app).get(`/api/v1/auth/link/github?token=${encodeURIComponent(aliceToken)}`);
    assert.strictEqual(linkInit.status, 302);
    const redirectLocation = linkInit.headers["location"] || "";
    assert.ok(redirectLocation.includes("/api/v1/auth/callback/github?code="));

    // 2. Forged unsigned state parameter must be rejected with error=InvalidState
    const forgedState = encodeURIComponent(JSON.stringify({ action: "link", userId: bob.id }));
    const forgedCallback = await request(app).get(
      `/api/v1/auth/callback/github?code=mock_code_from_github&state=${forgedState}`,
    );
    assert.strictEqual(forgedCallback.status, 302);
    assert.ok((forgedCallback.headers["location"] || "").includes("error=InvalidState"));
    assert.strictEqual(db.getOAuthAccountByUserId(bob.id, "github"), undefined);

    // 3. Following the signed redirect links the account to Alice
    const validCallback = await request(app).get(redirectLocation);
    assert.strictEqual(validCallback.status, 302);
    assert.ok((validCallback.headers["location"] || "").includes("success=Linkedgithub"));
    assert.ok(db.getOAuthAccountByUserId(alice.id, "github"));
  });

  await t.test(
    "Phase 6: Mute/block timeline filtering, notification preferences, follow notification, and GDPR erasure invalidation",
    async () => {
      const charlie = db.createUser("charlie_rev", "charlie_rev@modelscript.test", passwordHash, {
        emailVerified: true,
      });
      const charlieToken = jwt.sign(
        { id: charlie.id, username: charlie.username, email: charlie.email, tokenVersion: 1 },
        JWT_SECRET,
      );

      // 1. Follow emits notification
      const followRes = await request(app)
        .post(`/api/v1/users/${alice.username}/follow`)
        .set("Authorization", `Bearer ${charlieToken}`);
      assert.strictEqual(followRes.status, 200);
      const aliceNotifs = db.getNotifications(alice.id, 10, 0);
      assert.ok(
        aliceNotifs.some((n: any) => n.type === "follow" && n.actor_id === charlie.id),
        "Expected follow notification for Alice from Charlie",
      );

      // 2. Muting Charlie excludes Charlie's posts from Alice's timelines & suppresses notifications
      const charliePost = db.createPost(charlie.id, "Charlie's post before mute");
      assert.ok(db.getExploreTimeline(alice.id, 20, 0).some((p) => p.id === charliePost.id));

      db.muteUser(alice.id, charlie.id);
      assert.ok(
        !db.getExploreTimeline(alice.id, 20, 0).some((p) => p.id === charliePost.id),
        "Muted user's post should be excluded from Alice's explore timeline",
      );
      assert.ok(
        !db.getHomeTimeline(alice.id, 20, 0).some((p) => p.id === charliePost.id),
        "Muted user's post should be excluded from Alice's home timeline",
      );

      db.createNotification(alice.id, charlie.id, "like", charliePost.id);
      assert.ok(
        !db.getNotifications(alice.id, 10, 0).some((n: any) => n.type === "like" && n.actor_id === charlie.id),
        "Notification from muted user must be suppressed",
      );
      db.unmuteUser(alice.id, charlie.id);

      // 3. Notification settings disable specific notification types
      db.updateNotificationSettings(alice.id, JSON.stringify({ likes: false, follows: true }));
      db.createNotification(alice.id, charlie.id, "like", charliePost.id);
      assert.ok(
        !db.getNotifications(alice.id, 10, 0).some((n: any) => n.type === "like" && n.actor_id === charlie.id),
        "Disabled like notification preference must suppress notification",
      );

      // 4. Anonymizing Charlie increments token_version and invalidates existing JWT on requireAuth
      db.anonymizeUser(charlie.id);
      const deletedCheck = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${charlieToken}`)
        .send({ content: "Should be rejected after anonymizeUser" });
      assert.strictEqual(deletedCheck.status, 401);

      // 5. Live OAuth provider redirect when GITHUB_CLIENT_ID is configured
      process.env["GITHUB_CLIENT_ID"] = "gh_live_client_123";
      try {
        const liveOAuthInit = await request(app).get("/api/v1/auth/login/github");
        assert.strictEqual(liveOAuthInit.status, 302);
        const authUrl = liveOAuthInit.headers["location"] || "";
        assert.ok(
          authUrl.startsWith("https://github.com/login/oauth/authorize?"),
          `Expected GitHub OAuth authorize URL, got: ${authUrl}`,
        );
        assert.ok(authUrl.includes("client_id=gh_live_client_123"));
        assert.ok(authUrl.includes("state="));
      } finally {
        delete process.env["GITHUB_CLIENT_ID"];
      }
    },
  );
});
