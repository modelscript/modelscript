// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { resolveActiveEnterpriseLicense, type EnterpriseFeature, type LicenseVerificationResult } from "./verifier.js";

/**
 * Express middleware that verifies an active Enterprise Edition license and checks
 * that the requested `feature` is included in the license grant.
 */
export function requireEnterpriseFeature(feature?: EnterpriseFeature) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const status: LicenseVerificationResult = resolveActiveEnterpriseLicense();
    if (!status.valid || !status.claims) {
      const httpStatus = status.mode === "expired" ? 403 : 402;
      res.status(httpStatus).json({
        error: "Enterprise License Required",
        code: status.mode === "expired" ? "EE_LICENSE_EXPIRED" : "EE_LICENSE_INVALID",
        mode: status.mode,
        message:
          status.reason ||
          "A valid ModelScript Enterprise Edition license key (MSX_LICENSE_KEY) is required to access this feature.",
        pricingUrl: "https://modelscript.org/pricing",
      });
      return;
    }

    if (feature && !status.claims.features.includes(feature)) {
      res.status(403).json({
        error: "Enterprise Feature Not Licensed",
        code: "EE_FEATURE_NOT_ENTITLED",
        requiredFeature: feature,
        tier: status.claims.tier,
        message: `Your Enterprise license ('${status.claims.org}', tier '${status.claims.tier}') does not include the '${feature}' entitlement.`,
        pricingUrl: "https://modelscript.org/pricing",
      });
      return;
    }

    next();
  };
}

/**
 * Router exposing `/api/v1/ee/license/status` for appliance operators and compliance auditors.
 */
export function createEnterpriseLicenseRouter(): Router {
  const router = express.Router();

  router.get("/ee/license/status", (_req: Request, res: Response) => {
    const result = resolveActiveEnterpriseLicense();
    res.status(result.valid ? 200 : 402).json({
      edition: "ee",
      licenseSpdx: "LicenseRef-ModelScript-Enterprise",
      valid: result.valid,
      mode: result.mode,
      reason: result.reason ?? null,
      claims: result.claims ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
