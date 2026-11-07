// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from "express";
import net from "node:net";
import { isIpTrustedProxy } from "../middleware/auth-middleware.js";

function isValidIp(ip: string | undefined): boolean {
  return Boolean(ip && net.isIP(ip.trim()) !== 0);
}

/**
 * Extracts the real client IP address from an incoming Express request,
 * prioritizing Cloudflare Tunnels (CF-Connecting-IP), trusted reverse proxies
 * (X-Forwarded-For), and direct socket connections.
 */
export function getClientIp(req: Request): string {
  const explicitDisable = process.env["TRUST_PROXY"] === "false";
  const hasCfTunnel = Boolean(process.env["CLOUDFLARE_TUNNEL_TOKEN"]?.trim() && req.headers["cf-ray"]);
  const socketIp = req.socket?.remoteAddress || req.ip || "";
  const isTest = process.env["NODE_ENV"] === "test";
  const trustForwarded =
    hasCfTunnel ||
    (!explicitDisable &&
      (isTest || (process.env["TRUST_PROXY"] === "true" && (!socketIp || isIpTrustedProxy(socketIp)))));

  if (trustForwarded) {
    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && isValidIp(cfIp)) {
      return cfIp.trim();
    }

    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const validParts = xff
        .split(",")
        .map((s) => s.trim())
        .filter((s) => isValidIp(s));
      if (validParts.length === 1) {
        return validParts[0]!;
      }
      if (validParts.length > 1) {
        for (let i = validParts.length - 1; i >= 0; i--) {
          const candidate = validParts[i]!;
          if (!isIpTrustedProxy(candidate)) {
            return candidate;
          }
        }
        return validParts[0]!;
      }
    }

    const xRealIp = req.headers["x-real-ip"];
    if (typeof xRealIp === "string" && isValidIp(xRealIp)) {
      return xRealIp.trim();
    }
  }

  const fallback = req.ip || req.socket?.remoteAddress || "127.0.0.1";
  return isValidIp(fallback) ? fallback.trim() : "127.0.0.1";
}
