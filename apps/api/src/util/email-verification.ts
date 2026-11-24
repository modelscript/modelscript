// SPDX-License-Identifier: AGPL-3.0-or-later

import { JWT_SECRET } from "../middleware/auth-middleware.js";
import { signHmacToken, verifyHmacToken } from "./hmac-token.js";

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
  return signHmacToken({ userId, email: email.toLowerCase().trim() }, secret, expiresInMs);
}

/**
 * Validates an email verification token signature and expiration.
 */
export function verifyEmailVerificationToken(
  token: string,
  secret: string = JWT_SECRET,
): { valid: boolean; userId?: number | undefined; email?: string | undefined; error?: string | undefined } {
  const result = verifyHmacToken<{ userId: number; email: string }>(token, secret);
  if (!result.valid) {
    if (result.code === "expired") {
      return { valid: false, error: "Verification token has expired" };
    }
    return { valid: false, error: result.error };
  }

  const { payload } = result;
  if (!payload.userId || !payload.email) {
    return { valid: false, error: "Invalid token payload structure" };
  }

  return {
    valid: true,
    userId: payload.userId,
    email: payload.email,
  };
}
