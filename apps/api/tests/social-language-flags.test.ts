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
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("Social Routes: Language Feature Flag Filtering", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-lang-flag-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(async () => {
    try {
      await new Promise((r) => setTimeout(r, 100));
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const testUser = db.createUser("testengineer", "eng@modelscript.test", "hash_pw", "Test Engineer");
  assert.ok(testUser);
  const token = jwt.sign({ id: testUser.id, username: testUser.username, role: "user" }, JWT_SECRET);

  // 1. Create a Modelica post and a ModelScript post directly
  const { id: modelicaPostId } = db.createPost(
    testUser.id,
    "Here is a regular Modelica physical simulation model #modelica #physics",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { language: "modelica", filename: "Circuit.mo" },
  );

  const { id: modelscriptPostId } = db.createPost(
    testUser.id,
    "Here is an experimental #modelscript post with TiltRotorTransitionController.msx",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { language: "modelscript", filename: "TiltRotorTransitionController.msx" },
  );

  await t.test("When lang_modelscript is disabled by default: ModelScript post is filtered from timeline", async () => {
    const res = await request(app).get("/api/v1/social/timeline").set("Authorization", `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    const postIds = res.body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes(modelicaPostId), "Modelica post should be visible");
    assert.ok(!postIds.includes(modelscriptPostId), "ModelScript post should be hidden when flag is disabled");
  });

  await t.test("When lang_modelscript is disabled: Direct GET /api/v1/social/posts/:id returns 404", async () => {
    const res = await request(app)
      .get(`/api/v1/social/posts/${modelscriptPostId}`)
      .set("Authorization", `Bearer ${token}`);

    assert.strictEqual(res.status, 404);
  });

  await t.test("When lang_modelscript is disabled: Creating a ModelScript post is rejected with 403", async () => {
    const res = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        content: "Trying to publish a new ModelScript module #modelscript",
        metadata: {
          language: "modelscript",
          filename: "NewModel.msx",
        },
      });

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes("disabled"), `Expected disabled language error, got: ${res.body.error}`);
  });

  await t.test("When lang_modelscript is enabled in DB: ModelScript posts are visible and createable", async () => {
    const featureFlagService = app.locals["featureFlagService"];
    featureFlagService.setFlag("lang_modelscript", true);

    // Timeline should now include the ModelScript post
    const timelineRes = await request(app).get("/api/v1/social/timeline").set("Authorization", `Bearer ${token}`);

    assert.strictEqual(timelineRes.status, 200);
    const postIds = timelineRes.body.posts.map((p: any) => p.id);
    assert.ok(postIds.includes(modelscriptPostId), "ModelScript post should now be visible");

    // Direct fetch should now succeed
    const singleRes = await request(app)
      .get(`/api/v1/social/posts/${modelscriptPostId}`)
      .set("Authorization", `Bearer ${token}`);

    assert.strictEqual(singleRes.status, 200);
    assert.strictEqual(singleRes.body.post.id, modelscriptPostId);

    // Creating post should now succeed
    const createRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        content: "Publishing new ModelScript module with flag enabled #modelscript",
        metadata: {
          language: "modelscript",
          filename: "NewModel.msx",
        },
      });

    assert.strictEqual(createRes.status, 201);
  });
});
