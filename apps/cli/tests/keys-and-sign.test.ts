// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import {
  createPostProof,
  generateEd25519KeyPair,
  parseSshPublicKey,
  signChallengePoP,
  verifyPostProof,
} from "../src/util/signing.js";

const TEST_DIR = path.join(process.cwd(), "apps/cli/tests/scratch_keys_test");

describe("msx keys and sign cryptographic operations and CLI utilities", () => {
  let server: http.Server;
  let serverUrl: string;
  let registeredKeys: Array<{
    id: number;
    fingerprint_sha256: string;
    public_key_openssh: string;
    label: string;
    algo: string;
    trust_level: string;
    created_at: string;
  }> = [];
  let isStrict = false;

  before(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });

    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");

      // GET /api/v1/auth/me
      if (url.pathname === "/api/v1/auth/me") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            user: {
              id: 42,
              username: "alice",
              email: "alice@example.com",
            },
          }),
        );
        return;
      }

      // GET /api/v1/users/me/signing-challenge
      if (url.pathname === "/api/v1/users/me/signing-challenge") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            challengeId: "chal_test_12345",
            challengeText: "ModelScript PoP Challenge for alice at 2026-11-05T12:00:00Z",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }),
        );
        return;
      }

      // POST /api/v1/users/me/signing-keys
      if (url.pathname === "/api/v1/users/me/signing-keys" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          const parsedPk = parseSshPublicKey(parsed.publicKeyOpenSsh);
          const newKey = {
            id: registeredKeys.length + 1,
            fingerprint_sha256: parsedPk.fingerprintSha256,
            public_key_openssh: parsedPk.openssh,
            label: parsed.label || "Ed25519 Signing Key",
            algo: "ed25519",
            trust_level: "tofu",
            created_at: new Date().toISOString(),
          };
          registeredKeys.push(newKey);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              key: newKey,
              signing_verified: true,
            }),
          );
        });
        return;
      }

      // GET /api/v1/users/alice/signing-keys
      if (url.pathname.endsWith("/signing-keys") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            username: "alice",
            signing_verified: registeredKeys.length > 0,
            signing_policy_strict: isStrict,
            keys: registeredKeys,
          }),
        );
        return;
      }

      // POST /api/v1/users/me/signing-keys/:id/revoke
      if (url.pathname.includes("/signing-keys/") && url.pathname.endsWith("/revoke")) {
        const parts = url.pathname.split("/");
        const id = Number.parseInt(parts[parts.length - 2]!, 10);
        registeredKeys = registeredKeys.filter((k) => k.id !== id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, remaining: registeredKeys.length }));
        return;
      }

      // PUT /api/v1/users/me/signing-policy
      if (url.pathname === "/api/v1/users/me/signing-policy" && req.method === "PUT") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          isStrict = Boolean(parsed.strict);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, strict: isStrict }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("generateEd25519KeyPair produces valid OpenSSH public key and SHA-256 fingerprint", () => {
    const keyPair = generateEd25519KeyPair("test-key");
    assert.ok(keyPair.privateKeyPem.includes("BEGIN PRIVATE KEY"));
    assert.ok(keyPair.publicKeyOpenSsh.startsWith("ssh-ed25519 "));
    assert.ok(keyPair.publicKeyOpenSsh.endsWith(" test-key"));
    assert.ok(keyPair.fingerprintSha256.startsWith("SHA256:"));

    const parsed = parseSshPublicKey(keyPair.publicKeyOpenSsh);
    assert.equal(parsed.algo, "ed25519");
    assert.equal(parsed.rawPubkey.length, 32);
    assert.equal(parsed.fingerprintSha256, keyPair.fingerprintSha256);
    assert.ok(parsed.multibase.startsWith("z"));
  });

  test("signChallengePoP produces a valid signature verifiable with public key", () => {
    const keyPair = generateEd25519KeyPair();
    const challenge = "ModelScript PoP Challenge for alice";
    const sigBase64 = signChallengePoP(challenge, keyPair.privateKeyPem);

    const parsed = parseSshPublicKey(keyPair.publicKeyOpenSsh);
    const spkiDer = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), parsed.rawPubkey]);
    const pubKeyObj = crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });

    const verified = crypto.verify(null, Buffer.from(challenge, "utf8"), pubKeyObj, Buffer.from(sigBase64, "base64"));
    assert.equal(verified, true);
  });

  test("createPostProof and verifyPostProof correctly sign and verify markdown post content", () => {
    const keyPair = generateEd25519KeyPair();
    const postId = "987654321012345678";
    const content = "Hello decentralized Modelica simulations!";
    const createdAt = "2026-11-05T12:00:00.000Z";

    const { proofDoc } = createPostProof(postId, content, createdAt, keyPair.privateKeyPem, keyPair.publicKeyOpenSsh);

    assert.equal(proofDoc.type, "PostEvidence");
    assert.equal(proofDoc.proof.cryptosuite, "eddsa-jcs-2022");
    assert.ok(proofDoc.proof.proofValue.startsWith("z"));

    const parsed = parseSshPublicKey(keyPair.publicKeyOpenSsh);
    const valid = verifyPostProof(content, postId, createdAt, proofDoc, parsed.rawPubkey);
    assert.equal(valid, true);

    // Tampering with content invalidates proof
    const tamperedValid = verifyPostProof("Tampered content!", postId, createdAt, proofDoc, parsed.rawPubkey);
    assert.equal(tamperedValid, false);

    // Tampering with post ID invalidates proof
    const tamperedIdValid = verifyPostProof(content, "different_id", createdAt, proofDoc, parsed.rawPubkey);
    assert.equal(tamperedIdValid, false);
  });

  test("file-based post signing and verification round-trip", () => {
    const keyPair = generateEd25519KeyPair();
    const privPath = path.join(TEST_DIR, "id_ed25519_test");
    const pubPath = `${privPath}.pub`;
    fs.writeFileSync(privPath, keyPair.privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(pubPath, `${keyPair.publicKeyOpenSsh}\n`, { mode: 0o644 });

    const postPath = path.join(TEST_DIR, "test-post.md");
    const postContent = `---
id: 112233445566778899
date: 2026-11-05T14:00:00Z
---
Validating autonomous robotics model with ModelScript.`;
    fs.writeFileSync(postPath, postContent, "utf8");

    const parsedKey = parseSshPublicKey(keyPair.publicKeyOpenSsh);
    const bodyOnly = "Validating autonomous robotics model with ModelScript.";
    const { proofDoc } = createPostProof(
      "112233445566778899",
      bodyOnly,
      "2026-11-05T14:00:00Z",
      privPath,
      keyPair.publicKeyOpenSsh,
    );

    const proofFilePath = `${postPath}.proof.json`;
    fs.writeFileSync(proofFilePath, JSON.stringify(proofDoc, null, 2), "utf8");

    // Read back and verify
    const readDoc = JSON.parse(fs.readFileSync(proofFilePath, "utf8"));
    const verified = verifyPostProof(
      bodyOnly,
      "112233445566778899",
      "2026-11-05T14:00:00Z",
      readDoc,
      parsedKey.rawPubkey,
    );
    assert.equal(verified, true);
  });
});
