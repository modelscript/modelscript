// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, Request, Response } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";
import { resolveActiveEnterpriseLicense } from "../license/verifier.js";

export interface EnterpriseEntitlementCheck {
  allowed: boolean;
  statusCode: 200 | 402 | 403 | 501;
  code?: string | undefined;
  reason?: string | undefined;
}

/**
 * Verifies whether Real-Time Multi-User WebSocket Co-Editing (`/api/v1/collab/stream`)
 * is entitled under the active Enterprise Edition license (`saml_oidc_sso`).
 */
export function verifyEnterpriseCollabSession(): EnterpriseEntitlementCheck {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return {
      allowed: false,
      statusCode: 501,
      code: "EE_EDITION_REQUIRED",
      reason:
        "Real-time multi-user co-editing rooms (/api/v1/collab/stream) require ModelScript Enterprise Edition (MSX_EDITION=ee).",
    };
  }

  const license = resolveActiveEnterpriseLicense();
  if (!license.valid) {
    return {
      allowed: false,
      statusCode: license.mode === "unlicensed" ? 402 : 403,
      code: license.mode === "unlicensed" ? "EE_LICENSE_REQUIRED" : "EE_LICENSE_INVALID",
      reason:
        license.reason ??
        "Real-time multi-user co-editing requires a valid ModelScript Enterprise Edition license (MSX_LICENSE_KEY).",
    };
  }

  if (license.mode === "licensed" && license.claims && !license.claims.features.includes("saml_oidc_sso")) {
    return {
      allowed: false,
      statusCode: 403,
      code: "EE_FEATURE_NOT_ENTITLED",
      reason: `Active Enterprise license for '${license.claims.org}' does not include the 'saml_oidc_sso' entitlement required for multi-user co-editing rooms.`,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
  };
}

/**
 * Verifies whether setting repository or package visibility to `private` or `internal`
 * is entitled under the active Enterprise Edition license (`saml_oidc_sso`).
 */
export function verifyPrivateVisibilityEntitlement(): EnterpriseEntitlementCheck {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return {
      allowed: false,
      statusCode: 501,
      code: "EE_EDITION_REQUIRED",
      reason:
        "Private and organization-internal repositories require ModelScript Enterprise Edition (MSX_EDITION=ee). Community Edition repositories must be public under AGPL-3.0-or-later.",
    };
  }

  const license = resolveActiveEnterpriseLicense();
  if (!license.valid) {
    return {
      allowed: false,
      statusCode: license.mode === "unlicensed" ? 402 : 403,
      code: license.mode === "unlicensed" ? "EE_LICENSE_REQUIRED" : "EE_LICENSE_INVALID",
      reason:
        license.reason ??
        "Private repository visibility requires a valid ModelScript Enterprise Edition license (MSX_LICENSE_KEY).",
    };
  }

  if (license.mode === "licensed" && license.claims && !license.claims.features.includes("saml_oidc_sso")) {
    return {
      allowed: false,
      statusCode: 403,
      code: "EE_FEATURE_NOT_ENTITLED",
      reason: `Active Enterprise license for '${license.claims.org}' does not include the 'saml_oidc_sso' entitlement required for private repository visibility.`,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
  };
}

/**
 * Mounts Batch I Enterprise Collaboration, AI PR Review & Industry 4.0 Digital Twin Archive Gates:
 * - Real-Time Multi-User Co-Editing Status (`/api/v1/ee/collab/status`) gated by `saml_oidc_sso`
 * - Automated AI Pull Request / Commit Model Reviews (`/api/v1/repos/:id/reviews`) gated by `plm_connectors`
 * - OMG KerML / SysML v2 Archive Export (`/api/v1/libraries/:name/:version/export/kpar`) gated by `sysml2_omg_api`
 * - IDTA Asset Administration Shell Export (`/api/v1/libraries/:name/:version/export/aasx`) gated by `sysml2_omg_api`
 */
export function mountEnterpriseCollabAndExports(app: Express): void {
  app.get("/api/v1/ee/collab/status", requireEnterpriseFeature("saml_oidc_sso"), (_req: Request, res: Response) => {
    const license = resolveActiveEnterpriseLicense();
    res.json({
      edition: "ee",
      licenseSpdx: "LicenseRef-ModelScript-Enterprise",
      collabEnabled: true,
      privateReposEnabled: true,
      maxConcurrentPeersPerRoom: license.claims?.seats ?? 64,
    });
  });

  app.use("/api/v1/repos/:id/reviews", requireEnterpriseFeature("plm_connectors"));

  app.use(
    [
      "/api/v1/libraries/:name/:version/export/kpar",
      "/api/v1/libraries/:scope/:name/:version/export/kpar",
      "/api/v1/libraries/:name/:version/export/aasx",
      "/api/v1/libraries/:scope/:name/:version/export/aasx",
    ],
    requireEnterpriseFeature("sysml2_omg_api"),
  );
}
