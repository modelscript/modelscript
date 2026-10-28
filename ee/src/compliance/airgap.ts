// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";
import { resolveActiveEnterpriseLicense } from "../license/verifier.js";

export interface EnterpriseComplianceContext {
  isFeatureFlagEnabled(flagKey: string): boolean;
  hasAdminUser(): boolean;
  isDatabaseOpen(): boolean;
  isGeoIpReady(): boolean;
  getMailerDriver(): string;
  sanctionedCountriesCount: number;
  sanctionedRegionsCount: number;
}

/**
 * Middleware that injects strict Air-Gap Content-Security-Policy (CSP),
 * `X-Airgap-Enforced`, and `X-CEII-Compliance: FERC-18-CFR-388.113` headers
 * when running in Enterprise Appliance / Air-Gap mode.
 */
export function createAirgapSecurityHeadersMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isAirgap = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";
    if (!isAirgap) {
      next();
      return;
    }

    const isEmbedRoute =
      req.path === "/embed" ||
      req.path.startsWith("/embed/") ||
      req.path === "/static/embed.js" ||
      req.path === "/api/v1/oembed";
    const embedFrameAncestors = process.env["EMBED_FRAME_ANCESTORS"] || "*";
    const frameAncestorsDirective = isEmbedRoute
      ? `frame-ancestors ${embedFrameAncestors};`
      : "frame-ancestors 'self';";

    res.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; ${frameAncestorsDirective}`,
    );
    res.header("X-Airgap-Enforced", "true");
    res.header("X-CEII-Compliance", "FERC-18-CFR-388.113");
    next();
  };
}

/**
 * Creates the Enterprise Compliance router mounting:
 * - `GET /api/v1/compliance/airgap` (NERC CIP & FERC CEII air-gap verification probe)
 * - `GET /api/v1/compliance/readiness` (Enterprise security, export control, and audit readiness probe)
 */
export function createEnterpriseComplianceRouter(ctx: EnterpriseComplianceContext): Router {
  const router = express.Router();

  router.get("/compliance/airgap", requireEnterpriseFeature("airgap_compliance"), (_req: Request, res: Response) => {
    const isAppliance = process.env["ENTERPRISE_APPLIANCE"] === "true";
    const isAirgap = process.env["AIRGAP_ENFORCED"] === "true" || isAppliance;
    const externalTelemetry = !isAirgap && process.env["TELEMETRY_ENABLED"] === "true";
    const externalAssets = !isAirgap && Boolean(process.env["EXTERNAL_CDN_URL"]);
    const federationActive = !isAirgap && ctx.isFeatureFlagEnabled("activitypub_federation");
    const licenseStatus = resolveActiveEnterpriseLicense();

    res.json({
      edition: "ee",
      status: isAirgap ? "enforced" : "configurable",
      ceiiCompliant: !externalTelemetry,
      nercCipCompliant: !externalTelemetry && !externalAssets,
      outboundTrafficBlocked: isAirgap,
      telemetryDisabled: !externalTelemetry,
      localAssetsOnly: !externalAssets,
      federationOutboundActive: federationActive,
      applianceMode: isAppliance,
      licenseMode: licenseStatus.mode,
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/compliance/readiness", requireEnterpriseFeature("airgap_compliance"), (_req: Request, res: Response) => {
    const isProd = process.env["NODE_ENV"] === "production";
    const isAirgap = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";
    const envJwt = process.env["JWT_SECRET"];
    const jwtOk = Boolean(envJwt && envJwt !== "modelscript-dev-secret");
    const turnstileOk = Boolean(process.env["TURNSTILE_SECRET_KEY"]) || isAirgap;
    const hasAdmin = ctx.hasAdminUser();
    const geoIpLoaded = ctx.isGeoIpReady();

    const isDegraded = isProd && (!jwtOk || !turnstileOk || !hasAdmin);

    res.status(isDegraded ? 503 : 200).json({
      timestamp: new Date().toISOString(),
      edition: "ee",
      status: isDegraded ? "degraded" : "ready",
      environment: process.env["NODE_ENV"] || "development",
      checks: {
        exportControls: {
          status: "enforced",
          sanctionedCountriesCount: ctx.sanctionedCountriesCount,
          sanctionedRegionsCount: ctx.sanctionedRegionsCount,
          policy: "Overcompliance (24 countries + 5 occupied Ukrainian regions)",
        },
        secrets: {
          jwtSecretConfigured: Boolean(envJwt),
          jwtSecretIsSecure: jwtOk,
          turnstileConfigured: turnstileOk,
        },
        services: {
          geolocation: {
            dbLoaded: geoIpLoaded,
            fallbackPrefixesActive: true,
          },
          mailer: {
            driver: ctx.getMailerDriver(),
          },
          database: {
            connected: ctx.isDatabaseOpen(),
            hasAdminUser: hasAdmin,
          },
        },
        regulations: {
          ofacEarItar: "active",
          gdprArticle17Erasure: "active",
          gdprArticle20Portability: "active",
          rfc9116SecurityTxt: "active",
          agplv3Section13: "active",
        },
      },
    });
  });

  return router;
}
