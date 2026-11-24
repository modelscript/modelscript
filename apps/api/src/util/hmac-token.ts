// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

export interface HmacTokenEnvelope {
  expiresAt: number; // Unix timestamp in milliseconds
}

export type HmacVerifyErrorCode = "malformed" | "invalid_signature" | "invalid_payload" | "expired";

export type HmacVerifyResult<T> =
  { valid: true; payload: T & HmacTokenEnvelope } | { valid: false; code: HmacVerifyErrorCode; error: string };

/**
 * Generates a tamper-proof base64url + HMAC-SHA256 signed token with an embedded `expiresAt` timestamp.
 */
export function signHmacToken<T extends Record<string, unknown>>(payload: T, secret: string, ttlMs: number): string {
  const envelope: T & HmacTokenEnvelope = {
    ...payload,
    expiresAt: Date.now() + ttlMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Decodes a signed token's payload without cryptographic verification.
 */
export function parseHmacTokenPayload<T>(token: string): T | null {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [payloadB64] = token.split(".");
  if (!payloadB64) return null;
  try {
    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(payloadStr) as T;
  } catch {
    return null;
  }
}

/**
 * Validates an HMAC-SHA256 signed token's format, signature (constant-time), payload structure, and expiration.
 */
export function verifyHmacToken<T extends Record<string, unknown>>(token: string, secret: string): HmacVerifyResult<T> {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, code: "malformed", error: "Malformed token format" };
  }

  const [payloadB64, providedSig] = token.split(".");
  if (!payloadB64 || !providedSig) {
    return { valid: false, code: "malformed", error: "Malformed token parts" };
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedSig, "utf8");
  const expectedBuffer = Buffer.from(expectedSig, "utf8");

  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, code: "invalid_signature", error: "Invalid cryptographic signature" };
  }

  try {
    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadStr) as T & HmacTokenEnvelope;

    if (!payload || typeof payload !== "object" || typeof payload.expiresAt !== "number") {
      return { valid: false, code: "invalid_payload", error: "Invalid token payload structure" };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, code: "expired", error: "Token has expired" };
    }

    return { valid: true, payload };
  } catch (err: unknown) {
    return {
      valid: false,
      code: "invalid_payload",
      error: `Failed to decode token payload: ${(err as Error).message}`,
    };
  }
}
