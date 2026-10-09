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

function createMockLibraryZip(name: string, version: string): Buffer {
  const zip = new AdmZip();
  const packageMo = `
package ${name}
  annotation(version="${version}");
  parameter Real param1 = 42.0;
end ${name};
  `.trim();
  zip.addFile("package.mo", Buffer.from(packageMo, "utf-8"));
  zip.addFile(`${name}/package.mo`, Buffer.from(packageMo, "utf-8"));
  return zip.toBuffer();
}

test("Package Unpublish RBAC Security & Cascade Deletion", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unpublish-sec-test-"));
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
      // Ignore cleanup error
    }
  });

  const alice = db.createUser("alice", "alice@example.com", "hash", { emailVerified: true });
  const eve = db.createUser("eve", "eve@example.com", "hash", { emailVerified: true });
  const admin = db.createUser("superadmin", "admin@example.com", "hash", { emailVerified: true, accountType: "admin" });

  const aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);
  const eveToken = jwt.sign({ id: eve.id, username: eve.username }, JWT_SECRET);
  const adminToken = jwt.sign({ id: admin.id, username: admin.username, accountType: "admin" }, JWT_SECRET);

  const pkgName = "SecureMotor";
  const pkgVersion = "1.0.0";
  const zipBuffer = createMockLibraryZip(pkgName, pkgVersion);

  await t.test("Alice publishes SecureMotor@1.0.0", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", zipBuffer, "library.zip");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(storage.exists(pkgName, pkgVersion), true);
    assert.strictEqual(db.getLibraryReleases(pkgName).length, 1);
  });

  await t.test("Unauthorized user (Eve) cannot unpublish SecureMotor (403)", async () => {
    const res = await request(app)
      .delete(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${eveToken}`);

    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes("permission"), "Should return permission error");
    assert.strictEqual(storage.exists(pkgName, pkgVersion), true);
  });

  await t.test("Alice (owner) successfully unpublishes and cascades DB + storage", async () => {
    const res = await request(app)
      .delete(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes("unpublished"));

    // Verify storage file is removed
    assert.strictEqual(storage.exists(pkgName, pkgVersion), false);

    // Verify database cascade
    const releases = db.getLibraryReleases(pkgName);
    assert.strictEqual(releases.length, 0);

    const classes = db.getClasses(pkgName, pkgVersion);
    assert.strictEqual(classes.length, 0);

    const pkg = db.getPackage(pkgName);
    assert.strictEqual(pkg, undefined);
  });

  await t.test("Admin can unpublish any package", async () => {
    // Re-publish by Alice
    const resPub = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", zipBuffer, "library.zip");
    assert.strictEqual(resPub.status, 201);

    // Unpublish by admin
    const resDel = await request(app)
      .delete(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(resDel.status, 200);
    assert.strictEqual(storage.exists(pkgName, pkgVersion), false);
  });
});
