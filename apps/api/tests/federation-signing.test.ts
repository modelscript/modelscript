// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { clearPublicKeyCache, setCachedPublicKey } from "../src/middleware/activitypub.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { encodeMultibase } from "../src/services/git-sync/base58.js";
import { canonicalizeJson } from "../src/services/git-sync/jcs.js";
import { createPostProof } from "../src/services/git-sync/proofs.js";
import { computeSshFingerprint, parseSshPublicKey, writeSshWireString } from "../src/services/git-sync/sshsig.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

test("Phase 6: Federation & W3C Data Integrity Interoperability", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "federation-signing-test-"));
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

  // Local user setup (Alice)
  const alice = db.createUser("alice_crypto", "alice@modelscript.test", "hashed_pwd", {
    emailVerified: true,
  });
  const aliceToken = jwt.sign({ id: alice.id, username: alice.username, email: alice.email }, JWT_SECRET);

  // Generate Alice's Ed25519 user signing keypair
  const { publicKey: aliceEdPub, privateKey: aliceEdPriv } = crypto.generateKeyPairSync("ed25519");
  const aliceSpkiDer = aliceEdPub.export({ type: "spki", format: "der" });
  const aliceRawPub = aliceSpkiDer.subarray(aliceSpkiDer.length - 32);
  const aliceWireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(aliceRawPub)]);
  const aliceOpenSsh = `ssh-ed25519 ${aliceWireBytes.toString("base64")} alice@local`;
  const aliceParsedKey = parseSshPublicKey(aliceOpenSsh);

  // Register Alice's signing key
  const aliceKeyRecord = db.registerSigningKey({
    userId: alice.id,
    publicKeyMultibase: aliceParsedKey.multibase,
    publicKeyOpenssh: aliceParsedKey.openssh,
    fingerprintSha256: aliceParsedKey.fingerprintSha256,
    algo: "ed25519",
    label: "Alice Hardware Key",
  });

  // Remote actor setup (Bob on aerospace.social)
  const { publicKey: bobRsaPub, privateKey: bobRsaPriv } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Bob's Ed25519 user signing key
  const { publicKey: bobEdPub, privateKey: bobEdPriv } = crypto.generateKeyPairSync("ed25519");
  const bobSpkiDer = bobEdPub.export({ type: "spki", format: "der" });
  const bobRawPub = bobSpkiDer.subarray(bobSpkiDer.length - 32);
  const bobMulticodec = Buffer.concat([Buffer.from([0xed, 0x01]), bobRawPub]);
  const bobMultibase = encodeMultibase(bobMulticodec);
  const bobWireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(bobRawPub)]);
  const bobFingerprint = computeSshFingerprint(bobWireBytes);

  const remoteActorUrl = "https://aerospace.social/users/bob_aerodynamics";
  const remoteKeyId = `${remoteActorUrl}#main-key`;
  setCachedPublicKey(remoteKeyId, bobRsaPub);

  t.after(() => {
    clearPublicKeyCache();
  });

  // Helper to send signed ActivityPub POST to inbox
  const sendSignedInboxActivity = async (targetPath: string, activityObj: Record<string, unknown>) => {
    setCachedPublicKey(remoteKeyId, bobRsaPub);
    setCachedPublicKey(remoteActorUrl, bobRsaPub);
    const bodyStr = JSON.stringify(activityObj);
    const date = new Date().toUTCString();
    const digest = "SHA-256=" + crypto.createHash("sha256").update(bodyStr).digest("base64");
    const stringToSign = `(request-target): post ${targetPath}\nhost: hub.modelscript.org\ndate: ${date}\ndigest: ${digest}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(stringToSign);
    const signature = signer.sign(bobRsaPriv, "base64");
    const sigHeader = `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;

    return request(app)
      .post(targetPath)
      .set("Host", "hub.modelscript.org")
      .set("Date", date)
      .set("Digest", digest)
      .set("Signature", sigHeader)
      .set("Content-Type", "application/activity+json")
      .send(bodyStr);
  };

  await t.test(
    "1. Local verified actor exposes active Ed25519 keys in assertionMethod of GET /users/:username",
    async () => {
      const res = await request(app).get(`/users/${alice.username}`).set("Accept", "application/activity+json");

      assert.strictEqual(res.status, 200, `Expected 200: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.signing_verified, true, "Expected signing_verified to be true");
      assert(Array.isArray(res.body.assertionMethod), "Expected assertionMethod array");

      const userKeyAssertion = res.body.assertionMethod.find(
        (m: Record<string, unknown>) => m["id"] === `${res.body.id}#user-key-${aliceKeyRecord.id}`,
      );
      assert(userKeyAssertion, "Expected user-key assertion in assertionMethod");
      assert.strictEqual(userKeyAssertion.type, "Multikey");
      assert.strictEqual(userKeyAssertion.publicKeyMultibase, aliceParsedKey.multibase);
      assert.strictEqual(userKeyAssertion.fingerprintSha256, aliceParsedKey.fingerprintSha256);
    },
  );

  await t.test(
    "2. Outbound Note in outbox attaches FEP-8b32 DataIntegrityProof when signed evidence exists",
    async () => {
      // Create a post for Alice
      const post = db.createPost(alice.id, "Validated CFD grid convergence proof.");

      // Create a cryptographic proof for the post
      const payload = {
        handle: alice.username,
        path: `posts/${post.id}.md`,
        rev: 1,
        contentSha256: crypto.createHash("sha256").update("Validated CFD grid convergence proof.").digest("hex"),
        created: new Date().toISOString(),
      };
      const evidenceDoc = createPostProof(payload, aliceEdPriv, aliceParsedKey);

      db.recordSignedPostEvidence({
        postId: String(post.id),
        rev: 1,
        payloadJson: JSON.stringify(evidenceDoc.payload),
        proofJson: JSON.stringify(evidenceDoc.proof),
        keyId: aliceKeyRecord.id,
      });

      const outboxRes = await request(app)
        .get(`/users/${alice.username}/outbox?page=true`)
        .set("Accept", "application/activity+json");

      assert.strictEqual(outboxRes.status, 200);
      assert(Array.isArray(outboxRes.body.orderedItems), "Expected orderedItems array");

      const outboxItem = outboxRes.body.orderedItems.find(
        (item: any) => item.object?.content === "Validated CFD grid convergence proof.",
      );
      assert(outboxItem, "Expected outbox item to be present");
      assert(
        outboxItem["@context"].includes("https://w3id.org/security/data-integrity/v1"),
        "Context should include data-integrity",
      );

      const note = outboxItem.object;
      assert(note.proof, "Expected proof attached to Note");
      assert.strictEqual(note.proof.type, "DataIntegrityProof");
      assert.strictEqual(note.proof.cryptosuite, "eddsa-jcs-2022");
      assert.strictEqual(note.proof.proofValue, evidenceDoc.proof.proofValue);
      assert(note.proof.signedPayload, "Expected signedPayload attached for recipient verification");
    },
  );

  await t.test("3. Resolving or updating remote actor pins public key (TOFU) and sets signing_verified", async () => {
    // Bob sends an Update activity for his Person profile advertising his Multikey
    const updateActivity = {
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/data-integrity/v1"],
      id: `${remoteActorUrl}/activities/update-1`,
      type: "Update",
      actor: remoteActorUrl,
      object: {
        id: remoteActorUrl,
        type: "Person",
        preferredUsername: "bob_aerodynamics",
        name: "Bob Aerodynamics",
        inbox: `${remoteActorUrl}/inbox`,
        publicKey: {
          id: remoteKeyId,
          owner: remoteActorUrl,
          publicKeyPem: bobRsaPub,
        },
        assertionMethod: [
          {
            id: `${remoteActorUrl}#ed25519-key`,
            type: "Multikey",
            controller: remoteActorUrl,
            publicKeyMultibase: bobMultibase,
          },
        ],
      },
    };

    const res = await sendSignedInboxActivity(`/users/${alice.username}/inbox`, updateActivity);
    assert.strictEqual(res.status, 202);

    const bobUser = db.getUserByActorUrl(remoteActorUrl);
    assert(bobUser, "Expected Bob user to be created");
    assert.strictEqual(bobUser.signing_verified, 1, "Expected Bob to have signing_verified = 1 after TOFU pin");

    const bobKeys = db.getSigningKeysForUser(bobUser.id, false);
    assert.strictEqual(bobKeys.length, 1, "Expected 1 pinned key for Bob");
    assert.strictEqual(bobKeys[0]?.fingerprint_sha256, bobFingerprint);
    assert.strictEqual(bobKeys[0]?.trust_level, "pinned_tofu");

    const keyLog = db.getKeyLogForUser(bobUser.id);
    assert(
      keyLog.some((e) => e.event === "pin_tofu"),
      "Expected pin_tofu event in key log",
    );
  });

  await t.test("4. Inbound remote Note with valid DataIntegrityProof verifies and records post evidence", async () => {
    const inboundNoteId = "https://aerospace.social/posts/note-mach-4";
    const inboundActivityId = "https://aerospace.social/activities/create-mach-4";
    const noteContent = "<p>Mach 4 hypersonic wind tunnel shockwave data verified.</p>";

    // Sign the Note content using Bob's Ed25519 key
    const contentHash = crypto.createHash("sha256").update(noteContent).digest("hex");
    const payload = {
      handle: "bob_aerodynamics",
      path: "posts/note-mach-4.md",
      rev: 1,
      contentSha256: contentHash,
      created: new Date().toISOString(),
    };
    const canonicalPayload = canonicalizeJson(payload);
    const signatureRaw = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), bobEdPriv);
    const proofValue = encodeMultibase(signatureRaw);

    const inboundActivity = {
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/data-integrity/v1"],
      id: inboundActivityId,
      type: "Create",
      actor: remoteActorUrl,
      object: {
        id: inboundNoteId,
        type: "Note",
        attributedTo: remoteActorUrl,
        content: noteContent,
        published: new Date().toISOString(),
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        proof: {
          type: "DataIntegrityProof",
          cryptosuite: "eddsa-jcs-2022",
          created: payload.created,
          verificationMethod: `did:key:${bobMultibase}`,
          proofPurpose: "assertionMethod",
          proofValue,
          signedPayload: payload,
        },
      },
    };

    const res = await sendSignedInboxActivity(`/users/${alice.username}/inbox`, inboundActivity);
    assert.strictEqual(res.status, 202);

    const createdPost = db.getPostByApId(inboundNoteId);
    assert(createdPost, "Expected post to be created in DB");

    // Check evidence was recorded
    const evidence = db.getSignedPostEvidence(String(createdPost.id));
    assert(evidence, "Expected signed_post_evidence to be recorded");
    assert(evidence.proof_json.includes("eddsa-jcs-2022"), "Expected proof_json to contain eddsa-jcs-2022");

    // Check public evidence API endpoint
    const evidenceRes = await request(app).get(`/api/v1/posts/${createdPost.id}/evidence`);
    assert.strictEqual(evidenceRes.status, 200);
    assert.strictEqual(evidenceRes.body.post_id, String(createdPost.id));
    assert.strictEqual(evidenceRes.body.proof.cryptosuite, "eddsa-jcs-2022");
    assert.strictEqual(evidenceRes.body.proof.proofValue, proofValue);
  });

  await t.test(
    "5. Inbound remote Note with tampered content fails verification and does not record evidence",
    async () => {
      const inboundNoteId = "https://aerospace.social/posts/note-tampered-1";
      const inboundActivityId = "https://aerospace.social/activities/create-tampered-1";
      const originalContent = "<p>Original authentic aerodynamic equation.</p>";
      const tamperedContent = "<p>TAMPERED hostile aerodynamic equation injected by middleman!</p>";

      // Sign the original content
      const originalHash = crypto.createHash("sha256").update(originalContent).digest("hex");
      const payload = {
        handle: "bob_aerodynamics",
        path: "posts/note-tampered.md",
        rev: 1,
        contentSha256: originalHash,
        created: new Date().toISOString(),
      };
      const canonicalPayload = canonicalizeJson(payload);
      const signatureRaw = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), bobEdPriv);
      const proofValue = encodeMultibase(signatureRaw);

      // Send the Note with the tampered content
      const inboundActivity = {
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/data-integrity/v1"],
        id: inboundActivityId,
        type: "Create",
        actor: remoteActorUrl,
        object: {
          id: inboundNoteId,
          type: "Note",
          attributedTo: remoteActorUrl,
          content: tamperedContent, // TAMPERED!
          published: new Date().toISOString(),
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          proof: {
            type: "DataIntegrityProof",
            cryptosuite: "eddsa-jcs-2022",
            created: payload.created,
            verificationMethod: `did:key:${bobMultibase}`,
            proofPurpose: "assertionMethod",
            proofValue,
            signedPayload: payload,
          },
        },
      };

      const res = await sendSignedInboxActivity(`/users/${alice.username}/inbox`, inboundActivity);
      assert.strictEqual(res.status, 202);

      const createdPost = db.getPostByApId(inboundNoteId);
      assert(createdPost, "Expected post to still be created in DB");

      // But evidence should NOT be recorded because verification failed!
      const evidence = db.getSignedPostEvidence(String(createdPost.id));
      assert.strictEqual(evidence, null, "Expected NO signed post evidence for tampered post");

      // Public evidence route should return 404
      const evidenceRes = await request(app).get(`/api/v1/posts/${createdPost.id}/evidence`);
      assert.strictEqual(evidenceRes.status, 404);
    },
  );

  await t.test("6. Unannounced remote actor key change triggers alert and revokes verified status", async () => {
    // Generate a new, substitute Ed25519 key for Bob (representing an instance key substitution attack)
    const { publicKey: evilEdPub } = crypto.generateKeyPairSync("ed25519");
    const evilSpkiDer = evilEdPub.export({ type: "spki", format: "der" });
    const evilRawPub = evilSpkiDer.subarray(evilSpkiDer.length - 32);
    const evilMulticodec = Buffer.concat([Buffer.from([0xed, 0x01]), evilRawPub]);
    const evilMultibase = encodeMultibase(evilMulticodec);

    // Send update with substituted key without rotation proof
    const evilUpdateActivity = {
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/data-integrity/v1"],
      id: `${remoteActorUrl}/activities/update-evil-key`,
      type: "Update",
      actor: remoteActorUrl,
      object: {
        id: remoteActorUrl,
        type: "Person",
        preferredUsername: "bob_aerodynamics",
        name: "Bob Aerodynamics (Substituted)",
        inbox: `${remoteActorUrl}/inbox`,
        publicKey: {
          id: remoteKeyId,
          owner: remoteActorUrl,
          publicKeyPem: bobRsaPub,
        },
        assertionMethod: [
          {
            id: `${remoteActorUrl}#ed25519-key`,
            type: "Multikey",
            controller: remoteActorUrl,
            publicKeyMultibase: evilMultibase,
          },
        ],
      },
    };

    const res = await sendSignedInboxActivity(`/users/${alice.username}/inbox`, evilUpdateActivity);
    assert.strictEqual(res.status, 202);

    const bobUser = db.getUserByActorUrl(remoteActorUrl);
    assert(bobUser, "Bob user exists");
    assert.strictEqual(
      bobUser.signing_verified,
      0,
      "signing_verified MUST be revoked (set to 0) upon unannounced key change!",
    );

    const keys = db.getSigningKeysForUser(bobUser.id, true);
    assert(
      keys.some((k) => k.trust_level === "key_changed"),
      "Key trust_level must be downgraded to key_changed",
    );

    const keyLog = db.getKeyLogForUser(bobUser.id);
    assert(
      keyLog.some((e) => e.event === "key_changed_unannounced"),
      "Transparency log must record key_changed_unannounced alert",
    );
  });
});
