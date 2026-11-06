// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import crypto from "node:crypto";
import test from "node:test";
import { decodeBase58, decodeMultibase, encodeBase58, encodeMultibase } from "../src/services/git-sync/base58.js";
import { canonicalizeJson } from "../src/services/git-sync/jcs.js";
import {
  createRegistrationChallenge,
  verifyKeyLogChain,
  verifyProofOfPossession,
} from "../src/services/git-sync/key-registry.js";
import { createPostProof, sha256Hex, verifyPostEvidence } from "../src/services/git-sync/proofs.js";
import {
  createSshPublicKeyFromRaw,
  extractCommitSignedPayload,
  parseSshPublicKey,
  parseSshsig,
  signSshsig,
  verifyCommitSignature,
} from "../src/services/git-sync/sshsig.js";

test("Signing Crypto Services", async (t) => {
  await t.test("Base58 and Multibase encoding and decoding round-trip", () => {
    const raw = Buffer.from("Hello ModelScript Verification!", "utf8");
    const b58 = encodeBase58(raw);
    const decoded = decodeBase58(b58);
    assert.deepStrictEqual(decoded, new Uint8Array(raw));

    const mb = encodeMultibase(raw);
    assert.ok(mb.startsWith("z"));
    const decodedMb = decodeMultibase(mb);
    assert.deepStrictEqual(decodedMb, new Uint8Array(raw));
  });

  await t.test("RFC 8785 JSON Canonicalization Scheme (JCS)", () => {
    // Key order sorting
    const unordered = { z: 1, a: "foo", m: true, b: null };
    const canonical = canonicalizeJson(unordered);
    assert.strictEqual(canonical, '{"a":"foo","b":null,"m":true,"z":1}');

    // Negative zero handling
    assert.strictEqual(canonicalizeJson(-0), "0");
    assert.strictEqual(canonicalizeJson(0), "0");

    // Arrays and nesting
    const nested = { array: [{ d: 4, c: 3 }, 2, 1], b: "bar" };
    assert.strictEqual(canonicalizeJson(nested), '{"array":[{"c":3,"d":4},2,1],"b":"bar"}');
  });

  await t.test("Ed25519 OpenSSH public key parsing and fingerprinting", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const rawPubDer = keyPair.publicKey.export({ format: "der", type: "spki" });
    const rawPub32 = rawPubDer.subarray(rawPubDer.length - 32);

    const parsed = createSshPublicKeyFromRaw(rawPub32);
    assert.strictEqual(parsed.algo, "ssh-ed25519");
    assert.ok(parsed.openssh.startsWith("ssh-ed25519 AAAAC3"));
    assert.ok(parsed.fingerprintSha256.startsWith("SHA256:"));
    assert.ok(parsed.multibase.startsWith("z"));

    // Re-parse the openssh string
    const reparsed = parseSshPublicKey(parsed.openssh);
    assert.strictEqual(reparsed.fingerprintSha256, parsed.fingerprintSha256);
    assert.strictEqual(reparsed.multibase, parsed.multibase);
  });

  await t.test("FIDO2 / U2F sk-ssh-ed25519@openssh.com hardware key parsing and fingerprinting", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const rawPubDer = keyPair.publicKey.export({ format: "der", type: "spki" });
    const rawPub32 = rawPubDer.subarray(rawPubDer.length - 32);

    // Build FIDO2 OpenSSH wire format: string "sk-ssh-ed25519@openssh.com" || string pubkey || string "ssh:"
    const wireBytes = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x1a]), // length 26
      Buffer.from("sk-ssh-ed25519@openssh.com", "utf8"),
      Buffer.from([0x00, 0x00, 0x00, 0x20]), // length 32
      rawPub32,
      Buffer.from([0x00, 0x00, 0x00, 0x04]), // length 4
      Buffer.from("ssh:", "utf8"),
    ]);

    const skKeyStr = `sk-ssh-ed25519@openssh.com ${wireBytes.toString("base64")} yubikey-5c@workstation`;
    const parsedSk = parseSshPublicKey(skKeyStr);

    assert.strictEqual(parsedSk.algo, "sk-ssh-ed25519@openssh.com");
    assert.strictEqual(parsedSk.rawPubkey.length, 32);
    assert.ok(parsedSk.fingerprintSha256.startsWith("SHA256:"));
    assert.ok(parsedSk.multibase.startsWith("z"));
    assert.ok(parsedSk.openssh.startsWith("sk-ssh-ed25519@openssh.com "));
  });

  await t.test("OpenSSH SSHSIG generation and cryptographic verification", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const rawPubDer = keyPair.publicKey.export({ format: "der", type: "spki" });
    const rawPub32 = rawPubDer.subarray(rawPubDer.length - 32);
    const pubInfo = createSshPublicKeyFromRaw(rawPub32);

    const commitMessage = "Add verified simulation notes\n";
    const commitPayload = `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor Alice <alice@example.com> 1700000000 +0000\ncommitter Alice <alice@example.com> 1700000000 +0000\n\n${commitMessage}`;

    const signatureArmor = signSshsig(commitPayload, keyPair.privateKey, "git", "sha512");
    assert.ok(signatureArmor.includes("-----BEGIN SSH SIGNATURE-----"));
    assert.ok(signatureArmor.includes("-----END SSH SIGNATURE-----"));

    const parsedSig = parseSshsig(signatureArmor);
    assert.strictEqual(parsedSig.namespace, "git");
    assert.strictEqual(parsedSig.hashAlgo, "sha512");
    assert.strictEqual(parsedSig.rawPubkey.length, 32);

    // Format full git commit with gpgsig header
    const sigContinuation = signatureArmor
      .split("\n")
      .map((line, idx) => (idx === 0 ? `gpgsig ${line}` : ` ${line}`))
      .join("\n");
    const fullCommit = `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor Alice <alice@example.com> 1700000000 +0000\ncommitter Alice <alice@example.com> 1700000000 +0000\n${sigContinuation}\n\n${commitMessage}`;

    // Extract payload and verify
    const { payload, signatureText } = extractCommitSignedPayload(fullCommit);
    assert.strictEqual(payload, commitPayload);
    assert.ok(signatureText?.includes("BEGIN SSH SIGNATURE"));

    // Verification against registered key allowlist
    const verifyRes = verifyCommitSignature(fullCommit, [
      {
        fingerprint_sha256: pubInfo.fingerprintSha256,
        public_key_openssh: pubInfo.openssh,
      },
    ]);
    assert.strictEqual(verifyRes.valid, true);
    assert.strictEqual(verifyRes.fingerprint, pubInfo.fingerprintSha256);

    // Verification fails if tampered
    const tamperedCommit = fullCommit.replace(commitMessage, "Tampered commit message!\n");
    const tamperedRes = verifyCommitSignature(tamperedCommit, [
      {
        fingerprint_sha256: pubInfo.fingerprintSha256,
        public_key_openssh: pubInfo.openssh,
      },
    ]);
    assert.strictEqual(tamperedRes.valid, false);

    // Verification fails if key is not in allowlist
    const strangerKeyPair = crypto.generateKeyPairSync("ed25519");
    const strangerPub = createSshPublicKeyFromRaw(
      strangerKeyPair.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    );
    const strangerRes = verifyCommitSignature(fullCommit, [
      {
        fingerprint_sha256: strangerPub.fingerprintSha256,
        public_key_openssh: strangerPub.openssh,
      },
    ]);
    assert.strictEqual(strangerRes.valid, false);
    assert.ok(strangerRes.error?.includes("not associated with this user"));
  });

  await t.test("Proof of Possession (PoP) challenge verification", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const rawPub32 = keyPair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);

    const challenge = createRegistrationChallenge(42);
    const sigRaw = crypto.sign(null, Buffer.from(challenge, "utf8"), keyPair.privateKey);
    const sigMb = encodeMultibase(sigRaw);

    const valid = verifyProofOfPossession(challenge, sigMb, rawPub32);
    assert.strictEqual(valid, true);

    const invalid = verifyProofOfPossession("tampered-challenge", sigMb, rawPub32);
    assert.strictEqual(invalid, false);
  });

  await t.test("Transparency log hash chain verification", () => {
    const entries = [
      {
        seq: 1,
        user_id: 1,
        event: "register",
        payload_json: '{"fingerprint":"SHA256:key1"}',
        prev_hash: "0".repeat(64),
        entry_hash: "",
        created_at: new Date().toISOString(),
      },
      {
        seq: 2,
        user_id: 1,
        event: "revoke",
        payload_json: '{"fingerprint":"SHA256:key1","reason":"lost"}',
        prev_hash: "",
        entry_hash: "",
        created_at: new Date().toISOString(),
      },
    ];

    // Compute entry_hash for genesis
    entries[0]!.entry_hash = crypto
      .createHash("sha256")
      .update(`${entries[0]!.prev_hash}:${entries[0]!.seq}:${entries[0]!.event}:${entries[0]!.payload_json}`)
      .digest("hex");

    // Link entry 2 to entry 1
    entries[1]!.prev_hash = entries[0]!.entry_hash;
    entries[1]!.entry_hash = crypto
      .createHash("sha256")
      .update(`${entries[1]!.prev_hash}:${entries[1]!.seq}:${entries[1]!.event}:${entries[1]!.payload_json}`)
      .digest("hex");

    assert.strictEqual(verifyKeyLogChain(entries), true);

    // Tampered entry fails chain verification
    entries[0]!.payload_json = '{"fingerprint":"SHA256:tampered"}';
    assert.strictEqual(verifyKeyLogChain(entries), false);
  });

  await t.test("W3C Data Integrity Post Proofs (eddsa-jcs-2022)", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const rawPub32 = keyPair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const pubInfo = createSshPublicKeyFromRaw(rawPub32);

    const postContent = "---\ntitle: Verified Post\n---\nHello verified world!\n";
    const evidence = createPostProof(
      {
        handle: "alice",
        path: "posts/verified-1.md",
        rev: 1,
        contentSha256: sha256Hex(postContent),
        created: "2026-11-05T12:00:00.000Z",
      },
      keyPair.privateKey,
      pubInfo,
    );

    assert.strictEqual(evidence.proof.cryptosuite, "eddsa-jcs-2022");
    assert.ok(evidence.proof.proofValue.startsWith("z"));

    const verifyOk = verifyPostEvidence(evidence, postContent, "alice", "posts/verified-1.md", [
      {
        fingerprint_sha256: pubInfo.fingerprintSha256,
        public_key_multibase: pubInfo.multibase,
        public_key_openssh: pubInfo.openssh,
      },
    ]);
    assert.strictEqual(verifyOk.valid, true);

    // Tampered content fails proof
    const tamperedContent = postContent + " Extra malicious line";
    const verifyTampered = verifyPostEvidence(evidence, tamperedContent, "alice", "posts/verified-1.md", [
      {
        fingerprint_sha256: pubInfo.fingerprintSha256,
        public_key_multibase: pubInfo.multibase,
        public_key_openssh: pubInfo.openssh,
      },
    ]);
    assert.strictEqual(verifyTampered.valid, false);
    assert.ok(verifyTampered.error?.includes("SHA256 does not match"));

    // Wrong handle fails proof
    const verifyWrongHandle = verifyPostEvidence(evidence, postContent, "bob", "posts/verified-1.md", [
      {
        fingerprint_sha256: pubInfo.fingerprintSha256,
        public_key_multibase: pubInfo.multibase,
        public_key_openssh: pubInfo.openssh,
      },
    ]);
    assert.strictEqual(verifyWrongHandle.valid, false);
  });
});
