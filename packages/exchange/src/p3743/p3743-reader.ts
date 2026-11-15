// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from "node:crypto";
import type { P3743Package, P3743ValidationResult } from "./types.js";

/**
 * Computes the SHA-256 hex digest of a binary or base64-encoded vendor model payload.
 */
export function computeP3743PayloadDigest(payload: Uint8Array | string): string {
  const buf = typeof payload === "string" ? Buffer.from(payload, "base64") : Buffer.from(payload);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Validates structural and cryptographic integrity of an IEEE P3743 package.
 */
export function validateP3743Package(pkg: P3743Package): P3743ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (pkg.metadata?.schemaVersion !== "IEEE-P3743-draft-1.0") {
    errors.push(`Unsupported P3743 schemaVersion: ${String(pkg.metadata?.schemaVersion)}`);
  }
  if (!pkg.metadata?.caseId) {
    errors.push("P3743 metadata.caseId is required.");
  }
  if (pkg.metadata?.nominalFrequencyHz !== 50 && pkg.metadata?.nominalFrequencyHz !== 60) {
    errors.push(`Invalid nominalFrequencyHz: ${String(pkg.metadata?.nominalFrequencyHz)}`);
  }

  const busIds = new Set(pkg.buses.map((b) => b.id));
  for (const corridor of pkg.corridors) {
    if (!busIds.has(corridor.fromBusId)) {
      errors.push(`Corridor '${corridor.id}' references unknown fromBusId '${corridor.fromBusId}'.`);
    }
    if (!busIds.has(corridor.toBusId)) {
      errors.push(`Corridor '${corridor.id}' references unknown toBusId '${corridor.toBusId}'.`);
    }
    if (corridor.lengthKm <= 0) {
      errors.push(`Corridor '${corridor.id}' must have positive lengthKm.`);
    }
  }

  for (const vm of pkg.vendorModels) {
    if (!busIds.has(vm.busId)) {
      errors.push(`Vendor model '${vm.id}' references unknown busId '${vm.busId}'.`);
    }
    if (!vm.payloadBase64 && !vm.payloadUri) {
      errors.push(`Vendor model '${vm.id}' must provide either payloadBase64 or payloadUri.`);
    }
    if (vm.payloadBase64) {
      const actual = computeP3743PayloadDigest(vm.payloadBase64);
      if (actual !== vm.sha256.toLowerCase()) {
        errors.push(`Vendor model '${vm.id}' SHA-256 mismatch (expected ${vm.sha256}, got ${actual}).`);
      }
    }
    if (vm.modelInfo.recommendedTimeStepSec > 100e-6) {
      warnings.push(
        `Vendor model '${vm.id}' recommendedTimeStepSec (${vm.modelInfo.recommendedTimeStepSec}s) exceeds typical 100 us EMT step.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parses and validates an IEEE P3743 JSON document.
 */
export function parseP3743Package(jsonText: string): {
  pkg: P3743Package;
  validation: P3743ValidationResult;
} {
  const pkg = JSON.parse(jsonText) as P3743Package;
  const validation = validateP3743Package(pkg);
  return { pkg, validation };
}
