// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import type { AccountSigningKey } from "../database/types.js";
import { encodeMultibase } from "../services/git-sync/base58.js";
import { canonicalizeJson } from "../services/git-sync/jcs.js";
import { appendKeyLogEntry, createDelegationStatement } from "../services/git-sync/key-registry.js";

export interface SeedKeyDefinition {
  idKey: string;
  username: string;
  label: string;
  algo: "ed25519";
  trustLevel: "hardware_or_cli" | "web_browser" | "delegated_by_master";
  publicKeyOpenssh: string;
  publicKeyMultibase: string;
  fingerprintSha256: string;
  privateKeyPem: string;
  isMaster?: boolean;
  delegatedByMaster?: string; // idKey of master key
}

/**
 * Deterministic Ed25519 keypairs for verified seed personas.
 * Precomputed so that local development and test runs produce 100% reproducible
 * public keys, multibase DIDs, OpenSSH strings, and cryptographic signatures.
 */
export const SEED_SIGNING_KEYS: SeedKeyDefinition[] = [
  {
    idKey: "omarMaster",
    username: "omar",
    label: "YubiKey 5C NFC (Primary Hardware Key)",
    algo: "ed25519",
    trustLevel: "hardware_or_cli",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICrl6lG9WxQI5ydBSNo6FcjhL4k6flIUHfLBBQV0/TVS omar-yubikey-5c@ansatz.org",
    publicKeyMultibase: "z6MkhLiWMyNpBMEmLFBhErpY6HcyYD5zNG4riteS66ZDH2Ad",
    fingerprintSha256: "SHA256:FvYsl0i6CunTJT9NWUXKQyKZDYkB6hdYttySdhfPXPw",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIL4kOS1NC9icNLt1+bUDSdjeWZDTD3Wv0EVwIwZPgWK7\n-----END PRIVATE KEY-----\n",
    isMaster: true,
  },
  {
    idKey: "omarDevice",
    username: "omar",
    label: "Ansatz Workstation (CLI Device Key)",
    algo: "ed25519",
    trustLevel: "delegated_by_master",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqJNpjxHEeWJ2s0y9Vk/5p3wbouLGtGjtJq3IL27mMu omar-workstation@ansatz.org",
    publicKeyMultibase: "z6Mkqvxhux15sGTEzzR1NgE9sqmDGb3e7bKGNK27qKKQJ1wT",
    fingerprintSha256: "SHA256:UvUl6VflCO1DgMgjrR8PssjyS6zqRvd/4/vFIw0rpfg",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIEEParnE4PgsyCe87k85lpbkR7FXQe057hyALpykk4HC\n-----END PRIVATE KEY-----\n",
    delegatedByMaster: "omarMaster",
  },
  {
    idKey: "elena",
    username: "elena_vance",
    label: "ETH Zurich Security Token",
    algo: "ed25519",
    trustLevel: "hardware_or_cli",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFTflxk0UoXZZTKXT3/OkfjE0iXhB7k5Y+3JYiwXkzTW elena-vance-yubikey@ethz.ch",
    publicKeyMultibase: "z6MkkAa34nBuYsh4ewVKqpWTg8oEkBQzxsbrv3tH8KfGc74h",
    fingerprintSha256: "SHA256:lXOylksMPCfcnDU6KhkXEvO+JPnWv/aSlwQk1YlsJ4Y",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIPbwzR760HQX4V8L979ENbWva0ahvvTASblzroP7Xqki\n-----END PRIVATE KEY-----\n",
  },
  {
    idKey: "marcus",
    username: "marcus_chen",
    label: "MacBook Pro Browser Device Key",
    algo: "ed25519",
    trustLevel: "web_browser",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIlIUcak0H2hV1kEhY+nKFrByKMc2quwY9Rum2UDsr/U marcus-chen-mbp@ercot.com",
    publicKeyMultibase: "z6Mkoh9rpT9eWZAfzYrTENvm4Yg5hUnYBEo7zyCHX261QDPq",
    fingerprintSha256: "SHA256:+zcq4okD+QuaKL4FXZQFc3b/Byx9luOjV7vGyF+Fkuc",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIF4gta9Ktnq+uol9iisT55TgE57NfO/lltZAGYjLJij+\n-----END PRIVATE KEY-----\n",
  },
  {
    idKey: "claire",
    username: "claire_dubois",
    label: "Airbus Cyber-Physical Hardware Key",
    algo: "ed25519",
    trustLevel: "hardware_or_cli",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKt92dJZZrdzVG3vp+BOtrjj0j6xEhS1me7Vw1q7SI/+ claire-dubois-workstation@airbus.com",
    publicKeyMultibase: "z6Mkqzh4iiKa9kU1PFX1dxfb7DvmJcTFgSje9kMPcMWfw5zM",
    fingerprintSha256: "SHA256:djCuWEFnzOXYE33pYR2u6pV11Uhw9sI9FPTPzmcfO+8",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHilpLTpu4nSqqY4qUAiZT1cGT6AdsWhBhcIy+DUAFD+\n-----END PRIVATE KEY-----\n",
  },
  {
    idKey: "kenji",
    username: "kenji_takahashi",
    label: "Robotics Laboratory Hardware Key",
    algo: "ed25519",
    trustLevel: "hardware_or_cli",
    publicKeyOpenssh:
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBdkfL0T89/oNSxTpX2VMrtEYmz1W2qzOvZXgDiTrJWS kenji-takahashi-lab@riken.jp",
    publicKeyMultibase: "z6Mkg2aJ1An1d5NrWnFohcxysmM5gEZGYFaibHm42yRSNWAV",
    fingerprintSha256: "SHA256:p2+cfO8m/6OZRvnKGGeURhr6dzcdpXcoOdk8FQf5Mr4",
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIH2RPBuQNxLSz49RwgyWeOxcCSQ5DzI7wHdgzr5MdlE2\n-----END PRIVATE KEY-----\n",
  },
];

export interface SeedKeyRecord {
  spec: SeedKeyDefinition;
  record: AccountSigningKey;
}

/**
 * Seeds verified signing keys, master key delegations, and transparency log chains
 * for the configured verified personas.
 * Idempotent: safe to run multiple times without duplicating keys.
 */
export function seedSigningKeys(db: LibraryDatabase, userIds: Map<string, number>): Map<string, SeedKeyRecord> {
  const registered = new Map<string, SeedKeyRecord>();
  const dbKeyByFp = new Map<string, AccountSigningKey>();

  for (const spec of SEED_SIGNING_KEYS) {
    const userId = userIds.get(spec.username);
    if (!userId) continue;

    // Check if key already exists by fingerprint
    let existing = db.getSigningKeyByFingerprint(spec.fingerprintSha256);
    if (existing) {
      dbKeyByFp.set(spec.fingerprintSha256, existing);
      registered.set(spec.idKey, { spec, record: existing });
      continue;
    }

    let prevKeyId: number | null = null;
    let rotationProof: string | null = null;

    if (spec.delegatedByMaster) {
      const masterSpec = SEED_SIGNING_KEYS.find((k) => k.idKey === spec.delegatedByMaster);
      if (masterSpec) {
        const masterRecord = dbKeyByFp.get(masterSpec.fingerprintSha256);
        if (masterRecord) {
          prevKeyId = masterRecord.id;
          const masterPriv = crypto.createPrivateKey(masterSpec.privateKeyPem);
          const statement = createDelegationStatement(userId, masterRecord.fingerprint_sha256, spec.fingerprintSha256);
          rotationProof = crypto.sign(null, Buffer.from(statement, "utf8"), masterPriv).toString("base64");
        }
      }
    }

    const rec = db.registerSigningKey({
      userId,
      publicKeyMultibase: spec.publicKeyMultibase,
      publicKeyOpenssh: spec.publicKeyOpenssh,
      fingerprintSha256: spec.fingerprintSha256,
      algo: spec.algo,
      label: spec.label,
      trustLevel: spec.trustLevel,
      prevKeyId,
      rotationProof,
    });

    dbKeyByFp.set(spec.fingerprintSha256, rec);
    registered.set(spec.idKey, { spec, record: rec });

    // Ensure signing_verified is active on the user
    db.setSigningVerified(userId, true);

    // Populate key transparency log
    appendKeyLogEntry(db, userId, "register", {
      keyId: rec.id,
      fingerprint: rec.fingerprint_sha256,
      multibase: rec.public_key_multibase,
      label: rec.label,
      trustLevel: rec.trust_level,
      ...(prevKeyId ? { prevKeyId } : {}),
    });

    if (prevKeyId && rotationProof) {
      appendKeyLogEntry(db, userId, "delegate_device", {
        keyId: rec.id,
        masterKeyId: prevKeyId,
        fingerprint: rec.fingerprint_sha256,
        delegationProof: rotationProof,
      });
    }
  }

  return registered;
}

export interface SeedProofResult {
  proof: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
  payload: Record<string, unknown>;
  clientSignature: string;
  keyIdString: string;
  keyRecord?: AccountSigningKey | undefined;
}

/**
 * Cryptographically generates a W3C Data Integrity proof (eddsa-jcs-2022)
 * for a seed post using a deterministic persona key.
 */
export function createSeedPostProof(
  content: string,
  createdAt: string,
  keySpec: SeedKeyDefinition,
  context?: {
    replyToId?: number | string | null | undefined;
    quotePostId?: number | string | null | undefined;
    artifactId?: number | string | null | undefined;
  },
  keyRecord?: AccountSigningKey | undefined,
): SeedProofResult {
  const payload: Record<string, unknown> = {
    content,
    created_at: createdAt,
  };
  if (context?.replyToId != null) {
    payload["reply_to_id"] = String(context.replyToId);
  }
  if (context?.quotePostId != null) {
    payload["quote_post_id"] = String(context.quotePostId);
  }
  if (context?.artifactId != null) {
    payload["artifact_id"] = String(context.artifactId);
  }

  const verificationMethod = `did:key:${keySpec.publicKeyMultibase}#${keySpec.publicKeyMultibase}`;
  const proofConfig = {
    type: "DataIntegrityProof" as const,
    cryptosuite: "eddsa-jcs-2022" as const,
    created: createdAt,
    verificationMethod,
    proofPurpose: "assertionMethod" as const,
  };

  const canonicalPayload = canonicalizeJson(payload);
  const payloadHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();
  const canonicalConfig = canonicalizeJson(proofConfig);
  const configHash = crypto.createHash("sha256").update(canonicalConfig, "utf8").digest();

  const signingData = Buffer.concat([configHash, payloadHash]);
  const privKey = crypto.createPrivateKey(keySpec.privateKeyPem);
  const sig = crypto.sign(null, signingData, privKey);
  const proofValue = encodeMultibase(sig);

  const proof = {
    ...proofConfig,
    proofValue,
  };

  return {
    proof,
    payload,
    clientSignature: proofValue,
    keyIdString: keySpec.fingerprintSha256,
    keyRecord,
  };
}

/**
 * Returns the default signing key definition for a given persona username.
 */
export function getSeedSigningKeyForUser(username: string): SeedKeyDefinition | undefined {
  if (username === "omar") {
    // Prefer delegated workstation key for posts (master key acts as offline attester)
    return SEED_SIGNING_KEYS.find((k) => k.idKey === "omarDevice");
  }
  return SEED_SIGNING_KEYS.find((k) => k.username === username);
}
