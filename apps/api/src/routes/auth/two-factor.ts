// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../../database.js";
import { JWT_SECRET, isAccountBlocked, requireAuth } from "../../middleware/auth-middleware.js";
import { defaultLoginLimiter } from "../../middleware/login-limiter.js";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { resolveBrandInstanceName } from "../../util/registration-policy.js";
import {
  generateBackupCodes,
  generateTotpSecret,
  generateTotpUri,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "../../util/totp.js";
import { isScopedApiToken, setSessionCookie } from "./auth-helpers.js";

export function createTwoFactorRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const pendingTotpSecrets = new Map<number, string>();

  /**
   * POST /api/v1/auth/2fa/challenge
   *
   * Completes sign in for accounts with Two-Factor Authentication enabled.
   * Accepts { tempToken, code }.
   * Code can be a 6-digit TOTP code or a single-use backup recovery code.
   */
  router.post("/2fa/challenge", express.json(), async (req: Request, res: Response): Promise<void> => {
    const { tempToken, code } = req.body || {};
    const clientIp = getClientIp(req);
    const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

    if (!bypassRateLimit) {
      const ipRateCheck = defaultLoginLimiter.check(clientIp);
      if (!ipRateCheck.allowed) {
        res.status(429).json({
          error: "Too many failed 2FA attempts. Please try again in 15 minutes.",
          retryAfterSeconds: Math.ceil(ipRateCheck.resetInMs / 1000),
        });
        return;
      }
    }

    if (!tempToken || typeof tempToken !== "string") {
      res.status(400).json({ error: "Temporary challenge token is required" });
      return;
    }

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Two-factor authentication code is required" });
      return;
    }

    try {
      const decoded = jwt.verify(tempToken, JWT_SECRET) as {
        id: number;
        email: string;
        scope?: string | undefined;
        purpose?: string | undefined;
        tokenVersion?: number | undefined;
      };

      if (decoded.scope !== "2fa_challenge" && decoded.purpose !== "2fa_challenge") {
        res.status(400).json({ error: "Invalid challenge token" });
        return;
      }

      if (!bypassRateLimit && decoded.email) {
        const rateCheck = defaultLoginLimiter.check(clientIp, decoded.email);
        if (!rateCheck.allowed) {
          res.status(429).json({
            error: "Too many failed 2FA attempts. Please try again in 15 minutes.",
            retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
          });
          return;
        }
      }

      const user = database.getUserById(decoded.id);
      if (!user) {
        res.status(401).json({ error: "User no longer exists" });
        return;
      }

      if (isAccountBlocked(user.status)) {
        res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
        return;
      }

      if ((decoded.tokenVersion ?? 1) !== (user.token_version ?? 1)) {
        res.status(401).json({ error: "Session has expired or was revoked. Please log in again." });
        return;
      }

      const state2FA = database.getUser2FAState(user.id);
      if (!state2FA || !state2FA.totp_enabled || !state2FA.totp_secret) {
        res.status(400).json({ error: "Two-factor authentication is not configured for this account" });
        return;
      }

      const cleanCode = code.trim();
      let verified = false;
      let usedBackupCode = false;

      // 1. Check if it's a valid 6-digit TOTP code
      if (/^\d{6}$/.test(cleanCode.replace(/\s+/g, ""))) {
        verified = verifyTotpCode(state2FA.totp_secret, cleanCode, {
          preventReplay: process.env["NODE_ENV"] === "production",
        });
      }

      // 2. If not verified via TOTP, check if it's a valid backup recovery code
      if (!verified && state2FA.backup_codes.length > 0) {
        const backupResult = verifyAndConsumeBackupCode(cleanCode, state2FA.backup_codes);
        if (backupResult.valid && backupResult.matchedHash) {
          database.consumeBackupCode(user.id, backupResult.matchedHash);
          verified = true;
          usedBackupCode = true;
        }
      }

      if (!verified) {
        defaultLoginLimiter.recordFailure(clientIp, user.email);
        database.logAudit({
          actorId: user.id,
          action: "auth_login_failure",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: clientIp,
          details: { email: user.email, reason: "invalid_2fa_code" },
        });
        res.status(401).json({ error: "Invalid authentication code or backup recovery code" });
        return;
      }

      defaultLoginLimiter.recordSuccess(clientIp, user.email);

      const sessionToken = jwt.sign(
        { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
        JWT_SECRET,
        {
          expiresIn: "7d",
        },
      );

      setSessionCookie(res, sessionToken);
      defaultLoginLimiter.recordSuccess(clientIp, user.email);

      database.logAudit({
        actorId: user.id,
        action: "auth_login_success",
        resourceType: "auth",
        resourceId: String(user.id),
        ipAddress: clientIp,
        details: { method: usedBackupCode ? "2fa_backup_code" : "2fa_totp" },
      });

      const backupCodesRemaining = database.getRemainingBackupCodeCount(user.id);
      if (usedBackupCode) {
        database.createNotification(user.id, user.id, "security_alert", null, {
          title: "2FA Backup Recovery Code Used",
          description: `A single-use backup code was used to sign in (${backupCodesRemaining} remaining).`,
          skipEmail: true,
        });
        if (user.email_verified === 1) {
          void defaultMailer
            .sendSecurityAlertEmail(user.email, {
              username: user.username,
              eventTitle: "2FA Backup Recovery Code Used",
              description: `A single-use backup recovery code was used to sign in to your account (${backupCodesRemaining} codes remaining).`,
              ipAddress: clientIp,
              instanceName: resolveBrandInstanceName(database),
            })
            .catch(() => {});
        }
      }

      const {
        password_hash,
        github_token: _gh,
        gitlab_token: _gl,
        totp_secret: _,
        backup_codes: __,
        ...safeUser
      } = user;

      res.json({
        token: sessionToken,
        user: {
          ...safeUser,
          banner_url: user.banner_url ?? null,
          credit_balance: user.credit_balance ?? 0,
          has_password: Boolean(password_hash),
          totp_enabled: Boolean(user.totp_enabled),
          email_verified: user.email_verified ?? 1,
          backup_codes_remaining: backupCodesRemaining,
        },
        usedBackupCode,
        backupCodesRemaining,
      });
    } catch {
      res.status(401).json({ error: "Invalid or expired challenge token" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/setup
   *
   * Generates a new TOTP secret and otpauth URI for the authenticated user.
   */
  router.post("/2fa/setup", requireAuth, (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot modify two-factor authentication settings" });
      return;
    }
    try {
      const user = database.getUserById(req.user!.id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (user.totp_enabled === 1) {
        res.status(400).json({
          error: "Two-factor authentication is already enabled. Disable 2FA first before configuring a new secret.",
        });
        return;
      }

      const secret = generateTotpSecret();
      if (pendingTotpSecrets.size >= 2_000 && !pendingTotpSecrets.has(user.id)) {
        const oldestKey = pendingTotpSecrets.keys().next().value;
        if (oldestKey !== undefined) {
          pendingTotpSecrets.delete(oldestKey);
        }
      }
      pendingTotpSecrets.set(user.id, secret);
      database.setPendingTotpSecret(user.id, secret, Date.now() + 15 * 60 * 1000);
      const otpAuthUri = generateTotpUri({
        accountName: user.email,
        issuer: resolveBrandInstanceName(database),
        secret,
      });

      res.json({
        secret,
        otpAuthUri,
        otpauthUri: otpAuthUri,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to initialize 2FA setup" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/verify
   *
   * Verifies the initial TOTP code, activates 2FA for the user,
   * and generates 10 single-use emergency backup recovery codes.
   */
  router.post("/2fa/verify", requireAuth, express.json(), (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot modify two-factor authentication settings" });
      return;
    }
    const { secret, code } = req.body || {};
    const clientIp = getClientIp(req);
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const existingUser = database.getUserById(userId);
    if (existingUser?.totp_enabled === 1) {
      res.status(400).json({
        error: "Two-factor authentication is already enabled. Disable 2FA first before configuring a new secret.",
      });
      return;
    }
    const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

    if (!bypassRateLimit) {
      const rateCheck = defaultLoginLimiter.check(clientIp, userEmail);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: "Too many failed 2FA verification attempts. Please try again in 15 minutes.",
          retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
        });
        return;
      }
    }

    const pendingSecret = database.getPendingTotpSecret(userId) ?? pendingTotpSecrets.get(userId);
    if (pendingSecret && typeof secret === "string" && secret.trim() && secret.trim() !== pendingSecret) {
      if (!bypassRateLimit) {
        defaultLoginLimiter.recordFailure(clientIp, userEmail);
      }
      res.status(400).json({ error: "Provided secret does not match active 2FA setup session" });
      return;
    }
    const clientSuppliedSecret =
      process.env["NODE_ENV"] !== "production" && typeof secret === "string" && secret.trim()
        ? secret.trim()
        : undefined;
    const resolvedSecret = pendingSecret || clientSuppliedSecret;

    if (!resolvedSecret) {
      res.status(400).json({ error: "Secret is required" });
      return;
    }

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Verification code is required" });
      return;
    }

    const valid = verifyTotpCode(resolvedSecret, code, {
      preventReplay: process.env["NODE_ENV"] === "production",
    });
    if (!valid) {
      if (!bypassRateLimit) {
        defaultLoginLimiter.recordFailure(clientIp, userEmail);
      }
      res.status(400).json({ error: "Invalid 6-digit code. Please verify your authenticator app time and try again." });
      return;
    }

    if (!bypassRateLimit) {
      defaultLoginLimiter.recordSuccess(clientIp, userEmail);
    }

    try {
      const { plainCodes, hashedCodes } = generateBackupCodes(10);
      database.enableUser2FA(userId, resolvedSecret, hashedCodes);
      database.deletePendingTotpSecret(userId);
      pendingTotpSecrets.delete(userId);

      database.logAudit({
        actorId: userId,
        action: "auth_2fa_enabled",
        resourceType: "auth",
        resourceId: String(userId),
        ipAddress: clientIp,
        details: { backupCodesCount: 10 },
      });

      database.createNotification(userId, userId, "security_alert", null, {
        title: "Two-Factor Authentication Enabled",
        description: "TOTP two-factor authentication has been activated on your account.",
        skipEmail: true,
      });

      const userRecord = database.getUserById(userId);
      if (userRecord && userRecord.email_verified === 1) {
        void defaultMailer
          .sendSecurityAlertEmail(userRecord.email, {
            username: userRecord.username,
            eventTitle: "Two-Factor Authentication Enabled",
            description: "TOTP two-factor authentication has been activated on your account.",
            ipAddress: clientIp,
            instanceName: resolveBrandInstanceName(database),
          })
          .catch(() => {});
      }

      res.json({
        success: true,
        message: "Two-Factor Authentication enabled successfully.",
        backupCodes: plainCodes,
        backupCodesRemaining: 10,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to activate 2FA" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/disable
   *
   * Disables 2FA. Requires password verification (if account has password)
   * and current TOTP code or backup code confirmation.
   */
  router.post("/2fa/disable", requireAuth, express.json(), async (req: Request, res: Response): Promise<void> => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot modify two-factor authentication settings" });
      return;
    }
    const { password, code, revokeOtherSessions } = req.body || {};
    const clientIp = getClientIp(req);
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

    if (!bypassRateLimit) {
      const rateCheck = defaultLoginLimiter.check(clientIp, userEmail);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: "Too many failed 2FA attempts. Please try again in 15 minutes.",
          retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
        });
        return;
      }
    }

    try {
      const userRecord = database.getUserById(userId);
      if (userRecord?.account_type === "admin" && database.getInstanceSettings().requireAdmin2FA) {
        res.status(403).json({
          error:
            "Administrator accounts cannot disable two-factor authentication while the requireAdmin2FA instance policy is active.",
          code: "ADMIN_2FA_REQUIRED",
        });
        return;
      }

      const hash = database.getPasswordHash(userId);
      if (hash) {
        if (!password) {
          res.status(400).json({ error: "Password is required to disable two-factor authentication" });
          return;
        }
        const validPassword = await bcrypt.compare(password, hash);
        if (!validPassword) {
          if (!bypassRateLimit) {
            defaultLoginLimiter.recordFailure(clientIp, userEmail);
          }
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
      }

      const state2FA = database.getUser2FAState(userId);
      if (!state2FA || !state2FA.totp_enabled) {
        res.status(400).json({ error: "Two-factor authentication is not enabled" });
        return;
      }

      // Require a valid TOTP or backup recovery code to disable 2FA
      if (!code || typeof code !== "string" || !code.trim()) {
        res.status(400).json({ error: "Authentication code or backup recovery code is required" });
        return;
      }

      let codeValid = false;
      if (state2FA.totp_secret && /^\d{6}$/.test(code.trim().replace(/\s+/g, ""))) {
        codeValid = verifyTotpCode(state2FA.totp_secret, code.trim(), {
          preventReplay: process.env["NODE_ENV"] === "production",
        });
      }
      if (!codeValid && state2FA.backup_codes.length > 0) {
        const backupResult = verifyAndConsumeBackupCode(code.trim(), state2FA.backup_codes);
        codeValid = backupResult.valid;
      }
      if (!codeValid) {
        if (!bypassRateLimit) {
          defaultLoginLimiter.recordFailure(clientIp, userEmail);
        }
        res.status(400).json({ error: "Invalid authentication code or backup recovery code" });
        return;
      }

      if (!bypassRateLimit) {
        defaultLoginLimiter.recordSuccess(clientIp, userEmail);
      }

      database.disableUser2FA(userId);

      let refreshedToken: string | undefined;
      if (revokeOtherSessions && userRecord) {
        const newVersion = database.incrementTokenVersion(userId);
        refreshedToken = jwt.sign(
          { id: userRecord.id, username: userRecord.username, email: userRecord.email, tokenVersion: newVersion },
          JWT_SECRET,
          { expiresIn: "7d" },
        );
        setSessionCookie(res, refreshedToken);
      }

      database.logAudit({
        actorId: userId,
        action: "auth_2fa_disabled",
        resourceType: "auth",
        resourceId: String(userId),
        ipAddress: clientIp,
      });

      database.createNotification(userId, userId, "security_alert", null, {
        title: "Two-Factor Authentication Disabled",
        description: "Two-factor authentication was disabled on your account.",
        skipEmail: true,
      });

      if (userRecord && userRecord.email_verified === 1) {
        void defaultMailer
          .sendSecurityAlertEmail(userRecord.email, {
            username: userRecord.username,
            eventTitle: "Two-Factor Authentication Disabled",
            description: "Two-factor authentication was disabled on your account.",
            ipAddress: clientIp,
            instanceName: resolveBrandInstanceName(database),
          })
          .catch(() => {});
      }

      res.json({
        success: true,
        message: "Two-factor authentication has been disabled.",
        ...(refreshedToken ? { token: refreshedToken } : {}),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to disable 2FA" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/backup-codes/regenerate
   *
   * Generates a fresh set of 10 backup recovery codes, invalidating all previous codes.
   * Requires password (if account has local password) and a current 6-digit TOTP code.
   */
  router.post(
    "/2fa/backup-codes/regenerate",
    requireAuth,
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      if (isScopedApiToken(req)) {
        res.status(403).json({ error: "Personal access tokens cannot modify two-factor authentication settings" });
        return;
      }
      const { password, code } = req.body || {};
      const clientIp = getClientIp(req);
      const userId = req.user!.id;
      const userEmail = req.user!.email;
      const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

      if (!bypassRateLimit) {
        const rateCheck = defaultLoginLimiter.check(clientIp, userEmail);
        if (!rateCheck.allowed) {
          res.status(429).json({
            error: "Too many failed 2FA attempts. Please try again in 15 minutes.",
            retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
          });
          return;
        }
      }

      try {
        const hash = database.getPasswordHash(userId);
        if (hash) {
          if (!password || typeof password !== "string") {
            res.status(400).json({ error: "Password is required to regenerate backup recovery codes" });
            return;
          }
          const validPassword = await bcrypt.compare(password, hash);
          if (!validPassword) {
            if (!bypassRateLimit) {
              defaultLoginLimiter.recordFailure(clientIp, userEmail);
            }
            res.status(401).json({ error: "Incorrect password" });
            return;
          }
        }

        const state2FA = database.getUser2FAState(userId);
        if (!state2FA || !state2FA.totp_enabled || !state2FA.totp_secret) {
          res.status(400).json({ error: "Two-factor authentication is not enabled" });
          return;
        }

        if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim().replace(/\s+/g, ""))) {
          res.status(400).json({ error: "A valid 6-digit authenticator code is required" });
          return;
        }

        const validTotp = verifyTotpCode(state2FA.totp_secret, code.trim(), {
          preventReplay: process.env["NODE_ENV"] === "production",
        });
        if (!validTotp) {
          if (!bypassRateLimit) {
            defaultLoginLimiter.recordFailure(clientIp, userEmail);
          }
          res.status(400).json({ error: "Invalid 6-digit authenticator code" });
          return;
        }

        if (!bypassRateLimit) {
          defaultLoginLimiter.recordSuccess(clientIp, userEmail);
        }

        const { plainCodes, hashedCodes } = generateBackupCodes(10);
        database.setUserBackupCodes(userId, hashedCodes);

        database.logAudit({
          actorId: userId,
          action: "auth_2fa_backup_codes_regenerated",
          resourceType: "auth",
          resourceId: String(userId),
          ipAddress: clientIp,
          details: { backupCodesCount: 10 },
        });

        database.createNotification(userId, userId, "security_alert", null, {
          title: "2FA Backup Codes Regenerated",
          description: "A new set of 10 emergency recovery codes was generated; previous codes were invalidated.",
          skipEmail: true,
        });

        const userRecord = database.getUserById(userId);
        if (userRecord && userRecord.email_verified === 1) {
          void defaultMailer
            .sendSecurityAlertEmail(userRecord.email, {
              username: userRecord.username,
              eventTitle: "2FA Backup Codes Regenerated",
              description:
                "A new set of 10 emergency recovery codes was generated for your account; all previous recovery codes were invalidated.",
              ipAddress: clientIp,
              instanceName: resolveBrandInstanceName(database),
            })
            .catch(() => {});
        }

        res.json({
          success: true,
          message: "Emergency backup recovery codes have been regenerated.",
          backupCodes: plainCodes,
          backupCodesRemaining: 10,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to regenerate backup codes" });
      }
    },
  );

  return router;
}
