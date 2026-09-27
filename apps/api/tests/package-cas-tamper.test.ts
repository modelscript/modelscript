// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
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
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

function createMockLibraryZip(name: string, version: string, extraContent = ""): Buffer {
  const zip = new AdmZip();
  const packageMo = `
package ${name}
  annotation(version="${version}");
  ${extraContent}
end ${name};
  `.trim();
  zip.addFile("package.mo", Buffer.from(packageMo, "utf-8"));
  return zip.toBuffer();
}

test("Package Content-Addressed Storage (CAS) & Supply Chain Integrity", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-tamper-test-"));
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
      // ignore
    }
  });

  const publisher = db.createUser("oem_vendor", "vendor@oem.test", "hashed_pwd", "OEM Vendor");
  const token = jwt.sign({ id: publisher.id, username: publisher.username }, JWT_SECRET);

  let correctHash = "";
  const zipBuffer = createMockLibraryZip("SecurePump", "1.0.0", "parameter Real pressure=100.0;");
  correctHash = `sha256:${crypto.createHash("sha256").update(zipBuffer).digest("hex")}`;

  await t.test(
    "rejects publish upload when contentHash does not match payload (parameter poisoning detection)",
    async () => {
      const tamperedHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

      const res = await request(app)
        .post("/api/v1/libraries/SecurePump/1.0.0")
        .set("Authorization", `Bearer ${token}`)
        .field("contentHash", tamperedHash)
        .attach("file", zipBuffer, "library.zip");

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes("Content hash mismatch"));
      assert.ok(res.body.error.includes("M3010"));
    },
  );

  await t.test("successfully publishes package when contentHash matches payload and registers release", async () => {
    const res = await request(app)
      .post("/api/v1/libraries/SecurePump/1.0.0")
      .set("Authorization", `Bearer ${token}`)
      .field("contentHash", correctHash)
      .field("signature", "sig-ed25519-valid-key")
      .attach("file", zipBuffer, "library.zip");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.contentHash, correctHash);
    assert.strictEqual(res.body.signature, "sig-ed25519-valid-key");

    // Verify database record
    const release = db.getLibraryRelease("SecurePump", "1.0.0");
    assert.ok(release);
    assert.strictEqual(release.content_hash, correctHash);
    assert.strictEqual(release.signature, "sig-ed25519-valid-key");
    assert.strictEqual(release.published_by, publisher.id);
  });

  await t.test("GET /api/v1/libraries/:name/:version returns verified CAS contentHash and signature", async () => {
    const res = await request(app).get("/api/v1/libraries/SecurePump/1.0.0");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, "SecurePump");
    assert.strictEqual(res.body.version, "1.0.0");
    assert.strictEqual(res.body.contentHash, correctHash);
    assert.strictEqual(res.body.signature, "sig-ed25519-valid-key");
  });

  await t.test("GET /api/v1/libraries/:name/:version/download sets ETag and X-Content-SHA256 headers", async () => {
    const res = await request(app).get("/api/v1/libraries/SecurePump/1.0.0/download");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["x-content-sha256"], correctHash);
    assert.strictEqual(res.headers["etag"], `"${correctHash}"`);
    assert.strictEqual(res.headers["x-package-signature"], "sig-ed25519-valid-key");
  });
});
