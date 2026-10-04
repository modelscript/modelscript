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

test("Package Lifecycle Management & Download Analytics", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-test-"));
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
  const bob = db.createUser("bob", "bob@example.com", "hash", { emailVerified: true });
  const eve = db.createUser("eve", "eve@example.com", "hash", { emailVerified: true });

  const aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);
  const bobToken = jwt.sign({ id: bob.id, username: bob.username }, JWT_SECRET);
  const eveToken = jwt.sign({ id: eve.id, username: eve.username }, JWT_SECRET);

  const pkgName = "SecureEngine";
  const pkgVersion = "1.0.0";
  const zipBuffer = createMockLibraryZip(pkgName, pkgVersion);

  // Publish package as Alice
  await t.test("Alice publishes SecureEngine@1.0.0", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .set("x-test-allow-unscoped", "true")
      .attach("file", zipBuffer, "library.zip")
      .expect(201);

    assert.strictEqual(res.body.processing, "pending");
  });

  await t.test("Unauthorized user (Eve) cannot deprecate SecureEngine", async () => {
    await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}/deprecate`)
      .set("Authorization", `Bearer ${eveToken}`)
      .send({ reason: "I do not like this package" })
      .expect(403);
  });

  await t.test("Alice deprecates SecureEngine@1.0.0 with reason", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}/deprecate`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ reason: "Use SecureEngine 2.x instead" })
      .expect(200);

    assert.strictEqual(res.body.isDeprecated, true);
    assert.strictEqual(res.body.deprecationReason, "Use SecureEngine 2.x instead");

    // Verify GET details reflects deprecation
    const detail = await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}`).expect(200);
    assert.strictEqual(detail.body.isDeprecated, true);
    assert.strictEqual(detail.body.deprecationReason, "Use SecureEngine 2.x instead");
  });

  await t.test("Alice clears deprecation status", async () => {
    const res = await request(app)
      .delete(`/api/v1/libraries/${pkgName}/${pkgVersion}/deprecate`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    assert.strictEqual(res.body.isDeprecated, false);

    const detail = await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}`).expect(200);
    assert.strictEqual(detail.body.isDeprecated, false);
  });

  await t.test("Alice yanks SecureEngine@1.0.0 (tombstone)", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}/yank`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ reason: "Critical vulnerability CVE-2026-9999" })
      .expect(200);

    assert.strictEqual(res.body.isYanked, true);
    assert.strictEqual(res.body.yankReason, "Critical vulnerability CVE-2026-9999");

    // Standard download must be rejected with 410 Gone
    const dlRes = await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}/download`).expect(410);
    assert.strictEqual(dlRes.body.isYanked, true);

    // Download with allowYanked=true succeeds for lockfile reproducibility
    await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}/download?allowYanked=true`).expect(200);
  });

  await t.test("Alice unyanks SecureEngine@1.0.0", async () => {
    const res = await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}/unyank`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(200);

    assert.strictEqual(res.body.isYanked, false);

    // Download succeeds normally
    await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}/download`).expect(200);
  });

  await t.test("Download analytics records download and serves aggregated stats", async () => {
    // Perform several downloads
    await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}/download`).expect(200);
    await request(app).get(`/api/v1/libraries/${pkgName}/${pkgVersion}/download`).expect(200);

    const statsRes = await request(app).get(`/api/v1/libraries/${pkgName}/stats`).expect(200);
    assert.strictEqual(statsRes.body.name, pkgName);
    assert.ok(statsRes.body.totalDownloads >= 3);
    assert.ok(statsRes.body.daily.length > 0);
    assert.strictEqual(statsRes.body.versionBreakdown[pkgVersion], statsRes.body.totalDownloads);
  });

  await t.test("Alice initiates ownership transfer to Bob, and Bob accepts", async () => {
    // 1. Alice creates transfer
    const transferRes = await request(app)
      .post(`/api/v1/libraries/${pkgName}/transfer-ownership`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ targetUsername: "bob" })
      .expect(201);

    const transferId = transferRes.body.transferId;
    assert.ok(transferId);

    // 2. Bob lists pending transfers
    const pendingRes = await request(app)
      .get("/api/v1/libraries/transfers/pending")
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);

    assert.ok(pendingRes.body.transfers.some((t: any) => t.id === transferId));

    // 3. Bob accepts transfer
    await request(app)
      .post(`/api/v1/libraries/transfers/${transferId}/accept`)
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(200);

    // 4. Bob can now deprecate the package, while Alice can no longer manage it
    await request(app)
      .post(`/api/v1/libraries/${pkgName}/${pkgVersion}/deprecate`)
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ reason: "New owner deprecation" })
      .expect(200);

    await request(app)
      .delete(`/api/v1/libraries/${pkgName}/${pkgVersion}/deprecate`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .expect(403);
  });
});
