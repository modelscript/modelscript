// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a Buffer to an RFC 4648 Base32 string (without padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string to a Buffer.
 * Ignores spaces, hyphens, and '=' padding.
 */
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[\s-=_]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]!;
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      continue;
    }

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a random Base32 TOTP secret key (default 20 bytes = 160 bits).
 */
export function generateTotpSecret(numBytes: number = 20): string {
  const bytes = crypto.randomBytes(numBytes);
  return base32Encode(bytes);
}

/**
 * Generates an otpauth://totp/... URI suitable for scanning in standard authenticator apps.
 */
export function generateTotpUri(options: { accountName: string; issuer?: string; secret: string }): string {
  const issuer = options.issuer || "ModelScript";
  const account = options.accountName;
  const secret = options.secret;

  const label = encodeURIComponent(issuer) + ":" + encodeURIComponent(account);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Computes the 6-digit TOTP code for a given secret and timestamp (RFC 6238).
 */
export function generateTotpCode(secret: string, timestampMs: number = Date.now()): string {
  const key = base32Decode(secret);
  const timeStep = Math.floor(timestampMs / 1000 / 30);

  // 8-byte big-endian counter
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(timeStep), 0);

  const hmac = crypto.createHmac("sha1", key).update(timeBuffer).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, "0");
}

/**
 * Verifies a 6-digit TOTP code against a secret with clock drift tolerance.
 * Window = 1 means checking [current - 30s, current, current + 30s].
 */
export function verifyTotpCode(
  secret: string,
  inputCode: string,
  windowSteps: number = 1,
  timestampMs: number = Date.now(),
): boolean {
  if (!secret || !inputCode) return false;
  const cleanCode = inputCode.replace(/\s+/g, "").trim();
  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return false;
  }

  const inputBuf = Buffer.from(cleanCode, "utf8");

  for (let step = -windowSteps; step <= windowSteps; step++) {
    const candidateTime = timestampMs + step * 30_000;
    const expected = generateTotpCode(secret, candidateTime);
    const expectedBuf = Buffer.from(expected, "utf8");

    if (expectedBuf.length === inputBuf.length && crypto.timingSafeEqual(expectedBuf, inputBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * Computes the SHA-256 hash of a backup recovery code for secure database storage.
 */
export function hashBackupCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Generates an array of single-use emergency backup recovery codes (e.g. 10 codes formatted as XXXX-XXXX).
 */
export function generateBackupCodes(count: number = 10): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 characters
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashBackupCode(formatted));
  }

  return { plainCodes, hashedCodes };
}

/**
 * Validates a backup recovery code against a stored list of SHA-256 hashed codes.
 * If valid, returns the matched hash and remaining code hashes so the consumed code can be removed.
 */
export function verifyAndConsumeBackupCode(
  inputCode: string,
  storedHashedCodes: string[],
): { valid: boolean; matchedHash?: string; remainingHashes: string[] } {
  if (!inputCode || !Array.isArray(storedHashedCodes) || storedHashedCodes.length === 0) {
    return { valid: false, remainingHashes: storedHashedCodes || [] };
  }

  const inputHash = hashBackupCode(inputCode);
  const inputHashBuf = Buffer.from(inputHash, "utf8");

  let matchIndex = -1;
  for (let i = 0; i < storedHashedCodes.length; i++) {
    const candidateBuf = Buffer.from(storedHashedCodes[i]!, "utf8");
    if (candidateBuf.length === inputHashBuf.length && crypto.timingSafeEqual(candidateBuf, inputHashBuf)) {
      matchIndex = i;
      break;
    }
  }

  if (matchIndex === -1) {
    return { valid: false, remainingHashes: storedHashedCodes };
  }

  const matchedHash = storedHashedCodes[matchIndex]!;
  const remainingHashes = storedHashedCodes.filter((_, idx) => idx !== matchIndex);
  return { valid: true, matchedHash, remainingHashes };
}
