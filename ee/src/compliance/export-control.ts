// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { NextFunction, Request, Response } from "express";

export interface ExportControlAuditLogger {
  logAudit(entry: {
    actorId: number | null;
    action: string;
    resourceType: string;
    resourceId: string;
    ipAddress: string | undefined;
    details: Record<string, unknown>;
  }): void;
}

export interface GeoLocationLookupAdapter {
  extractIp(req: Request): string;
  lookupIp(ip: string): { countryCode?: string | null; regionCode?: string | null } | null;
}

/**
 * Prohibited jurisdictions subject to comprehensive export controls, trade embargoes,
 * ITAR § 126.1 prohibitions, and EAR dual-use / military restrictions (Overcompliance Policy).
 */
export const SANCTIONED_COUNTRIES = new Set<string>([
  "CU", // Cuba (OFAC / EAR E:1 / ITAR 126.1)
  "IR", // Iran (OFAC / EAR E:1 / ITAR 126.1)
  "KP", // North Korea (OFAC / EAR E:1 / ITAR 126.1)
  "SY", // Syria (OFAC / EAR E:1 / ITAR 126.1)
  "RU", // Russia (EAR Part 746 / ITAR 126.1 / Dual-Use)
  "BY", // Belarus (EAR Part 746 / ITAR 126.1 / Dual-Use)
  "VE", // Venezuela (ITAR 126.1 / EAR Military End-Use)
  "MM", // Myanmar / Burma (ITAR 126.1 / EAR Military End-Use)
  "AF", // Afghanistan (ITAR 126.1)
  "CF", // Central African Republic (ITAR 126.1)
  "CD", // Democratic Republic of the Congo (ITAR 126.1)
  "CN", // China (ITAR 126.1 / EAR Dual-Use Advanced Compute)
  "ER", // Eritrea (ITAR 126.1)
  "HT", // Haiti (ITAR 126.1)
  "IQ", // Iraq (ITAR 126.1)
  "KH", // Cambodia (ITAR 126.1)
  "LB", // Lebanon (ITAR 126.1)
  "LY", // Libya (ITAR 126.1)
  "NI", // Nicaragua (ITAR 126.1)
  "SO", // Somalia (ITAR 126.1)
  "SS", // South Sudan (ITAR 126.1)
  "SD", // Sudan (ITAR 126.1 / EAR)
  "YE", // Yemen (ITAR 126.1)
  "ZW", // Zimbabwe (ITAR 126.1)
]);

export const SANCTIONED_REGIONS = new Set<string>([
  "UA-43", // Crimea
  "UA-14", // Donetsk
  "UA-09", // Luhansk
  "UA-23", // Zaporizhzhia
  "UA-65", // Kherson
]);

export const OFAC_SANCTIONED_COUNTRIES = SANCTIONED_COUNTRIES;
export const OFAC_SANCTIONED_REGIONS = SANCTIONED_REGIONS;

export function isOfacSanctioned(countryCode?: string | null, regionCode?: string | null): boolean {
  if (countryCode && SANCTIONED_COUNTRIES.has(countryCode.toUpperCase().trim())) {
    return true;
  }
  if (regionCode) {
    const formattedRegion = regionCode.toUpperCase().trim();
    if (SANCTIONED_REGIONS.has(formattedRegion)) {
      return true;
    }
    if (countryCode && SANCTIONED_REGIONS.has(`${countryCode.toUpperCase().trim()}-${formattedRegion}`)) {
      return true;
    }
  }
  return false;
}

export const isExportRestricted = isOfacSanctioned;

export function extractRequestCountry(req: Request, locationAdapter?: GeoLocationLookupAdapter): string | undefined {
  const isProd = process.env["NODE_ENV"] === "production";
  const trustGeoHeaders = !isProd || process.env["TRUST_GEO_HEADERS"] === "true";
  const trustCloudflare =
    !isProd ||
    process.env["TRUST_CLOUDFLARE_HEADERS"] === "true" ||
    process.env["MSX_INGRESS_MODE"] === "cloudflare" ||
    Boolean(process.env["CLOUDFLARE_TUNNEL_TOKEN"]) ||
    Boolean(req.headers["cf-ray"]) ||
    trustGeoHeaders;

  const user = (req as Request & { user?: { id?: number | undefined; country?: string | undefined } | undefined }).user;
  const userCountry = user?.country ? String(user.country).toUpperCase().trim() : undefined;

  const rawCfCountry = req.headers["cf-ipcountry"] as string | undefined;
  const cfCountry =
    trustCloudflare &&
    rawCfCountry &&
    rawCfCountry.trim().toUpperCase() !== "XX" &&
    rawCfCountry.trim().toUpperCase() !== "T1"
      ? rawCfCountry.trim().toUpperCase()
      : undefined;

  const hasExplicitClientIp = Boolean(req.headers["cf-connecting-ip"] || req.headers["true-client-ip"]);
  const skipProxyHopIpLookup =
    !hasExplicitClientIp &&
    (Boolean(req.headers["cf-ray"]) ||
      Boolean(cfCountry) ||
      (process.env["MSX_INGRESS_MODE"] === "cloudflare" && !req.headers["x-forwarded-for"]));

  let geoIpCountry: string | undefined;
  if (locationAdapter && !skipProxyHopIpLookup) {
    try {
      const ip = locationAdapter.extractIp(req);
      const loc = locationAdapter.lookupIp(ip);
      if (loc?.countryCode) {
        geoIpCountry = loc.countryCode.toUpperCase().trim();
      }
    } catch {
      // Ignore location lookup error
    }
  }

  if (userCountry && isOfacSanctioned(userCountry)) {
    return userCountry;
  }
  if (geoIpCountry && isOfacSanctioned(geoIpCountry)) {
    return geoIpCountry;
  }

  if (cfCountry) {
    return cfCountry;
  }

  if (trustGeoHeaders) {
    const customCountry =
      (req.headers["x-country-code"] as string | undefined) ||
      (req.headers["x-client-geo-country"] as string | undefined);
    if (customCountry) {
      return customCountry.toUpperCase().trim();
    }
  }

  if (userCountry) {
    return userCountry;
  }

  return geoIpCountry;
}

export function extractRequestRegion(req: Request, locationAdapter?: GeoLocationLookupAdapter): string | undefined {
  const isProd = process.env["NODE_ENV"] === "production";
  const trustGeoHeaders = !isProd || process.env["TRUST_GEO_HEADERS"] === "true";
  const trustCloudflare =
    !isProd ||
    process.env["TRUST_CLOUDFLARE_HEADERS"] === "true" ||
    process.env["MSX_INGRESS_MODE"] === "cloudflare" ||
    Boolean(process.env["CLOUDFLARE_TUNNEL_TOKEN"]) ||
    Boolean(req.headers["cf-ray"]) ||
    trustGeoHeaders;

  const rawCfCountry = req.headers["cf-ipcountry"] as string | undefined;
  const cfCountry =
    trustCloudflare &&
    rawCfCountry &&
    rawCfCountry.trim().toUpperCase() !== "XX" &&
    rawCfCountry.trim().toUpperCase() !== "T1"
      ? rawCfCountry.trim().toUpperCase()
      : undefined;
  const rawCfRegion = trustCloudflare
    ? ((req.headers["cf-region-code"] || req.headers["cf-region"]) as string | undefined)?.trim().toUpperCase()
    : undefined;
  const cfRegion = rawCfRegion
    ? cfCountry && !rawCfRegion.startsWith(`${cfCountry}-`)
      ? `${cfCountry}-${rawCfRegion}`
      : rawCfRegion
    : undefined;

  const hasExplicitClientIp = Boolean(req.headers["cf-connecting-ip"] || req.headers["true-client-ip"]);
  const skipProxyHopIpLookup =
    !hasExplicitClientIp &&
    (Boolean(req.headers["cf-ray"]) ||
      Boolean(cfCountry) ||
      (process.env["MSX_INGRESS_MODE"] === "cloudflare" && !req.headers["x-forwarded-for"]));

  let geoIpRegion: string | undefined;
  if (locationAdapter && !skipProxyHopIpLookup) {
    try {
      const ip = locationAdapter.extractIp(req);
      const loc = locationAdapter.lookupIp(ip);
      if (loc?.regionCode && loc?.countryCode) {
        geoIpRegion = `${loc.countryCode}-${loc.regionCode}`.toUpperCase().trim();
      }
    } catch {
      // Ignore location lookup error
    }
  }

  if (geoIpRegion && isOfacSanctioned(undefined, geoIpRegion)) {
    return geoIpRegion;
  }

  if (cfRegion) {
    return cfRegion;
  }

  if (trustGeoHeaders) {
    const customRegion = (req.headers["x-region-code"] as string | undefined)?.toUpperCase().trim();
    if (customRegion) {
      return customRegion;
    }
  }

  return geoIpRegion;
}

/**
 * Enterprise ITAR / EAR / OFAC Export Control middleware that rejects computation,
 * simulation dispatch, package publishing, and registration from sanctioned jurisdictions.
 */
export function createExportComplianceMiddleware(
  databaseGetter?: () => ExportControlAuditLogger | undefined,
  locationAdapter?: GeoLocationLookupAdapter,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-ofac"] === "true") {
      next();
      return;
    }

    const country = extractRequestCountry(req, locationAdapter);
    const region = extractRequestRegion(req, locationAdapter);

    if (isOfacSanctioned(country, region)) {
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip;
      const db = databaseGetter
        ? databaseGetter()
        : (req.app?.locals?.["database"] as ExportControlAuditLogger | undefined);

      if (db) {
        db.logAudit({
          actorId: (req as Request & { user?: { id?: number | undefined } | undefined }).user?.id || null,
          action: "export_control_blocked",
          resourceType: "compliance",
          resourceId: `${country || ""}:${region || ""}`,
          ipAddress: clientIp,
          details: {
            country,
            region,
            endpoint: req.originalUrl,
            method: req.method,
            reason: "Comprehensive export control and trade embargo compliance enforcement",
          },
        });
      }

      res.status(403).json({
        error:
          "Access denied under OFAC / EAR / ITAR export control regulations: Engineering simulation, computation, and software publishing services are not available in your region.",
        jurisdiction: country || region,
      });
      return;
    }

    next();
  };
}
