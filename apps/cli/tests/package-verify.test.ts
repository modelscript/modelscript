// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { computePackageContentHash, verifyPackageContentHash } from "../src/util/package-verify.js";

describe("Package CAS Verification Utility", () => {
  const originalBuffer = Buffer.from("model BatteryCell Real capacity=50.0; end BatteryCell;");
  const tamperedBuffer = Buffer.from("model BatteryCell Real capacity=5.0; end BatteryCell;");

  test("computes sha256 CAS content hash accurately", () => {
    const hash = computePackageContentHash(originalBuffer);
    assert.ok(hash.startsWith("sha256:"));
    assert.equal(hash.length, 7 + 64);
  });

  test("verifies untampered package matches expected hash", () => {
    const expected = computePackageContentHash(originalBuffer);
    const result = verifyPackageContentHash(originalBuffer, expected);
    assert.equal(result.valid, true);
    assert.equal(result.computedHash, expected);
    assert.equal(result.expectedHash, expected);
  });

  test("detects single-character parameter tampering and reports M3010 error", () => {
    const originalHash = computePackageContentHash(originalBuffer);
    const result = verifyPackageContentHash(tamperedBuffer, originalHash);
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("M3010"));
    assert.ok(result.error.includes("Parameter tampering"));
    assert.notEqual(result.computedHash, result.expectedHash);
  });
});
