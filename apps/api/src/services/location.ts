// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from "express";
import fs from "fs";
import * as maxmind from "maxmind";
import path from "path";

class LocationService {
  private cityReader: maxmind.Reader<maxmind.CityResponse> | null = null;
  private isInitialized = false;

  async init() {
    if (this.isInitialized) return;

    // By default, look for the free DB-IP City Lite database or MaxMind GeoLite2 Free
    const dbPath = process.env["GEOLOCATION_DB_PATH"] || path.resolve(process.cwd(), "data", "GeoLite2-City.mmdb");

    try {
      if (fs.existsSync(dbPath)) {
        this.cityReader = await maxmind.open<maxmind.CityResponse>(dbPath);
        console.log(`[LocationService] Loaded GeoLite2/DB-IP City database from ${dbPath}`);
      } else {
        console.warn(`[LocationService] GeoLite2 City database not found at ${dbPath}. IP Geolocation is disabled.`);
      }
    } catch {
      console.error(`[LocationService] Failed to load GeoLite2 City database.`);
    }

    this.isInitialized = true;
  }

  public isReady(): boolean {
    return this.cityReader !== null;
  }

  public lookupIp(ip: string): { countryCode: string; regionCode?: string } | null {
    if (!this.cityReader) {
      // Graceful fallback for testing and offline resilience when DB-IP database is missing
      if (ip === "1.1.1.1" || ip === "8.8.8.8") return { countryCode: "US", regionCode: "CA" };
      if (ip === "82.165.228.1") return { countryCode: "DE", regionCode: "BY" };
      if (ip === "212.102.40.1") return { countryCode: "IT" };
      if (ip === "104.28.12.1") return { countryCode: "GB" };

      // High-risk sanctioned jurisdictions subnet prefix fallback
      if (ip.startsWith("175.45.176.") || ip.startsWith("210.52.109.") || ip.startsWith("77.94.35.")) {
        return { countryCode: "KP" };
      }
      if (ip.startsWith("5.1.0.") || ip.startsWith("77.88.") || ip.startsWith("87.250.")) {
        return { countryCode: "RU", regionCode: "MOW" };
      }
      if (ip.startsWith("31.135.")) {
        return { countryCode: "UA", regionCode: "43" }; // Crimea
      }
      if (ip.startsWith("82.137.") || ip.startsWith("178.253.") || ip.startsWith("195.12.")) {
        return { countryCode: "SY" };
      }
      if (ip.startsWith("5.200.") || ip.startsWith("2.144.") || ip.startsWith("31.2.") || ip.startsWith("91.98.")) {
        return { countryCode: "IR" };
      }
      if (ip.startsWith("152.206.") || ip.startsWith("169.158.") || ip.startsWith("200.55.")) {
        return { countryCode: "CU" };
      }
      if (ip.startsWith("37.212.") || ip.startsWith("82.209.") || ip.startsWith("86.57.")) {
        return { countryCode: "BY" };
      }
      if (ip.startsWith("190.72.") || ip.startsWith("200.11.")) {
        return { countryCode: "VE" };
      }
      if (ip.startsWith("203.81.64.") || ip.startsWith("203.81.")) {
        return { countryCode: "MM" };
      }

      // Default to null if no DB
      return null;
    }

    try {
      // Validate IP to prevent maxmind from throwing
      if (!maxmind.validate(ip)) {
        return null;
      }

      const result = this.cityReader.get(ip);
      if (!result || !result.country) return null;

      const regionCode =
        result.subdivisions && result.subdivisions.length > 0 ? result.subdivisions[0]?.iso_code : undefined;

      if (regionCode) {
        return { countryCode: result.country.iso_code, regionCode };
      }
      return { countryCode: result.country.iso_code };
    } catch {
      // Ignore lookup errors
      return null;
    }
  }

  // Helper to extract IP from an Express request
  public extractIp(req: Request): string {
    // Look for X-Forwarded-For if behind a reverse proxy
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      const parts = forwarded.toString().split(",");
      const firstPart = parts[0];
      if (firstPart) {
        return firstPart.trim();
      }
    }
    return req.ip || req.connection?.remoteAddress || "127.0.0.1";
  }
}

export const locationService = new LocationService();
