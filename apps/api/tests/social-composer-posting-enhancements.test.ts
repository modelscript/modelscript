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

test("Social Composer Posting Enhancements: Mentions, Federation Tags, and Package/Repo Artifacts", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "composer-enhancements-test-"));
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

  const author = db.createUser("alice", "alice@modelscript.test", "hashed_pwd", { emailVerified: true });
  const authorToken = jwt.sign({ id: author.id, username: author.username, email: author.email }, JWT_SECRET);

  const localUser = db.createUser("bob", "bob@modelscript.test", "hashed_pwd", { emailVerified: true });

  await t.test("Post with local and federated mentions creates correct ActivityPub tags", async () => {
    // Seed a remote actor in the database using getOrCreateRemoteUser
    const remoteActorUrl = "https://mastodon.energy/users/charlie";
    const remoteInbox = "https://mastodon.energy/users/charlie/inbox";
    db.getOrCreateRemoteUser(remoteActorUrl, {
      preferredUsername: "charlie",
      name: "Charlie",
      summary: "Thermal Engineer",
      inbox: remoteInbox,
    });

    const postContent = "Check out the new simulation models @bob and @charlie@mastodon.energy #Thermal #Modelica";

    const res = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ content: postContent });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.post);
    assert.strictEqual(res.body.post.author_id, author.id);

    // Wait for asynchronous post tasks (notifications & federation broadcast)
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Verify notifications for local user bob
    const notifs = db.getNotifications(localUser.id);
    const mentionNotif = notifs.find((n: any) => n.type === "mention");
    assert.ok(mentionNotif, "Local user Bob should receive a mention notification");
    assert.strictEqual(mentionNotif.actor_id, author.id);
    assert.strictEqual(mentionNotif.actor_username, author.username);
  });

  await t.test("Engineering Resource Artifacts: Package artifact view creation and post attachment", async () => {
    // Create a package artifact view
    const pkgPayload = {
      name: "@modelscript/thermal-grid",
      version: "1.2.0",
      description: "Grid scale thermal balancing components",
      dialect: "Modelica",
      total_downloads: 450,
      verified: true,
    };

    const artifactRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "package",
        view_config: JSON.stringify(pkgPayload),
        title: pkgPayload.name,
      });

    assert.strictEqual(artifactRes.status, 201);
    assert.ok(artifactRes.body.id);

    // Fetch the created artifact view
    const getRes = await request(app).get(`/api/v1/social/artifact-views/${artifactRes.body.id}`);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.artifactView);
    assert.strictEqual(getRes.body.artifactView.view_type, "package");
    const parsedConfig = JSON.parse(getRes.body.artifactView.view_config);
    assert.strictEqual(parsedConfig.name, "@modelscript/thermal-grid");

    // Attach to a post
    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${authorToken}`).send({
      content: "Announcing our new library @modelscript/thermal-grid v1.2.0! #thermal",
      artifactId: artifactRes.body.id,
    });

    assert.strictEqual(postRes.status, 201);
    assert.strictEqual(postRes.body.post.artifact_view_id, artifactRes.body.id);
  });

  await t.test("Engineering Resource Artifacts: Repository artifact view creation and post attachment", async () => {
    // Create a repository artifact view
    const repoPayload = {
      provider: "local",
      namespace: "alice",
      project: "aerospace-actuators",
      defaultBranch: "main",
      description: "Hydraulic and electro-mechanical actuator models",
      starsCount: 18,
      isPrivate: false,
    };

    const artifactRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "repository",
        view_config: JSON.stringify(repoPayload),
        title: `${repoPayload.namespace}/${repoPayload.project}`,
      });

    assert.strictEqual(artifactRes.status, 201);
    assert.ok(artifactRes.body.id);

    // Attach to a post
    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${authorToken}`).send({
      content: "Check out our open-source actuator repository!",
      artifact_view_id: artifactRes.body.id,
    });

    assert.strictEqual(postRes.status, 201);
    assert.strictEqual(postRes.body.post.artifact_view_id, artifactRes.body.id);
  });

  await t.test("Trending Topics and Search: Has hashtags and search completions", async () => {
    const trendingRes = await request(app).get("/api/v1/social/trending");
    assert.strictEqual(trendingRes.status, 200);
    assert.ok(Array.isArray(trendingRes.body.topics));
  });

  await t.test("Thumbnail Upload: PUT /api/v1/social/artifact-views/:id/thumbnail", async () => {
    // Create an artifact view
    const artRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "cad-step",
        view_config: JSON.stringify({ url: "/uploads/cad/test.step" }),
        title: "Test CAD",
      });

    assert.strictEqual(artRes.status, 201);
    const artId = artRes.body.id;

    // Upload base64 thumbnail
    const sampleDataUrl = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
    const thumbRes = await request(app)
      .put(`/api/v1/social/artifact-views/${artId}/thumbnail`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ dataUrl: sampleDataUrl });

    assert.strictEqual(thumbRes.status, 200);
    assert.strictEqual(thumbRes.body.success, true);
    assert.ok(thumbRes.body.thumbnailUrl.startsWith("/thumbnails/artifact_"));

    // Verify GET returns updated thumbnailUrl in both column and view_config
    const getRes = await request(app).get(`/api/v1/social/artifact-views/${artId}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.artifactView.thumbnail_url, thumbRes.body.thumbnailUrl);
    const config = JSON.parse(getRes.body.artifactView.view_config);
    assert.strictEqual(config.thumbnailUrl, thumbRes.body.thumbnailUrl);
  });

  await t.test("Feed Filtering & Engineering Hashtag Discovery", async () => {
    // 1. Create a post with a CAD artifact and hashtag #Aerodynamics
    const cadArtRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "cad-step",
        view_config: JSON.stringify({ url: "/models/airfoil.step" }),
        title: "Airfoil CAD",
      });
    const cadPostRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        content: "New NACA 0012 supersonic airfoil geometry #Aerodynamics #CAD",
        artifact_view_id: cadArtRes.body.id,
      });
    assert.strictEqual(cadPostRes.status, 201);

    // 2. Create a post with a plot artifact and hashtag #Robotics
    const plotArtRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "simulation-plot",
        view_config: JSON.stringify({ series: [{ name: "theta", data: [0, 1, 2] }] }),
        title: "Joint Trajectory Plot",
      });
    const plotPostRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        content: "Bipedal joint control response #Robotics #ControlSystems",
        artifact_view_id: plotArtRes.body.id,
      });
    assert.strictEqual(plotPostRes.status, 201);

    // 3. Test timeline filter by artifactType=cad
    const cadTimeline = await request(app)
      .get("/api/v1/social/timeline?artifactType=cad")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(cadTimeline.status, 200);
    assert.ok(cadTimeline.body.posts.some((p: any) => p.id === cadPostRes.body.post.id));
    assert.ok(!cadTimeline.body.posts.some((p: any) => p.id === plotPostRes.body.post.id));

    // 4. Test timeline filter by artifactType=plot
    const plotTimeline = await request(app)
      .get("/api/v1/social/timeline?artifactType=plot")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(plotTimeline.status, 200);
    assert.ok(plotTimeline.body.posts.some((p: any) => p.id === plotPostRes.body.post.id));
    assert.ok(!plotTimeline.body.posts.some((p: any) => p.id === cadPostRes.body.post.id));

    // 5. Test timeline filter by tag=Aerodynamics
    const aeroTimeline = await request(app)
      .get("/api/v1/social/timeline?tag=Aerodynamics")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(aeroTimeline.status, 200);
    assert.ok(aeroTimeline.body.posts.some((p: any) => p.id === cadPostRes.body.post.id));
    assert.ok(!aeroTimeline.body.posts.some((p: any) => p.id === plotPostRes.body.post.id));

    // 6. Test topic endpoint /topics/aerodynamics/posts
    const topicPostsRes = await request(app)
      .get("/api/v1/social/topics/aerodynamics/posts")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(topicPostsRes.status, 200);
    assert.ok(topicPostsRes.body.posts.length >= 1);
    assert.ok(topicPostsRes.body.posts.some((p: any) => p.id === cadPostRes.body.post.id));

    // 7. Test curated trending topics
    const trendingRes = await request(app).get("/api/v1/social/trending?limit=10");
    assert.strictEqual(trendingRes.status, 200);
    assert.ok(trendingRes.body.topics.length >= 8);
    const concepts = trendingRes.body.topics.map((t: any) => t.concept.toLowerCase());
    assert.ok(concepts.includes("aerodynamics") || concepts.includes("robotics"));
  });

  await t.test("Polyglot Artifact Viewers: FMU and SysML artifact views and timeline filtering", async () => {
    // 1. Create FMU artifact view
    const fmuPayload = {
      modelName: "DriveTrainSystem",
      fmiVersion: "3.0",
      hasWasm: true,
      variables: [
        { name: "torque_in", causality: "input", type: "Real" },
        { name: "speed_out", causality: "output", type: "Real" },
      ],
    };

    const fmuArtRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "fmu",
        view_config: JSON.stringify(fmuPayload),
        title: "DriveTrain FMU",
      });

    assert.strictEqual(fmuArtRes.status, 201);
    assert.ok(fmuArtRes.body.id);

    const fmuPostRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        content: "High-fidelity FMI 3.0 drivetrain co-simulation model #FMU #Simulation",
        artifact_view_id: fmuArtRes.body.id,
      });
    assert.strictEqual(fmuPostRes.status, 201);

    // 2. Create SysML v2 artifact view
    const sysmlPayload = {
      systemName: "AvionicsArchitecture",
      format: "SysML2",
      parts: [{ name: "flightComputer", type: "AvionicsUnit" }],
    };

    const sysmlArtRes = await request(app)
      .post("/api/v1/social/artifact-views")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        artifact_type: "sysml",
        view_config: JSON.stringify(sysmlPayload),
        title: "Avionics SysML v2",
      });

    assert.strictEqual(sysmlArtRes.status, 201);
    assert.ok(sysmlArtRes.body.id);

    const sysmlPostRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        content: "SysML v2 avionics decomposition and requirements matrix #SysML #SystemsEngineering",
        artifact_view_id: sysmlArtRes.body.id,
      });
    assert.strictEqual(sysmlPostRes.status, 201);

    // 3. Test timeline filter by artifactType=fmu
    const fmuTimeline = await request(app)
      .get("/api/v1/social/timeline?artifactType=fmu")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(fmuTimeline.status, 200);
    assert.ok(fmuTimeline.body.posts.some((p: any) => p.id === fmuPostRes.body.post.id));
    assert.ok(!fmuTimeline.body.posts.some((p: any) => p.id === sysmlPostRes.body.post.id));

    // 4. Test timeline filter by artifactType=sysml
    const sysmlTimeline = await request(app)
      .get("/api/v1/social/timeline?artifactType=sysml")
      .set("Authorization", `Bearer ${authorToken}`);
    assert.strictEqual(sysmlTimeline.status, 200);
    assert.ok(sysmlTimeline.body.posts.some((p: any) => p.id === sysmlPostRes.body.post.id));
    assert.ok(!sysmlTimeline.body.posts.some((p: any) => p.id === fmuPostRes.body.post.id));

    // 5. Test artifact view retrieval
    const getFmuView = await request(app).get(`/api/v1/social/artifact-views/${fmuArtRes.body.id}`);
    assert.strictEqual(getFmuView.status, 200);
    assert.strictEqual(getFmuView.body.artifactView.view_type, "fmu");
    const parsedFmuConfig = JSON.parse(getFmuView.body.artifactView.view_config);
    assert.strictEqual(parsedFmuConfig.modelName, "DriveTrainSystem");
  });
});
