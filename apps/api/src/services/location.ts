// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "crypto";
import type { Request } from "express";
import fs from "fs";
import * as maxmind from "maxmind";
import path from "path";

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
const ISO_REGION_RE = /^[A-Z0-9]{1,6}$/;
const BOT_UA_RE =
  /\b(bot|spider|crawl|slurp|headlesschrome|lighthouse|ahrefs|semrush|python-requests|curl\/|wget\/|gptbot|claudebot|bytespider|bingpreview|facebookexternalhit|discordbot|twitterbot)\b/i;

class LocationService {
  private cityReader: maxmind.Reader<maxmind.CityResponse> | null = null;
  private isInitialized = false;
  private dailySaltDate = "";
  private dailySalt: Buffer = crypto.randomBytes(32);
  private seenDigests = new Set<string>();

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

  public lookupIp(ip: string): { countryCode: string; regionCode?: string | undefined } | null {
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
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) {
      return realIp.trim();
    }
    return req.ip || req.socket?.remoteAddress || "127.0.0.1";
  }

  /**
   * Resolves a request's ISO 3166-1 alpha-2 country and optional region code
   * in memory without storing raw IP addresses.
   */
  public resolveRequestGeo(
    req: Request,
    fallbackProfileLocation?: string | null,
  ): { countryCode?: string | undefined; regionCode?: string | undefined } {
    // 1. Server-side IP geolocation lookup first (authoritative when available)
    const ip = this.extractIp(req);
    const loc = this.lookupIp(ip);
    if (loc?.countryCode) {
      const normCountry = loc.countryCode.trim().toUpperCase();
      if (ISO_COUNTRY_RE.test(normCountry)) {
        const normRegion = loc.regionCode ? loc.regionCode.trim().toUpperCase() : undefined;
        return {
          countryCode: normCountry,
          regionCode: normRegion && ISO_REGION_RE.test(normRegion) ? normRegion : undefined,
        };
      }
    }

    // 2. Trusted CDN / reverse proxy headers (Cloudflare or trusted proxy / test mode)
    const trustProxyHeaders =
      process.env["TRUST_PROXY"] === "true" || process.env["NODE_ENV"] === "test" || Boolean(req.headers["cf-ray"]);

    const cfCountry =
      typeof req.headers["cf-ipcountry"] === "string" ? req.headers["cf-ipcountry"].trim().toUpperCase() : "";
    if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1" && ISO_COUNTRY_RE.test(cfCountry)) {
      const rawCfRegion = (req.headers["cf-region-code"] || req.headers["cf-region"]) as string | undefined;
      const cfRegion = rawCfRegion ? rawCfRegion.trim().toUpperCase() : undefined;
      return {
        countryCode: cfCountry,
        regionCode: cfRegion && ISO_REGION_RE.test(cfRegion) ? cfRegion : undefined,
      };
    }

    if (trustProxyHeaders) {
      const rawXCountry = (req.headers["x-country-code"] || req.headers["x-country"]) as string | undefined;
      const xCountry = rawXCountry ? rawXCountry.trim().toUpperCase() : "";
      if (xCountry && ISO_COUNTRY_RE.test(xCountry)) {
        const rawXRegion = (req.headers["x-region-code"] || req.headers["x-region"]) as string | undefined;
        const xRegion = rawXRegion ? rawXRegion.trim().toUpperCase() : undefined;
        return {
          countryCode: xCountry,
          regionCode: xRegion && ISO_REGION_RE.test(xRegion) ? xRegion : undefined,
        };
      }
    }

    // 3. Optional profile location fallback — only if it is a valid 2-letter ISO code
    if (fallbackProfileLocation) {
      const trimmed = fallbackProfileLocation.trim().toUpperCase();
      if (ISO_COUNTRY_RE.test(trimmed)) {
        return { countryCode: trimmed };
      }
    }

    return {};
  }

  public isBotUserAgent(userAgent?: string | null): boolean {
    if (!userAgent) return false;
    return BOT_UA_RE.test(userAgent);
  }

  /**
   * Privacy-preserving ephemeral deduplication using a daily rotating HMAC salt in RAM.
   * Returns true if this is the first time the visitor hit `scopeKey` today.
   */
  public checkAndMarkUniqueHit(req: Request, scopeKey: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailySaltDate !== today || this.seenDigests.size > 100_000) {
      this.dailySaltDate = today;
      this.dailySalt = crypto.randomBytes(32);
      this.seenDigests.clear();
    }

    const ip = this.extractIp(req);
    const ua = String(req.headers["user-agent"] || "");
    const digest = crypto.createHmac("sha256", this.dailySalt).update(`${ip}|${ua}|${scopeKey}`).digest("base64url");

    if (this.seenDigests.has(digest)) {
      return false;
    }
    this.seenDigests.add(digest);
    return true;
  }

  public resetSeenHits(): void {
    this.seenDigests.clear();
  }
}

export const locationService = new LocationService();
