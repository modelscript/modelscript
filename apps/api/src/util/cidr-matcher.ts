// SPDX-License-Identifier: AGPL-3.0-or-later

import net from "node:net";
import { ipMatchesCidr } from "./email-filter.js";

/**
 * Validates whether an IP address or CIDR mask is syntactically valid.
 */
export function isValidIpOrCidr(entry: string): boolean {
  const clean = entry.trim();
  if (!clean) return false;
  if (clean === "*") return true;

  if (clean.includes("/")) {
    const [ip, bitsStr] = clean.split("/");
    if (!ip || !bitsStr) return false;
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0) return false;
    if (net.isIPv4(ip) && bits <= 32) return true;
    if (net.isIPv6(ip) && bits <= 128) return true;
    return false;
  }

  if (clean.endsWith(".*")) {
    const prefix = clean.slice(0, -2);
    const parts = prefix.split(".");
    return (
      parts.length >= 1 &&
      parts.length <= 3 &&
      parts.every((part) => {
        const n = Number(part);
        return Number.isInteger(n) && n >= 0 && n <= 255;
      })
    );
  }

  return net.isIP(clean) !== 0;
}

/**
 * Normalizes an allowlist of IPs and CIDRs into a trimmed array.
 */
export function parseIpAllowlist(allowlist?: string | string[] | null): string[] {
  if (!allowlist) return [];
  if (Array.isArray(allowlist)) {
    return allowlist.map((s) => s.trim()).filter(Boolean);
  }
  return allowlist
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks whether the client IP address satisfies an IP allowlist containing
 * exact IPs, wildcards, or CIDR blocks.
 */
export function isIpInAllowlist(clientIp: string, allowlist?: string | string[] | null): boolean {
  const rules = parseIpAllowlist(allowlist);
  if (rules.length === 0 || rules.includes("*")) {
    return true; // No restrictions
  }

  const cleanClientIp = clientIp.trim().replace(/^::ffff:/i, "");
  for (const rule of rules) {
    if (rule === "*") return true;
    if (ipMatchesCidr(cleanClientIp, rule)) {
      return true;
    }
  }

  return false;
}
