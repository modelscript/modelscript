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
}

declare module "express" {
  interface Request {
    user?: AuthUser;
  }
}

export { JWT_SECRET };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (typeof req.query.token === "string" && req.query.token.length > 0) {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
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
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Fast path check to ensure the user hasn't been deleted (e.g. during a DB reset)
    if (sharedAuthDatabase) {
      const userExists = sharedAuthDatabase.getUserById(decoded.id);
      if (!userExists) {
        res.status(401).json({ error: "User no longer exists" });
        return;
      }
      decoded.accountType = userExists.account_type || decoded.accountType || decoded.role || "user";
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
  const authHeader = req.headers["authorization"];
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (typeof req.query.token === "string" && req.query.token.length > 0) {
    token = req.query.token;
  }

  if (!token) {
    next();
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    if (sharedAuthDatabase) {
      const userExists = sharedAuthDatabase.getUserById(decoded.id);
      if (userExists) {
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
