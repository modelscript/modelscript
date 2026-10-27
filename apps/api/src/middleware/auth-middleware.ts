// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { LibraryDatabase } from "../database.js";

let sharedAuthDatabase: LibraryDatabase | null = null;

export function setAuthDatabase(database: LibraryDatabase) {
  sharedAuthDatabase = database;
}

const isProd = process.env["NODE_ENV"] === "production";
const envJwtSecret = process.env["JWT_SECRET"];
if (isProd && (!envJwtSecret || envJwtSecret === "modelscript-dev-secret")) {
  throw new Error("FATAL: JWT_SECRET must be explicitly configured with a secure key in production mode.");
}
const JWT_SECRET = envJwtSecret || "modelscript-dev-secret";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role?: string | undefined;
  accountType?: string | undefined;
  account_type?: string | undefined;
  tokenVersion?: number | undefined;
}

declare module "express" {
  interface Request {
    user?: AuthUser | undefined;
    tokenScopes?: string[] | undefined;
    tokenPackagePattern?: string | undefined;
    tokenId?: number | undefined;
    cookies?: Record<string, string> | undefined;
    rawBody?: Buffer | string | undefined;
    isDomainSilenced?: boolean | undefined;
    database?: LibraryDatabase | undefined;
  }
}

export { JWT_SECRET };

export function isAccountBlocked(status?: string | null): boolean {
  return status === "suspended" || status === "suspended_dispute" || status === "frozen" || status === "deleted";
}

function parseBotScopes(rawScopes?: string | null): string[] {
  if (!rawScopes || typeof rawScopes !== "string") return [];
  const trimmed = rawScopes.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch {
      // fall back to comma split
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matchesPackagePattern(packageName: string, pattern?: string | null | undefined): boolean {
  if (!pattern || pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return packageName.startsWith(prefix);
  }
  return packageName === pattern;
}

export function requireTokenScope(...allowedScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    // If authenticated via user session / JWT (no tokenScopes restriction) or token has '*' or one of allowedScopes:
    if (
      !req.tokenScopes ||
      req.tokenScopes.includes("*") ||
      req.tokenScopes.includes("admin") ||
      allowedScopes.some((s) => req.tokenScopes!.includes(s))
    ) {
      next();
      return;
    }
    res.status(403).json({
      error: `Insufficient permissions: missing required token scope. Required one of: ${allowedScopes.join(", ")}`,
      requiredScopes: allowedScopes,
      currentScopes: req.tokenScopes,
    });
  };
}

function extractTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  const cookies = req.cookies;
  if (cookies && typeof cookies["modelscript_token"] === "string" && cookies["modelscript_token"].length > 0) {
    return cookies["modelscript_token"];
  }
  const rawCookieHeader = req.headers["cookie"];
  if (rawCookieHeader) {
    const match = rawCookieHeader.match(/(?:^|;\s*)modelscript_token=([^;]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  if (typeof req.query["token"] === "string" && req.query["token"].length > 0) {
    return req.query["token"];
  }
  return undefined;
}

export function isEnterpriseHeaderAuthEnabled(): boolean {
  return process.env["ENTERPRISE_HEADER_AUTH"] === "true" || process.env["SAML_PROXY_AUTH"] === "true";
}

export function isIpTrustedProxy(ip: string): boolean {
  const trustedList = process.env["TRUSTED_PROXY_IPS"];
  if (trustedList) {
    if (trustedList === "*") return true;
    const ips = trustedList.split(",").map((s) => s.trim().toLowerCase());
    const normalizedIp = ip.replace(/^::ffff:/, "").toLowerCase();
    return ips.includes(normalizedIp) || ips.includes(ip.toLowerCase());
  }

  // If not explicitly configured, trust loopback and private container subnets in trust-proxy mode or tests
  const normalized = ip.replace(/^::ffff:/, "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("10.") ||
    normalized.startsWith("172.16.") ||
    normalized.startsWith("172.17.") ||
    normalized.startsWith("172.18.") ||
    normalized.startsWith("172.19.") ||
    normalized.startsWith("172.20.") ||
    normalized.startsWith("172.21.") ||
    normalized.startsWith("172.22.") ||
    normalized.startsWith("172.23.") ||
    normalized.startsWith("172.24.") ||
    normalized.startsWith("172.25.") ||
    normalized.startsWith("172.26.") ||
    normalized.startsWith("172.27.") ||
    normalized.startsWith("172.28.") ||
    normalized.startsWith("172.29.") ||
    normalized.startsWith("172.30.") ||
    normalized.startsWith("172.31.") ||
    normalized.startsWith("192.168.")
  );
}

export function tryEnterpriseProxyAuth(req: Request): boolean {
  if (!isEnterpriseHeaderAuthEnabled() || !sharedAuthDatabase) {
    return false;
  }

  const rawUserHeader =
    (req.headers["x-forwarded-user"] as string | undefined) ||
    (req.headers["x-remote-user"] as string | undefined) ||
    (req.headers["x-webauth-user"] as string | undefined);

  if (!rawUserHeader || typeof rawUserHeader !== "string") {
    return false;
  }

  // Validate proxy source IP (only consult x-forwarded-for in test mode to prevent spoofing in production)
  const clientIp =
    (process.env["NODE_ENV"] === "test"
      ? (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      : undefined) ||
    req.socket?.remoteAddress ||
    req.ip ||
    "";
  if (!clientIp || !isIpTrustedProxy(clientIp)) {
    console.warn(`[EnterpriseAuth] Rejected header auth from untrusted IP: ${clientIp}`);
    return false;
  }

  const cleanUsername = rawUserHeader
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");
  if (!cleanUsername) return false;

  const rawEmailHeader = (req.headers["x-forwarded-email"] as string | undefined)?.trim();
  const email = rawEmailHeader || `${cleanUsername}@enterprise.internal`;

  const rawGroups =
    (req.headers["x-forwarded-groups"] as string | undefined) ||
    (req.headers["x-forwarded-roles"] as string | undefined) ||
    "";
  const groups = rawGroups
    .split(/[,;]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  const configuredAdminGroups = (
    process.env["ENTERPRISE_ADMIN_GROUPS"] ||
    process.env["OIDC_ADMIN_GROUP"] ||
    "Engineering-Admins,AD-Transmission-Planning-Admins,Admins"
  )
    .split(/[,;]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = groups.some((g) => configuredAdminGroups.includes(g));

  let user = sharedAuthDatabase.getUserByUsername(cleanUsername);
  if (!user && rawEmailHeader) {
    const userByEmail = sharedAuthDatabase.getUserByEmail(email);
    if (userByEmail) user = userByEmail;
  }

  if (!user) {
    // JIT auto-provisioning
    const created = sharedAuthDatabase.createUser(cleanUsername, email, null, {
      emailVerified: true,
      accountType: isAdmin ? "admin" : "user",
      status: "active",
    });
    user = {
      id: created.id,
      username: created.username,
      email: created.email,
      account_type: created.account_type || (isAdmin ? "admin" : "user"),
      status: "active",
    };
  } else if (isAdmin && user.account_type !== "admin") {
    sharedAuthDatabase.setUserAccountType(user.id, "admin");
    user.account_type = "admin";
  }

  if (isAccountBlocked(user.status)) {
    return false;
  }

  req.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.account_type || (isAdmin ? "admin" : "user"),
    accountType: user.account_type || (isAdmin ? "admin" : "user"),
    account_type: user.account_type || (isAdmin ? "admin" : "user"),
  };

  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Try enterprise reverse proxy / SAML header authentication first
  if (tryEnterpriseProxyAuth(req)) {
    next();
    return;
  }

  const token = extractTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Check if it's a granular personal access token (PAT)
  if (token.startsWith("ms_pat_") && sharedAuthDatabase) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRecord = sharedAuthDatabase.getApiTokenByHash(tokenHash);

    if (!tokenRecord) {
      res.status(401).json({ error: "Invalid API token" });
      return;
    }

    if (tokenRecord.expires_at) {
      const expires = new Date(tokenRecord.expires_at).getTime();
      if (!Number.isNaN(expires) && expires < Date.now()) {
        res.status(401).json({ error: "API token has expired" });
        return;
      }
    }

    const user = sharedAuthDatabase.getUserById(tokenRecord.user_id);
    if (!user || isAccountBlocked(user.status)) {
      res.status(401).json({ error: "User account inactive or not found" });
      return;
    }

    sharedAuthDatabase.touchApiToken(tokenRecord.id, (req.headers["x-forwarded-for"] as string) || req.ip);

    req.user = {
      ...user,
      accountType: user.account_type || "user",
    };
    req.tokenScopes = tokenRecord.scopes;
    req.tokenPackagePattern = tokenRecord.package_pattern;
    req.tokenId = tokenRecord.id;
    next();
    return;
  }

  // Check if it's a bot token
  if (token.startsWith("ms_bot_") && sharedAuthDatabase) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const botUser = sharedAuthDatabase.getUserByBotTokenHash(tokenHash);

    if (!botUser || isAccountBlocked(botUser.status)) {
      res.status(401).json({ error: "Invalid bot token" });
      return;
    }

    if (botUser.owner_id) {
      const owner = sharedAuthDatabase.getUserById(botUser.owner_id);
      if (owner && isAccountBlocked(owner.status)) {
        res.status(403).json({ error: `Bot owner account is ${owner.status}.` });
        return;
      }
    }

    sharedAuthDatabase.touchBotLastUsed(botUser.id);

    req.user = {
      ...botUser,
      accountType: botUser.account_type,
    };
    req.tokenScopes = parseBotScopes(botUser.bot_scopes);
    next();
    return;
  }

  // Otherwise, handle as a JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { scope?: string | undefined };

    // Intermediate 2FA challenge token cannot access authenticated endpoints
    if (decoded.scope === "2fa_challenge") {
      res.status(401).json({ error: "Two-factor authentication required" });
      return;
    }

    // Fast path check to ensure the user exists, isn't suspended, and session is not revoked
    if (sharedAuthDatabase) {
      const user = sharedAuthDatabase.getUserById(decoded.id);
      if (!user) {
        res.status(401).json({ error: "User no longer exists" });
        return;
      }

      if (user.status === "deleted") {
        res.status(401).json({ error: "User account has been deleted" });
        return;
      }

      if (isAccountBlocked(user.status)) {
        res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
        return;
      }

      const currentTokenVersion = user.token_version ?? 1;
      const tokenVersion = decoded.tokenVersion ?? 1;
      if (tokenVersion !== currentTokenVersion) {
        res.status(401).json({ error: "Session has expired or was revoked. Please log in again." });
        return;
      }

      decoded.accountType = user.account_type || decoded.accountType || decoded.role || "user";
      decoded.account_type = decoded.accountType;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = user.role === "admin" || user.accountType === "admin" || user.account_type === "admin";

    if (!isAdmin) {
      res.status(403).json({ error: "Access denied: Administrator privileges required" });
      return;
    }

    next();
  });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // 1. Try enterprise reverse proxy / SAML header authentication first
  if (tryEnterpriseProxyAuth(req)) {
    next();
    return;
  }

  const token = extractTokenFromRequest(req);

  if (!token) {
    next();
    return;
  }

  // Check if it's a granular personal access token (PAT)
  if (token.startsWith("ms_pat_") && sharedAuthDatabase) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRecord = sharedAuthDatabase.getApiTokenByHash(tokenHash);
    if (tokenRecord) {
      let expired = false;
      if (tokenRecord.expires_at) {
        const expires = new Date(tokenRecord.expires_at).getTime();
        if (!Number.isNaN(expires) && expires < Date.now()) expired = true;
      }
      if (!expired) {
        const user = sharedAuthDatabase.getUserById(tokenRecord.user_id);
        if (user && !isAccountBlocked(user.status)) {
          req.user = {
            ...user,
            accountType: user.account_type || "user",
          };
          req.tokenScopes = tokenRecord.scopes;
          req.tokenPackagePattern = tokenRecord.package_pattern;
          req.tokenId = tokenRecord.id;
        }
      }
    }
    next();
    return;
  }

  // Check if it's a bot token
  if (token.startsWith("ms_bot_") && sharedAuthDatabase) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const botUser = sharedAuthDatabase.getUserByBotTokenHash(tokenHash);
    if (botUser && !isAccountBlocked(botUser.status)) {
      let ownerBlocked = false;
      if (botUser.owner_id) {
        const owner = sharedAuthDatabase.getUserById(botUser.owner_id);
        if (owner && isAccountBlocked(owner.status)) {
          ownerBlocked = true;
        }
      }
      if (!ownerBlocked) {
        sharedAuthDatabase.touchBotLastUsed(botUser.id);
        req.user = {
          ...botUser,
          accountType: botUser.account_type,
        };
        req.tokenScopes = parseBotScopes(botUser.bot_scopes);
      }
    }
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { scope?: string | undefined };
    if (decoded.scope === "2fa_challenge") {
      next();
      return;
    }
    if (sharedAuthDatabase) {
      const user = sharedAuthDatabase.getUserById(decoded.id);
      if (user && !isAccountBlocked(user.status) && (decoded.tokenVersion ?? 1) === (user.token_version ?? 1)) {
        decoded.accountType = user.account_type || decoded.accountType || decoded.role || "user";
        decoded.account_type = decoded.accountType;
        req.user = decoded;
      }
    } else {
      req.user = decoded;
    }
  } catch {
    // Ignore invalid or expired token for optional auth
  }
  next();
}
