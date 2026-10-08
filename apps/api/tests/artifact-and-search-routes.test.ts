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

test("Artifact Viewer, Search Completions, and RDF Metadata REST Routes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-search-test-"));
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

  // Seed sample user and package
  const user = db.createUser("cad_dev", "cad@modelscript.test", "hash_pw", "CAD Developer");
  const { id: pkgId } = db.getOrCreatePackage("MechanicalComponents");

  await t.test("Artifacts: GET /api/v1/artifacts/types returns registered artifact handlers", async () => {
    const res = await request(app).get("/api/v1/artifacts/types");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.types));
    const types = res.body.types.map((t: any) => t.type);
    assert.ok(types.includes("cad"), "Should include CAD artifact handler");
    assert.ok(types.includes("fmu"), "Should include FMU artifact handler");
    assert.ok(types.includes("dataset"), "Should include Dataset artifact handler");
  });

  await t.test("Artifacts: GET /api/v1/cad/convert validates query parameters", async () => {
    const res = await request(app).get("/api/v1/cad/convert");
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test("Artifacts: GET /api/v1/packages/:name/:version/artifacts handles non-existent packages", async () => {
    const res = await request(app).get("/api/v1/packages/NonExistent/1.0.0/artifacts");
    assert.strictEqual(res.status, 404);
  });

  await t.test("Search: GET /api/v1/search/completions returns empty structure on empty query", async () => {
    const res = await request(app).get("/api/v1/search/completions");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { topics: [], users: [], packages: [], repositories: [] });
  });

  await t.test("Search: GET /api/v1/search/completions finds seeded user and package", async () => {
    const res = await request(app).get("/api/v1/search/completions?q=cad");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
    assert.ok(Array.isArray(res.body.packages));
    const foundUser = res.body.users.some((u: any) => u.username === "cad_dev");
    assert.ok(foundUser, "Search should return seeded user");
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf returns 404 for missing package", async () => {
    const res = await request(app).get("/api/v1/libraries/MissingPackage/1.0.0/rdf");
    assert.strictEqual(res.status, 404);
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf serializes Turtle triples", async () => {
    db.db
      .prepare(
        `INSERT INTO classes (library_name, library_version, class_name, class_kind, description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("MechanicalComponents", "1.0.0", "Motor", "model", "DC Electric Motor");

    const res = await request(app).get("/api/v1/libraries/MechanicalComponents/1.0.0/rdf").set("Accept", "text/turtle");

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"].includes("text/turtle"));
    assert.ok(res.text.includes("MechanicalComponents"));
    assert.ok(res.text.includes("Motor"));
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf serializes N-Triples format", async () => {
    const res = await request(app)
      .get("/api/v1/libraries/MechanicalComponents/1.0.0/rdf")
      .set("Accept", "application/n-triples");

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"].includes("application/n-triples"));
    assert.ok(res.text.includes("urn:modelica:MechanicalComponents:1.0.0:Motor"));
  });
});
