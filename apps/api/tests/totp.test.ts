// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  generateTotpUri,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "../src/util/totp.js";

test("TOTP Utility - Base32 roundtrip", () => {
  const original = Buffer.from("Hello ModelScript 2FA World!", "utf8");
  const encoded = base32Encode(original);
  assert.ok(encoded.length > 0);
  const decoded = base32Decode(encoded);
  assert.deepEqual(decoded, original);
});

test("TOTP Utility - Secret and URI generation", () => {
  const secret = generateTotpSecret();
  assert.strictEqual(secret.length, 32); // 20 bytes = 160 bits / 5 = 32 chars
  assert.match(secret, /^[A-Z2-7]+$/);

  const uri = generateTotpUri({
    accountName: "alice@modelscript.org",
    secret,
  });

  assert.ok(uri.startsWith("otpauth://totp/ModelScript:alice%40modelscript.org?"));
  assert.ok(uri.includes(`secret=${secret}`));
  assert.ok(uri.includes("digits=6"));
  assert.ok(uri.includes("period=30"));
});

test("TOTP Utility - Code generation and verification with drift window", () => {
  const secret = generateTotpSecret();
  const now = Date.now();

  const code = generateTotpCode(secret, now);
  assert.strictEqual(code.length, 6);
  assert.match(code, /^\d{6}$/);

  // Verification at same timestamp
  assert.strictEqual(verifyTotpCode(secret, code, 1, now), true);

  // Verification within 30-second window drift
  assert.strictEqual(verifyTotpCode(secret, code, 1, now + 25_000), true);
  assert.strictEqual(verifyTotpCode(secret, code, 1, now - 25_000), true);

  // Invalid code
  assert.strictEqual(verifyTotpCode(secret, "000000" === code ? "999999" : "000000", 1, now), false);

  // Malformed codes
  assert.strictEqual(verifyTotpCode(secret, "abc", 1, now), false);
  assert.strictEqual(verifyTotpCode(secret, "1234567", 1, now), false);
});

test("TOTP Utility - Single-use backup codes generation and consumption", () => {
  const { plainCodes, hashedCodes } = generateBackupCodes(10);
  assert.strictEqual(plainCodes.length, 10);
  assert.strictEqual(hashedCodes.length, 10);

  const codeToUse = plainCodes[0]!;
  assert.match(codeToUse, /^[0-9A-F]{4}-[0-9A-F]{4}$/);

  // Consume first code
  const result1 = verifyAndConsumeBackupCode(codeToUse, hashedCodes);
  assert.strictEqual(result1.valid, true);
  assert.strictEqual(result1.remainingHashes.length, 9);
  assert.strictEqual(result1.remainingHashes.includes(hashedCodes[0]!), false);

  // Attempting to consume same code again should fail
  const result2 = verifyAndConsumeBackupCode(codeToUse, result1.remainingHashes);
  assert.strictEqual(result2.valid, false);
  assert.strictEqual(result2.remainingHashes.length, 9);

  // Invalid code consumption
  const invalidResult = verifyAndConsumeBackupCode("FFFF-FFFF", result1.remainingHashes);
  assert.strictEqual(invalidResult.valid, false);
});
