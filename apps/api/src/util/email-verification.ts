// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { JWT_SECRET } from "../middleware/auth-middleware.js";

export interface VerificationTokenPayload {
  userId: number;
  email: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generates a tamper-proof HMAC-SHA256 signed email verification token.
 */
export function signEmailVerificationToken(
  userId: number,
  email: string,
  secret: string = JWT_SECRET,
  expiresInMs: number = DEFAULT_EXPIRY_MS,
): string {
  const payload: VerificationTokenPayload = {
    userId,
    email: email.toLowerCase().trim(),
    expiresAt: Date.now() + expiresInMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Validates an email verification token signature and expiration.
 */
export function verifyEmailVerificationToken(
  token: string,
  secret: string = JWT_SECRET,
): { valid: boolean; userId?: number; email?: string; error?: string } {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Malformed token format" };
  }

  const [payloadB64, providedSig] = token.split(".");
  if (!payloadB64 || !providedSig) {
    return { valid: false, error: "Malformed token parts" };
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedSig, "utf8");
  const expectedBuffer = Buffer.from(expectedSig, "utf8");

  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid cryptographic signature" };
  }

  try {
    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadStr) as VerificationTokenPayload;

    if (!payload.userId || !payload.email || typeof payload.expiresAt !== "number") {
      return { valid: false, error: "Invalid token payload structure" };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Verification token has expired" };
    }

    return {
      valid: true,
      userId: payload.userId,
      email: payload.email,
    };
  } catch (err: unknown) {
    return { valid: false, error: `Failed to decode token payload: ${(err as Error).message}` };
  }
}
