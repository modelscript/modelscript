// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { isSnowflakeId } from "../src/util/snowflake.js";

test("Twitter Snowflake IDs & Workspace Normalization Parity", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snowflake-workspace-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup error ignored
    }
  });

  const author = db.createUser("alice", "alice@modelscript.test", "hashed_pwd", { emailVerified: true });
  const authorToken = jwt.sign({ id: author.id, username: author.username, email: author.email }, JWT_SECRET);

  const bob = db.createUser("bob", "bob@modelscript.test", "hashed_pwd", { emailVerified: true });
  const bobToken = jwt.sign({ id: bob.id, username: bob.username, email: bob.email }, JWT_SECRET);

  await t.test("db.createPost generates 64-bit snowflake IDs without IEEE-754 precision loss", async () => {
    // 1. Automatic snowflake generation
    const postAuto = db.createPost(author.id, "Hello from snowflake world!");
    assert.ok(isSnowflakeId(postAuto.id), `Expected ${postAuto.id} to be a valid snowflake ID`);
    assert.strictEqual(typeof postAuto.id, "string");
    assert.strictEqual(postAuto.id_str, postAuto.id);

    const fetchedAuto = db.getPost(postAuto.id);
    assert.ok(fetchedAuto);
    assert.strictEqual(fetchedAuto.id, postAuto.id);
    assert.strictEqual(fetchedAuto.id_str, postAuto.id);

    // 2. Explicit 64-bit snowflake ID (exact Twitter snowflake example: 2117825138435453369)
    const twitterSnowflakeId = "2117825138435453369";
    const postExplicit = db.createPost(author.id, "Explicit 64-bit snowflake post", {
      explicitId: twitterSnowflakeId,
    });
    assert.strictEqual(postExplicit.id, twitterSnowflakeId);

    const fetchedExplicit = db.getPost(twitterSnowflakeId);
    assert.ok(fetchedExplicit);
    // Crucial check: must NOT be IEEE 754 rounded to 2117825138435453400
    assert.strictEqual(fetchedExplicit.id, twitterSnowflakeId);
    assert.strictEqual(fetchedExplicit.id_str, twitterSnowflakeId);
    assert.notStrictEqual(fetchedExplicit.id, "2117825138435453400");

    // Verify timeline returns exact string ID
    const timeline = db.getHomeTimeline(author.id, 10);
    const foundInTimeline = timeline.find((p) => p.id === twitterSnowflakeId);
    assert.ok(foundInTimeline, "Post should be present in timeline");
    assert.strictEqual(foundInTimeline.id, twitterSnowflakeId);
  });

  await t.test("db.createArtifactView generates and stores snowflake IDs safely", async () => {
    // Auto-generated snowflake for artifact view
    const artAutoId = db.createArtifactView(
      author.id,
      "diagram",
      "code",
      JSON.stringify({ dialect: "modelica" }),
      "Auto Snowflake Artifact",
    );
    assert.ok(isSnowflakeId(artAutoId), `Expected artifact view ID ${artAutoId} to be snowflake`);
    assert.strictEqual(typeof artAutoId, "string");

    const fetchedArt = db.getArtifactView(artAutoId);
    assert.ok(fetchedArt);
    assert.strictEqual(fetchedArt.id, artAutoId);

    // Explicit 64-bit snowflake ID for artifact view
    const explicitArtId = "2117825138435453369";
    const artExplicitId = db.createArtifactView(
      author.id,
      "diagram",
      "code",
      JSON.stringify({ dialect: "modelica" }),
      "Explicit Snowflake Artifact",
      null,
      null,
      explicitArtId,
    );
    assert.strictEqual(artExplicitId, explicitArtId);

    const fetchedExplicit = db.getArtifactView(explicitArtId);
    assert.ok(fetchedExplicit);
    assert.strictEqual(fetchedExplicit.id, explicitArtId);
    assert.notStrictEqual(fetchedExplicit.id, "2117825138435453400");

    // Verify fallback lookup for IEEE-754 precision rounded requests (e.g. ...700 vs ...704)
    const exactSnowflake = "620763551375560704";
    const truncatedSnowflake = "620763551375560700";
    db.createArtifactView(
      author.id,
      "morsel",
      "upload",
      JSON.stringify({ code: "model Test end Test;" }),
      "Fuzzy Snowflake Test",
      null,
      null,
      exactSnowflake,
    );
    const fetchedFuzzy = db.getArtifactView(truncatedSnowflake);
    assert.ok(fetchedFuzzy, "Artifact view should be resolvable via fuzzy snowflake envelope");
    assert.strictEqual(fetchedFuzzy.id, exactSnowflake);

    // Verify via REST API
    const restRes = await request(app).get(`/api/v1/social/artifact-views/${truncatedSnowflake}`);
    assert.strictEqual(restRes.status, 200);
    assert.strictEqual(restRes.body.artifactView.id, exactSnowflake);
  });

  await t.test("Social HTTP endpoints handle snowflake post IDs with complete precision", async () => {
    // Create a post via REST API
    const createRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        content: "Testing REST API snowflake IDs! 🚀",
      });

    assert.strictEqual(createRes.status, 201);
    const postId = createRes.body.post.id;
    assert.ok(postId);
    assert.strictEqual(typeof postId, "string");
    assert.ok(isSnowflakeId(postId));
    assert.strictEqual(createRes.body.post.id_str, postId);

    // Fetch the post by snowflake ID
    const getRes = await request(app).get(`/api/v1/social/posts/${postId}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.post.id, postId);

    // Like the post with bob's account
    const likeRes = await request(app)
      .post(`/api/v1/social/posts/${postId}/like`)
      .set("Authorization", `Bearer ${bobToken}`);
    assert.strictEqual(likeRes.status, 200);
    assert.strictEqual(likeRes.body.liked, true);

    // Analytics endpoint
    const analyticsRes = await request(app).get(`/api/v1/social/posts/${postId}/analytics`);
    assert.strictEqual(analyticsRes.status, 200);
    assert.strictEqual(analyticsRes.body.like_count, 1);
  });

  await t.test("VS Code Workbench route normalizes raw snowflake workspace IDs and legacy artifact-<id>", async () => {
    const snowflakeId = "2117825138435453369";

    // 1. Normalized raw snowflake ID in template query: ?template=2117825138435453369
    const resRaw = await request(app).get(`/vscode/workbench?template=${snowflakeId}`);
    assert.strictEqual(resRaw.status, 200);
    // Both template and folder normalize into folderUri path "/2117825138435453369"
    assert.ok(resRaw.text.includes(`&quot;path&quot;:&quot;/${snowflakeId}&quot;`));
    assert.ok(resRaw.text.includes("template.startsWith('artifact-')"));
    assert.ok(resRaw.text.includes("'Workspace #' + artId"));
    assert.ok(resRaw.text.includes("'modelscript:ide:memfs:' + data.artifactId"));

    // 2. Legacy artifact-<id> template query: ?template=artifact-2117825138435453369
    const resLegacy = await request(app).get(`/vscode/workbench?template=artifact-${snowflakeId}`);
    assert.strictEqual(resLegacy.status, 200);
    assert.ok(resLegacy.text.includes(`&quot;path&quot;:&quot;/${snowflakeId}&quot;`));
    assert.ok(resLegacy.text.includes("modelscript:ide:memfs:artifact-"));
  });

  await t.test("CAE cluster status is exempt from feature flags and returns 200 OK", async () => {
    const res = await request(app).get("/api/v1/cae/cluster/status");
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.backend);
    assert.ok(Array.isArray(res.body.partitions));
  });
});
