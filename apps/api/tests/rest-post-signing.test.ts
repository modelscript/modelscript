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
import { encodeMultibase } from "../src/services/git-sync/base58.js";
import { canonicalizeJson } from "../src/services/git-sync/jcs.js";
import { writeSshWireString } from "../src/services/git-sync/sshsig.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function createTestDb(testName: string) {
  const tmpDir = path.resolve("./data/test-" + testName + "-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, "test.db");
  const db = new LibraryDatabase(dbPath);
  return { db, tmpDir };
}

function generateEd25519TestKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const rawPubkey = pubDer.subarray(pubDer.length - 32);

  const wireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawPubkey)]);
  const openSsh = `ssh-ed25519 ${wireBytes.toString("base64")} test-device@browser`;

  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(rawPubkey, 2);
  const multibase = encodeMultibase(multicodec);

  return { privateKey, publicKey, rawPubkey, openSsh, multibase };
}

function createClientProof(content: string, createdAt: string, privateKey: crypto.KeyObject, multibase: string) {
  const payload = {
    content,
    created_at: createdAt,
  };
  const proofConfig = {
    type: "DataIntegrityProof" as const,
    cryptosuite: "eddsa-jcs-2022" as const,
    created: createdAt,
    verificationMethod: `did:key:${multibase}#${multibase}`,
    proofPurpose: "assertionMethod" as const,
  };

  const canonicalPayload = canonicalizeJson(payload);
  const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();
  const canonicalConfig = canonicalizeJson(proofConfig);
  const configHash = crypto.createHash("sha256").update(canonicalConfig, "utf8").digest();

  const signingData = Buffer.concat([configHash, payloadHash]);
  const sig = crypto.sign(null, signingData, privateKey);
  const proofValue = encodeMultibase(sig);

  return {
    proof: {
      ...proofConfig,
      proofValue,
    },
    payload,
  };
}

test("REST API In-Browser Device Signing & Verification", async (t) => {
  const { db, tmpDir } = createTestDb("rest-signing");

  t.after(async () => {
    try {
      await new Promise((r) => setTimeout(r, 60));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const app = createApp({ database: db, seedStdlibOnBoot: false, enableWorkers: false });

  // 1. Create a test user
  const user = db.createUser("carol", "carol@example.com", "password123");
  assert.ok(user.id);
  const userInitial = db.getUserById(user.id);
  assert.equal(userInitial?.signing_verified, 0);

  // Authenticate user
  const token = jwt.sign({ id: user.id, username: "carol", email: "carol@example.com" }, JWT_SECRET);

  // 2. Generate and register an Ed25519 Web Browser Device Key
  const keyPair = generateEd25519TestKey();

  const challengeRes = await request(app)
    .get("/api/v1/users/me/signing-challenge")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(challengeRes.status, 200);
  const challenge = challengeRes.body.challenge;

  const challengeSig = crypto.sign(null, Buffer.from(challenge, "utf8"), keyPair.privateKey).toString("base64");

  const regRes = await request(app).post("/api/v1/users/me/signing-keys").set("Authorization", `Bearer ${token}`).send({
    publicKeyOpenssh: keyPair.openSsh,
    label: "Chrome Device Key",
    trustLevel: "web_browser",
    challenge,
    signature: challengeSig,
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.body.trust_level, "web_browser");

  // Check user is now verified
  const userAfter = db.getUserById(user.id);
  assert.equal(userAfter?.signing_verified, 1);

  await t.test("1. Create post with valid W3C Data Integrity proof", async () => {
    const content = "Testing automated ComposeBox device signing via REST! #modelscript";
    const createdAt = new Date().toISOString();
    const { proof, payload } = createClientProof(content, createdAt, keyPair.privateKey, keyPair.multibase);

    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content,
      proof,
      proof_payload: payload,
    });

    assert.equal(postRes.status, 201);
    const createdPost = postRes.body.post;
    assert.ok(createdPost.id);
    assert.equal(createdPost.content, content);
    assert.ok(createdPost.metadata?.proof);
    assert.equal(createdPost.metadata.proof.cryptosuite, "eddsa-jcs-2022");

    // Verify database recorded evidence
    const evidence = db.getSignedPostEvidence(String(createdPost.id));
    assert.ok(evidence);
    assert.equal(evidence.key_id, regRes.body.id);
    const storedProof = JSON.parse(evidence.proof_json);
    assert.equal(storedProof.proofValue, proof.proofValue);
  });

  await t.test("2. Create post with tampered proof fails verification", async () => {
    const content = "Original content";
    const createdAt = new Date().toISOString();
    const { proof, payload } = createClientProof(content, createdAt, keyPair.privateKey, keyPair.multibase);

    // Tamper with post content submitted to REST
    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content: "Tampered content that does not match cryptographic signature!",
      proof,
      proof_payload: payload,
    });

    assert.equal(postRes.status, 400);
    assert.match(postRes.body.error, /verification failed/i);
  });

  await t.test("3. Strict signing policy rejects unsigned post and accepts signed post", async () => {
    // Enable strict signing policy
    db.setSigningPolicyStrict(user.id, true);

    // Try posting without proof or signature -> Rejected
    const unsignedRes = await request(app)
      .post("/api/v1/social/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Unsigned post attempt under strict policy" });

    assert.equal(unsignedRes.status, 400);
    assert.match(unsignedRes.body.error, /Strict signing policy enabled/i);

    // Try posting with valid proof -> Accepted
    const content = "Valid signed post under strict policy";
    const createdAt = new Date().toISOString();
    const { proof, payload } = createClientProof(content, createdAt, keyPair.privateKey, keyPair.multibase);

    const signedRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content,
      proof,
      proof_payload: payload,
    });

    assert.equal(signedRes.status, 201);
    assert.ok(signedRes.body.post.id);
  });

  await t.test("4. Context binding rejects mismatched reply_to_id and artifact_id", async () => {
    const content = "Context bound post";
    const createdAt = new Date().toISOString();
    // Proof binds reply_to_id: "99"
    const payload = {
      content,
      created_at: createdAt,
      reply_to_id: "99",
      artifact_id: "42",
    };
    const proofConfig = {
      type: "DataIntegrityProof" as const,
      cryptosuite: "eddsa-jcs-2022" as const,
      created: createdAt,
      verificationMethod: `did:key:${keyPair.multibase}#${keyPair.multibase}`,
      proofPurpose: "assertionMethod" as const,
    };
    const canonicalPayload = canonicalizeJson(payload);
    const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();
    const canonicalConfig = canonicalizeJson(proofConfig);
    const configHash = crypto.createHash("sha256").update(canonicalConfig, "utf8").digest();
    const sig = crypto.sign(null, Buffer.concat([configHash, payloadHash]), keyPair.privateKey);
    const proof = { ...proofConfig, proofValue: encodeMultibase(sig) };

    // Submitting with wrong reply_to_id -> Rejected
    const mismatchRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content,
      proof,
      proof_payload: payload,
      reply_to_id: 100, // mismatch from 99
    });

    assert.equal(mismatchRes.status, 400);
    assert.match(mismatchRes.body.error, /reply_to_id does not match/i);
  });

  await t.test("5. Master Key Delegation Attestation", async () => {
    // 1. Generate master key
    const masterKeyPair = generateEd25519TestKey();

    // 2. Register master key
    const chalRes = await request(app)
      .get("/api/v1/users/me/signing-challenge")
      .set("Authorization", `Bearer ${token}`);
    const challenge = chalRes.body.challenge;
    const masterPoPSig = crypto.sign(null, Buffer.from(challenge, "utf8"), masterKeyPair.privateKey).toString("base64");

    const masterRegRes = await request(app)
      .post("/api/v1/users/me/signing-keys")
      .set("Authorization", `Bearer ${token}`)
      .send({
        publicKeyOpenssh: masterKeyPair.openSsh,
        label: "Master Hardware YubiKey",
        trustLevel: "hardware_or_cli",
        challenge,
        signature: masterPoPSig,
      });

    assert.equal(masterRegRes.status, 201);
    const masterKeyId = masterRegRes.body.id;

    // 3. Get delegation statement for device key
    const stmtRes = await request(app)
      .get(`/api/v1/users/me/signing-keys/${regRes.body.id}/delegation-statement?masterKeyId=${masterKeyId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(stmtRes.status, 200);
    const statement = stmtRes.body.statement;
    assert.match(statement, /^delegate:/);

    // 4. Master key signs delegation statement
    const delSig = crypto.sign(null, Buffer.from(statement, "utf8"), masterKeyPair.privateKey).toString("base64");

    // 5. Submit delegation
    const delRes = await request(app)
      .post(`/api/v1/users/me/signing-keys/${regRes.body.id}/delegate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        masterKeyId,
        signature: delSig,
      });

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.key.trust_level, "delegated_by_master");
    assert.equal(delRes.body.key.prev_key_id, masterKeyId);

    // 6. Verify transparency log records delegation event
    const logRes = await request(app).get(`/api/v1/users/${user.username}/signing-keys/log`);
    assert.equal(logRes.status, 200);
    assert.ok(logRes.body.chain_valid);
    const events = logRes.body.log.map((e: any) => e.event);
    assert.ok(events.includes("delegate_device"));
  });

  await t.test("6. Clock drift enforcement rejects outdated or future-dated proofs", async () => {
    // 30 minutes in past
    const pastTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { proof: pastProof, payload: pastPayload } = createClientProof(
      "Old post replay",
      pastTime,
      keyPair.privateKey,
      keyPair.multibase,
    );

    const pastRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content: "Old post replay",
      proof: pastProof,
      proof_payload: pastPayload,
    });

    assert.equal(pastRes.status, 400);
    assert.match(pastRes.body.error, /clock drift window/i);
  });

  await t.test("7. Post edit re-signing and unverified mutation protection", async () => {
    // Ensure strict policy is disabled initially for non-strict test
    db.setSigningPolicyStrict(user.id, false);

    // 1. Create a signed post
    const origContent = "Original authentic post content";
    const origTime = new Date().toISOString();
    const { proof: origProof, payload: origPayload } = createClientProof(
      origContent,
      origTime,
      keyPair.privateKey,
      keyPair.multibase,
    );

    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content: origContent,
      proof: origProof,
      proof_payload: origPayload,
    });
    assert.equal(postRes.status, 201);
    const postId = postRes.body.post.id;

    // Check initial evidence is rev 1
    const ev1 = db.getSignedPostEvidence(String(postId));
    assert.ok(ev1);
    assert.equal(ev1.rev, 1);

    // 2. Edit post with a valid new cryptographic proof
    const updatedContent = "Updated and re-signed content";
    const updateTime = new Date().toISOString();
    const { proof: updateProof, payload: updatePayload } = createClientProof(
      updatedContent,
      updateTime,
      keyPair.privateKey,
      keyPair.multibase,
    );

    const editRes = await request(app)
      .patch(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        content: updatedContent,
        proof: updateProof,
        proof_payload: updatePayload,
      });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.post.content, updatedContent);
    assert.equal(editRes.body.post.metadata?.signature_rev, 2);

    // Verify rev 2 recorded in signed_post_evidence
    const ev2 = db.getSignedPostEvidence(String(postId), 2);
    assert.ok(ev2);
    assert.equal(ev2.rev, 2);

    // 3. Edit post WITHOUT proof -> signatures stripped & marked unverified
    const unsignedEditRes = await request(app)
      .patch(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        content: "Stealth edit attempt without cryptographic signature",
      });
    assert.equal(unsignedEditRes.status, 200);
    assert.equal(unsignedEditRes.body.post.metadata?.edited_unverified, true);
    assert.equal(unsignedEditRes.body.post.metadata?.signature_invalidated, true);
    assert.equal(unsignedEditRes.body.post.metadata?.proof, undefined);

    // 4. Test strict signing policy blocks unsigned edits
    await request(app)
      .put("/api/v1/users/me/signing-policy")
      .set("Authorization", `Bearer ${token}`)
      .send({ strict: true });

    const blockedEditRes = await request(app)
      .patch(`/api/v1/social/posts/${postId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        content: "Another edit attempt under strict policy",
      });
    assert.equal(blockedEditRes.status, 400);
    assert.match(blockedEditRes.body.error, /Strict signing policy enabled/i);

    // Revert strict policy
    await request(app)
      .put("/api/v1/users/me/signing-policy")
      .set("Authorization", `Bearer ${token}`)
      .send({ strict: false });
  });

  await t.test("8. GDPR Deletion Cascade removes signed_post_evidence", async () => {
    const postContent = "Ephemeral content to be deleted";
    const postTime = new Date().toISOString();
    const { proof, payload } = createClientProof(postContent, postTime, keyPair.privateKey, keyPair.multibase);

    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content: postContent,
      proof,
      proof_payload: payload,
    });
    assert.equal(postRes.status, 201);
    const postId = postRes.body.post.id;

    // Verify evidence exists before delete
    assert.ok(db.getSignedPostEvidence(String(postId)));

    // Delete post
    const delRes = await request(app).delete(`/api/v1/social/posts/${postId}`).set("Authorization", `Bearer ${token}`);
    assert.equal(delRes.status, 200);

    // Verify evidence was cascade deleted from signed_post_evidence
    assert.equal(db.getSignedPostEvidence(String(postId)), null);

    // Public evidence route returns 404
    const evRes = await request(app).get(`/api/v1/posts/${postId}/evidence`);
    assert.equal(evRes.status, 404);
  });

  await t.test("9. Banned keys cannot sign posts", async () => {
    // Ban the key by its fingerprint
    db.banSigningKey(regRes.body.fingerprint_sha256, "Key compromised in test");

    const content = "Post from banned key";
    const postTime = new Date().toISOString();
    const { proof, payload } = createClientProof(content, postTime, keyPair.privateKey, keyPair.multibase);

    const postRes = await request(app).post("/api/v1/social/posts").set("Authorization", `Bearer ${token}`).send({
      content,
      proof,
      proof_payload: payload,
    });

    assert.equal(postRes.status, 400);
    assert.match(postRes.body.error, /banned/i);
  });

  await t.test("10. Anti-Squatting: Owner with PoP reclaims unverified pasted key", async () => {
    // Generate new key
    const victimKey = generateEd25519TestKey();

    // Create a second attacker user
    const attacker = db.createUser("attacker", "attacker@example.com", "password123");
    const attackerToken = jwt.sign(
      { id: attacker.id, username: "attacker", email: "attacker@example.com" },
      JWT_SECRET,
    );

    // Attacker pastes victim's public key without PoP
    const attackRegRes = await request(app)
      .post("/api/v1/users/me/signing-keys")
      .set("Authorization", `Bearer ${attackerToken}`)
      .send({
        publicKeyOpenssh: victimKey.openSsh,
        label: "Squatted Key",
      });
    assert.equal(attackRegRes.status, 201);
    assert.equal(attackRegRes.body.trust_level, "unverified_paste");

    // Victim registers with valid Proof of Possession
    const chalRes = await request(app)
      .get("/api/v1/users/me/signing-challenge")
      .set("Authorization", `Bearer ${token}`);
    const challenge = chalRes.body.challenge;
    const popSig = crypto.sign(null, Buffer.from(challenge, "utf8"), victimKey.privateKey).toString("base64");

    const reclaimRes = await request(app)
      .post("/api/v1/users/me/signing-keys")
      .set("Authorization", `Bearer ${token}`)
      .send({
        publicKeyOpenssh: victimKey.openSsh,
        label: "Legitimate Owner Key",
        challenge,
        signature: popSig,
      });

    assert.equal(reclaimRes.status, 201);
    assert.equal(reclaimRes.body.trust_level, "hardware_or_cli");

    // Check key was transferred to legitimate owner
    const reclaimedKey = db.getSigningKeyById(attackRegRes.body.id);
    assert.equal(reclaimedKey?.user_id, user.id);
    assert.equal(reclaimedKey?.trust_level, "hardware_or_cli");

    // Check attacker's transparency log recorded revocation
    const attackerLog = db.getKeyLogForUser(attacker.id);
    assert.ok(attackerLog.some((e) => e.event === "revoke"));
  });
});
