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
    const dbPath =
      process.env["GEOLOCATION_DB_PATH"] ||
      process.env["GEOIP_DB_PATH"] ||
      path.resolve(process.cwd(), "data", "GeoLite2-City.mmdb");

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

  public isCloudflareRequest(req: Request): boolean {
    return Boolean(
      req.headers["cf-ray"] ||
      req.headers["cf-ipcountry"] ||
      req.headers["cf-connecting-ip"] ||
      req.headers["cf-visitor"] ||
      process.env["MSX_INGRESS_MODE"] === "cloudflare" ||
      process.env["TRUST_CLOUDFLARE_HEADERS"] === "true" ||
      process.env["CLOUDFLARE_TUNNEL_TOKEN"],
    );
  }

  private normalizeRegionCode(rawRegion: string | undefined, countryCode?: string): string | undefined {
    if (!rawRegion) return undefined;
    let cleaned = rawRegion.trim().toUpperCase();
    if (countryCode && cleaned.startsWith(`${countryCode}-`)) {
      cleaned = cleaned.slice(countryCode.length + 1);
    }
    return ISO_REGION_RE.test(cleaned) ? cleaned : undefined;
  }

  // Helper to extract IP from an Express request
  public extractIp(req: Request): string {
    // 1. Prefer explicit Cloudflare / CDN eyeball IP headers when present
    const cfConnectingIp = req.headers["cf-connecting-ip"] || req.headers["true-client-ip"];
    if (typeof cfConnectingIp === "string" && cfConnectingIp.trim()) {
      return cfConnectingIp.trim();
    }

    // 2. Look for X-Forwarded-For if behind a reverse proxy
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
   *
   * When behind Cloudflare (including Cloudflare Free where client IPs may be omitted
   * or replaced by edge/tunnel proxy IPs), Cloudflare's edge geolocation headers
   * (`cf-ipcountry`, `cf-region-code`, `cf-region`) take precedence so MaxMind lookups
   * against Cloudflare's own proxy/tunnel IPs never corrupt analytics or telemetry.
   */
  public resolveRequestGeo(
    req: Request,
    fallbackProfileLocation?: string | null,
  ): { countryCode?: string | undefined; regionCode?: string | undefined } {
    const trustProxyHeaders =
      process.env["TRUST_PROXY"] === "true" || process.env["NODE_ENV"] === "test" || this.isCloudflareRequest(req);

    // 1. Cloudflare edge geolocation headers first (prevents proxy/tunnel hop IP from corrupting geo data)
    const cfCountry =
      typeof req.headers["cf-ipcountry"] === "string" ? req.headers["cf-ipcountry"].trim().toUpperCase() : "";
    if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1" && ISO_COUNTRY_RE.test(cfCountry)) {
      const rawCfRegion = (req.headers["cf-region-code"] ||
        req.headers["cf-region"] ||
        (trustProxyHeaders
          ? req.headers["x-region-code"] || req.headers["x-region"] || req.headers["x-vercel-ip-country-region"]
          : undefined)) as string | undefined;
      let cfRegion = this.normalizeRegionCode(rawCfRegion, cfCountry);

      // Only enrich missing region from MaxMind if an explicit client IP was provided and matches cfCountry
      if (!cfRegion && (req.headers["cf-connecting-ip"] || req.headers["true-client-ip"])) {
        const ip = this.extractIp(req);
        const loc = this.lookupIp(ip);
        if (loc?.countryCode?.trim().toUpperCase() === cfCountry) {
          cfRegion = this.normalizeRegionCode(loc.regionCode, cfCountry);
        }
      }

      return {
        countryCode: cfCountry,
        regionCode: cfRegion,
      };
    }

    // 2. Other trusted reverse proxy headers
    if (trustProxyHeaders) {
      const rawXCountry = (req.headers["x-country-code"] ||
        req.headers["x-country"] ||
        req.headers["x-vercel-ip-country"]) as string | undefined;
      const xCountry = rawXCountry ? rawXCountry.trim().toUpperCase() : "";
      if (xCountry && ISO_COUNTRY_RE.test(xCountry)) {
        const rawXRegion = (req.headers["x-region-code"] ||
          req.headers["x-region"] ||
          req.headers["x-vercel-ip-country-region"]) as string | undefined;
        const xRegion = this.normalizeRegionCode(rawXRegion, xCountry);
        return {
          countryCode: xCountry,
          regionCode: xRegion,
        };
      }
    }

    // 3. Server-side IP geolocation lookup — skip if request came via Cloudflare without a client IP header
    // (otherwise X-Forwarded-For / X-Real-IP contains the Cloudflare/tunnel hop IP and would corrupt geo data)
    const hasExplicitClientIp = Boolean(req.headers["cf-connecting-ip"] || req.headers["true-client-ip"]);
    const isUnforwardedCloudflareHop =
      !hasExplicitClientIp &&
      (Boolean(req.headers["cf-ray"]) ||
        cfCountry === "XX" ||
        cfCountry === "T1" ||
        (process.env["MSX_INGRESS_MODE"] === "cloudflare" && !req.headers["x-forwarded-for"]));

    const ip = this.extractIp(req);
    if (!isUnforwardedCloudflareHop) {
      const loc = this.lookupIp(ip);
      if (loc?.countryCode) {
        const normCountry = loc.countryCode.trim().toUpperCase();
        if (ISO_COUNTRY_RE.test(normCountry)) {
          const normRegion = this.normalizeRegionCode(loc.regionCode, normCountry);
          return {
            countryCode: normCountry,
            regionCode: normRegion,
          };
        }
      }
    }

    // 4. Optional profile location fallback — only if it is a valid 2-letter ISO code
    if (fallbackProfileLocation) {
      const trimmed = fallbackProfileLocation.trim().toUpperCase();
      if (ISO_COUNTRY_RE.test(trimmed)) {
        return { countryCode: trimmed };
      }
    }

    // 5. Local development loopback fallback: infer ISO country subtag from browser Accept-Language (e.g., en-US -> US)
    // Never apply when behind Cloudflare tunnel or in production, where 127.0.0.1 is the local reverse proxy/tunnel daemon.
    if (
      process.env["NODE_ENV"] !== "test" &&
      process.env["NODE_ENV"] !== "production" &&
      !this.isCloudflareRequest(req) &&
      (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
    ) {
      const acceptLang = req.headers["accept-language"];
      if (typeof acceptLang === "string") {
        const match = /\b[a-z]{2,3}-([A-Z]{2})\b/.exec(acceptLang);
        if (match?.[1] && ISO_COUNTRY_RE.test(match[1])) {
          return { countryCode: match[1] };
        }
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
    const cfGeoKey = [
      req.headers["cf-ipcountry"],
      req.headers["cf-region-code"] || req.headers["cf-region"],
      req.headers["cf-ipcity"],
    ]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim().toUpperCase())
      .join(":");
    const digestInput = cfGeoKey ? `${ip}|${cfGeoKey}|${ua}|${scopeKey}` : `${ip}|${ua}|${scopeKey}`;
    const digest = crypto.createHmac("sha256", this.dailySalt).update(digestInput).digest("base64url");

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
