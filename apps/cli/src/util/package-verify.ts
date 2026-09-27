// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";

export interface PackageVerificationResult {
  valid: boolean;
  computedHash: string;
  expectedHash: string;
  error?: string;
}

/**
 * Computes the canonical SHA-256 CAS content hash of an archive buffer.
 */
export function computePackageContentHash(buffer: Buffer | Uint8Array): string {
  const hex = crypto.createHash("sha256").update(buffer).digest("hex");
  return `sha256:${hex}`;
}

/**
 * Verifies that a package archive buffer matches its pinned cryptographic SHA-256 hash.
 * If expectedHash does not match, returns valid: false with diagnostic details.
 */
export function verifyPackageContentHash(buffer: Buffer | Uint8Array, expectedHash: string): PackageVerificationResult {
  const cleanExpected = expectedHash
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  const computedHex = crypto.createHash("sha256").update(buffer).digest("hex");
  const computedHash = `sha256:${computedHex}`;
  const formattedExpected = `sha256:${cleanExpected}`;

  if (computedHex !== cleanExpected) {
    return {
      valid: false,
      computedHash,
      expectedHash: formattedExpected,
      error: `Package content hash mismatch (M3010). Expected: ${formattedExpected}, computed: ${computedHash}. Parameter tampering or corrupt payload detected.`,
    };
  }

  return {
    valid: true,
    computedHash,
    expectedHash: formattedExpected,
  };
}
