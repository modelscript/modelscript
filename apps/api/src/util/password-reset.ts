// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { JWT_SECRET } from "../middleware/auth-middleware.js";

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
  const payload: PasswordResetTokenPayload = {
    userId,
    email: email.toLowerCase().trim(),
    tokenVersion,
    expiresAt: Date.now() + expiresInMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmacSecret = buildResetSecret(secret, passwordHash, tokenVersion);
  const signature = crypto.createHmac("sha256", hmacSecret).update(payloadB64).digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Decodes and inspects the token payload without cryptographic verification.
 * Useful to retrieve the userId/email in order to fetch the user's current hash/tokenVersion from DB.
 */
export function parsePasswordResetTokenPayload(token: string): PasswordResetTokenPayload | null {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [payloadB64] = token.split(".");
  if (!payloadB64) return null;
  try {
    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(payloadStr) as PasswordResetTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Validates a password reset token signature, expiration, and user state.
 */
export function verifyPasswordResetToken(
  token: string,
  currentUser: { id: number; email: string; token_version?: number; password_hash?: string | null },
  secret: string = JWT_SECRET,
): { valid: boolean; userId?: number; email?: string; error?: string } {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Malformed reset token" };
  }

  const [payloadB64, providedSig] = token.split(".");
  if (!payloadB64 || !providedSig) {
    return { valid: false, error: "Malformed reset token parts" };
  }

  let payload: PasswordResetTokenPayload;
  try {
    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
    payload = JSON.parse(payloadStr) as PasswordResetTokenPayload;
  } catch (err: unknown) {
    return { valid: false, error: `Invalid reset token payload structure: ${(err as Error).message}` };
  }

  if (!payload.userId || !payload.email || typeof payload.expiresAt !== "number") {
    return { valid: false, error: "Missing required claims in reset token payload" };
  }

  if (payload.userId !== currentUser.id) {
    return { valid: false, error: "Token subject mismatch" };
  }

  const expectedTokenVersion = currentUser.token_version ?? 1;
  if (payload.tokenVersion !== expectedTokenVersion) {
    return { valid: false, error: "Reset token has already been used or was revoked" };
  }

  if (Date.now() > payload.expiresAt) {
    return { valid: false, error: "Password reset link has expired. Please request a new one." };
  }

  const hmacSecret = buildResetSecret(secret, currentUser.password_hash, expectedTokenVersion);
  const expectedSig = crypto.createHmac("sha256", hmacSecret).update(payloadB64).digest("base64url");

  const providedBuffer = Buffer.from(providedSig, "utf8");
  const expectedBuffer = Buffer.from(expectedSig, "utf8");

  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid password reset token signature" };
  }

  return {
    valid: true,
    userId: payload.userId,
    email: payload.email,
  };
}
