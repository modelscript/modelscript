// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NRTL Validation Attestation & Commissioning Boundary Schema.
 *
 * Implements the ORNL / City Utilities NRTL Liability Framework:
 * - 3rd-party Nationally Recognized Testing Laboratory (NRTL) certification ID
 * - Explicit "as-left" commissioning boundary (PPC Vendor vs. MOD-Testing vs. HIL)
 * - Ed25519 cryptographic signature over model digest & grid-code compliance dossier
 */

import { createHash, sign, verify, type KeyObject } from "node:crypto";
import type { PmviewBatchSummary } from "./pmview-report.js";

export type CommissioningBoundaryMode = "PPC_VENDOR" | "MOD_TESTING_CONSULTANT" | "REAL_FIRMWARE_CODE" | "AS_BUILT_HIL";

export interface NrtlComplianceDossier {
  ieee2800Passed: boolean;
  prc029Passed: boolean;
  pmViewProfileName?: string | undefined;
  pmViewPassed?: boolean | undefined;
  mod032CompletenessScore?: number | undefined;
}

export interface NrtlAttestationPayload {
  attestationId: string;
  nrtlLabId: string;
  nrtlLabName: string;
  equipmentVendor: string;
  modelName: string;
  firmwareVersion: string;
  modelArtifactSha256: string;
  boundaryMode: CommissioningBoundaryMode;
  issuedAtIso: string;
  expiresAtIso?: string | undefined;
  dossier: NrtlComplianceDossier;
}

export interface SignedNrtlAttestation {
  payload: NrtlAttestationPayload;
  /** Canonical SHA-256 hex digest of `payload`. */
  payloadSha256: string;
  /** Base64-encoded Ed25519 signature over `payloadSha256`. */
  signatureBase64: string;
  /** PEM-encoded Ed25519 public key of the issuing NRTL. */
  publicKeyPem: string;
}

export function canonicalNrtlPayloadDigest(payload: NrtlAttestationPayload): string {
  const canonical = JSON.stringify(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Signs an NRTL validation attestation using an Ed25519 private key.
 */
export function signNrtlAttestation(
  payload: NrtlAttestationPayload,
  privateKey: KeyObject,
  publicKeyPem: string,
): SignedNrtlAttestation {
  const payloadSha256 = canonicalNrtlPayloadDigest(payload);
  const sig = sign(null, Buffer.from(payloadSha256, "utf8"), privateKey);
  return {
    payload,
    payloadSha256,
    signatureBase64: sig.toString("base64"),
    publicKeyPem,
  };
}

/**
 * Verifies an NRTL validation attestation's payload digest and Ed25519 signature.
 */
export function verifyNrtlAttestation(attestation: SignedNrtlAttestation): {
  valid: boolean;
  reason?: string | undefined;
} {
  const expectedDigest = canonicalNrtlPayloadDigest(attestation.payload);
  if (expectedDigest !== attestation.payloadSha256) {
    return { valid: false, reason: "Payload SHA-256 digest mismatch." };
  }
  const ok = verify(
    null,
    Buffer.from(attestation.payloadSha256, "utf8"),
    attestation.publicKeyPem,
    Buffer.from(attestation.signatureBase64, "base64"),
  );
  if (!ok) {
    return { valid: false, reason: "Ed25519 signature verification failed." };
  }
  return { valid: true };
}

/**
 * Attaches an ERCOT PMView batch test-suite summary to an NRTL compliance dossier.
 */
export function attachPmviewBatchToDossier(
  dossier: NrtlComplianceDossier,
  summary: PmviewBatchSummary,
): NrtlComplianceDossier {
  return {
    ...dossier,
    pmViewProfileName: summary.profileName,
    pmViewPassed: summary.allPassed,
  };
}
