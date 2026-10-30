// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ENCRYPTED_TOTP_PREFIX = "enc:v1:";

function deriveTotpEncryptionKey(): Buffer {
  const rawMaterial =
    process.env["TOTP_ENCRYPTION_KEY"] || process.env["JWT_SECRET"] || "modelscript-dev-totp-fallback-key";
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(rawMaterial, "utf8"),
      Buffer.from("modelscript-totp-salt-v1", "utf8"),
      Buffer.from("totp-secret-aes256gcm", "utf8"),
      32,
    ),
  );
}

/**
 * Encrypts a Base32 TOTP secret at rest using AES-256-GCM (`enc:v1:<iv>:<tag>:<ciphertext>`).
 * Idempotent if the value is already encrypted.
 */
export function encryptTotpSecret(plainSecret: string): string {
  if (!plainSecret || plainSecret.startsWith(ENCRYPTED_TOTP_PREFIX)) {
    return plainSecret;
  }
  const key = deriveTotpEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTED_TOTP_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts an `enc:v1:...` TOTP secret back to Base32, or returns legacy plaintext secrets unchanged.
 */
export function decryptTotpSecret(storedSecret: string): string {
  if (!storedSecret || !storedSecret.startsWith(ENCRYPTED_TOTP_PREFIX)) {
    return storedSecret;
  }
  const payload = storedSecret.slice(ENCRYPTED_TOTP_PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted TOTP secret");
  }
  const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
  const key = deriveTotpEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

export const encryptSecretAtRest = encryptTotpSecret;
export const decryptSecretAtRest = decryptTotpSecret;

export function maskSecretPreview(secret: string | undefined | null): string {
  if (!secret) return "";
  try {
    const plain = decryptSecretAtRest(secret);
    if (!plain) return "";
    if (plain.length <= 6) return "••••••••";
    return `${plain.slice(0, 3)}••••••${plain.slice(-3)}`;
  } catch {
    return "••••••••";
  }
}

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
export function generateTotpUri(options: { accountName: string; issuer?: string | undefined; secret: string }): string {
  const issuer = options.issuer || "Ansatz";
  const account = options.accountName;
  const secret = decryptTotpSecret(options.secret);

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
  const plainSecret = decryptTotpSecret(secret);
  const key = base32Decode(plainSecret);
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

const MAX_REPLAY_ENTRIES = 10_000;
const consumedTotpSteps = new Map<string, number>();

export function clearTotpReplayCache(): void {
  consumedTotpSteps.clear();
}

export interface VerifyTotpOptions {
  windowSteps?: number | undefined;
  timestampMs?: number | undefined;
  preventReplay?: boolean | undefined;
}

/**
 * Verifies a 6-digit TOTP code against a secret with clock drift tolerance.
 * Window = 1 means checking [current - 30s, current, current + 30s].
 */
export function verifyTotpCode(
  secret: string,
  inputCode: string,
  windowStepsOrOptions: number | VerifyTotpOptions = 1,
  timestampMs: number = Date.now(),
  options?: { preventReplay?: boolean | undefined },
): boolean {
  if (!secret || !inputCode) return false;
  let plainSecret: string;
  try {
    plainSecret = decryptTotpSecret(secret);
  } catch {
    return false;
  }
  const cleanCode = inputCode.replace(/\s+/g, "").trim();
  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return false;
  }

  const windowSteps =
    typeof windowStepsOrOptions === "number" ? windowStepsOrOptions : (windowStepsOrOptions.windowSteps ?? 1);
  const effectiveTimestampMs =
    typeof windowStepsOrOptions === "object" && windowStepsOrOptions.timestampMs !== undefined
      ? windowStepsOrOptions.timestampMs
      : timestampMs;
  const preventReplay =
    typeof windowStepsOrOptions === "object"
      ? Boolean(windowStepsOrOptions.preventReplay)
      : Boolean(options?.preventReplay);

  const inputBuf = Buffer.from(cleanCode, "utf8");

  for (let step = -windowSteps; step <= windowSteps; step++) {
    const candidateTime = effectiveTimestampMs + step * 30_000;
    const expected = generateTotpCode(plainSecret, candidateTime);
    const expectedBuf = Buffer.from(expected, "utf8");

    if (expectedBuf.length === inputBuf.length && crypto.timingSafeEqual(expectedBuf, inputBuf)) {
      const matchedStep = Math.floor(candidateTime / 1000 / 30);
      const secretKey = crypto.createHash("sha256").update(plainSecret).digest("hex");
      if (preventReplay) {
        const lastStep = consumedTotpSteps.get(secretKey);
        if (lastStep !== undefined && matchedStep <= lastStep) {
          return false;
        }
      }
      if (consumedTotpSteps.size >= MAX_REPLAY_ENTRIES) {
        const oldestKey = consumedTotpSteps.keys().next().value;
        if (oldestKey !== undefined) {
          consumedTotpSteps.delete(oldestKey);
        }
      }
      consumedTotpSteps.set(secretKey, matchedStep);
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
): { valid: boolean; matchedHash?: string | undefined; remainingHashes: string[] } {
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
