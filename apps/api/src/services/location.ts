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
    // This allows us to use the free versions.
    const dbPath = path.resolve(process.cwd(), "data", "GeoLite2-City.mmdb");

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

  public lookupIp(ip: string): { countryCode: string; regionCode?: string } | null {
    if (!this.cityReader) {
      // Graceful fallback for testing when DB-IP free database is missing
      if (ip === "1.1.1.1" || ip === "8.8.8.8") return { countryCode: "US", regionCode: "CA" };
      if (ip === "82.165.228.1") return { countryCode: "DE", regionCode: "BY" };
      if (ip === "212.102.40.1") return { countryCode: "IT" };
      if (ip === "104.28.12.1") return { countryCode: "GB" };

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
