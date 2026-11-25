// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response } from "express";
import crypto from "node:crypto";

export const DUMMY_BCRYPT_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const isProd = process.env["NODE_ENV"] === "production";

export function setSessionCookie(res: Response, token: string): void {
  res.cookie("modelscript_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie("modelscript_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
  });
}

export function stripTrailingSlashes(str: string): string {
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return str.slice(0, end);
}

export function isHubModelscriptUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === "hub.modelscript.org";
  } catch {
    return false;
  }
}

export function isScopedApiToken(req: Request): boolean {
  return Boolean(req.tokenScopes && !req.tokenScopes.includes("*") && !req.tokenScopes.includes("admin"));
}

export function resolvePublicBaseUrl(req: Request): string {
  const envPublicUrl = (process.env["PUBLIC_URL"] || "").trim().replace(/\/$/, "");
  const forwardedHost = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : "";
  const reqHost = (forwardedHost.split(",")[0]?.trim() || req.get("host") || "").trim();
  const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "";
  const reqProto = (forwardedProto.split(",")[0]?.trim() || req.protocol || "http").trim();
  if (envPublicUrl && envPublicUrl !== "http://localhost:3000") {
    return envPublicUrl;
  }
  if (reqHost && !reqHost.startsWith("localhost") && !reqHost.startsWith("127.0.0.1")) {
    return `${reqProto}://${reqHost}`;
  }
  return envPublicUrl || (reqHost ? `${reqProto}://${reqHost}` : "http://localhost:3000");
}

export function buildOAuthAuthorizeUrl(
  req: Request,
  provider: string,
  clientId: string,
  signedState: string,
  gitlabBaseUrl = "https://gitlab.com",
): string | null {
  const publicBase = resolvePublicBaseUrl(req);
  const redirectUri = `${publicBase.replace(/\/$/, "")}/api/v1/auth/callback/${provider}`;
  if (provider === "github") {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state: signedState,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }
  if (provider === "gitlab") {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read_user",
      state: signedState,
    });
    return `${gitlabBaseUrl.replace(/\/$/, "")}/oauth/authorize?${params.toString()}`;
  }
  return null;
}

export function extractSessionCookieToken(req: Request): string {
  const cookieHeader = req.headers.cookie || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)modelscript_token=([^;]+)/);
  if (!cookieMatch?.[1]) {
    return "";
  }
  try {
    return decodeURIComponent(cookieMatch[1]);
  } catch {
    return cookieMatch[1];
  }
}

const OAUTH_EXCHANGE_CODE_TTL_MS = 60 * 1000;
const MAX_OAUTH_EXCHANGE_CODES = 5000;

export interface OAuthExchangePayload {
  token: string;
  requires2FA?: boolean;
  expiresAt: number;
}

const oauthExchangeCodes = new Map<string, OAuthExchangePayload>();

export function issueOAuthExchangeCode(payload: { token: string; requires2FA?: boolean }): string {
  const now = Date.now();
  if (oauthExchangeCodes.size >= MAX_OAUTH_EXCHANGE_CODES) {
    for (const [key, entry] of oauthExchangeCodes) {
      if (entry.expiresAt <= now) {
        oauthExchangeCodes.delete(key);
      }
    }
    while (oauthExchangeCodes.size >= MAX_OAUTH_EXCHANGE_CODES) {
      const oldestKey = oauthExchangeCodes.keys().next().value;
      if (oldestKey === undefined) break;
      oauthExchangeCodes.delete(oldestKey);
    }
  }

  const code = crypto.randomBytes(32).toString("base64url");
  oauthExchangeCodes.set(code, {
    token: payload.token,
    ...(payload.requires2FA ? { requires2FA: true } : {}),
    expiresAt: now + OAUTH_EXCHANGE_CODE_TTL_MS,
  });
  return code;
}

export function consumeOAuthExchangeCode(code: string): OAuthExchangePayload | undefined {
  const entry = oauthExchangeCodes.get(code);
  if (!entry) {
    return undefined;
  }
  // Delete atomically on first read (single-use)
  oauthExchangeCodes.delete(code);
  return entry;
}
