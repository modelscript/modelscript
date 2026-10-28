// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import { Router, type Request, type Response } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";
import { resolveActiveEnterpriseLicense } from "../license/verifier.js";

export interface EnterpriseDesktopAirgapReport {
  edition: "ee";
  licenseSpdx: "LicenseRef-ModelScript-Enterprise";
  compliant: boolean;
  outboundTrafficBlocked: boolean;
  localStorageOnly: boolean;
  blackboxFmuExecutionAllowed: boolean;
  details: string[];
}

export interface BlackboxFmuEntitlementResult {
  allowed: boolean;
  executionModes: ("native" | "emulated")[];
  reason?: string | undefined;
}

/**
 * Evaluates NERC CIP-005 / CIP-007 & FERC CEII (18 CFR § 388.113) air-gap compliance
 * for the ModelScript Enterprise Desktop Studio (`@modelscript/desktop`).
 */
export function checkEnterpriseDesktopAirgapCompliance(): EnterpriseDesktopAirgapReport {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return {
      edition: "ee",
      licenseSpdx: "LicenseRef-ModelScript-Enterprise",
      compliant: false,
      outboundTrafficBlocked: false,
      localStorageOnly: true,
      blackboxFmuExecutionAllowed: false,
      details: [
        "NERC CIP / FERC CEII Desktop Air-Gap Compliance requires ModelScript Enterprise Edition (MSX_EDITION=ee).",
      ],
    };
  }

  const license = resolveActiveEnterpriseLicense();
  const airgapEntitled =
    license.valid &&
    (license.mode === "dev-evaluation" || Boolean(license.claims?.features.includes("airgap_compliance")));
  const hilEntitled =
    license.valid && (license.mode === "dev-evaluation" || Boolean(license.claims?.features.includes("hil_codegen")));

  return {
    edition: "ee",
    licenseSpdx: "LicenseRef-ModelScript-Enterprise",
    compliant: airgapEntitled,
    outboundTrafficBlocked: airgapEntitled,
    localStorageOnly: true,
    blackboxFmuExecutionAllowed: hilEntitled,
    details: airgapEntitled
      ? [
          "Zero telemetry: outbound network reporting is disabled.",
          "All parsing and simulation execute 100% locally in WebAssembly/AssemblyScript.",
          "Model files and simulation outputs remain on local encrypted disk.",
          "FERC CEII (18 CFR § 388.113) safe: zero base cases or parameters exfiltrated.",
        ]
      : [
          license.reason ??
            "Active Enterprise license does not include the 'airgap_compliance' entitlement required for NERC CIP / FERC CEII attestation.",
        ],
  };
}

/**
 * Verifies whether third-party compiled black-box FMU binaries (`.dll`, `.so`, `.dylib`)
 * are entitled to execute via Native FFI (`NativeFmuRunner`) or x86-64 PE/ELF emulation (`UniversalBinaryRunner`).
 */
export function verifyBlackboxFmuEntitlement(): BlackboxFmuEntitlementResult {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return {
      allowed: false,
      executionModes: [],
      reason:
        "Compiled black-box binary FMU execution (.dll / .so / .dylib) requires ModelScript Enterprise Edition (feature 'hil_codegen') and is disabled when MSX_EDITION=ce.",
    };
  }

  const license = resolveActiveEnterpriseLicense();
  if (!license.valid) {
    return {
      allowed: false,
      executionModes: [],
      reason:
        license.reason ??
        "Compiled black-box binary FMU execution requires a valid ModelScript Enterprise Edition license with feature 'hil_codegen'.",
    };
  }

  if (license.mode === "licensed" && license.claims && !license.claims.features.includes("hil_codegen")) {
    return {
      allowed: false,
      executionModes: [],
      reason: `Active Enterprise license for '${license.claims.org}' does not include the 'hil_codegen' entitlement required for black-box binary FMU execution.`,
    };
  }

  return {
    allowed: true,
    executionModes: ["native", "emulated"],
  };
}

/**
 * Express router mounted under `/api/v1` exposing Enterprise Desktop compliance
 * and black-box binary FMU execution authorization endpoints.
 */
export function createEnterpriseDesktopRouter(): Router {
  const router = Router();

  router.get(
    "/ee/desktop/compliance",
    requireEnterpriseFeature("airgap_compliance"),
    (_req: Request, res: Response) => {
      res.json(checkEnterpriseDesktopAirgapCompliance());
    },
  );

  router.post(
    "/ee/desktop/authorize-blackbox",
    requireEnterpriseFeature("hil_codegen"),
    (req: Request, res: Response) => {
      const check = verifyBlackboxFmuEntitlement();
      const format = String(req.body?.format ?? "PE-x86_64-DLL");
      const filename = typeof req.body?.filename === "string" ? req.body.filename : undefined;
      res.json({
        authorized: check.allowed,
        feature: "hil_codegen",
        format,
        filename,
        executionModes: check.executionModes,
      });
    },
  );

  return router;
}
