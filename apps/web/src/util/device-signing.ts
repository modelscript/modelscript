// SPDX-License-Identifier: AGPL-3.0-or-later

import { encodeMultibase } from "./crypto/base58";
import { canonicalizeJson } from "./crypto/jcs";
import { getActiveDeviceSigningKey, type StoredDeviceKey } from "./keystore";

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

export interface PostSigningResult {
  proof: DataIntegrityProof;
  payload: Record<string, unknown>;
  keyId: string;
  fingerprintSha256: string;
}

/**
 * Checks whether an active Web Browser Device Key is available in local storage.
 */
export async function hasActiveDeviceSigningKey(): Promise<boolean> {
  try {
    const key = await getActiveDeviceSigningKey();
    return Boolean(key && key.privateKey);
  } catch {
    return false;
  }
}

export interface SignPostContext {
  customCreatedAt?: string;
  replyToId?: number | string | null;
  quotePostId?: number | string | null;
  artifactId?: number | string | null;
  domain?: string | null;
}

/**
 * Signs post markdown content using the active Web Browser Device Key (Ed25519 WebCrypto).
 * Produces a standard W3C Data Integrity proof (eddsa-jcs-2022).
 */
export async function signPostWithDeviceKey(
  content: string,
  contextOrCreatedAt?: string | SignPostContext,
): Promise<PostSigningResult | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return null;
  }

  let key: StoredDeviceKey | null = null;
  try {
    key = await getActiveDeviceSigningKey();
  } catch {
    return null;
  }

  if (!key || !key.privateKey) {
    return null;
  }

  try {
    const context: SignPostContext =
      typeof contextOrCreatedAt === "string" ? { customCreatedAt: contextOrCreatedAt } : contextOrCreatedAt || {};

    const createdAt = context.customCreatedAt || new Date().toISOString();
    const payload: Record<string, unknown> = {
      content,
      created_at: createdAt,
    };
    if (context.replyToId != null) {
      payload["reply_to_id"] = String(context.replyToId);
    }
    if (context.quotePostId != null) {
      payload["quote_post_id"] = String(context.quotePostId);
    }
    if (context.artifactId != null) {
      payload["artifact_id"] = String(context.artifactId);
    }
    if (context.domain) {
      payload["domain"] = context.domain;
    }

    const verificationMethod = key.publicKeyMultibase.startsWith("z")
      ? `did:key:${key.publicKeyMultibase}#${key.publicKeyMultibase}`
      : key.fingerprintSha256;

    const proofConfig = {
      type: "DataIntegrityProof" as const,
      cryptosuite: "eddsa-jcs-2022" as const,
      created: createdAt,
      verificationMethod,
      proofPurpose: "assertionMethod" as const,
    };

    const encoder = new TextEncoder();
    const canonicalPayload = canonicalizeJson(payload);
    const payloadHashBuf = await window.crypto.subtle.digest("SHA-256", encoder.encode(canonicalPayload));

    const canonicalConfig = canonicalizeJson(proofConfig);
    const configHashBuf = await window.crypto.subtle.digest("SHA-256", encoder.encode(canonicalConfig));

    const signingData = new Uint8Array(64);
    signingData.set(new Uint8Array(configHashBuf), 0);
    signingData.set(new Uint8Array(payloadHashBuf), 32);

    const sigBuf = await window.crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, signingData);
    const proofValue = encodeMultibase(new Uint8Array(sigBuf));

    const proof: DataIntegrityProof = {
      ...proofConfig,
      proofValue,
    };

    return {
      proof,
      payload,
      keyId: key.id,
      fingerprintSha256: key.fingerprintSha256,
    };
  } catch (err) {
    console.warn("Failed to sign post with Web Browser Device Key:", err);
    return null;
  }
}
