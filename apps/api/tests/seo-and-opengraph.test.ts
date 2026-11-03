// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";

test("SEO, OpenGraph Previews, and AI Bot Discoverability Infrastructure", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Seed sample user, post, and package for tests
  const user = db.createUser("elena_vance", "elena@example.com", "hash");
  db.updateProfile(user.id, { display_name: "Elena Vance" });
  const post = db.createPost(
    user.id,
    "Delta Robot Dynamic Trajectory Tracking: Nonlinear multibody dynamics simulation of a 3-DOF parallel delta robot using Modelica 3.4.",
    undefined,
    undefined,
  );

  // Seed a package with a version and a class
  const { id: pkgId } = db.getOrCreatePackage("@robotics/DeltaDynamics");
  db.updatePackageMeta(pkgId, {
    description: "Multibody kinetics and trajectory controllers for parallel robots.",
    license: "BSD-3-Clause",
  });
  db.storePackageVersion(
    pkgId,
    "2.1.0",
    "delta-2.1.0.tgz",
    "abc123shasum",
    null,
    1024,
    JSON.stringify({ name: "@robotics/DeltaDynamics", version: "2.1.0" }),
    null,
    null,
  );
  db.setDistTag(pkgId, "latest", "2.1.0");

  db.storeClassMetadata("@robotics/DeltaDynamics", "2.1.0", {
    className: "DeltaDynamics.Robots.Delta3DOF",
    classKind: "model",
    description: "Kinematic and dynamic model of high-speed delta pick-and-place robot.",
    documentation: "Full mathematical derivation using Lagrange multipliers and loop-closure constraints.",
    iconHash: "icon123",
    diagramHash: "diag123",
    baseClasses: ["Modelica.Mechanics.MultiBody.Interfaces.PartialRobot"],
    components: [
      {
        name: "flange",
        typeName: "Modelica.Mechanics.MultiBody.Interfaces.Flange",
        causality: "connector",
        variability: "continuous",
        description: "Tool center point (TCP) end-effector flange",
        modifiers: [],
      },
      {
        name: "arm_length",
        typeName: "Modelica.Units.SI.Length",
        causality: "internal",
        variability: "parameter",
        description: "Upper bicep arm length",
        modifiers: [],
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Dynamic OpenGraph Preview Images (/api/v1/og/...)
  // ─────────────────────────────────────────────────────────────
  await t.test("GET /api/v1/og/post/:id renders 1200x630 vector SVG card", async () => {
    const res = await request(app).get(`/api/v1/og/post/${post.id}`).expect(200);

    assert.ok(res.headers["content-type"]?.includes("image/svg+xml"));
    const text = res.text || (Buffer.isBuffer(res.body) ? res.body.toString("utf8") : "");
    assert.ok(text.includes('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"'));
    assert.ok(text.includes("Delta Robot Dynamic Trajectory Tracking"));
    assert.ok(text.includes("Elena Vance"));
    assert.ok(text.includes("@elena_vance"));
    assert.ok(text.includes("SUNDIALS CVODE"));
  });

  await t.test("GET /api/v1/og/package/:name renders package metrics card", async () => {
    const res = await request(app).get("/api/v1/og/package/@robotics/DeltaDynamics").expect(200);

    assert.ok(res.headers["content-type"]?.includes("image/svg+xml"));
    const text = res.text || (Buffer.isBuffer(res.body) ? res.body.toString("utf8") : "");
    assert.ok(text.includes("PACKAGE REGISTRY"));
    assert.ok(text.includes("@robotics/DeltaDynamics"));
    assert.ok(text.includes("v2.1.0"));
    assert.ok(text.includes("BSD-3-Clause"));
    assert.ok(text.includes("Indexed Models"));
  });

  await t.test("GET /api/v1/og/class/:pkg/:version/:className renders schematic BDD block card", async () => {
    const res = await request(app)
      .get("/api/v1/og/class/@robotics/DeltaDynamics/2.1.0/DeltaDynamics.Robots.Delta3DOF")
      .expect(200);

    assert.ok(res.headers["content-type"]?.includes("image/svg+xml"));
    const text = res.text || (Buffer.isBuffer(res.body) ? res.body.toString("utf8") : "");
    assert.ok(text.includes("CLASS SPECIFICATION"));
    assert.ok(text.includes("Delta3DOF"));
    assert.ok(text.includes("«model»"));
    assert.ok(text.includes("BLOCK DEFINITION DIAGRAM"));
    assert.ok(text.includes("1 Connectors"));
    assert.ok(text.includes("1 Parameters"));
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Server-Side Head Injection & Social Previews
  // ─────────────────────────────────────────────────────────────
  await t.test("GET /posts/:id injects dynamic OpenGraph, Twitter, and JSON-LD tags into HTML", async () => {
    const res = await request(app).get(`/posts/${post.id}`).set("Accept", "text/html").expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.text.includes("<title>Delta Robot Dynamic Trajectory Tracking | Ansatz</title>"));
    assert.ok(
      res.text.includes(`<meta property="og:title" content="Delta Robot Dynamic Trajectory Tracking | Ansatz" />`),
    );
    assert.ok(
      res.text.includes(`<meta property="og:image" content="https://ansatz.social/api/v1/og/post/${post.id}" />`),
    );
    assert.ok(res.text.includes('<meta name="twitter:card" content="summary_large_image" />'));
    assert.ok(res.text.includes(`<link rel="canonical" href="https://ansatz.social/posts/${post.id}" />`));
    assert.ok(
      res.text.includes(
        `href="https://ansatz.social/api/v1/oembed?url=https%3A%2F%2Fansatz.social%2Fposts%2F${post.id}&amp;format=json"`,
      ),
    );
    assert.ok(res.text.includes(`href="https://ansatz.social/posts/${post.id}.md"`));
    assert.ok(res.text.includes(`"@type":"TechArticle"`));
    assert.ok(res.text.includes(`Elena Vance`));
    // Semantic prerender body for crawlers
    assert.ok(res.text.includes('<div id="seo-prerender">'));
    assert.ok(res.text.includes("Nonlinear multibody dynamics"));
  });

  await t.test("GET /packages/:name/:version/classes/:className injects SoftwareSourceCode & Breadcrumbs", async () => {
    const res = await request(app)
      .get("/packages/@robotics/DeltaDynamics/2.1.0/classes/DeltaDynamics.Robots.Delta3DOF")
      .set("Accept", "text/html")
      .expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.text.includes("DeltaDynamics.Robots.Delta3DOF (model) | @robotics/DeltaDynamics@2.1.0 | Ansatz"));
    assert.ok(
      res.text.includes(
        `https://ansatz.social/api/v1/og/class/@robotics/DeltaDynamics/2.1.0/DeltaDynamics.Robots.Delta3DOF`,
      ),
    );
    assert.ok(res.text.includes(`"@type":"SoftwareSourceCode"`));
    assert.ok(res.text.includes(`"@type":"BreadcrumbList"`));
    assert.ok(res.text.includes("Tool center point (TCP) end-effector flange"));
  });

  // ─────────────────────────────────────────────────────────────
  // 3. AI Bot Content Negotiation & Markdown Mirrors (.md)
  // ─────────────────────────────────────────────────────────────
  await t.test("GET /posts/:id.md returns clean, token-dense Markdown with BibTeX", async () => {
    const res = await request(app).get(`/posts/${post.id}.md`).expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/markdown"));
    assert.ok(res.text.startsWith("---"));
    assert.ok(res.text.includes("# Delta Robot Dynamic Trajectory Tracking"));
    assert.ok(res.text.includes("## Citation (BibTeX)"));
    assert.ok(res.text.includes(`@article{ansatz_post_${post.id},`));
  });

  await t.test("Content-negotiation: GET /posts/:id with Accept: text/markdown returns Markdown", async () => {
    const res = await request(app).get(`/posts/${post.id}`).set("Accept", "text/markdown").expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/markdown"));
    assert.ok(res.text.includes("# Delta Robot Dynamic Trajectory Tracking"));
  });

  await t.test("GET /package/:name/classes/:className.md returns structured engineering spec", async () => {
    const res = await request(app)
      .get("/package/@robotics/DeltaDynamics/classes/DeltaDynamics.Robots.Delta3DOF.md")
      .expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/markdown"));
    assert.ok(res.text.includes("# DeltaDynamics.Robots.Delta3DOF"));
    assert.ok(res.text.includes("## Interface & Connectors"));
    assert.ok(res.text.includes("| `flange` | `Modelica.Mechanics.MultiBody.Interfaces.Flange` | connector |"));
    assert.ok(res.text.includes("## Parameters"));
    assert.ok(res.text.includes("| `arm_length` | `Modelica.Units.SI.Length` | parameter |"));
    assert.ok(res.text.includes("## Execution & Linear DAE Lowering"));
  });

  await t.test("GET /packages/llms.txt serves registry directory following llmstxt.org", async () => {
    const res = await request(app).get("/packages/llms.txt").expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/plain"));
    assert.ok(res.text.includes("# Ansatz Package Registry"));
    assert.ok(res.text.includes("@robotics/DeltaDynamics"));
    assert.ok(res.text.includes("/package/@robotics/DeltaDynamics.md"));
  });

  await t.test("GET /package/:name/llms.txt serves per-package model manifest", async () => {
    const res = await request(app).get("/package/@robotics/DeltaDynamics/llms.txt").expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/plain"));
    assert.ok(res.text.includes("# Package: @robotics/DeltaDynamics"));
    assert.ok(res.text.includes("DeltaDynamics.Robots.Delta3DOF"));
    assert.ok(res.text.includes("«model»"));
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Dynamic XML Sitemaps & robots.txt
  // ─────────────────────────────────────────────────────────────
  await t.test("GET /sitemap.xml returns valid multi-sitemap index", async () => {
    const res = await request(app).get("/sitemap.xml").expect(200);

    assert.ok(res.headers["content-type"]?.includes("application/xml"));
    assert.ok(res.text.includes("<sitemapindex"));
    assert.ok(res.text.includes("/sitemaps/packages.xml"));
    assert.ok(res.text.includes("/sitemaps/classes.xml"));
    assert.ok(res.text.includes("/sitemaps/posts.xml"));
  });

  await t.test("GET /sitemaps/packages.xml and /sitemaps/classes.xml list resources", async () => {
    const pkgRes = await request(app).get("/sitemaps/packages.xml").expect(200);
    assert.ok(pkgRes.text.includes("<urlset"));
    assert.ok(pkgRes.text.includes("@robotics/DeltaDynamics"));

    const clsRes = await request(app).get("/sitemaps/classes.xml").expect(200);
    assert.ok(clsRes.text.includes("<urlset"));
    assert.ok(clsRes.text.includes("DeltaDynamics.Robots.Delta3DOF"));
  });

  await t.test("GET /robots.txt welcomes AI answer engines and references sitemaps & llms.txt", async () => {
    const res = await request(app).get("/robots.txt").expect(200);

    assert.ok(res.headers["content-type"]?.includes("text/plain"));
    assert.ok(res.text.includes("User-agent: GPTBot"));
    assert.ok(res.text.includes("User-agent: PerplexityBot"));
    assert.ok(res.text.includes("User-agent: ClaudeBot"));
    assert.ok(res.text.includes("Sitemap: https://ansatz.social/sitemap.xml"));
    assert.ok(res.text.includes("LLMs-Txt: https://ansatz.social/packages/llms.txt"));
  });
});
