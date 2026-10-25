// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { compressEmbedPayload, type UniversalEmbedPayload } from "@modelscript/embed";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";

test("Universal oEmbed Provider Route (/api/v1/oembed)", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oembed-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("Missing url returns 400", async () => {
    const res = await request(app).get("/api/v1/oembed");
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test("Unsupported format returns 501", async () => {
    const res = await request(app).get("/api/v1/oembed?url=https://modelscript.org&format=xml");
    assert.strictEqual(res.status, 501);
  });

  await t.test("Valid compressed Morsel embed URL returns rich oEmbed payload", async () => {
    const payload: UniversalEmbedPayload = {
      v: 1,
      lang: "modelica",
      title: "RLC Transient Circuit",
      code: "model RLC ... end RLC;",
      view: "diagram",
      anchor: { elementId: "R1", kind: "component" },
    };
    const token = compressEmbedPayload(payload);
    const targetUrl = `https://modelscript.org/embed/playground#m=${token}`;

    const res = await request(app)
      .get(`/api/v1/oembed?url=${encodeURIComponent(targetUrl)}&maxwidth=640&maxheight=400`)
      .expect(200);

    assert.strictEqual(res.body.type, "rich");
    assert.strictEqual(res.body.version, "1.0");
    assert.strictEqual(res.body.provider_name, "ModelScript");
    assert.strictEqual(res.body.title, "RLC Transient Circuit (R1)");
    assert.strictEqual(res.body.width, 640);
    assert.strictEqual(res.body.height, 400);
    assert.ok(res.body.html.includes("<iframe"));
    assert.ok(res.body.html.includes(`m=${token}`));
  });

  await t.test("Social post URL returns post title and iframe embed snippet", async () => {
    // Seed a user and post
    const user = db.createUser("engineer_alice", "alice@example.com", "hash", "Alice Engineer");
    const post = db.createPost(user.id, "High-Voltage EMT Inverter Simulation", undefined, undefined);

    const postUrl = `https://modelscript.org/p/${post.id}`;
    const res = await request(app)
      .get(`/api/v1/oembed?url=${encodeURIComponent(postUrl)}`)
      .expect(200);

    assert.strictEqual(res.body.type, "rich");
    assert.strictEqual(res.body.title, "High-Voltage EMT Inverter Simulation");
    assert.strictEqual(res.body.author_name, "engineer_alice");
    assert.ok(res.body.html.includes("<iframe"));
  });

  await t.test("GET /api/v1/social/posts/:id/card returns OpenGraph & Twitter Card HTML", async () => {
    const user = db.createUser("cad_guru", "guru@example.com", "hash");
    const post = db.createPost(user.id, "Planetary Gearbox CAD Model", undefined, undefined);

    const cardRes = await request(app).get(`/api/v1/social/posts/${post.id}/card`).expect(200);

    assert.ok(cardRes.text.includes('<meta property="og:title" content="Planetary Gearbox CAD Model">'));
    assert.ok(cardRes.text.includes('<meta name="twitter:card" content="summary_large_image">'));
    assert.ok(cardRes.text.includes('rel="alternate" type="application/json+oembed"'));

    // Bot crawler request to /posts/:id should redirect to /card
    const botRes = await request(app)
      .get(`/api/v1/social/posts/${post.id}`)
      .set("User-Agent", "Twitterbot/1.0")
      .expect(302);

    assert.strictEqual(botRes.headers.location, `/api/v1/social/posts/${post.id}/card`);
  });
});
