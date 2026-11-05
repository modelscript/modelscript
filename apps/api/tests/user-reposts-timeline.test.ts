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

test("User Reposts Timeline Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repost-timeline-test-"));
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

  const passwordHash = await bcrypt.hash("Pass123!Safe", 10);
  const alice = db.createUser("alice_rep", "alice_rep@modelscript.test", passwordHash, { emailVerified: true });
  const bob = db.createUser("bob_rep", "bob_rep@modelscript.test", passwordHash, { emailVerified: true });

  const aliceToken = jwt.sign(
    { id: alice.id, username: alice.username, email: alice.email, tokenVersion: 1 },
    JWT_SECRET,
  );
  const bobToken = jwt.sign({ id: bob.id, username: bob.username, email: bob.email, tokenVersion: 1 }, JWT_SECRET);

  // Bob creates a post
  const bobPostRes = await request(app)
    .post("/api/v1/social/posts")
    .set("Authorization", `Bearer ${bobToken}`)
    .send({ content: "Bob's novel thermal model" });
  assert.strictEqual(bobPostRes.status, 201);
  const bobPostId = bobPostRes.body.post.id;

  // Alice creates a post
  const alicePostRes = await request(app)
    .post("/api/v1/social/posts")
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ content: "Alice's fluid dynamics model" });
  assert.strictEqual(alicePostRes.status, 201);
  const alicePostId = alicePostRes.body.post.id;

  // Alice reposts Bob's post
  const repostRes = await request(app)
    .post(`/api/v1/social/posts/${bobPostId}/repost`)
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.strictEqual(repostRes.status, 200);
  assert.strictEqual(repostRes.body.reposted, true);

  await t.test(
    "GET /api/v1/social/users/:username/posts?type=reposts returns only Alice's reposts with hydrated repost_post",
    async () => {
      const res = await request(app).get("/api/v1/social/users/alice_rep/posts?type=reposts");
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.posts));
      assert.strictEqual(res.body.posts.length, 1);

      const repost = res.body.posts[0];
      assert.strictEqual(repost.author_id, alice.id);
      assert.strictEqual(repost.username, "alice_rep");
      assert.strictEqual(String(repost.repost_of_id), String(bobPostId));
      assert.ok(repost.repost_post, "Expected repost_post to be hydrated");
      assert.strictEqual(repost.repost_post.username, "bob_rep");
      assert.strictEqual(repost.repost_post.content, "Bob's novel thermal model");
    },
  );

  await t.test(
    "GET /api/v1/social/users/:username/posts?type=reposts returns empty for users with no reposts",
    async () => {
      const res = await request(app).get("/api/v1/social/users/bob_rep/posts?type=reposts");
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.posts));
      assert.strictEqual(res.body.posts.length, 0);
    },
  );

  await t.test(
    "GET /api/v1/social/users/:username/posts without type or type=posts returns Alice's authored posts",
    async () => {
      const res = await request(app).get("/api/v1/social/users/alice_rep/posts?type=posts");
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.posts));
      const aliceAuthored = res.body.posts.find((p: any) => p.id === alicePostId);
      assert.ok(aliceAuthored, "Expected Alice's authored post in posts timeline");
    },
  );

  await t.test("Un-reposting removes the post from Alice's reposts timeline", async () => {
    const unRepostRes = await request(app)
      .post(`/api/v1/social/posts/${bobPostId}/repost`)
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(unRepostRes.status, 200);
    assert.strictEqual(unRepostRes.body.reposted, false);

    const res = await request(app).get("/api/v1/social/users/alice_rep/posts?type=reposts");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.posts.length, 0);
  });
});
