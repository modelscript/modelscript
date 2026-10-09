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
import { clearPublicKeyCache, setCachedPublicKey } from "../src/middleware/activitypub.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("W3C Social Protocols UX/UI Maturity Integration Tests", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-fed-ux-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // Local user setup
  const localUser = db.createUser("alice_engineer", "alice@modelscript.test", "hashed_pwd", {
    emailVerified: true,
  });
  const aliceToken = jwt.sign({ id: localUser.id, username: localUser.username, email: localUser.email }, JWT_SECRET);

  // Remote keypair generation
  const { publicKey: remoteRsaPub, privateKey: remoteRsaPriv } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const remoteActorUrl = "https://aerospace.social/users/bob_rocketry";
  const remoteKeyId = `${remoteActorUrl}#main-key`;
  setCachedPublicKey(remoteKeyId, remoteRsaPub);

  t.after(() => {
    clearPublicKeyCache();
  });

  await t.test("Post creation with content_warning stores metadata and reflects in GET /posts", async () => {
    const res = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${aliceToken}`).send({
      content: "Here is the new thruster design equation for hypergolic propellant.",
      content_warning: "Spoiler: Classified nozzle geometry",
    });

    assert.strictEqual(res.status, 201, `Failed to create post: ${JSON.stringify(res.body)}`);
    assert(res.body.post, "Expected post in response");
    assert.strictEqual(res.body.post.metadata?.contentWarning, "Spoiler: Classified nozzle geometry");

    // Fetch individual post
    const getRes = await request(app)
      .get(`/api/v1/social/posts/${res.body.post.id}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.post.metadata?.contentWarning, "Spoiler: Classified nozzle geometry");
  });

  await t.test("Outbox endpoint serializes summary in ActivityStreams Note object", async () => {
    const outboxRes = await request(app)
      .get(`/users/${localUser.username}/outbox?page=true`)
      .set("Accept", "application/activity+json");

    assert.strictEqual(outboxRes.status, 200);
    assert(Array.isArray(outboxRes.body.orderedItems), "Expected orderedItems array");

    const itemWithCw = outboxRes.body.orderedItems.find(
      (item: any) => item.object?.summary === "Spoiler: Classified nozzle geometry",
    );
    assert(itemWithCw, "Expected outbox item to have summary matching content_warning");
    assert.strictEqual(itemWithCw.object.summary, "Spoiler: Classified nozzle geometry");
  });

  await t.test("Inbound Create(Note) with summary stores contentWarning in post metadata", async () => {
    const inboundNoteId = "https://aerospace.social/posts/note-998877";
    const inboundActivityId = "https://aerospace.social/activities/create-998877";
    const bodyStr = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: inboundActivityId,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: inboundNoteId,
        type: "Note",
        attributedTo: remoteActorUrl,
        summary: "CAD Analysis Spoiler",
        content: "<p>Check out our latest FEA stress simulation results.</p>",
        published: new Date().toISOString(),
        to: ["https://www.w3.org/ns/activitystreams#Public"],
      },
    });

    const date = new Date().toUTCString();
    const digest = "SHA-256=" + crypto.createHash("sha256").update(bodyStr).digest("base64");
    const targetPath = `/users/${localUser.username}/inbox`;
    const stringToSign = `(request-target): post ${targetPath}\nhost: hub.modelscript.org\ndate: ${date}\ndigest: ${digest}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(stringToSign);
    const signature = signer.sign(remoteRsaPriv, "base64");
    const sigHeader = `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;

    const inboxRes = await request(app)
      .post(targetPath)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Digest", digest)
      .set("Signature", sigHeader)
      .set("Content-Type", "application/activity+json")
      .send(bodyStr);

    assert.strictEqual(inboxRes.status, 202, `Inbox delivery failed: ${JSON.stringify(inboxRes.body)}`);

    // Verify the remote post was ingested into database with contentWarning
    const posts = db.getFederatedTimeline(localUser.id, 50, 0);
    const ingestedPost = posts.find((p: any) => p.ap_id === inboundNoteId);
    assert(ingestedPost, "Expected remote post to be ingested into local database");
    assert.strictEqual(
      ingestedPost.metadata?.contentWarning,
      "CAD Analysis Spoiler",
      "Expected metadata.contentWarning to match incoming note summary",
    );
  });

  await t.test("GET /api/v1/social/timeline/federated returns fediverse posts and filters correctly", async () => {
    // 1. Query federated timeline unauthenticated
    const fedRes = await request(app).get("/api/v1/social/timeline/federated");
    assert.strictEqual(fedRes.status, 200);
    assert(Array.isArray(fedRes.body.posts), "Expected posts array");

    // Must contain the remote post we ingested from aerospace.social
    const hasRemotePost = fedRes.body.posts.some((p: any) => p.ap_id === "https://aerospace.social/posts/note-998877");
    assert(hasRemotePost, "Expected federated timeline to include remote Fediverse post");

    // All posts in federated timeline must either have remote account_type, ap_id, or handle with '@'
    for (const post of fedRes.body.posts) {
      const isRemoteOrFederated =
        post.account_type === "remote" || (post.ap_id && post.ap_id.startsWith("http")) || post.username.includes("@");
      assert(
        isRemoteOrFederated,
        `Post ${post.id} by ${post.username} should have federated indicator in federated timeline`,
      );
    }
  });

  await t.test(
    "Engineering event notifications (simulation_completed, package_published, security_alert, credit_warning) can be created and retrieved",
    async () => {
      // Dispatch engineering event notifications
      db.createNotification(localUser.id, localUser.id, "simulation_completed");
      db.createNotification(localUser.id, localUser.id, "package_published");
      db.createNotification(localUser.id, localUser.id, "security_alert");
      db.createNotification(localUser.id, localUser.id, "credit_warning");

      const notifRes = await request(app)
        .get("/api/v1/social/notifications")
        .set("Authorization", `Bearer ${aliceToken}`);

      assert.strictEqual(notifRes.status, 200);
      assert(Array.isArray(notifRes.body.notifications), "Expected notifications array");

      const types = notifRes.body.notifications.map((n: any) => n.type);
      assert(types.includes("simulation_completed"), "Expected simulation_completed notification");
      assert(types.includes("package_published"), "Expected package_published notification");
      assert(types.includes("security_alert"), "Expected security_alert notification");
      assert(types.includes("credit_warning"), "Expected credit_warning notification");
    },
  );
});
