// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { writeSshWireString } from "../src/services/git-sync/sshsig.js";

function createTestDb(testName: string) {
  const tmpDir = path.resolve(
    "./data/test-" + testName + "-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"),
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, "test.db");
  const db = new LibraryDatabase(dbPath);
  return { db, tmpDir };
}

function generateEd25519TestKey(comment = "test-device@browser") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const rawPubkey = pubDer.subarray(pubDer.length - 32);

  const wireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawPubkey)]);
  const openSsh = `ssh-ed25519 ${wireBytes.toString("base64")} ${comment}`;

  return { privateKey, publicKey, rawPubkey, openSsh };
}

test("GET /api/v1/users/me/signing-keys requires authentication and returns authenticated user keys (not username 'me')", async (t) => {
  const { db, tmpDir } = createTestDb("signing-keys-me");

  t.after(async () => {
    try {
      await new Promise((r) => setTimeout(r, 60));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const app = createApp({ database: db, seedStdlibOnBoot: false, enableWorkers: false });

  // Create a decoy user literally named "me" to verify /me/signing-keys never hits /:username/signing-keys
  const decoyMeUser = db.createUser("me", "me@example.com", "password123");
  const decoyToken = jwt.sign({ id: decoyMeUser.id, username: "me", email: "me@example.com" }, JWT_SECRET);
  const decoyKey = generateEd25519TestKey("decoy@me");

  const decoyChallengeRes = await request(app)
    .get("/api/v1/users/me/signing-challenge")
    .set("Authorization", `Bearer ${decoyToken}`);
  assert.equal(decoyChallengeRes.status, 200);
  const decoySig = crypto
    .sign(null, Buffer.from(decoyChallengeRes.body.challenge, "utf8"), decoyKey.privateKey)
    .toString("base64");
  const decoyRegRes = await request(app)
    .post("/api/v1/users/me/signing-keys")
    .set("Authorization", `Bearer ${decoyToken}`)
    .send({
      publicKeyOpenssh: decoyKey.openSsh,
      label: "Decoy Me Key",
      trustLevel: "hardware_or_cli",
      challenge: decoyChallengeRes.body.challenge,
      signature: decoySig,
    });
  assert.equal(decoyRegRes.status, 201);

  // 1. Unauthenticated request must return 401 (never leak user "me"'s keys)
  const unauthRes = await request(app).get("/api/v1/users/me/signing-keys");
  assert.equal(unauthRes.status, 401);

  // 2. Create real authenticated user "signing_alice"
  const alice = db.createUser("signing_alice", "signing_alice@example.com", "password123");
  const aliceToken = jwt.sign(
    { id: alice.id, username: "signing_alice", email: "signing_alice@example.com" },
    JWT_SECRET,
  );

  // Before registering any keys
  const initialRes = await request(app)
    .get("/api/v1/users/me/signing-keys")
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(initialRes.status, 200);
  assert.equal(initialRes.body.username, "signing_alice");
  assert.equal(initialRes.body.signing_verified, false);
  assert.equal(initialRes.body.signing_policy_strict, false);
  assert.deepEqual(initialRes.body.keys, []);

  // Register a signing key for signing_alice and enable strict signing policy
  const aliceKey = generateEd25519TestKey("signing_alice@workstation");
  const challengeRes = await request(app)
    .get("/api/v1/users/me/signing-challenge")
    .set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(challengeRes.status, 200);
  const challengeSig = crypto
    .sign(null, Buffer.from(challengeRes.body.challenge, "utf8"), aliceKey.privateKey)
    .toString("base64");

  const regRes = await request(app)
    .post("/api/v1/users/me/signing-keys")
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({
      publicKeyOpenssh: aliceKey.openSsh,
      label: "Alice Workstation Key",
      trustLevel: "web_browser",
      challenge: challengeRes.body.challenge,
      signature: challengeSig,
    });
  assert.equal(regRes.status, 201);

  const policyRes = await request(app)
    .put("/api/v1/users/me/signing-policy")
    .set("Authorization", `Bearer ${aliceToken}`)
    .send({ strict: true });
  assert.equal(policyRes.status, 200);

  // 3. Authenticated GET /me/signing-keys returns signing_alice's keys and strict policy (not decoy "me")
  const afterRes = await request(app).get("/api/v1/users/me/signing-keys").set("Authorization", `Bearer ${aliceToken}`);
  assert.equal(afterRes.status, 200);
  assert.equal(afterRes.body.username, "signing_alice");
  assert.equal(afterRes.body.signing_verified, true);
  assert.equal(afterRes.body.signing_policy_strict, true);
  assert.equal(afterRes.body.keys.length, 1);

  const returnedKey = afterRes.body.keys[0];
  assert.equal(returnedKey.id, regRes.body.id);
  assert.equal(returnedKey.user_id, alice.id);
  assert.equal(returnedKey.label, "Alice Workstation Key");
  assert.equal(returnedKey.trust_level, "web_browser");
  assert.equal(returnedKey.fingerprint_sha256, regRes.body.fingerprint_sha256);
  assert.equal(returnedKey.public_key_openssh, regRes.body.public_key_openssh);
  assert.equal(returnedKey.public_key_multibase, regRes.body.public_key_multibase);
  assert.equal(typeof returnedKey.created_at, "string");
  assert.equal(returnedKey.revoked_at, null);

  // 4. Public endpoint /:username/signing-keys still works for signing_alice
  const publicRes = await request(app).get("/api/v1/users/signing_alice/signing-keys");
  assert.equal(publicRes.status, 200);
  assert.equal(publicRes.body.username, "signing_alice");
  assert.equal(publicRes.body.keys.length, 1);
});
