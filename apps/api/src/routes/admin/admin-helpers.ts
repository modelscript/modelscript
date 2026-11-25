// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import type { LibraryDatabase } from "../../database.js";
import {
  JWT_SECRET,
  isAccountBlocked,
  requireAdmin,
  requireStaffRole,
  type StaffRole,
} from "../../middleware/auth-middleware.js";
import type { FeatureFlagService } from "../../services/feature-flag-service.js";
import type { FederationWorker } from "../../services/federation-worker.js";

export type AdminMiddleware = (req: Request, res: Response, next: express.NextFunction) => void;

export interface AdminRouteContext {
  database: LibraryDatabase;
  worker?: FederationWorker | undefined;
  featureFlagService?: FeatureFlagService | undefined;
  verifyAdminSudo: AdminMiddleware;
}

export function createStaffGuard(...roles: StaffRole[]) {
  const middleware = roles.length === 0 ? requireAdmin : requireStaffRole(...roles);
  return (req: Request, res: Response, next: express.NextFunction) => {
    return middleware(req, res, next);
  };
}

// Enforce staff privileges by tier
export const adminAuth = createStaffGuard();
export const moderatorAuth = createStaffGuard("admin", "moderator");
export const auditorAuth = createStaffGuard("admin", "auditor");
export const staffAuth = createStaffGuard("admin", "moderator", "auditor");

export function createAdminSudoVerifier(database: LibraryDatabase): AdminMiddleware {
  return function verifyAdminSudo(req: Request, res: Response, next: express.NextFunction): void {
    const rawSudoToken =
      (req.headers["x-admin-sudo-token"] as string | undefined) ||
      (typeof req.body?.sudoToken === "string" ? req.body.sudoToken : undefined);
    const isProd = process.env["NODE_ENV"] === "production";
    const enforceSudo =
      process.env["REQUIRE_ADMIN_SUDO"] === "true" || req.headers["x-enforce-sudo"] === "true" || isProd;

    if (!rawSudoToken) {
      if (enforceSudo) {
        res.status(403).json({
          error: "Administrator step-up sudo verification is required for this operation",
          code: "SUDO_REQUIRED",
        });
        return;
      }
      next();
      return;
    }

    try {
      const decoded = jwt.verify(rawSudoToken.trim(), JWT_SECRET) as {
        id?: number | undefined;
        sudo?: boolean | undefined;
        tokenVersion?: number | undefined;
      };
      if (!decoded.sudo || !decoded.id || (req.user?.id && decoded.id !== req.user.id)) {
        res.status(403).json({ error: "Invalid administrator sudo token", code: "SUDO_INVALID" });
        return;
      }
      const user = database.getUserById(decoded.id);
      if (!user || isAccountBlocked(user.status)) {
        res.status(403).json({ error: "Invalid administrator sudo token", code: "SUDO_INVALID" });
        return;
      }
      const currentTokenVersion = user.token_version ?? 1;
      const tokenVersion = decoded.tokenVersion ?? 1;
      if (tokenVersion !== currentTokenVersion) {
        res.status(403).json({ error: "Expired or invalid administrator sudo token", code: "SUDO_EXPIRED" });
        return;
      }
      next();
    } catch {
      res.status(403).json({ error: "Expired or invalid administrator sudo token", code: "SUDO_EXPIRED" });
    }
  };
}
