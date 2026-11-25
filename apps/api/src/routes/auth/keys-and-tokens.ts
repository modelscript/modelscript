// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router as createRouter, type Request, type Response, type Router } from "express";
import crypto from "node:crypto";

import type { LibraryDatabase } from "../../database.js";
import { requireAuth } from "../../middleware/auth-middleware.js";
import { isValidIpOrCidr, parseIpAllowlist } from "../../util/cidr-matcher.js";
import { getClientIp } from "../../util/client-ip.js";
import { isScopedApiToken } from "./auth-helpers.js";

const VALID_PAT_SCOPES = new Set([
  "*",
  "admin",
  "admin:accounts:read",
  "packages:read",
  "packages:publish",
  "packages:yank",
  "packages:manage",
  "repos:read",
  "repos:write",
  "account:read",
]);

export function createKeysAndTokensRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/auth/keys
   */
  router.get("/keys", requireAuth, (req: Request, res: Response): void => {
    try {
      const keys = database.getPublicKeysForUser(req.user!.id);
      res.json({ keys });
    } catch {
      res.status(500).json({ error: "Failed to fetch public keys" });
    }
  });

  /**
   * POST /api/v1/auth/keys
   */
  router.post("/keys", requireAuth, (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Restricted personal access tokens cannot manage public keys" });
      return;
    }
    const { key_id_string, public_key_pem, device_name } = req.body;
    if (!key_id_string || !public_key_pem) {
      res.status(400).json({ error: "key_id_string and public_key_pem are required" });
      return;
    }

    try {
      const result = database.addPublicKeyForUser(req.user!.id, key_id_string, public_key_pem, device_name);
      res.status(201).json({ id: result.id, key_id_string, device_name });
    } catch {
      res.status(500).json({ error: "Failed to add public key" });
    }
  });

  /**
   * DELETE /api/v1/auth/keys/:id
   */
  router.delete("/keys/:id", requireAuth, (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Restricted personal access tokens cannot revoke public keys" });
      return;
    }
    try {
      database.revokePublicKey(req.user!.id, Number(req.params["id"]));
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to revoke public key" });
    }
  });

  /**
   * GET /api/v1/auth/tokens
   * List user's active API personal access tokens
   */
  router.get("/tokens", requireAuth, (req: Request, res: Response): void => {
    try {
      const tokens = database.listApiTokens(req.user!.id);
      res.json({ tokens });
    } catch {
      res.status(500).json({ error: "Failed to list API tokens" });
    }
  });

  /**
   * POST /api/v1/auth/tokens
   * Generate a new personal access token (PAT)
   */
  router.post("/tokens", requireAuth, (req: Request, res: Response): void => {
    if (req.tokenScopes && !req.tokenScopes.includes("*") && !req.tokenScopes.includes("admin")) {
      res.status(403).json({ error: "Personal access tokens cannot mint new API tokens without admin scope" });
      return;
    }
    const { name, scopes, packagePattern, expiresInDays, ipAllowlist, cidr } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Token name is required" });
      return;
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json({ error: "At least one scope is required in the 'scopes' array" });
      return;
    }

    const rawAllowlist = ipAllowlist ?? cidr;
    let normalizedAllowlist: string | null = null;
    if (rawAllowlist) {
      const parts = parseIpAllowlist(rawAllowlist);
      for (const entry of parts) {
        if (!isValidIpOrCidr(entry)) {
          res.status(400).json({ error: `Invalid IP address or CIDR mask: '${entry}'` });
          return;
        }
      }
      if (parts.length > 0) {
        normalizedAllowlist = parts.join(", ");
      }
    }

    const userRecord = database.getUserById(req.user!.id);
    const isAdminUser =
      userRecord?.account_type === "admin" ||
      req.user!.account_type === "admin" ||
      req.user!.accountType === "admin" ||
      req.user!.role === "admin";
    for (const scope of scopes) {
      if (typeof scope !== "string" || !VALID_PAT_SCOPES.has(scope)) {
        res
          .status(400)
          .json({ error: `Invalid scope: '${scope}'. Valid scopes: ${Array.from(VALID_PAT_SCOPES).join(", ")}` });
        return;
      }
      if ((scope === "admin" || scope === "*" || scope.startsWith("admin:")) && !isAdminUser) {
        res.status(403).json({ error: `Insufficient privileges to mint token with '${scope}' scope` });
        return;
      }
    }

    let expiresAt: string | null = null;
    if (typeof expiresInDays === "number" && Number.isFinite(expiresInDays) && expiresInDays > 0) {
      const cappedDays = Math.min(expiresInDays, 3650);
      const expiry = new Date(Date.now() + cappedDays * 24 * 60 * 60 * 1000);
      expiresAt = expiry.toISOString();
    } else if (typeof req.body?.expiresAt === "string") {
      const parsedMs = Date.parse(req.body.expiresAt);
      if (Number.isNaN(parsedMs)) {
        res.status(400).json({ error: "Invalid expiresAt timestamp" });
        return;
      }
      expiresAt = new Date(parsedMs).toISOString();
    }

    try {
      const secretBytes = crypto.randomBytes(32).toString("hex");
      const plaintextToken = `ms_pat_${secretBytes}`;
      const tokenPrefix = plaintextToken.slice(0, 14); // e.g. "ms_pat_7e9a2f1"
      const tokenHash = crypto.createHash("sha256").update(plaintextToken).digest("hex");

      const tokenRowId = database.storeApiTokenRow({
        userId: req.user!.id,
        name: name.trim(),
        tokenPrefix,
        tokenHash,
        scopes,
        packagePattern: typeof packagePattern === "string" ? packagePattern.trim() : "*",
        ipAllowlist: normalizedAllowlist,
        expiresAt,
      });
      const tokenId = Number(tokenRowId);
      const auditResourceId = String(Math.floor(tokenId) || 0);

      database.logAudit({
        actorId: req.user!.id,
        action: "auth_token_created",
        resourceType: "api_token",
        resourceId: auditResourceId,
        ipAddress: getClientIp(req),
        details: { name: name.trim(), scopes, packagePattern, ipAllowlist: normalizedAllowlist, expiresAt },
      });

      database.createNotification(req.user!.id, req.user!.id, "security_alert", null, {
        title: "New Personal Access Token Created",
        description: `A new API token '${name.trim()}' (${tokenPrefix}...) was created with scopes: ${scopes.join(", ")}${normalizedAllowlist ? ` (CIDR: ${normalizedAllowlist})` : ""}.`,
        skipEmail: true,
      });

      res.status(201).json({
        token: plaintextToken,
        id: tokenId,
        name: name.trim(),
        prefix: tokenPrefix,
        scopes,
        packagePattern: packagePattern || "*",
        ipAllowlist: normalizedAllowlist,
        expiresAt,
        message: "Save this token now; you will not be able to see it again.",
      });
    } catch {
      res.status(500).json({ error: "Failed to create API token" });
    }
  });

  /**
   * DELETE /api/v1/auth/tokens/:id
   * Revoke an API token
   */
  router.delete("/tokens/:id", requireAuth, (req: Request, res: Response): void => {
    if (req.tokenScopes && !req.tokenScopes.includes("*") && !req.tokenScopes.includes("admin")) {
      res.status(403).json({ error: "Personal access tokens cannot revoke API tokens without admin scope" });
      return;
    }
    const rawId = req.params["id"];
    const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
    const tokenId = parseInt(idStr || "", 10);
    if (Number.isNaN(tokenId)) {
      res.status(400).json({ error: "Invalid token ID" });
      return;
    }

    try {
      const deleted = database.deleteApiToken(tokenId, req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: "API token not found or already revoked" });
        return;
      }

      database.logAudit({
        actorId: req.user!.id,
        action: "auth_token_revoked",
        resourceType: "api_token",
        resourceId: String(tokenId),
        ipAddress: getClientIp(req),
        details: { tokenId },
      });

      res.json({ success: true, message: "Token revoked successfully" });
    } catch {
      res.status(500).json({ error: "Failed to revoke API token" });
    }
  });

  return router;
}
