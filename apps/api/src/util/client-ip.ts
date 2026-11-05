// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from "express";
import net from "node:net";

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
  const trustForwarded =
    hasCfTunnel || (!explicitDisable && (process.env["TRUST_PROXY"] === "true" || process.env["NODE_ENV"] === "test"));

  if (trustForwarded) {
    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && isValidIp(cfIp)) {
      return cfIp.trim();
    }

    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const parts = xff.split(",").map((s) => s.trim());
      for (const part of parts) {
        if (isValidIp(part)) {
          return part;
        }
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
