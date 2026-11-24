// SPDX-License-Identifier: AGPL-3.0-or-later

import { JWT_SECRET } from "../middleware/auth-middleware.js";
import { parseHmacTokenPayload, signHmacToken, verifyHmacToken } from "./hmac-token.js";

export interface PasswordResetTokenPayload {
  userId: number;
  email: string;
  tokenVersion: number;
  expiresAt: number; // Unix timestamp in milliseconds
}

const DEFAULT_RESET_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Builds a dynamic secret combining the server JWT_SECRET and the user's current password hash.
 * This guarantees instantaneous single-use invalidation once the password changes.
 */
function buildResetSecret(baseSecret: string, passwordHash: string | null | undefined, tokenVersion: number): string {
  return `${baseSecret}:${passwordHash || "nopass"}:${tokenVersion}`;
}

/**
 * Generates a tamper-proof HMAC-SHA256 signed password reset token.
 */
export function signPasswordResetToken(
  userId: number,
  email: string,
  tokenVersion: number = 1,
  passwordHash: string | null | undefined = null,
  secret: string = JWT_SECRET,
  expiresInMs: number = DEFAULT_RESET_EXPIRY_MS,
): string {
  const hmacSecret = buildResetSecret(secret, passwordHash, tokenVersion);
  return signHmacToken({ userId, email: email.toLowerCase().trim(), tokenVersion }, hmacSecret, expiresInMs);
}

/**
 * Decodes and inspects the token payload without cryptographic verification.
 * Useful to retrieve the userId/email in order to fetch the user's current hash/tokenVersion from DB.
 */
export function parsePasswordResetTokenPayload(token: string): PasswordResetTokenPayload | null {
  return parseHmacTokenPayload<PasswordResetTokenPayload>(token);
}

/**
 * Validates a password reset token signature, expiration, and user state.
 */
export function verifyPasswordResetToken(
  token: string,
  currentUser: {
    id: number;
    email: string;
    token_version?: number | undefined;
    password_hash?: string | null | undefined;
  },
  secret: string = JWT_SECRET,
): { valid: boolean; userId?: number | undefined; email?: string | undefined; error?: string | undefined } {
  const expectedTokenVersion = currentUser.token_version ?? 1;
  const hmacSecret = buildResetSecret(secret, currentUser.password_hash, expectedTokenVersion);

  const result = verifyHmacToken<{ userId: number; email: string; tokenVersion: number }>(token, hmacSecret);
  if (!result.valid) {
    if (result.code === "expired") {
      return { valid: false, error: "Password reset link has expired. Please request a new one." };
    }
    if (result.code === "invalid_signature") {
      return { valid: false, error: "Invalid password reset token signature" };
    }
    return { valid: false, error: result.error };
  }

  const { payload } = result;
  if (!payload.userId || !payload.email) {
    return { valid: false, error: "Missing required claims in reset token payload" };
  }

  if (payload.userId !== currentUser.id) {
    return { valid: false, error: "Token subject mismatch" };
  }

  if (payload.tokenVersion !== expectedTokenVersion) {
    return { valid: false, error: "Reset token has already been used or was revoked" };
  }

  return {
    valid: true,
    userId: payload.userId,
    email: payload.email,
  };
}
