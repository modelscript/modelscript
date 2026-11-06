// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { decodeMultibase, encodeMultibase } from "./base58.js";
import { canonicalizeJson } from "./jcs.js";
import type { ParsedSshPublicKey } from "./sshsig.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface PostProofPayload {
  handle: string;
  path: string;
  rev: number;
  contentSha256: string;
  created: string;
  title?: string;
  previousRevisionSha?: string;
}

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string; // e.g. "did:key:z6Mku..." or fingerprint
  proofPurpose: "assertionMethod";
  proofValue: string; // multibase base58btc "z..."
}

export interface PostEvidenceDocument {
  payload: PostProofPayload;
  proof: DataIntegrityProof;
}

/**
 * Computes SHA-256 hash of a string or buffer in hex.
 */
export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Generates a W3C Data Integrity proof for a post payload using an Ed25519 private key.
 */
export function createPostProof(
  payload: PostProofPayload,
  privateKey: crypto.KeyObject | string | Buffer,
  publicKeyInfo: ParsedSshPublicKey,
): PostEvidenceDocument {
  const privKeyObj =
    typeof privateKey === "object" && "type" in privateKey
      ? (privateKey as crypto.KeyObject)
      : crypto.createPrivateKey(privateKey);

  const canonicalPayload = canonicalizeJson(payload);
  const signatureRaw = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), privKeyObj);
  const proofValue = encodeMultibase(signatureRaw);

  const verificationMethod = publicKeyInfo.multibase.startsWith("z")
    ? `did:key:${publicKeyInfo.multibase}`
    : publicKeyInfo.fingerprintSha256;

  const proof: DataIntegrityProof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: payload.created,
    verificationMethod,
    proofPurpose: "assertionMethod",
    proofValue,
  };

  return { payload, proof };
}

/**
 * Verifies a Post Evidence document against an allowed public key.
 */
export function verifyPostEvidence(
  evidence: PostEvidenceDocument,
  postContent: string | Buffer,
  expectedHandle: string,
  expectedPath: string,
  allowedKeys: Array<{ fingerprint_sha256: string; public_key_multibase: string; public_key_openssh: string }>,
): { valid: boolean; keyId?: string; error?: string } {
  const { payload, proof } = evidence;

  if (payload.handle !== expectedHandle) {
    return {
      valid: false,
      error: `Proof handle '${payload.handle}' does not match expected handle '${expectedHandle}'`,
    };
  }

  if (payload.path !== expectedPath) {
    return { valid: false, error: `Proof path '${payload.path}' does not match expected path '${expectedPath}'` };
  }

  const expectedSha = sha256Hex(postContent);
  if (payload.contentSha256 !== expectedSha) {
    return { valid: false, error: "Proof content SHA256 does not match actual post content" };
  }

  if (proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022") {
    return { valid: false, error: `Unsupported cryptosuite '${proof.cryptosuite}' (expected eddsa-jcs-2022)` };
  }

  // Find matching key by verificationMethod (did:key or fingerprint)
  const matchedKey = allowedKeys.find(
    (k) =>
      proof.verificationMethod.includes(k.public_key_multibase) ||
      proof.verificationMethod.includes(k.fingerprint_sha256) ||
      k.public_key_multibase.includes(proof.verificationMethod),
  );

  if (!matchedKey) {
    return {
      valid: false,
      error: `Verification method '${proof.verificationMethod}' does not match any registered key for this user`,
    };
  }

  try {
    const rawSig = decodeMultibase(proof.proofValue);
    const rawPubkeyBytes = decodeMultibase(matchedKey.public_key_multibase);
    // Multicodec 0xed 0x01 prefix is 2 bytes, followed by 32 bytes public key
    const rawPub32 = rawPubkeyBytes.length === 34 ? rawPubkeyBytes.subarray(2) : rawPubkeyBytes;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawPub32]);
    const pubKeyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    const canonicalBytes = Buffer.from(canonicalizeJson(payload), "utf8");
    const ok = crypto.verify(null, canonicalBytes, pubKeyObj, rawSig);
    if (!ok) {
      return { valid: false, error: "Ed25519 signature verification failed" };
    }

    return { valid: true, keyId: matchedKey.fingerprint_sha256 };
  } catch (err) {
    return { valid: false, error: `Invalid proof format: ${err instanceof Error ? err.message : String(err)}` };
  }
}
