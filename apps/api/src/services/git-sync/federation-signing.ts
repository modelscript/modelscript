// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { LibraryDatabase } from "../../database.js";
import type { AccountSigningKey } from "../../database/types.js";
import { decodeMultibase } from "./base58.js";
import { canonicalizeJson } from "./jcs.js";
import { appendKeyLogEntry } from "./key-registry.js";
import { computeSshFingerprint, writeSshWireString } from "./sshsig.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface ActorMultikeyAssertion {
  id: string;
  type: "Multikey";
  controller: string;
  publicKeyMultibase: string;
  fingerprintSha256: string;
}

/**
 * Serializes all active user-held Ed25519 signing keys for an actor into W3C Multikey assertionMethod objects.
 */
export function serializeActorAssertionMethods(
  userId: number,
  actorUrl: string,
  db: LibraryDatabase,
): ActorMultikeyAssertion[] {
  const activeKeys = db.getSigningKeysForUser(userId, false);
  return activeKeys.map((key) => ({
    id: `${actorUrl}#user-key-${key.id}`,
    type: "Multikey" as const,
    controller: actorUrl,
    publicKeyMultibase: key.public_key_multibase,
    fingerprintSha256: key.fingerprint_sha256,
  }));
}

/**
 * Inspects a post for signed evidence in signed_post_evidence and attaches
 * a FEP-8b32 W3C Data Integrity proof to an outbound Note object if available.
 */
export function attachPostProofToNote(
  postId: string | number,
  noteObject: Record<string, unknown>,
  db: LibraryDatabase,
): boolean {
  const evidence = db.getSignedPostEvidence(String(postId));
  if (!evidence) return false;

  try {
    const parsedDoc = JSON.parse(evidence.proof_json) as Record<string, unknown>;
    const proof = (parsedDoc["proof"] || parsedDoc) as Record<string, unknown>;
    if (proof && typeof proof === "object") {
      let payload: Record<string, unknown> | undefined;
      try {
        payload = JSON.parse(evidence.payload_json);
      } catch {}

      noteObject["proof"] = {
        ...proof,
        ...(payload ? { signedPayload: payload } : {}),
      };
      return true;
    }
  } catch {
    // Malformed proof JSON, skip attaching
  }
  return false;
}

/**
 * Pins or verifies remote actor signing keys using Trust On First Use (TOFU).
 * Detects unannounced key changes without cryptographic rotation proofs.
 */
export function pinRemoteActorSigningKeys(
  actorUrl: string,
  actorProfile: Record<string, unknown>,
  db: LibraryDatabase,
): { action: "pinned" | "unchanged" | "key_changed" | "none"; fingerprint?: string; oldFingerprint?: string } {
  const rawAssertions = actorProfile["assertionMethod"];
  const list: unknown[] = Array.isArray(rawAssertions)
    ? rawAssertions
    : rawAssertions && typeof rawAssertions === "object"
      ? [rawAssertions]
      : [];

  const multikeys = list.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== "object") return false;
    const rec = item as Record<string, unknown>;
    return (
      rec["type"] === "Multikey" &&
      typeof rec["publicKeyMultibase"] === "string" &&
      rec["publicKeyMultibase"].startsWith("z")
    );
  });

  if (multikeys.length === 0) {
    return { action: "none" };
  }

  const primary = multikeys[0]!;
  const publicKeyMultibase = primary["publicKeyMultibase"] as string;

  let rawPubkey: Buffer;
  try {
    const decoded = decodeMultibase(publicKeyMultibase);
    rawPubkey =
      decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01
        ? Buffer.from(decoded.subarray(2))
        : Buffer.from(decoded);
  } catch {
    return { action: "none" };
  }

  if (rawPubkey.length !== 32) {
    return { action: "none" };
  }

  const wireBytes = Buffer.concat([writeSshWireString("ssh-ed25519"), writeSshWireString(rawPubkey)]);
  const fingerprint = computeSshFingerprint(wireBytes);
  const openSsh = `ssh-ed25519 ${wireBytes.toString("base64")} ${actorUrl}`;

  // Find user by actor URL
  const remoteUser = db.getUserByActorUrl(actorUrl);
  if (!remoteUser) {
    return { action: "none" };
  }

  const existingKeys = db.getSigningKeysForUser(remoteUser.id, false);

  if (existingKeys.length === 0) {
    // TOFU: Pin key on first observation
    const inserted = db.registerSigningKey({
      userId: remoteUser.id,
      publicKeyMultibase,
      publicKeyOpenssh: openSsh,
      fingerprintSha256: fingerprint,
      algo: "ed25519",
      label: "Federated Remote Key (TOFU)",
      trustLevel: "pinned_tofu",
    });

    appendKeyLogEntry(db, remoteUser.id, "pin_tofu", {
      actorUrl,
      fingerprint,
      publicKeyMultibase,
      keyId: inserted.id,
    });

    return { action: "pinned", fingerprint };
  }

  // Check if current key matches any existing active key
  const match = existingKeys.find(
    (k) => k.fingerprint_sha256 === fingerprint || k.public_key_multibase === publicKeyMultibase,
  );
  if (match) {
    return { action: "unchanged", fingerprint };
  }

  // Key changed without a valid rotation proof!
  const oldKey = existingKeys[0]!;
  appendKeyLogEntry(db, remoteUser.id, "key_changed_unannounced", {
    actorUrl,
    oldFingerprint: oldKey.fingerprint_sha256,
    newFingerprint: fingerprint,
    newPublicKeyMultibase: publicKeyMultibase,
  });

  // Downgrade trust level and clear verified badge
  db.db.prepare(`UPDATE account_signing_keys SET trust_level = 'key_changed' WHERE user_id = ?`).run(remoteUser.id);
  db.db.prepare(`UPDATE users SET signing_verified = 0 WHERE id = ?`).run(remoteUser.id);

  return { action: "key_changed", fingerprint, oldFingerprint: oldKey.fingerprint_sha256 };
}

/**
 * Verifies an inbound Note's cryptographic proof against the author's pinned key.
 */
export function verifyInboundNoteProof(
  note: Record<string, unknown>,
  authorUserId: number,
  db: LibraryDatabase,
): { valid: boolean; keyId?: number; error?: string } {
  const proof = (note["proof"] || (note["object"] as Record<string, unknown> | undefined)?.["proof"]) as
    | Record<string, unknown>
    | undefined;

  if (!proof || typeof proof !== "object") {
    return { valid: false, error: "Note does not contain a proof object" };
  }

  if (proof["type"] !== "DataIntegrityProof" || proof["cryptosuite"] !== "eddsa-jcs-2022") {
    return { valid: false, error: `Unsupported cryptosuite: ${String(proof["cryptosuite"])}` };
  }

  const rawProofValue = typeof proof["proofValue"] === "string" ? proof["proofValue"] : "";
  if (!rawProofValue.startsWith("z")) {
    return { valid: false, error: "Invalid proofValue format (must be multibase base58btc starting with 'z')" };
  }

  const activeKeys = db.getSigningKeysForUser(authorUserId, false);
  if (activeKeys.length === 0) {
    return { valid: false, error: "No active or pinned keys found for author" };
  }

  // Match key by verificationMethod or try active keys
  const verificationMethod = String(proof["verificationMethod"] || "");
  let matchedKey: AccountSigningKey | undefined;

  if (verificationMethod) {
    matchedKey = activeKeys.find(
      (k) =>
        verificationMethod.includes(k.public_key_multibase) ||
        verificationMethod.includes(k.fingerprint_sha256) ||
        verificationMethod.endsWith(`#user-key-${k.id}`),
    );
  }
  if (!matchedKey) {
    matchedKey = activeKeys[0];
  }

  if (!matchedKey) {
    return { valid: false, error: "No matching key found" };
  }

  if (db.isSigningKeyBanned(matchedKey.fingerprint_sha256)) {
    return { valid: false, error: "Signing key has been banned from the instance" };
  }

  if (matchedKey.revoked_at) {
    const revokedTime = new Date(matchedKey.revoked_at).getTime();
    const noteTime = new Date(String(proof["created"] || note["published"] || note["created_at"] || "")).getTime();
    if (!isNaN(revokedTime) && !isNaN(noteTime) && noteTime > revokedTime) {
      return { valid: false, error: "Signing key was revoked prior to note creation timestamp" };
    }
  }

  try {
    const sigBytes = decodeMultibase(rawProofValue);
    const decodedPub = decodeMultibase(matchedKey.public_key_multibase);
    const rawPub32 =
      decodedPub.length === 34 && decodedPub[0] === 0xed && decodedPub[1] === 0x01
        ? decodedPub.subarray(2)
        : decodedPub;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
    const pubKeyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    // Compute unsigned note payload
    const unsignedNote = { ...note };
    delete unsignedNote["proof"];

    // 1. Try standard W3C Data Integrity hash binding
    const docHash = crypto.createHash("sha256").update(canonicalizeJson(unsignedNote), "utf8").digest();
    const proofConfig = {
      type: proof["type"],
      cryptosuite: proof["cryptosuite"],
      created: proof["created"],
      verificationMethod: proof["verificationMethod"],
      proofPurpose: proof["proofPurpose"],
    };
    const configHash = crypto.createHash("sha256").update(canonicalizeJson(proofConfig), "utf8").digest();
    const signingData = Buffer.concat([configHash, docHash]);

    let isValid = crypto.verify(null, signingData, pubKeyObj, sigBytes);

    // 2. If not verified via config+doc hash, try direct JCS over unsigned Note
    if (!isValid) {
      isValid = crypto.verify(null, Buffer.from(canonicalizeJson(unsignedNote), "utf8"), pubKeyObj, sigBytes);
    }

    // 3. Try signedPayload verification (if attached from git post evidence)
    if (!isValid && proof["signedPayload"] && typeof proof["signedPayload"] === "object") {
      const signedPayload = proof["signedPayload"] as Record<string, unknown>;
      const payloadCanonical = canonicalizeJson(signedPayload);
      const payloadValid = crypto.verify(null, Buffer.from(payloadCanonical, "utf8"), pubKeyObj, sigBytes);
      if (payloadValid) {
        // Also verify content integrity if contentSha256 is specified
        if (typeof signedPayload["contentSha256"] === "string" && typeof note["content"] === "string") {
          const contentHash = crypto
            .createHash("sha256")
            .update(note["content"] as string)
            .digest("hex");
          if (contentHash === signedPayload["contentSha256"]) {
            isValid = true;
          }
        } else {
          isValid = true;
        }
      }
    }

    // 4. Try direct JCS over content string / simple post structure if wrapped
    if (!isValid && typeof note["content"] === "string") {
      const simplePayload = {
        id: note["id"],
        content: note["content"],
        created_at: note["published"] || note["created_at"],
      };
      const simpleHash = crypto.createHash("sha256").update(canonicalizeJson(simplePayload), "utf8").digest();
      isValid = crypto.verify(null, Buffer.concat([configHash, simpleHash]), pubKeyObj, sigBytes);
    }

    if (isValid) {
      return { valid: true, keyId: matchedKey.id };
    }
    return { valid: false, error: "Cryptographic signature mismatch" };
  } catch (err) {
    return { valid: false, error: `Proof verification exception: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface RestPostProofContext {
  replyToId?: number | string | null | undefined;
  quotePostId?: number | string | null | undefined;
  artifactId?: number | string | null | undefined;
}

/**
 * Verifies a REST post creation W3C Data Integrity proof against the author's registered signing keys.
 */
export function verifyRestPostProof(
  proof: Record<string, unknown>,
  content: string,
  authorUserId: number,
  db: LibraryDatabase,
  payloadInput?: Record<string, unknown>,
  expectedContext?: RestPostProofContext,
): { valid: boolean; keyId?: number; error?: string; payload: Record<string, unknown> } {
  if (!proof || typeof proof !== "object") {
    return { valid: false, error: "Missing proof object", payload: {} };
  }

  if (proof["type"] !== "DataIntegrityProof" || proof["cryptosuite"] !== "eddsa-jcs-2022") {
    return { valid: false, error: `Unsupported cryptosuite: ${String(proof["cryptosuite"])}`, payload: {} };
  }

  const rawProofValue = typeof proof["proofValue"] === "string" ? proof["proofValue"] : "";
  if (!rawProofValue.startsWith("z")) {
    return { valid: false, error: "Invalid proofValue format (must start with 'z')", payload: {} };
  }

  const activeKeys = db.getSigningKeysForUser(authorUserId, false);
  if (activeKeys.length === 0) {
    return { valid: false, error: "No active signing keys found for author", payload: {} };
  }

  const verificationMethod = String(proof["verificationMethod"] || "");
  let matchedKey = activeKeys.find(
    (k) =>
      verificationMethod.includes(k.public_key_multibase) ||
      verificationMethod.includes(k.fingerprint_sha256) ||
      verificationMethod.endsWith(`#user-key-${k.id}`),
  );
  if (!matchedKey) {
    matchedKey = activeKeys[0];
  }
  if (!matchedKey) {
    return { valid: false, error: "No matching key found", payload: {} };
  }

  if (db.isSigningKeyBanned(matchedKey.fingerprint_sha256)) {
    return { valid: false, error: "Signing key has been banned from the instance", payload: {} };
  }

  if (matchedKey.revoked_at) {
    const revokedTime = new Date(matchedKey.revoked_at).getTime();
    const proofTime = new Date(String(proof["created"] || "")).getTime();
    if (!isNaN(revokedTime) && !isNaN(proofTime) && proofTime > revokedTime) {
      return { valid: false, error: "Signing key was revoked prior to proof creation timestamp", payload: {} };
    }
  }

  // Validate proof timestamp freshness (max 15 minutes clock drift)
  const rawCreated = proof["created"];
  if (!rawCreated) {
    return { valid: false, error: "Missing proof creation timestamp", payload: {} };
  }
  const proofTime = new Date(String(rawCreated)).getTime();
  if (isNaN(proofTime)) {
    return { valid: false, error: "Invalid proof creation timestamp", payload: {} };
  }
  const MAX_CLOCK_DRIFT_MS = 15 * 60 * 1000;
  if (Math.abs(Date.now() - proofTime) > MAX_CLOCK_DRIFT_MS) {
    return {
      valid: false,
      error: "Proof creation timestamp exceeds allowable clock drift window (15 minutes)",
      payload: {},
    };
  }

  try {
    const sigBytes = decodeMultibase(rawProofValue);
    const decodedPub = decodeMultibase(matchedKey.public_key_multibase);
    const rawPub32 =
      decodedPub.length === 34 && decodedPub[0] === 0xed && decodedPub[1] === 0x01
        ? decodedPub.subarray(2)
        : decodedPub;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
    const pubKeyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    const payload =
      payloadInput && typeof payloadInput === "object"
        ? payloadInput
        : {
            content,
            created_at: proof["created"],
          };

    // Verify that the payload content matches the actual submitted post content
    if (typeof payload["content"] === "string" && payload["content"] !== content) {
      return {
        valid: false,
        error: "Proof payload content does not match post content",
        payload,
      };
    }

    // Verify context bindings if declared in payload
    if (expectedContext) {
      if (
        payload["reply_to_id"] !== undefined &&
        String(payload["reply_to_id"] ?? "") !== String(expectedContext.replyToId ?? "")
      ) {
        return {
          valid: false,
          error: "Proof payload reply_to_id does not match post reply_to_id",
          payload,
        };
      }
      if (
        payload["quote_post_id"] !== undefined &&
        String(payload["quote_post_id"] ?? "") !== String(expectedContext.quotePostId ?? "")
      ) {
        return {
          valid: false,
          error: "Proof payload quote_post_id does not match post quote_post_id",
          payload,
        };
      }
      if (
        payload["artifact_id"] !== undefined &&
        String(payload["artifact_id"] ?? "") !== String(expectedContext.artifactId ?? "")
      ) {
        return {
          valid: false,
          error: "Proof payload artifact_id does not match post artifact_id",
          payload,
        };
      }
    }

    const payloadHash = crypto.createHash("sha256").update(canonicalizeJson(payload), "utf8").digest();
    const proofConfig = {
      type: proof["type"],
      cryptosuite: proof["cryptosuite"],
      created: proof["created"],
      verificationMethod: proof["verificationMethod"],
      proofPurpose: proof["proofPurpose"],
    };
    const configHash = crypto.createHash("sha256").update(canonicalizeJson(proofConfig), "utf8").digest();
    const signingData = Buffer.concat([configHash, payloadHash]);

    let isValid = crypto.verify(null, signingData, pubKeyObj, sigBytes);

    if (!isValid) {
      // Fallback: direct JCS over payload
      isValid = crypto.verify(null, Buffer.from(canonicalizeJson(payload), "utf8"), pubKeyObj, sigBytes);
    }

    if (isValid) {
      return { valid: true, keyId: matchedKey.id, payload };
    }
    return { valid: false, error: "Cryptographic signature mismatch", payload };
  } catch (err) {
    return {
      valid: false,
      error: `Verification exception: ${err instanceof Error ? err.message : String(err)}`,
      payload: {},
    };
  }
}
