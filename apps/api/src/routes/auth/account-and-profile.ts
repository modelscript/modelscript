// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import { Router as createRouter, type Request, type Response, type Router } from "express";

import type { LibraryDatabase } from "../../database.js";
import { requireAuth } from "../../middleware/auth-middleware.js";
import { defaultLoginLimiter } from "../../middleware/login-limiter.js";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { isDisposableEmail } from "../../util/email-filter.js";
import { signEmailVerificationToken } from "../../util/email-verification.js";
import { isEmailDomainAllowed, resolveBrandInstanceName } from "../../util/registration-policy.js";
import { verifyTotpCode } from "../../util/totp.js";
import { isHubModelscriptUrl, isScopedApiToken, stripTrailingSlashes } from "./auth-helpers.js";

function isSafeProfileUrl(u: unknown): boolean {
  if (u === undefined || u === null || u === "") return true;
  if (typeof u !== "string" || u.length > 2048) return false;
  const trimmed = u.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createAccountAndProfileRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/auth/me
   */
  router.get("/me", requireAuth, (req: Request, res: Response): void => {
    try {
      const user = database.getUserById(req.user!.id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const {
        password_hash,
        github_token: _gh,
        gitlab_token: _gl,
        totp_secret: _,
        backup_codes: __,
        ...safeUser
      } = user;
      const totpEnabled = Boolean(user.totp_enabled);
      const backupCodesRemaining = totpEnabled ? database.getRemainingBackupCodeCount(user.id) : 0;
      const instanceSettings = database.getInstanceSettings();
      const requireAdmin2FASetup = Boolean(
        user.account_type === "admin" && !totpEnabled && instanceSettings.requireAdmin2FA,
      );
      const reqOrigin =
        process.env["PUBLIC_URL"] ||
        (typeof req.headers.origin === "string" && /^https?:\/\//i.test(req.headers.origin)
          ? req.headers.origin
          : `${
              typeof req.headers["x-forwarded-proto"] === "string"
                ? req.headers["x-forwarded-proto"].split(",")[0]!.trim()
                : req.protocol || "http"
            }://${
              typeof req.headers["x-forwarded-host"] === "string"
                ? req.headers["x-forwarded-host"].split(",")[0]!.trim()
                : req.get("host") || "localhost:3001"
            }`);
      const cleanBaseUrl = stripTrailingSlashes(reqOrigin);
      const dynamicActorUrl =
        !user.remote_domain && (!user.actor_url || isHubModelscriptUrl(user.actor_url))
          ? `${cleanBaseUrl}/users/${user.username}`
          : user.actor_url;

      res.json({
        user: {
          ...safeUser,
          actor_url: dynamicActorUrl ?? null,
          default_post_visibility: user.default_post_visibility || "public",
          banner_url: user.banner_url ?? null,
          credit_balance: user.credit_balance ?? 0,
          has_password: Boolean(password_hash),
          totp_enabled: totpEnabled,
          backup_codes_remaining: backupCodesRemaining,
          require_admin_2fa_setup: requireAdmin2FASetup,
        },
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  /**
   * PUT /api/v1/auth/account
   *
   * Supports profile updates for both local password accounts and OAuth/SSO accounts.
   * If the user has a local password set, current password confirmation is required.
   * If the user authenticated via OAuth/SSO with no password hash, profile updates proceed directly.
   */
  router.put("/account", requireAuth, async (req: Request, res: Response): Promise<void> => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot modify account settings" });
      return;
    }
    const { password, totpCode, username, email, display_name, avatar_url, banner_url } = req.body;
    const userId = req.user!.id;

    if (!isSafeProfileUrl(avatar_url) || !isSafeProfileUrl(banner_url)) {
      res.status(400).json({ error: "Profile URLs must use http://, https://, or a relative path" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      // Require password confirmation only if account has a password set (i.e. not OAuth-only)
      if (hash) {
        if (!password || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
          res.status(400).json({ error: "Password is required to confirm changes" });
          return;
        }
        if (!(await bcrypt.compare(password, hash))) {
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
      }

      const state2FA = database.getUser2FAState(userId);
      if (state2FA?.totp_enabled && state2FA.totp_secret) {
        const isChangingIdentity = Boolean(username || email);
        if (isChangingIdentity || (typeof totpCode === "string" && totpCode.trim())) {
          if (typeof totpCode !== "string" || !totpCode.trim()) {
            res.status(401).json({ error: "Two-factor authentication code is required" });
            return;
          }
          const clientIp = getClientIp(req);
          const userEmail = req.user!.email;
          const bypassRateLimit =
            process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";
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
          if (
            !verifyTotpCode(state2FA.totp_secret, totpCode.trim(), {
              preventReplay: process.env["NODE_ENV"] === "production",
            })
          ) {
            if (!bypassRateLimit) {
              defaultLoginLimiter.recordFailure(clientIp, userEmail);
            }
            res.status(401).json({ error: "Invalid two-factor authentication code" });
            return;
          }
          if (!bypassRateLimit) {
            defaultLoginLimiter.recordSuccess(clientIp, userEmail);
          }
        }
      }

      let emailChanged = false;
      let verificationRequired = false;
      if (username || email) {
        const currentUser = database.getUserById(userId);
        const currentUsername = currentUser?.username ?? req.user!.username;
        const currentEmail = currentUser?.email ?? req.user!.email;
        const u = username || currentUsername;
        const e = email ? String(email).toLowerCase().trim() : currentEmail;
        emailChanged = Boolean(email && e.toLowerCase() !== currentEmail.toLowerCase());

        // check uniqueness if changed
        if (u !== currentUsername) {
          const existU = database.getUserByUsername(u);
          if (existU && existU.id !== userId) {
            res.status(409).json({ error: "Username is taken" });
            return;
          }
        }
        if (emailChanged) {
          if (isDisposableEmail(e)) {
            res.status(403).json({
              error:
                "Disposable and temporary email addresses are not permitted. Please use a permanent email address.",
            });
            return;
          }
          const instanceSettings = database.getInstanceSettings();
          if (
            instanceSettings.registrationMode === "domain_allowlist" &&
            !isEmailDomainAllowed(e, instanceSettings.allowedEmailDomains)
          ) {
            res.status(403).json({
              error: `Email address must belong to an approved domain (${instanceSettings.allowedEmailDomains.join(", ") || "none"}).`,
            });
            return;
          }
          const existE = database.getUserByEmail(e);
          if (existE && existE.id !== userId) {
            res.status(409).json({ error: "Email is taken" });
            return;
          }
        }

        database.updateAccount(userId, u, e);

        if (emailChanged) {
          const instanceName = resolveBrandInstanceName(database);
          const autoVerifiedByAirgap =
            process.env["AIRGAP_ENFORCED"] === "true" && !defaultMailer.isConfiguredForLiveDelivery();
          verificationRequired = !autoVerifiedByAirgap;
          database.setUserEmailVerified(userId, autoVerifiedByAirgap);
          const verificationToken = signEmailVerificationToken(userId, e);
          void defaultMailer.sendVerificationEmail(e, u, verificationToken, { instanceName }).catch((err) => {
            console.error("[Auth] Failed to dispatch verification email on email change:", err);
          });

          database.createNotification(userId, userId, "security_alert", null, {
            title: "Account Email Address Changed",
            description: `Your primary email address was updated from ${currentEmail} to ${e}.`,
            skipEmail: true,
          });
          if (currentEmail && currentEmail.includes("@")) {
            void defaultMailer
              .sendSecurityAlertEmail(currentEmail, {
                username: u,
                eventTitle: "Account Email Address Changed",
                description: `The email address associated with your account (@${u}) was changed from ${currentEmail} to ${e}.`,
                ipAddress: getClientIp(req),
                instanceName,
              })
              .catch(() => {});
          }
        }
      }

      database.updateProfile(userId, {
        display_name,
        avatar_url,
        banner_url,
      });

      res.json({ success: true, emailChanged, verificationRequired });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
    }
  });

  /**
   * GET /api/v1/auth/notifications
   */
  router.get("/notifications", requireAuth, (req: Request, res: Response): void => {
    try {
      const settingsStr = database.getNotificationSettings(req.user!.id);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      res.json(settings);
    } catch {
      res.status(500).json({ error: "Failed to fetch notification settings" });
    }
  });

  /**
   * PUT /api/v1/auth/notifications
   */
  router.put("/notifications", requireAuth, (req: Request, res: Response): void => {
    try {
      const settingsStr = JSON.stringify(req.body);
      database.updateNotificationSettings(req.user!.id, settingsStr);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update notification settings" });
    }
  });

  return router;
}
