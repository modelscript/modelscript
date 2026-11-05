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

test("Social About Page, Location Stabilization, and Mute/Block Enforcement", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-about-mod-"));
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

  const passwordHash = await bcrypt.hash("Password123!", 10);
  const alice = db.createUser("alice_abt", "alice_abt@modelscript.test", passwordHash, {
    emailVerified: true,
  });
  const bob = db.createUser("bob_abt", "bob_abt@modelscript.test", passwordHash, {
    emailVerified: true,
  });

  const aliceToken = jwt.sign(
    { id: alice.id, username: alice.username, email: alice.email, tokenVersion: 1 },
    JWT_SECRET,
  );
  const bobToken = jwt.sign({ id: bob.id, username: bob.username, email: bob.email, tokenVersion: 1 }, JWT_SECRET);

  await t.test("GET /api/v1/users/:username/about returns metadata and location info", async () => {
    const res = await request(app).get("/api/v1/users/alice_abt/about").set("Authorization", `Bearer ${bobToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.profile.username, "alice_abt");
    assert.ok(res.body.joinedAt);
    assert.ok("basedIn" in res.body);
    assert.ok("countryCode" in res.body);
    assert.strictEqual(res.body.usernameChanges.count, 0);
    assert.strictEqual(res.body.usernameChanges.lastChangedAt, null);
    assert.deepStrictEqual(res.body.usernameChanges.history, []);
  });

  await t.test("Username changes are tracked in username_history and reflected in about endpoint", async () => {
    // Change Alice's username to alice_renamed
    db.updateAccount(alice.id, { username: "alice_renamed" });

    const history = db.getUsernameChanges(alice.id);
    assert.strictEqual(history.count, 1);
    assert.ok(history.lastChangedAt);
    assert.strictEqual(history.history[0]?.old_username, "alice_abt");
    assert.strictEqual(history.history[0]?.new_username, "alice_renamed");

    const res = await request(app).get("/api/v1/users/alice_renamed/about");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.profile.username, "alice_renamed");
    assert.strictEqual(res.body.usernameChanges.count, 1);
    assert.strictEqual(res.body.usernameChanges.history[0].oldUsername, "alice_abt");
    assert.strictEqual(res.body.usernameChanges.history[0].newUsername, "alice_renamed");
  });

  await t.test("Location stabilization algorithm requires N consistent requests to transition", async () => {
    const N = 4;
    // Step 1: Initial location seed for Bob
    const loc1 = db.recordUserLocationRequest(bob.id, "US", undefined, N);
    assert.strictEqual(loc1.confirmedCountryCode, "US");

    // Step 2: 3 requests from FR (less than N=4)
    db.recordUserLocationRequest(bob.id, "FR", undefined, N);
    db.recordUserLocationRequest(bob.id, "FR", undefined, N);
    const locAfter3 = db.recordUserLocationRequest(bob.id, "FR", undefined, N);
    assert.strictEqual(locAfter3.confirmedCountryCode, "US", "Location must not change before N requests");

    // Step 3: An inconsistent request from DE resets the pending streak
    const locNoise = db.recordUserLocationRequest(bob.id, "DE", undefined, N);
    assert.strictEqual(locNoise.confirmedCountryCode, "US");

    // Step 4: 4 consistent requests from JP
    db.recordUserLocationRequest(bob.id, "JP", undefined, N);
    db.recordUserLocationRequest(bob.id, "JP", undefined, N);
    db.recordUserLocationRequest(bob.id, "JP", undefined, N);
    const locSwitched = db.recordUserLocationRequest(bob.id, "JP", undefined, N);
    assert.strictEqual(locSwitched.confirmedCountryCode, "JP", "Location must switch after N consistent requests");

    const userLoc = db.getUserAccountLocation(bob.id);
    assert.strictEqual(userLoc?.countryCode, "JP");
    assert.strictEqual(userLoc?.countryName, "Japan");
  });

  await t.test("Cloudflare cf-ipcountry header is ingested automatically via request middleware", async () => {
    // Send authenticated request with cf-ipcountry header
    const res = await request(app)
      .get("/api/v1/users/bob_abt/about")
      .set("Authorization", `Bearer ${bobToken}`)
      .set("cf-ipcountry", "CA");

    assert.strictEqual(res.status, 200);
    // After 1 request from CA, confirmed is still JP (streak is 1 of 5)
    assert.strictEqual(res.body.countryCode, "JP");

    // Send 4 more requests with CA
    for (let i = 0; i < 4; i++) {
      await request(app)
        .get("/api/v1/users/bob_abt/about")
        .set("Authorization", `Bearer ${bobToken}`)
        .set("cf-ipcountry", "CA");
    }

    // Now it transitions to CA
    const resUpdated = await request(app).get("/api/v1/users/bob_abt/about").set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(resUpdated.body.countryCode, "CA");
    assert.strictEqual(resUpdated.body.basedIn, "Canada");
  });

  await t.test("Block enforcement: profile views, follows, post visibility, and replies", async () => {
    // Alice blocks Bob
    await request(app).post("/api/v1/users/bob_abt/block").set("Authorization", `Bearer ${aliceToken}`);

    // Check Alice's view of Bob: isBlocked = true, isBlockedBy = false
    const aliceViewBob = await request(app).get("/api/v1/users/bob_abt").set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(aliceViewBob.status, 200);
    assert.strictEqual(aliceViewBob.body.isBlocked, true);
    assert.strictEqual(aliceViewBob.body.isBlockedBy, false);

    // Check Bob's view of Alice (alice_renamed): isBlocked = false, isBlockedBy = true
    const bobViewAlice = await request(app)
      .get("/api/v1/users/alice_renamed")
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobViewAlice.status, 200);
    assert.strictEqual(bobViewAlice.body.isBlocked, false);
    assert.strictEqual(bobViewAlice.body.isBlockedBy, true);

    // Follow enforcement: Bob cannot follow Alice (403)
    const bobFollowAlice = await request(app)
      .post("/api/v1/users/alice_renamed/follow")
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobFollowAlice.status, 403);

    // Follow enforcement: Alice cannot follow Bob while blocked (403)
    const aliceFollowBob = await request(app)
      .post("/api/v1/users/bob_abt/follow")
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(aliceFollowBob.status, 403);

    // Alice creates a post
    const postRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ content: "Secret post from Alice" });
    assert.strictEqual(postRes.status, 201);
    const postId = postRes.body.post.id;

    // Bob cannot view Alice's timeline: returns empty array
    const bobTimeline = await request(app)
      .get("/api/v1/social/users/alice_renamed/posts")
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobTimeline.status, 200);
    assert.deepStrictEqual(bobTimeline.body.posts, []);

    // Bob cannot view Alice's individual post (403)
    const bobGetPost = await request(app)
      .get(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobGetPost.status, 403);

    // Bob cannot reply to Alice's post (403)
    const bobReply = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ content: "Unauthorized reply", reply_to_id: postId });
    assert.ok(bobReply.status === 403 || bobReply.status === 404, `Expected 403 or 404, got ${bobReply.status}`);

    // Unblocking restores access
    await request(app).post("/api/v1/users/bob_abt/unblock").set("Authorization", `Bearer ${aliceToken}`);

    const bobGetPostAfterUnblock = await request(app)
      .get(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(bobGetPostAfterUnblock.status, 200);
    assert.strictEqual(bobGetPostAfterUnblock.body.post.content, "Secret post from Alice");
  });

  await t.test("Mute enforcement filters notifications from muted user", async () => {
    // Create a notification for Alice where Bob is the actor BEFORE muting
    db.createNotification(alice.id, bob.id, "mention", null, { message: "bob_abt mentioned you" });

    const notifsBefore = db.getNotifications(alice.id);
    assert.strictEqual(notifsBefore.length, 1);

    // Alice mutes Bob
    await request(app).post("/api/v1/users/bob_abt/mute").set("Authorization", `Bearer ${aliceToken}`);

    // Alice checks notifications: notification from Bob must be filtered out
    const notifs = db.getNotifications(alice.id);
    assert.strictEqual(notifs.length, 0);

    // Verify that attempting to create a new notification while muted is discarded
    db.createNotification(alice.id, bob.id, "mention", null, { message: "another mention while muted" });
    assert.strictEqual(db.getNotifications(alice.id).length, 0);

    // Unmuting reveals prior notifications
    await request(app).post("/api/v1/users/bob_abt/unmute").set("Authorization", `Bearer ${aliceToken}`);

    const notifsAfter = db.getNotifications(alice.id);
    assert.strictEqual(notifsAfter.length, 1);
    assert.strictEqual(notifsAfter[0]?.actor_username, "bob_abt");
  });
});
