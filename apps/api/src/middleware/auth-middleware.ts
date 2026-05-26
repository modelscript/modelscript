// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { LibraryDatabase } from "../database.js";

let sharedAuthDatabase: LibraryDatabase | null = null;

export function setAuthDatabase(database: LibraryDatabase) {
  sharedAuthDatabase = database;
}

const JWT_SECRET = process.env["JWT_SECRET"] || "modelscript-dev-secret";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

declare module "express" {
  interface Request {
    user?: AuthUser;
  }
}

export { JWT_SECRET };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Fast path check to ensure the user hasn't been deleted (e.g. during a DB reset)
    if (sharedAuthDatabase) {
      const userExists = sharedAuthDatabase.getUserById(decoded.id);
      if (!userExists) {
        res.status(401).json({ error: "User no longer exists" });
        return;
      }
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
