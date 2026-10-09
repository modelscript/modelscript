// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
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
import { LibraryStorage } from "../src/storage.js";

function createValidZip(name: string, version: string): Buffer {
  const zip = new AdmZip();
  const pkgJson = {
    name,
    version,
    description: "Scoped package test",
    author: "Bob Engineer",
  };
  zip.addFile("package.json", Buffer.from(JSON.stringify(pkgJson, null, 2), "utf-8"));
  zip.addFile("model.sysml", Buffer.from("package System {}", "utf-8"));
  return zip.toBuffer();
}

function createMaliciousZipWithEnv(): Buffer {
  const zip = new AdmZip();
  const pkgJson = {
    name: "@bob/leak",
    version: "1.0.0",
    description: "Leaky package",
  };
  zip.addFile("package.json", Buffer.from(JSON.stringify(pkgJson, null, 2), "utf-8"));
  zip.addFile(".env", Buffer.from("DATABASE_URL=postgres://secret@localhost/db\nAPI_KEY=xyz", "utf-8"));
  return zip.toBuffer();
}

function createMaliciousZipWithGit(): Buffer {
  const zip = new AdmZip();
  const pkgJson = {
    name: "@bob/leak-git",
    version: "1.0.0",
  };
  zip.addFile("package.json", Buffer.from(JSON.stringify(pkgJson, null, 2), "utf-8"));
  zip.addFile(".git/HEAD", Buffer.from("ref: refs/heads/main\n", "utf-8"));
  return zip.toBuffer();
}

test("Scoped Package Routes & Ingestion Hardening", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-routes-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const app = createApp({ database: db, storage });

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  const bob = db.createUser("bob", "bob@example.com", "hash", { emailVerified: true });
  const bobToken = jwt.sign({ id: bob.id, username: bob.username }, JWT_SECRET);

  db.createOrganization({ name: "Acme", slug: "acme", createdBy: bob.id });

  const scopedName = "@acme/drone-control";
  const version = "1.0.0";

  await t.test("Rejects package containing sensitive .env credential files", async () => {
    const leakZip = createMaliciousZipWithEnv();
    const res = await request(app)
      .post("/api/v1/libraries/@bob/leak/1.0.0")
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", leakZip, "library.zip");

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /sensitive or secret credential file/i);
  });

  await t.test("Rejects package containing .git repository metadata", async () => {
    const gitZip = createMaliciousZipWithGit();
    const res = await request(app)
      .post("/api/v1/libraries/@bob/leak-git/1.0.0")
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", gitZip, "library.zip");

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /sensitive or secret credential file/i);
  });

  await t.test("Publishes valid scoped package with custom dist-tag", async () => {
    const validZip = createValidZip(scopedName, version);
    const res = await request(app)
      .post(`/api/v1/libraries/${scopedName}/${version}?tag=beta`)
      .set("Authorization", `Bearer ${bobToken}`)
      .attach("file", validZip, "library.zip");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, scopedName);
    assert.strictEqual(res.body.version, version);
    assert.strictEqual(res.body.tag, "beta");

    // Verify dist-tag stored in database
    const pkg = db.getPackage(scopedName);
    assert.ok(pkg);
    const tags = db.getDistTags(pkg.id);
    assert.strictEqual(tags["beta"], version);
  });

  await t.test("GET /api/v1/libraries lists the scoped package correctly", async () => {
    const res = await request(app).get("/api/v1/libraries");
    assert.strictEqual(res.status, 200);
    const pkg = res.body.packages.find((p: { name: string }) => p.name === scopedName);
    assert.ok(pkg, `Expected ${scopedName} in library list`);
    assert.deepStrictEqual(pkg.versions, [version]);
  });

  await t.test("GET /api/v1/libraries/:scope/:name retrieves versions", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, scopedName);
    assert.deepStrictEqual(res.body.versions, [version]);
  });

  await t.test("GET /api/v1/libraries/:scope/:name/:version retrieves release metadata", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}/${version}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, scopedName);
    assert.strictEqual(res.body.version, version);
  });

  await t.test("GET /api/v1/libraries/:scope/:name/:version/download downloads the archive", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}/${version}/download`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "application/zip");
    assert.ok(res.headers["content-disposition"]?.includes("drone-control-1.0.0.zip"));
  });

  await t.test("GET /api/v1/libraries/:scope/:name/:version/manifest resolves projected manifest", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}/${version}/manifest?lens=npm`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, scopedName);
  });

  await t.test("GET /api/v1/libraries/:scope/:name/stats retrieves package download stats", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}/stats`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, scopedName);
    assert.strictEqual(res.body.totalDownloads, 1);
  });

  await t.test("GET /api/v1/libraries/:scope/:name/dependents retrieves package dependents", async () => {
    const res = await request(app).get(`/api/v1/libraries/${scopedName}/dependents`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, scopedName);
    assert.strictEqual(typeof res.body.count, "number");
    assert.ok(Array.isArray(res.body.dependents));
  });
});
