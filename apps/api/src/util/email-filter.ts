// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import net from "node:net";

/**
 * Known disposable, temporary, and burner email domains used for botnet registration,
 * Sybil attacks, and credit farming.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "burnermail.io",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "inboxkitten.com",
  "maildrop.cc",
  "mailinator.com",
  "mohmal.com",
  "nada.ltd",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/**
 * Extracts and normalizes the domain from an email address.
 */
export function extractEmailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]!;
}

/**
 * Checks whether an email address belongs to a disposable or throwaway provider.
 */
export function isDisposableEmail(email: string, customBlacklist?: Set<string>): boolean {
  const domain = extractEmailDomain(email);
  if (!domain) return true; // Malformed domain is untrusted

  if (customBlacklist && customBlacklist.has(domain)) {
    return true;
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  // Check subdomains (e.g. sub.mailinator.com)
  for (const blacklisted of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${blacklisted}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes an email address into its canonical form (Mastodon-style):
 * - Lowercases local and domain parts
 * - Strips subaddressing tags (`user+alias@domain` -> `user@domain`)
 * - Normalizes `googlemail.com` -> `gmail.com` and strips dots from Gmail/Googlemail local parts
 */
export function canonicalizeEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  const atIdx = clean.lastIndexOf("@");
  if (atIdx <= 0) return clean;
  let local = clean.slice(0, atIdx);
  let domain = clean.slice(atIdx + 1);

  const plusIdx = local.indexOf("+");
  if (plusIdx !== -1) {
    local = local.slice(0, plusIdx);
  }

  if (domain === "googlemail.com") {
    domain = "gmail.com";
  }

  if (domain === "gmail.com" || domain === "protonmail.com" || domain === "proton.me") {
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

/**
 * Computes the SHA-256 hex digest of a canonicalized email address.
 */
export function hashCanonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(trimmed)) {
    return trimmed;
  }
  return crypto.createHash("sha256").update(canonicalizeEmail(trimmed)).digest("hex");
}

/**
 * Produces a privacy-preserving hint for an email address (e.g. `a***e@gmail.com`).
 */
export function redactEmailHint(email: string): string {
  const clean = canonicalizeEmail(email);
  const atIdx = clean.lastIndexOf("@");
  if (atIdx <= 0) return "***";
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  if (local.length <= 2) {
    return `${local[0] || "*"}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let res = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    res = ((res << 8) | n) >>> 0;
  }
  return res;
}

/**
 * Checks if a client IP matches an exact IP, wildcard prefix (`192.0.2.*`), or IPv4 CIDR block (`192.0.2.0/24`).
 */
export function ipMatchesCidr(clientIp: string, ruleCidr: string): boolean {
  const cleanIp = clientIp.trim().replace(/^::ffff:/i, "");
  const cleanRule = ruleCidr.trim().replace(/^::ffff:/i, "");
  if (!cleanIp || !cleanRule) return false;
  if (cleanIp.toLowerCase() === cleanRule.toLowerCase()) return true;

  if (cleanRule.endsWith(".*")) {
    const prefix = cleanRule.slice(0, -1);
    return cleanIp.startsWith(prefix);
  }

  if (cleanRule.includes("/")) {
    const [baseIp, bitsStr] = cleanRule.split("/");
    const bits = Number(bitsStr);
    if (!baseIp || !Number.isInteger(bits)) return false;

    if (net.isIPv4(cleanIp) && net.isIPv4(baseIp) && bits >= 0 && bits <= 32) {
      const ipInt = ipv4ToInt(cleanIp);
      const baseInt = ipv4ToInt(baseIp);
      if (ipInt === null || baseInt === null) return false;
      if (bits === 0) return true;
      const mask = (~0 << (32 - bits)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    }
  }

  return false;
}
