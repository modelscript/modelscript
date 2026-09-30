// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import type { LibraryDatabase } from "../database.js";
import { locationService } from "../services/location.js";

/**
 * Prohibited jurisdictions subject to comprehensive export controls, trade embargoes,
 * ITAR § 126.1 prohibitions, and EAR dual-use / military restrictions (Overcompliance Policy):
 * - Cuba (CU)
 * - Iran (IR)
 * - North Korea (KP)
 * - Syria (SY)
 * - Russia (RU)
 * - Belarus (BY)
 * - Venezuela (VE)
 * - Myanmar / Burma (MM)
 * - Afghanistan (AF)
 * - Central African Republic (CF)
 * - China (CN)
 * - Democratic Republic of the Congo (CD)
 * - Eritrea (ER)
 * - Haiti (HT)
 * - Iraq (IQ)
 * - Cambodia (KH)
 * - Lebanon (LB)
 * - Libya (LY)
 * - Nicaragua (NI)
 * - Somalia (SO)
 * - South Sudan (SS)
 * - Sudan (SD)
 * - Yemen (YE)
 * - Zimbabwe (ZW)
 * - Occupied Ukrainian regions: Crimea (UA-43), Donetsk (UA-14), Luhansk (UA-09), Zaporizhzhia (UA-23), Kherson (UA-65)
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

// Aliases for backwards compatibility with existing imports
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

export function extractRequestCountry(req: Request): string | undefined {
  const cfCountry = req.headers["cf-ipcountry"] as string | undefined;
  if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1") {
    return cfCountry.toUpperCase();
  }

  const customCountry =
    (req.headers["x-country-code"] as string | undefined) ||
    (req.headers["x-client-geo-country"] as string | undefined);
  if (customCountry) {
    return customCountry.toUpperCase().trim();
  }

  const user = (req as any).user;
  if (user?.country) {
    return String(user.country).toUpperCase().trim();
  }

  // Fallback to IP geolocation via locationService if available
  try {
    const ip = locationService.extractIp(req);
    const loc = locationService.lookupIp(ip);
    if (loc?.countryCode) {
      return loc.countryCode.toUpperCase().trim();
    }
  } catch {
    // Ignore location lookup error
  }

  return undefined;
}

export function extractRequestRegion(req: Request): string | undefined {
  const customRegion = (req.headers["x-region-code"] as string | undefined)?.toUpperCase().trim();
  if (customRegion) {
    return customRegion;
  }

  try {
    const ip = locationService.extractIp(req);
    const loc = locationService.lookupIp(ip);
    if (loc?.regionCode && loc?.countryCode) {
      return `${loc.countryCode}-${loc.regionCode}`.toUpperCase().trim();
    }
  } catch {
    // Ignore location lookup error
  }

  return undefined;
}

/**
 * Express middleware that rejects computation, simulation dispatch, package publishing,
 * and registration originating from export-controlled / sanctioned jurisdictions.
 */
export function enforceExportCompliance(databaseGetter?: () => LibraryDatabase | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // In test environment, allow explicit bypass unless testing export compliance checks
    if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-ofac"] === "true") {
      next();
      return;
    }

    const country = extractRequestCountry(req);
    const region = extractRequestRegion(req);

    if (isOfacSanctioned(country, region)) {
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip;
      const db = databaseGetter ? databaseGetter() : (req.app?.locals?.database as LibraryDatabase | undefined);

      if (db) {
        db.logAudit({
          actorId: (req as any).user?.id || null,
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
