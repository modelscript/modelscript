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

const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscript-test-uploads-"));
process.env["UPLOAD_TEMP_DIR"] = testUploadDir;

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JobQueue } from "../src/jobs.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { LibraryStorage } from "../src/storage.js";

function createZipWithFiles(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf-8") : content);
  }
  return zip.toBuffer();
}

function generateEd25519Key(): { privateKey: crypto.KeyObject; publicKeySpki: string; publicKeyOpenSsh: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey.export({ type: "spki", format: "pem" }) as string;
  const pubDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rawPubkey = pubDer.subarray(pubDer.length - 32);

  const wirePrefix = Buffer.alloc(15);
  wirePrefix.writeUInt32BE(11, 0);
  wirePrefix.write("ssh-ed25519", 4, 11, "utf8");
  const wireKeyLen = Buffer.alloc(4);
  wireKeyLen.writeUInt32BE(rawPubkey.length, 0);

  const wireBytes = Buffer.concat([wirePrefix, wireKeyLen, rawPubkey]);
  const publicKeyOpenSsh = `ssh-ed25519 ${wireBytes.toString("base64")} key@modelscript.test`;

  return { privateKey, publicKeySpki, publicKeyOpenSsh };
}

test("Package Management Hardening: Ed25519 Signatures, Strict Policy, Typosquatting & Disk Spooling", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hardening-test-"));
  const dbDir = path.join(tmpDir, "db");
  const storageDir = path.join(tmpDir, "storage");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const db = new LibraryDatabase(dbDir);
  const storage = new LibraryStorage(storageDir);
  const jobQueue = new JobQueue();
  const app = createApp({ database: db, storage, jobQueue });

  t.after(() => {
    try {
      jobQueue.clear();
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(testUploadDir, { recursive: true, force: true });
    } catch {}
  });

  // Create testing publisher account
  const alice = db.createUser("alice", "alice@modelscript.test", "hashed_pwd", { emailVerified: true });
  const aliceToken = jwt.sign({ id: alice.id, username: alice.username, email: alice.email }, JWT_SECRET, {
    expiresIn: "1h",
  });

  // Generate Ed25519 keys
  const aliceKey = generateEd25519Key();
  const attackerKey = generateEd25519Key();

  // Register Alice's public key with her account
  db.registerSigningKey({
    userId: alice.id,
    publicKeyOpenssh: aliceKey.publicKeyOpenSsh,
    publicKeyMultibase: "zDummy",
    fingerprintSha256: "SHA256:dummy",
    label: "Alice Main Laptop",
    trustLevel: "hardware_or_cli",
  });

  await t.test("Valid Ed25519 signature verifies successfully on publish", async () => {
    const pkgZip = createZipWithFiles({
      "package.mo": 'package SignedLib\n  annotation(version="1.0.0");\nend SignedLib;\n',
    });

    const sha256 = crypto.createHash("sha256").update(pkgZip).digest("hex");
    const contentHash = `sha256:${sha256}`;

    // Sign the contentHash using Alice's private key
    const sigBytes = crypto.sign(null, Buffer.from(contentHash, "utf8"), aliceKey.privateKey);
    const signature = sigBytes.toString("base64");

    const res = await request(app)
      .post("/api/v1/libraries/@alice/SignedLib/1.0.0")
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", pkgZip, "SignedLib.zip")
      .field("signature", signature)
      .field("contentHash", contentHash)
      .expect(201);

    assert.strictEqual(res.body.name, "@alice/SignedLib");
    assert.strictEqual(res.body.version, "1.0.0");
    assert.strictEqual(res.body.contentHash, contentHash);
    assert.strictEqual(res.body.signature, signature);

    // Verify stored release in database
    const release = db.getLibraryRelease("@alice/SignedLib", "1.0.0");
    assert.ok(release);
    assert.strictEqual(release.content_hash, contentHash);
    assert.strictEqual(release.signature, signature);
  });

  await t.test("Tampered or invalid signature is rejected with HTTP 422 (M3011)", async () => {
    const pkgZip = createZipWithFiles({
      "package.mo": 'package TamperLib\n  annotation(version="1.0.0");\nend TamperLib;\n',
    });

    // Provide invalid signature
    const invalidSignature = Buffer.from("invalid-forged-signature-bytes-not-matching-key").toString("base64");

    const res = await request(app)
      .post("/api/v1/libraries/@alice/TamperLib/1.0.0")
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", pkgZip, "TamperLib.zip")
      .field("signature", invalidSignature)
      .expect(422);

    assert.strictEqual(res.body.code, "M3011");
    assert.ok(res.body.error.includes("signature verification failed"));
  });

  await t.test("Signature signed with unregistered key is rejected even if passed via publicKey", async () => {
    const pkgZip = createZipWithFiles({
      "package.mo": 'package ForeignLib\n  annotation(version="1.0.0");\nend ForeignLib;\n',
    });
    const sha256 = crypto.createHash("sha256").update(pkgZip).digest("hex");
    const contentHash = `sha256:${sha256}`;

    // Attacker signs with their key
    const sigBytes = crypto.sign(null, Buffer.from(contentHash, "utf8"), attackerKey.privateKey);
    const attackerSig = sigBytes.toString("base64");

    const res = await request(app)
      .post("/api/v1/libraries/@alice/ForeignLib/1.0.0")
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", pkgZip, "ForeignLib.zip")
      .field("signature", attackerSig)
      .field("publicKey", attackerKey.publicKeySpki)
      .expect(422);

    assert.strictEqual(res.body.code, "M3011");
    assert.ok(
      res.body.error.includes("not registered to publisher account") ||
        res.body.error.includes("signature verification failed"),
    );
  });

  await t.test("Strict signing policy rejects unsigned releases with HTTP 422 (M3011)", async () => {
    // Enable strict signing policy for Alice
    db.setSigningPolicyStrict(alice.id, true);

    const unsignedZip = createZipWithFiles({
      "package.mo": 'package StrictTestLib\n  annotation(version="1.0.0");\nend StrictTestLib;\n',
    });

    const res = await request(app)
      .post("/api/v1/libraries/@alice/StrictTestLib/1.0.0")
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", unsignedZip, "StrictTestLib.zip")
      .expect(422);

    assert.strictEqual(res.body.code, "M3011");
    assert.ok(res.body.error.includes("Strict signing policy is active"));

    // Reset policy to optional
    db.setSigningPolicyStrict(alice.id, false);
  });

  await t.test("Typosquatting against core protected packages is rejected with HTTP 403 (M2006)", async () => {
    const typosquatNames = [
      "@alice/modelicaa", // Levenshtein distance 1 from 'modelica'
      "@alice/sysmll", // Levenshtein distance 1 from 'sysml'
      "@alice/complexx", // Levenshtein distance 1 from 'complex'
    ];

    for (const typoName of typosquatNames) {
      const baseName = typoName.split("/")[1]!;
      const typoZip = createZipWithFiles({
        "package.mo": `package ${baseName}\n  annotation(version="1.0.0");\nend ${baseName};\n`,
      });

      const res = await request(app)
        .post(`/api/v1/libraries/${typoName}/1.0.0`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .attach("file", typoZip, "archive.zip")
        .expect(403);

      assert.strictEqual(res.body.code, "M2006");
      assert.ok(res.body.error.includes("Typosquatting defense is active"));
    }
  });

  await t.test("Multer disk spooling cleans up temporary files after upload", async () => {
    // Verify no upload files are left behind in testUploadDir
    const filesBefore = fs.readdirSync(testUploadDir);

    const testZip = createZipWithFiles({
      "package.mo": 'package CleanupTestLib\n  annotation(version="1.0.0");\nend CleanupTestLib;\n',
    });

    await request(app)
      .post("/api/v1/libraries/@alice/CleanupTestLib/1.0.0")
      .set("Authorization", `Bearer ${aliceToken}`)
      .attach("file", testZip, "CleanupTestLib.zip")
      .expect(201);

    const filesAfter = fs.readdirSync(testUploadDir);
    assert.strictEqual(filesAfter.length, filesBefore.length);
  });
});
