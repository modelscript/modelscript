// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../../database.js";
import { JWT_SECRET, isAccountBlocked, requireAuth } from "../../middleware/auth-middleware.js";
import { authRateLimiter } from "../../middleware/rate-limiter.js";
import { registerOpenApiOperation, validateBody, type ObjectSchema } from "../../middleware/validate.js";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import {
  parsePasswordResetTokenPayload,
  signPasswordResetToken,
  verifyPasswordResetToken,
} from "../../util/password-reset.js";
import { resolveBrandInstanceName } from "../../util/registration-policy.js";
import { isScopedApiToken, setSessionCookie } from "./auth-helpers.js";

const FORGOT_PASSWORD_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Self-service password reset request payload.",
  required: ["email"],
  properties: {
    email: {
      type: "string",
      required: true,
      minLength: 1,
      description: "Account email address to send a password reset link to.",
    },
  },
};

const RESET_PASSWORD_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Password reset confirmation payload.",
  required: ["token", "newPassword"],
  properties: {
    token: {
      type: "string",
      required: true,
      minLength: 1,
      description: "Signed single-use password reset token.",
    },
    newPassword: {
      type: "string",
      required: true,
      minLength: 8,
      maxLength: 72,
      description: "New account password (8 to 72 bytes UTF-8).",
    },
  },
};

registerOpenApiOperation("post", "/api/v1/auth/forgot-password", {
  summary: "Request a self-service password reset link",
  tags: ["auth"],
  requestBody: FORGOT_PASSWORD_SCHEMA,
  responses: {
    "200": { description: "Generic confirmation returned regardless of whether the email exists." },
    "400": { description: "Email address is missing or invalid." },
    "429": { description: "Rate limit exceeded." },
  },
});

registerOpenApiOperation("post", "/api/v1/auth/reset-password", {
  summary: "Complete a password reset using a signed recovery token",
  tags: ["auth"],
  requestBody: RESET_PASSWORD_SCHEMA,
  responses: {
    "200": { description: "Password updated and existing sessions revoked." },
    "400": { description: "Invalid or expired reset token, or invalid new password." },
    "403": { description: "Account is suspended or blocked." },
    "429": { description: "Rate limit exceeded." },
  },
});

export function createPasswordRecoveryRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/auth/forgot-password
   *
   * Initiates self-service password reset.
   * Returns generic 200 message to prevent user enumeration.
   */
  router.post(
    "/forgot-password",
    authRateLimiter,
    validateBody(FORGOT_PASSWORD_SCHEMA),
    async (req: Request, res: Response): Promise<void> => {
      const { email } = req.body || {};
      if (!email || typeof email !== "string") {
        res.status(400).json({ error: "Email address is required" });
        return;
      }

      const cleanEmail = email.toLowerCase().trim();

      try {
        const user = database.getUserByEmail(cleanEmail);
        let resetToken: string | undefined;

        if (user && !isAccountBlocked(user.status)) {
          resetToken = signPasswordResetToken(user.id, user.email, user.token_version ?? 1, user.password_hash);

          database.logAudit({
            actorId: user.id,
            action: "auth_password_reset_requested",
            resourceType: "auth",
            resourceId: String(user.id),
            ipAddress: getClientIp(req),
            details: { email: user.email },
          });

          const instanceName = resolveBrandInstanceName(database);
          void defaultMailer
            .sendPasswordResetEmail(user.email, user.username, resetToken, { instanceName })
            .catch((err) => {
              console.error("[Auth] Failed to dispatch password reset email:", err);
            });
        }

        const isTest = process.env["NODE_ENV"] === "test";
        const tokenPayload = isTest ? resetToken : undefined;

        res.status(200).json({
          success: true,
          message: "If an account exists with this email address, a password reset link has been sent.",
          ...(tokenPayload ? { resetToken: tokenPayload } : {}),
        });
      } catch (err: unknown) {
        res
          .status(500)
          .json({ error: err instanceof Error ? err.message : "Failed to process password reset request" });
      }
    },
  );

  /**
   * POST /api/v1/auth/reset-password
   *
   * Validates signed reset token and updates the user's password.
   * Automatically increments token_version to invalidate existing sessions.
   */
  router.post(
    "/reset-password",
    authRateLimiter,
    validateBody(RESET_PASSWORD_SCHEMA),
    async (req: Request, res: Response): Promise<void> => {
      const { token, newPassword } = req.body || {};

      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Reset token is required" });
        return;
      }

      if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
        res.status(400).json({ error: "New password must be at least 8 characters" });
        return;
      }
      if (Buffer.byteLength(newPassword, "utf8") > 72) {
        res.status(400).json({ error: "New password must not exceed 72 bytes" });
        return;
      }

      const payload = parsePasswordResetTokenPayload(token);
      if (!payload || !payload.userId) {
        res.status(400).json({ error: "Invalid or malformed password reset link" });
        return;
      }

      try {
        const user = database.getUserById(payload.userId);
        if (!user || user.email.toLowerCase() !== payload.email.toLowerCase()) {
          res.status(400).json({ error: "Invalid or expired password reset link" });
          return;
        }

        if (isAccountBlocked(user.status)) {
          res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
          return;
        }

        const fullUser = database.getUserByEmail(user.email);
        const verification = verifyPasswordResetToken(token, fullUser || user);
        if (!verification.valid) {
          res.status(400).json({ error: verification.error || "Invalid or expired password reset link" });
          return;
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        database.updatePassword(user.id, newHash);
        database.incrementTokenVersion(user.id);

        database.logAudit({
          actorId: user.id,
          action: "auth_password_reset_completed",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: getClientIp(req),
          details: { email: user.email },
        });

        database.createNotification(user.id, user.id, "security_alert", null, {
          title: "Account Password Reset",
          description:
            "Your account password was reset using a recovery link and all other active sessions were revoked.",
          skipEmail: true,
        });

        res.status(200).json({
          success: true,
          message: "Your password has been reset successfully. Please sign in with your new password.",
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to reset password" });
      }
    },
  );

  /**
   * PUT /api/v1/auth/password
   *
   * Changes or initial-sets account password.
   * Increments token_version to invalidate all existing sessions and returns a refreshed token.
   */
  router.put("/password", authRateLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot change account passwords" });
      return;
    }
    const { oldPassword, newPassword } = req.body;
    const userId = req.user!.id;
    const currentUser = database.getUserById(userId);
    if (currentUser?.account_type === "bot" || req.user?.accountType === "bot" || req.user?.account_type === "bot") {
      res.status(403).json({ error: "Bot service accounts cannot set an interactive login password" });
      return;
    }

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }
    if (Buffer.byteLength(newPassword, "utf8") > 72) {
      res.status(400).json({ error: "New password must not exceed 72 bytes" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      // If user already has a password, verify old password
      if (hash) {
        if (!oldPassword || typeof oldPassword !== "string" || Buffer.byteLength(oldPassword, "utf8") > 72) {
          res.status(400).json({ error: "Current password is required" });
          return;
        }
        if (!(await bcrypt.compare(oldPassword, hash))) {
          res.status(401).json({ error: "Incorrect old password" });
          return;
        }
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      database.updatePassword(userId, newHash);

      const user = database.getUserById(userId);
      const newToken = jwt.sign(
        { id: user!.id, username: user!.username, email: user!.email, tokenVersion: user!.token_version ?? 1 },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      setSessionCookie(res, newToken);

      database.logAudit({
        actorId: userId,
        action: "auth_password_changed",
        resourceType: "auth",
        resourceId: String(userId),
        ipAddress: getClientIp(req),
      });

      database.createNotification(userId, userId, "security_alert", null, {
        title: "Account Password Changed",
        description: "Your account password was changed and other active sessions were revoked.",
        skipEmail: true,
      });

      res.json({ success: true, token: newToken, message: "Password updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Password change failed" });
    }
  });

  return router;
}
