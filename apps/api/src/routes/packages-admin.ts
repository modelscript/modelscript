// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";

import type { LibraryDatabase } from "../database.js";
import { matchesPackagePattern, optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import type { LibraryStorage } from "../storage.js";
import { extractPkgAndVersion, isScopeInvalid } from "./packages-compliance.js";

export function isValidPackageName(name: string): boolean {
  return /^(@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name);
}

export function checkPackageTokenAccess(
  req: Request,
  res: Response,
  packageName: string,
  allowedScopes: string[],
): boolean {
  if (req.tokenScopes) {
    const allowed =
      req.tokenScopes.includes("*") ||
      req.tokenScopes.includes("admin") ||
      allowedScopes.some((s) => req.tokenScopes!.includes(s));
    if (!allowed) {
      res.status(403).json({ error: "Insufficient permissions: token lacks required package scope" });
      return false;
    }
  }
  if (req.tokenPackagePattern && !matchesPackagePattern(packageName, req.tokenPackagePattern)) {
    res.status(403).json({
      error: `Insufficient permissions: token package pattern '${req.tokenPackagePattern}' does not permit access to '${packageName}'`,
    });
    return false;
  }
  return true;
}

export function packagesAdminRouter(_storage: LibraryStorage, database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/libraries/transfers/pending
   *
   * List pending transfers for the authenticated user.
   */
  router.get("/transfers/pending", requireAuth, (req: Request, res: Response): void => {
    const transfers = database.getPendingTransfers(req.user!.id);
    res.json({ transfers });
  });

  /**
   * POST /api/v1/libraries/transfers/:id/accept
   *
   * Accept an incoming package transfer.
   */
  router.post("/transfers/:id/accept", requireAuth, (req: Request, res: Response): void => {
    const transferId = Number(req.params["id"]);
    if (!transferId) {
      res.status(400).json({ error: "Valid transfer ID is required" });
      return;
    }

    const accepted = database.acceptPackageTransfer(transferId, req.user!.id);
    if (!accepted) {
      res.status(404).json({ error: "Transfer request not found or not pending for your account" });
      return;
    }

    res.json({ success: true, message: "Package ownership transferred successfully" });
  });

  /**
   * POST /api/v1/libraries/transfers/:id/cancel
   *
   * Cancel an outgoing package transfer.
   */
  router.post("/transfers/:id/cancel", requireAuth, (req: Request, res: Response): void => {
    const transferId = Number(req.params["id"]);
    if (!transferId) {
      res.status(400).json({ error: "Valid transfer ID is required" });
      return;
    }

    const canceled = database.cancelPackageTransfer(transferId, req.user!.id);
    if (!canceled) {
      res.status(404).json({ error: "Transfer request not found or not initiated by you" });
      return;
    }

    res.json({ success: true, message: "Transfer canceled" });
  });

  /**
   * GET /api/v1/libraries/:name/collaborators
   * GET /api/v1/libraries/:scope/:name/collaborators
   *
   * List all registered collaborators for a package.
   */
  router.get(
    ["/:name/collaborators", "/:scope/:name/collaborators"],
    optionalAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name } = extractPkgAndVersion(req);
      if (!name || !isValidPackageName(name)) {
        res.status(400).json({ error: "Valid package name is required" });
        return;
      }

      const collaborators = database.getPackageCollaborators(name);
      const canManage = Boolean(req.user && database.canUserManagePackage(name, req.user.id));
      res.json({ package: name, collaborators, canManage });
    },
  );

  /**
   * POST /api/v1/libraries/:name/collaborators
   * POST /api/v1/libraries/:scope/:name/collaborators
   *
   * Add or update a collaborator for a package.
   * Requires package management permission (owner / org maintainer / collaborator with admin).
   */
  router.post(
    ["/:name/collaborators", "/:scope/:name/collaborators"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name } = extractPkgAndVersion(req);
      if (!name || !isValidPackageName(name)) {
        res.status(400).json({ error: "Valid package name is required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage"])) {
        return;
      }

      if (!database.canUserAdministerPackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to manage collaborators for this package" });
        return;
      }

      const permission = (req.body?.permission ?? "write") as "admin" | "write" | "read";
      if (!["admin", "write", "read"].includes(permission)) {
        res.status(400).json({ error: "Permission must be 'admin', 'write', or 'read'" });
        return;
      }

      let targetUserId = Number(req.body?.userId);
      if (!targetUserId && req.body?.username) {
        const targetUser = database.getUserByUsername(String(req.body.username).trim());
        if (targetUser) targetUserId = targetUser.id;
      }

      if (!targetUserId) {
        res.status(400).json({ error: "Valid target userId or username is required" });
        return;
      }

      database.addPackageCollaborator(name, targetUserId, permission);
      res.json({ success: true, message: `Collaborator permission set to '${permission}'` });
    },
  );

  /**
   * DELETE /api/v1/libraries/:name/collaborators/:userId
   * DELETE /api/v1/libraries/:scope/:name/collaborators/:userId
   *
   * Remove a collaborator from a package.
   */
  router.delete(
    ["/:name/collaborators/:userId", "/:scope/:name/collaborators/:userId"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name } = extractPkgAndVersion(req);
      const targetUserId = Number(req.params["userId"]);

      if (!name || !isValidPackageName(name) || !targetUserId) {
        res.status(400).json({ error: "Valid package name and target userId are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage"])) {
        return;
      }

      if (!database.canUserAdministerPackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to remove collaborators for this package" });
        return;
      }

      const removed = database.removePackageCollaborator(name, targetUserId);
      if (!removed) {
        res.status(404).json({ error: "Collaborator not found for this package" });
        return;
      }

      res.json({ success: true, message: "Collaborator removed successfully" });
    },
  );

  /**
   * POST /api/v1/libraries/:name/:version/deprecate
   * POST /api/v1/libraries/:scope/:name/:version/deprecate
   *
   * Deprecate a package release with an explanation message.
   * Requires maintainer/owner/admin authentication.
   */
  router.post(
    ["/:name/:version/deprecate", "/:scope/:name/:version/deprecate"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);
      const reason = String(
        req.body?.reason || req.query["reason"] || "This version has been deprecated by the author.",
      );

      if (!name || !version || !isValidPackageName(name)) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage", "packages:yank", "packages:publish"])) {
        return;
      }

      if (!database.canUserManagePackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to deprecate this package" });
        return;
      }

      const updated = database.deprecateLibraryRelease(name, version, reason);
      if (!updated) {
        res.status(404).json({ error: `Release "${name}@${version}" not found` });
        return;
      }

      res.json({
        success: true,
        name,
        version,
        isDeprecated: true,
        deprecationReason: reason,
      });
    },
  );

  /**
   * DELETE /api/v1/libraries/:name/:version/deprecate
   * DELETE /api/v1/libraries/:scope/:name/:version/deprecate
   *
   * Clear deprecation status for a package release.
   */
  router.delete(
    ["/:name/:version/deprecate", "/:scope/:name/:version/deprecate"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);

      if (!name || !version || !isValidPackageName(name)) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage", "packages:yank", "packages:publish"])) {
        return;
      }

      if (!database.canUserManagePackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to manage this package" });
        return;
      }

      const updated = database.deprecateLibraryRelease(name, version, null);
      if (!updated) {
        res.status(404).json({ error: `Release "${name}@${version}" not found` });
        return;
      }

      res.json({
        success: true,
        name,
        version,
        isDeprecated: false,
      });
    },
  );

  /**
   * POST /api/v1/libraries/:name/:version/yank
   * POST /api/v1/libraries/:scope/:name/:version/yank
   *
   * Yank a package release (tombstones download while keeping metadata for reproducibility).
   */
  router.post(
    ["/:name/:version/yank", "/:scope/:name/:version/yank"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);
      const reason = String(req.body?.reason || req.query["reason"] || "This release has been yanked.");

      if (!name || !version || !isValidPackageName(name)) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage", "packages:yank"])) {
        return;
      }

      if (!database.canUserManagePackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to yank this package" });
        return;
      }

      const updated = database.yankLibraryRelease(name, version, reason);
      if (!updated) {
        res.status(404).json({ error: `Release "${name}@${version}" not found` });
        return;
      }

      if (reason.toLowerCase().match(/vulnerab|security|cve|exploit|compromise/)) {
        database.createNotification(req.user!.id, req.user!.id, "security_alert", null, {
          packageName: name,
          packageVersion: version,
          reason,
          severity: "critical",
        });
      }

      res.json({
        success: true,
        name,
        version,
        isYanked: true,
        yankReason: reason,
      });
    },
  );

  /**
   * POST /api/v1/libraries/:name/:version/unyank
   * POST /api/v1/libraries/:scope/:name/:version/unyank
   *
   * Restore a previously yanked package release.
   */
  router.post(
    ["/:name/:version/unyank", "/:scope/:name/:version/unyank"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name, version } = extractPkgAndVersion(req);

      if (!name || !version || !isValidPackageName(name)) {
        res.status(400).json({ error: "Package name and version are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage", "packages:yank"])) {
        return;
      }

      if (!database.canUserManagePackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to manage this package" });
        return;
      }

      const updated = database.unyankLibraryRelease(name, version);
      if (!updated) {
        res.status(404).json({ error: `Release "${name}@${version}" not found` });
        return;
      }

      res.json({
        success: true,
        name,
        version,
        isYanked: false,
      });
    },
  );

  /**
   * POST /api/v1/libraries/:name/transfer-ownership
   * POST /api/v1/libraries/:scope/:name/transfer-ownership
   *
   * Initiate an ownership transfer of a package to another user.
   */
  router.post(
    ["/:name/transfer-ownership", "/:scope/:name/transfer-ownership"],
    requireAuth,
    (req: Request, res: Response, next: NextFunction): void => {
      if (isScopeInvalid(req)) return next();
      const { name } = extractPkgAndVersion(req);
      const targetUsername = String(req.body?.targetUsername || req.body?.toUsername || "");

      if (!name || !targetUsername) {
        res.status(400).json({ error: "Package name and target username are required" });
        return;
      }

      if (!checkPackageTokenAccess(req, res, name, ["packages:manage"])) {
        return;
      }

      if (!database.canUserAdministerPackage(name, req.user!.id)) {
        res.status(403).json({ error: "You do not have permission to transfer this package" });
        return;
      }

      const targetUser = database.getUserByUsername(targetUsername);
      if (!targetUser) {
        res.status(404).json({ error: `Target user "${targetUsername}" not found` });
        return;
      }

      if (targetUser.id === req.user!.id) {
        res.status(400).json({ error: "Cannot transfer package to yourself" });
        return;
      }

      const transferId = database.createPackageTransfer(name, req.user!.id, targetUser.id);
      res.status(201).json({
        success: true,
        transferId,
        package: name,
        toUser: targetUsername,
        status: "pending",
      });
    },
  );

  return router;
}
