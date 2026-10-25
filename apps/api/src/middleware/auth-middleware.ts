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
  }
}

export { JWT_SECRET };

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
  const cookies = (req as any).cookies;
  if (cookies && typeof cookies["modelscript_token"] === "string" && cookies["modelscript_token"].length > 0) {
    return cookies["modelscript_token"];
  }
  const rawCookieHeader = req.headers["cookie"];
  if (rawCookieHeader) {
    const match = rawCookieHeader.match(/(?:^|;\s*)modelscript_token=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  if (typeof req.query["token"] === "string" && req.query["token"].length > 0) {
    return req.query["token"];
  }
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
    if (!user || user.status === "deleted" || user.status === "suspended" || user.status === "frozen") {
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

    if (!botUser) {
      res.status(401).json({ error: "Invalid bot token" });
      return;
    }

    req.user = {
      ...botUser,
      accountType: botUser.account_type,
    };
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

      if (user.status === "suspended" || user.status === "frozen") {
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
        if (user && user.status !== "suspended" && user.status !== "frozen" && user.status !== "deleted") {
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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { scope?: string | undefined };
    if (decoded.scope === "2fa_challenge") {
      next();
      return;
    }
    if (sharedAuthDatabase) {
      const user = sharedAuthDatabase.getUserById(decoded.id);
      if (
        user &&
        user.status !== "suspended" &&
        user.status !== "frozen" &&
        (decoded.tokenVersion ?? 1) === (user.token_version ?? 1)
      ) {
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
