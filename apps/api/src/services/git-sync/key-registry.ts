// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { LibraryDatabase } from "../../database.js";
import type { AccountKeyLogEntry, AccountSigningKey } from "../../database/types.js";
import { decodeMultibase } from "./base58.js";
import { canonicalizeJson } from "./jcs.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const GENESIS_PREV_HASH = "0".repeat(64);

export type { AccountKeyLogEntry, AccountSigningKey };

/**
 * Creates a challenge string for proof of possession during key registration.
 */
export function createRegistrationChallenge(userId: number, timestamp: number = Date.now(), nonce?: string): string {
  const n = nonce || crypto.randomBytes(16).toString("hex");
  return `register:${userId}:${timestamp}:${n}`;
}

/**
 * Verifies a proof of possession signature over a challenge string using an Ed25519 public key.
 */
export function verifyProofOfPossession(
  challenge: string,
  signatureMultibaseOrBase64: string,
  rawPubkey32: Uint8Array | Buffer,
): boolean {
  try {
    const candidates: Uint8Array[] = [];
    if (signatureMultibaseOrBase64.startsWith("z")) {
      try {
        candidates.push(decodeMultibase(signatureMultibaseOrBase64));
      } catch {}
    }
    try {
      candidates.push(Buffer.from(signatureMultibaseOrBase64, "base64"));
    } catch {}

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPubkey32)]);
    const pubKeyObj = crypto.createPublicKey({
      key: spkiDer,
      format: "der",
      type: "spki",
    });

    const challengeBuf = Buffer.from(challenge, "utf8");
    for (const sigBytes of candidates) {
      if (crypto.verify(null, challengeBuf, pubKeyObj, sigBytes)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Appends an entry to the user's tamper-evident key transparency log.
 */
export function appendKeyLogEntry(
  database: LibraryDatabase,
  userId: number,
  event: "register" | "rotate" | "revoke" | "pin_tofu" | "key_changed_unannounced" | (string & {}),
  payload: Record<string, unknown>,
): AccountKeyLogEntry {
  const existingLog = database.getKeyLogForUser(userId);
  const prevHash = existingLog.length > 0 ? existingLog[existingLog.length - 1]!.entry_hash : GENESIS_PREV_HASH;
  const seq = existingLog.length + 1;
  const payloadJson = canonicalizeJson(payload);

  const entryHash = crypto.createHash("sha256").update(`${prevHash}:${seq}:${event}:${payloadJson}`).digest("hex");

  return database.insertKeyLogEntry({
    user_id: userId,
    event,
    payload_json: payloadJson,
    prev_hash: prevHash,
    entry_hash: entryHash,
  });
}

/**
 * Validates the complete hash chain of a user's transparency log.
 */
export function verifyKeyLogChain(entries: AccountKeyLogEntry[]): boolean {
  let expectedPrev = GENESIS_PREV_HASH;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prev_hash !== expectedPrev) return false;
    const userSeq = i + 1;
    const computedUserSeq = crypto
      .createHash("sha256")
      .update(`${entry.prev_hash}:${userSeq}:${entry.event}:${entry.payload_json}`)
      .digest("hex");
    const computedEntrySeq = crypto
      .createHash("sha256")
      .update(`${entry.prev_hash}:${entry.seq}:${entry.event}:${entry.payload_json}`)
      .digest("hex");
    if (entry.entry_hash !== computedUserSeq && entry.entry_hash !== computedEntrySeq) return false;
    expectedPrev = entry.entry_hash;
  }
  return true;
}

/**
 * Creates the deterministic attestation statement string for a master key delegating to a device key.
 */
export function createDelegationStatement(
  userId: number,
  masterFingerprint: string,
  deviceFingerprint: string,
): string {
  return `delegate:${userId}:${masterFingerprint}:${deviceFingerprint}`;
}

/**
 * Verifies a delegation attestation signature from a master key over a device key.
 */
export function verifyDelegationSignature(
  userId: number,
  masterKeyOpenssh: string,
  masterFingerprint: string,
  deviceFingerprint: string,
  signature: string,
): boolean {
  const statement = createDelegationStatement(userId, masterFingerprint, deviceFingerprint);
  try {
    const match = masterKeyOpenssh.trim().split(/\s+/);
    if (match.length < 2) return false;
    const keyBytes = Buffer.from(match[1]!, "base64");
    // Wire format for ssh-ed25519 is: 4-byte len of "ssh-ed25519", "ssh-ed25519", 4-byte len of key (32), 32 bytes key
    const prefixLen = keyBytes.readUInt32BE(0);
    const pubOffset = 4 + prefixLen;
    const pubLen = keyBytes.readUInt32BE(pubOffset);
    const rawPub = keyBytes.subarray(pubOffset + 4, pubOffset + 4 + pubLen);
    return verifyProofOfPossession(statement, signature, rawPub);
  } catch {
    return false;
  }
}
