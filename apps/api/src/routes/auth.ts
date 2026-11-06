// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, isAccountBlocked, optionalAuth, requireAuth } from "../middleware/auth-middleware.js";

import { defaultLoginLimiter } from "../middleware/login-limiter.js";
import { defaultRegistrationLimiter } from "../middleware/registration-limiter.js";
import { defaultMailer } from "../services/mailer.js";
import { defaultOidcService } from "../services/oidc.js";
import { verifyCaptchaToken } from "../util/captcha.js";
import { getClientIp } from "../util/client-ip.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { isDisposableEmail } from "../util/email-filter.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../util/email-verification.js";
import {
  parsePasswordResetTokenPayload,
  signPasswordResetToken,
  verifyPasswordResetToken,
} from "../util/password-reset.js";
import {
  evaluateRegistrationPolicy,
  isEmailDomainAllowed,
  resolveBrandInstanceName,
} from "../util/registration-policy.js";
import { assertSafePublicUrl, safePublicFetch } from "../util/ssrf.js";
import { isFederationDisabled } from "../util/tier-presets.js";
import {
  generateBackupCodes,
  generateTotpSecret,
  generateTotpUri,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "../util/totp.js";

const DUMMY_BCRYPT_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const isProd = process.env["NODE_ENV"] === "production";

function setSessionCookie(res: Response, token: string): void {
  res.cookie("modelscript_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie("modelscript_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
  });
}

function stripTrailingSlashes(str: string): string {
  let end = str.length;
  while (end > 0 && str.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return str.slice(0, end);
}

function isHubModelscriptUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === "hub.modelscript.org";
  } catch {
    return false;
  }
}

export function authRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/auth/config
   *
   * Public capability discovery for login & signup UI across all deployment modes.
   */
  router.get("/config", (_req: Request, res: Response): void => {
    try {
      const settings = database.getInstanceSettings();
      const airgapEnforced = process.env["AIRGAP_ENFORCED"] === "true";
      const turnstileEnabled = !airgapEnforced && Boolean(process.env["TURNSTILE_SECRET_KEY"]);
      const mailerConfigured = defaultMailer.isConfiguredForLiveDelivery();
      const oauthProviders: ("github" | "gitlab" | "fediverse")[] = [];
      if (!airgapEnforced) {
        const githubCreds = database.getOAuthCredentials("github");
        const gitlabCreds = database.getOAuthCredentials("gitlab");
        if (githubCreds.clientId) {
          oauthProviders.push("github");
        }
        if (gitlabCreds.clientId) {
          oauthProviders.push("gitlab");
        }
        if (!isFederationDisabled(settings)) {
          oauthProviders.push("fediverse");
        }
      }
      res.json({
        instanceName: settings.instanceName,
        registrationMode: settings.registrationMode,
        allowedEmailDomains: settings.allowedEmailDomains,
        requireAdmin2FA: settings.requireAdmin2FA,
        airgapEnforced,
        turnstileEnabled,
        mailerConfigured,
        oauthProviders,
        oidcEnabled: defaultOidcService.isConfigured(),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load auth config" });
    }
  });

  /**
   * POST /api/v1/auth/register
   *
   * Hardened registration with anti-Sybil defense:
   * - Terms of Service & Acceptable Use Policy agreement audit trail
   * - Bot mitigation via Cloudflare Turnstile captcha
   * - Disposable / temporary email blocking
   * - IP velocity rate limiting
   * - Proof-of-personhood: free tier compute credits withheld until email verification
   */
  router.post(
    "/register",
    enforceExportCompliance(() => database),
    async (req: Request, res: Response): Promise<void> => {
      const { username, email, password, acceptTerms, captchaToken } = req.body;

      // 1. Audit trail: Terms of Service agreement
      if (acceptTerms !== true) {
        res.status(400).json({
          error: "You must accept the Terms of Service and Acceptable Use Policy to register",
        });
        return;
      }

      // 2. IP Velocity Limiting
      const clientIp = getClientIp(req);
      const rateCheck = defaultRegistrationLimiter.check(clientIp);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
        });
        return;
      }

      const cleanUsername = typeof username === "string" ? username.trim() : "";
      const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

      if (!cleanUsername || !cleanEmail || !password) {
        res.status(400).json({ error: "Username, email, and password are required" });
        return;
      }

      if (cleanUsername.length < 3) {
        res.status(400).json({ error: "Username must be at least 3 characters" });
        return;
      }

      if (typeof password !== "string" || password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      if (Buffer.byteLength(password, "utf8") > 72) {
        res.status(400).json({ error: "Password must not exceed 72 bytes" });
        return;
      }

      const emailRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!emailRegex.test(cleanEmail)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      // 3. Anti-Sybil: Reject disposable / temporary burner emails & canonical email blocks
      if (isDisposableEmail(cleanEmail)) {
        res.status(403).json({
          error: "Disposable and temporary email addresses are not permitted. Please use a permanent email address.",
        });
        return;
      }

      const ipBlock = database.checkIpBlock(clientIp);
      if (ipBlock && (ipBlock.severity === "no_access" || ipBlock.severity === "no_sign_up")) {
        res.status(403).json({
          error: ipBlock.comment || "Registration from your network address is restricted by instance policy.",
        });
        return;
      }

      const emailBlock = database.isCanonicalEmailBlocked(cleanEmail);
      if (emailBlock.blocked) {
        res.status(403).json({
          error: emailBlock.reason || "This email address is blocked from registration on this instance.",
        });
        return;
      }

      // 4. Bot mitigation: Cloudflare Turnstile / Captcha validation
      const captcha = await verifyCaptchaToken(captchaToken, clientIp);
      if (!captcha.success) {
        res.status(400).json({ error: captcha.error || "Captcha verification failed" });
        return;
      }

      try {
        const inviteCode = typeof req.body?.inviteCode === "string" ? req.body.inviteCode.trim() : "";

        const existing = database.getUserByEmail(cleanEmail);
        if (existing) {
          res.status(409).json({ error: "An account with this email already exists" });
          return;
        }

        const existingUsername = database.getUserByUsername(cleanUsername);
        if (existingUsername) {
          res.status(409).json({ error: "This username is already taken" });
          return;
        }

        const policy = evaluateRegistrationPolicy(database, { email: cleanEmail, inviteCode });
        if (!policy.allowed) {
          res.status(policy.status ?? 403).json({
            error: policy.error || "Registration is restricted on this instance.",
          });
          return;
        }
        const redeemedInvite = policy.redeemedInvite;
        const preVerified = Boolean(redeemedInvite || policy.autoVerifiedByAirgap);
        const initialCredits = redeemedInvite
          ? redeemedInvite.initialCredits
          : policy.autoVerifiedByAirgap
            ? 50.0
            : 0.0;

        const passwordHash = await bcrypt.hash(password, 10);

        // Create user with compute credits withheld until verification (unless invited or airgap-auto-verified)
        let user = database.createUser(cleanUsername, cleanEmail, passwordHash, {
          emailVerified: preVerified,
          initialCredits,
          status: preVerified ? "active" : "pending_verification",
          termsAcceptedAt: new Date().toISOString(),
          registrationIp: clientIp,
        });

        // Record referral lineage if this user registered via a member's golden ticket / invite
        if (redeemedInvite && typeof redeemedInvite.createdBy === "number") {
          database.recordUserReferral(redeemedInvite.createdBy, user.id, redeemedInvite.id);
        }

        if (
          redeemedInvite &&
          redeemedInvite.assignedRole &&
          redeemedInvite.assignedRole !== "user" &&
          (redeemedInvite.assignedRole === "moderator" ||
            redeemedInvite.assignedRole === "auditor" ||
            redeemedInvite.assignedRole === "admin")
        ) {
          database.moderateUserAccount(user.id, {
            role: redeemedInvite.assignedRole,
          });
          user = database.getUserById(user.id) ?? user;
        }

        // Record successful registration for IP velocity limit
        defaultRegistrationLimiter.record(clientIp);

        const token = jwt.sign(
          { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
          JWT_SECRET,
          {
            expiresIn: "7d",
          },
        );

        setSessionCookie(res, token);

        database.logAudit({
          actorId: user.id,
          action: "auth_account_created",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: clientIp,
          details: {
            username: user.username,
            email: user.email,
            ...(redeemedInvite
              ? {
                  inviteCode: redeemedInvite.code,
                  assignedRole: redeemedInvite.assignedRole,
                  ...(redeemedInvite.createdBy ? { referrerId: redeemedInvite.createdBy } : {}),
                }
              : {}),
            ...(policy.fastTracked ? { fastTracked: true, academicFastTrack: true } : {}),
            ...(policy.autoVerifiedByAirgap ? { autoVerifiedByAirgap: true } : {}),
          },
        });

        const verificationToken = signEmailVerificationToken(user.id, user.email);
        const instanceName = resolveBrandInstanceName(database);

        // Asynchronously dispatch verification email
        void defaultMailer
          .sendVerificationEmail(user.email, user.username, verificationToken, { instanceName })
          .catch((err) => {
            console.error("[Auth] Failed to dispatch verification email:", err);
          });

        const {
          password_hash: _,
          github_token: _gh,
          gitlab_token: _gl,
          ...safeUser
        } = user as typeof user & {
          password_hash?: unknown;
          github_token?: unknown;
          gitlab_token?: unknown;
        };

        // In production mode, never expose verificationToken in the JSON response payload
        const isProduction = process.env["NODE_ENV"] === "production";
        const tokenPayload = isProduction ? undefined : verificationToken;

        res.status(201).json({
          token,
          user: safeUser,
          ...(tokenPayload ? { verificationToken: tokenPayload } : {}),
          verificationRequired: !preVerified,
          message: preVerified
            ? "Account created and verified."
            : "Account created successfully. Please verify your email address.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Registration failed";
        res.status(500).json({ error: message });
      }
    },
  );

  /**
   * POST /api/v1/auth/resend-verification
   *
   * Resends email verification link to unverified accounts.
   */
  router.post("/resend-verification", express.json(), async (req: Request, res: Response) => {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email address is required" });
      return;
    }

    try {
      const user = database.getUserByEmail(email.toLowerCase().trim());
      // Return 200 even if user not found to prevent user enumeration
      if (!user) {
        res.status(200).json({
          message: "If an account exists with this email address, a verification link has been sent.",
        });
        return;
      }

      if (user.email_verified === 1) {
        res.status(400).json({ error: "Email address is already verified" });
        return;
      }

      const verificationToken = signEmailVerificationToken(user.id, user.email);
      const instanceName = resolveBrandInstanceName(database);
      await defaultMailer.sendVerificationEmail(user.email, user.username, verificationToken, { instanceName });

      const isProduction = process.env["NODE_ENV"] === "production";
      const tokenPayload = isProduction ? undefined : verificationToken;

      res.status(200).json({
        message: "If an account exists with this email address, a verification link has been sent.",
        ...(tokenPayload ? { verificationToken: tokenPayload } : {}),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resend verification email" });
    }
  });

  /**
   * GET/POST /api/v1/auth/verify-email
   *
   * Verifies email address using signed HMAC token.
   */
  const handleVerifyEmail = async (req: Request, res: Response): Promise<void> => {
    const token = ((req.body?.token || req.query["token"]) as string) || "";

    if (!token) {
      res.status(400).json({ error: "Email verification token is required" });
      return;
    }

    const verification = verifyEmailVerificationToken(token);
    if (!verification.valid || !verification.userId) {
      res.status(400).json({ error: verification.error || "Invalid or expired email verification token" });
      return;
    }

    const currentUser = database.getUserById(verification.userId);
    if (currentUser && verification.email && currentUser.email.toLowerCase() !== verification.email.toLowerCase()) {
      res.status(400).json({ error: "Email verification token does not match current account email" });
      return;
    }

    const result = database.verifyUserEmail(verification.userId, 50.0);
    if (!result.success || !result.user) {
      res.status(404).json({ error: "User account not found or email verification failed" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Email address verified successfully.",
      creditsGranted: result.creditsGranted,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        email_verified: result.user.email_verified,
        status: result.user.status,
        credit_balance: result.user.credit_balance,
      },
    });
  };

  router.get("/verify-email", handleVerifyEmail);
  router.post("/verify-email", handleVerifyEmail);

  /**
   * POST /api/v1/auth/login
   *
   * Hardened authentication:
   * - Brute-force rate limiting (5 attempts / 15-minute window)
   * - Timing-attack mitigation via constant-time dummy hash compare for non-existent users
   * - Safe handling for OAuth accounts where password_hash is NULL
   * - Immediate suspension check
   * - Token versioning for instant session revocation
   */
  router.post("/login", async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
      res.status(400).json({ error: "Password must not exceed 72 bytes" });
      return;
    }

    const clientIp = getClientIp(req);
    const loginIpBlock = database.checkIpBlock(clientIp);
    if (loginIpBlock && loginIpBlock.severity === "no_access") {
      res.status(403).json({
        error: loginIpBlock.comment || "Access from your network address is blocked by instance policy.",
      });
      return;
    }
    const cleanEmail = typeof email === "string" ? email.toLowerCase().trim() : "";
    const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

    if (!bypassRateLimit) {
      const rateCheck = defaultLoginLimiter.check(clientIp, cleanEmail);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: "Too many failed login attempts. Please try again in 15 minutes.",
          retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
        });
        return;
      }
    }

    try {
      const user = database.getUserByEmail(cleanEmail);

      // Non-existent user timing attack mitigation
      if (!user) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        defaultLoginLimiter.recordFailure(clientIp, cleanEmail);
        database.logAudit({
          actorId: null,
          action: "auth_login_failure",
          resourceType: "auth",
          ipAddress: clientIp,
          details: { email: cleanEmail, reason: "user_not_found" },
        });
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      // OAuth / SSO account with no password set
      if (!user.password_hash) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        defaultLoginLimiter.recordFailure(clientIp, cleanEmail);
        database.logAudit({
          actorId: user.id,
          action: "auth_login_failure",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: clientIp,
          details: { email: cleanEmail, reason: "oauth_only_account" },
        });
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        defaultLoginLimiter.recordFailure(clientIp, cleanEmail);
        database.logAudit({
          actorId: user.id,
          action: "auth_login_failure",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: clientIp,
          details: { email: cleanEmail, reason: "invalid_password" },
        });
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      if (isAccountBlocked(user.status)) {
        database.logAudit({
          actorId: user.id,
          action: "auth_login_failure",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: clientIp,
          details: { email: cleanEmail, reason: `account_${user.status}` },
        });
        res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
        return;
      }

      // Check if user has Two-Factor Authentication enabled
      if (user.totp_enabled === 1) {
        const tempToken = jwt.sign(
          {
            id: user.id,
            username: user.username,
            email: user.email,
            scope: "2fa_challenge",
            tokenVersion: user.token_version ?? 1,
          },
          JWT_SECRET,
          {
            expiresIn: "5m",
          },
        );

        res.json({
          requires2FA: true,
          tempToken,
          message: "Please enter your 6-digit authenticator code or backup recovery code to complete sign in.",
        });
        return;
      }

      defaultLoginLimiter.recordSuccess(clientIp, cleanEmail);

      const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
        JWT_SECRET,
        {
          expiresIn: "7d",
        },
      );

      setSessionCookie(res, token);

      database.logAudit({
        actorId: user.id,
        action: "auth_login_success",
        resourceType: "auth",
        resourceId: String(user.id),
        ipAddress: clientIp,
        details: { method: "password" },
      });

      const {
        password_hash,
        github_token: _gh,
        gitlab_token: _gl,
        totp_secret: _,
        backup_codes: __,
        ...safeUser
      } = user;

      res.json({
        token,
        user: {
          ...safeUser,
          banner_url: user.banner_url ?? null,
          credit_balance: user.credit_balance ?? 0,
          has_password: Boolean(password_hash),
          totp_enabled: Boolean(user.totp_enabled),
          email_verified: user.email_verified ?? 1,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(500).json({ error: message });
    }
  });

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

  const pendingTotpSecrets = new Map<number, string>();

  const isScopedApiToken = (req: Request): boolean =>
    Boolean(req.tokenScopes && !req.tokenScopes.includes("*") && !req.tokenScopes.includes("admin"));

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

  /**
   * POST /api/v1/auth/logout
   *
   * Clears the HttpOnly session cookie and logs audit event.
   */
  router.post("/logout", optionalAuth, (req: Request, res: Response): void => {
    clearSessionCookie(res);
    const clientIp = getClientIp(req);
    if (req.user?.id) {
      try {
        database.incrementTokenVersion(req.user.id);
      } catch {}
    }
    database.logAudit({
      actorId: req.user?.id ?? null,
      action: "auth_logout",
      resourceType: "auth",
      ipAddress: clientIp,
    });
    res.json({ success: true, message: "Signed out successfully" });
  });

  /**
   * POST /api/v1/auth/forgot-password
   *
   * Initiates self-service password reset.
   * Returns generic 200 message to prevent user enumeration.
   */
  router.post("/forgot-password", express.json(), async (req: Request, res: Response): Promise<void> => {
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
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to process password reset request" });
    }
  });

  /**
   * POST /api/v1/auth/reset-password
   *
   * Validates signed reset token and updates the user's password.
   * Automatically increments token_version to invalidate existing sessions.
   */
  router.post("/reset-password", express.json(), async (req: Request, res: Response): Promise<void> => {
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
  });

  const resolvePublicBaseUrl = (req: Request): string => {
    const envPublicUrl = (process.env["PUBLIC_URL"] || "").trim().replace(/\/$/, "");
    const forwardedHost = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : "";
    const reqHost = (forwardedHost.split(",")[0]?.trim() || req.get("host") || "").trim();
    const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "";
    const reqProto = (forwardedProto.split(",")[0]?.trim() || req.protocol || "http").trim();
    if (envPublicUrl && envPublicUrl !== "http://localhost:3000") {
      return envPublicUrl;
    }
    if (reqHost && !reqHost.startsWith("localhost") && !reqHost.startsWith("127.0.0.1")) {
      return `${reqProto}://${reqHost}`;
    }
    return envPublicUrl || (reqHost ? `${reqProto}://${reqHost}` : "http://localhost:3000");
  };

  const buildOAuthAuthorizeUrl = (
    req: Request,
    provider: string,
    clientId: string,
    signedState: string,
    gitlabBaseUrl = "https://gitlab.com",
  ): string | null => {
    const publicBase = resolvePublicBaseUrl(req);
    const redirectUri = `${publicBase.replace(/\/$/, "")}/api/v1/auth/callback/${provider}`;
    if (provider === "github") {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state: signedState,
      });
      return `https://github.com/login/oauth/authorize?${params.toString()}`;
    }
    if (provider === "gitlab") {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "read_user",
        state: signedState,
      });
      return `${gitlabBaseUrl.replace(/\/$/, "")}/oauth/authorize?${params.toString()}`;
    }
    return null;
  };

  /**
   * GET /api/v1/auth/login/:provider
   */
  router.get("/login/:provider", (req: Request, res: Response) => {
    const provider =
      typeof req.params["provider"] === "string" ? req.params["provider"] : String(req.params["provider"] ?? "");
    const frontendUrl = resolvePublicBaseUrl(req);

    if (provider === "fediverse") {
      const settings = database.getInstanceSettings();
      const acceptHeader = typeof req.headers["accept"] === "string" ? req.headers["accept"] : "";
      const wantsJson =
        (acceptHeader.includes("application/json") && !acceptHeader.includes("text/html")) ||
        req.query["format"] === "json";

      if (isFederationDisabled(settings) || process.env["AIRGAP_ENFORCED"] === "true") {
        if (wantsJson) {
          res.status(403).json({ error: "Federation is disabled on this instance.", code: "FEDERATION_DISABLED" });
          return;
        }
        res.redirect(`${frontendUrl}/login?error=FederationDisabled`);
        return;
      }
      const rawTarget = String(req.query["handle"] || req.query["domain"] || "").trim();
      if (!rawTarget) {
        if (wantsJson) {
          res
            .status(400)
            .json({ error: "Missing Fediverse handle or domain parameter.", code: "MISSING_FEDIVERSE_HANDLE" });
          return;
        }
        res.redirect(`${frontendUrl}/login?error=MissingFediverseHandle`);
        return;
      }
      let targetDomain = rawTarget;
      if (targetDomain.startsWith("acct:")) targetDomain = targetDomain.slice(5);
      if (targetDomain.startsWith("@")) targetDomain = targetDomain.slice(1);
      if (targetDomain.includes("@")) {
        const parts = targetDomain.split("@");
        targetDomain = parts[1] || "";
      }
      targetDomain = targetDomain
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (!targetDomain || targetDomain.length > 255) {
        if (wantsJson) {
          res.status(400).json({ error: "Invalid Fediverse domain.", code: "INVALID_FEDIVERSE_DOMAIN" });
          return;
        }
        res.redirect(`${frontendUrl}/login?error=InvalidFediverseDomain`);
        return;
      }
      try {
        assertSafePublicUrl(`https://${targetDomain}`);
      } catch {
        if (wantsJson) {
          res
            .status(400)
            .json({ error: "Disallowed Fediverse domain (SSRF protection).", code: "SSRF_DISALLOWED_DOMAIN" });
          return;
        }
        res.redirect(`${frontendUrl}/login?error=DisallowedFediverseDomain`);
        return;
      }
      const FEDIVERSE_DOMAIN_REGEX =
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
      if (!FEDIVERSE_DOMAIN_REGEX.test(targetDomain)) {
        if (wantsJson) {
          res.status(400).json({ error: "Invalid Fediverse domain.", code: "INVALID_FEDIVERSE_DOMAIN" });
          return;
        }
        res.redirect(`${frontendUrl}/login?error=InvalidFediverseDomain`);
        return;
      }

      void (async () => {
        try {
          let client = database.getFederatedOAuthClient(targetDomain);
          const publicBase = resolvePublicBaseUrl(req);
          const redirectUri = `${publicBase.replace(/\/$/, "")}/api/v1/auth/callback/fediverse`;
          if (!client) {
            const appRes = await safePublicFetch(`https://${targetDomain}/api/v1/apps`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                client_name: settings.instanceName || "Ansatz",
                redirect_uris: redirectUri,
                scopes: "read:accounts",
                website: publicBase,
              }),
            });
            if (!appRes.ok) {
              res.redirect(
                `${frontendUrl}/login?error=FediverseRegistrationFailed&domain=${encodeURIComponent(targetDomain)}`,
              );
              return;
            }
            const appData = (await appRes.json()) as { client_id?: string; client_secret?: string };
            if (!appData.client_id || !appData.client_secret) {
              res.redirect(
                `${frontendUrl}/login?error=FediverseRegistrationFailed&domain=${encodeURIComponent(targetDomain)}`,
              );
              return;
            }
            database.saveFederatedOAuthClient(targetDomain, appData.client_id, appData.client_secret);
            client = {
              domain: targetDomain,
              client_id: appData.client_id,
              client_secret: appData.client_secret,
              registered_at: new Date().toISOString(),
            };
          }

          const signedState = jwt.sign(
            { action: "login", provider: "fediverse", domain: targetDomain, targetHandle: rawTarget },
            JWT_SECRET,
            { expiresIn: "10m" },
          );
          res.cookie("oauth_state", signedState, {
            httpOnly: true,
            secure: process.env["NODE_ENV"] === "production",
            sameSite: "lax",
            maxAge: 10 * 60 * 1000,
            path: "/",
          });

          const authorizeParams = new URLSearchParams({
            client_id: client.client_id,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "read:accounts",
            state: signedState,
          });
          const redirectHost = client.domain;
          if (!redirectHost || !FEDIVERSE_DOMAIN_REGEX.test(redirectHost)) {
            throw new Error("Invalid Fediverse authorization target domain");
          }
          const authorizeUrl = new URL(`https://${redirectHost}/oauth/authorize`);
          authorizeUrl.search = authorizeParams.toString();
          if (wantsJson) {
            res.json({
              redirectUrl: authorizeUrl.href,
              state: signedState,
            });
            return;
          }
          res.redirect(authorizeUrl.href);
        } catch (err) {
          console.error("[FediverseAuth] Dynamic client registration error:", err);
          res.redirect(
            `${frontendUrl}/login?error=FediverseRegistrationFailed&domain=${encodeURIComponent(targetDomain)}`,
          );
        }
      })();
      return;
    }

    const oauthCreds = database.getOAuthCredentials(provider);
    const clientId = oauthCreds.clientId;
    if (!clientId) {
      if (process.env["NODE_ENV"] === "production") {
        res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
        return;
      }
      res.redirect(`${frontendUrl}/login?error=OAuthNotConfigured&provider=${encodeURIComponent(provider)}`);
      return;
    }
    const signedState = jwt.sign({ action: "login", provider }, JWT_SECRET, { expiresIn: "10m" });
    res.cookie("oauth_state", signedState, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
    const authorizeUrl = buildOAuthAuthorizeUrl(req, provider, clientId, signedState, oauthCreds.baseUrl);
    if (authorizeUrl) {
      res.redirect(authorizeUrl);
      return;
    }
    if (process.env["NODE_ENV"] === "production") {
      res.status(501).json({ error: `Unsupported OAuth provider '${provider}'.` });
      return;
    }
    res.redirect(`${frontendUrl}/login?error=OAuthNotConfigured&provider=${encodeURIComponent(provider)}`);
  });

  /**
   * GET /api/v1/auth/link/:provider
   * Initiated from the browser via an href link. Accepts token via query param or session cookie to verify user.
   */
  router.get("/link/:provider", (req: Request, res: Response) => {
    const provider =
      typeof req.params["provider"] === "string" ? req.params["provider"] : String(req.params["provider"] ?? "");
    const cookieHeader = req.headers.cookie || "";
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)modelscript_token=([^;]+)/);
    let cookieToken = "";
    if (cookieMatch?.[1]) {
      try {
        cookieToken = decodeURIComponent(cookieMatch[1]);
      } catch {
        cookieToken = cookieMatch[1];
      }
    }
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const token = (req.query["token"] as string) || cookieToken || bearerToken;
    const frontendUrl = resolvePublicBaseUrl(req);

    if (!token) {
      res.redirect(`${frontendUrl}/settings?error=MissingToken`);
      return;
    }

    const oauthCreds = database.getOAuthCredentials(provider);
    const clientId = oauthCreds.clientId;
    if (!clientId) {
      if (process.env["NODE_ENV"] === "production") {
        res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
        return;
      }
      res.redirect(`${frontendUrl}/settings?error=OAuthNotConfigured&provider=${encodeURIComponent(provider)}`);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: number;
        scope?: string | undefined;
        purpose?: string | undefined;
        tokenVersion?: number | undefined;
      };
      if (decoded.scope === "2fa_challenge" || decoded.purpose === "2fa_challenge") {
        res.redirect(`${frontendUrl}/settings?error=InvalidToken`);
        return;
      }
      const user = database.getUserById(decoded.id);
      if (!user || isAccountBlocked(user.status) || (decoded.tokenVersion ?? 1) !== (user.token_version ?? 1)) {
        res.redirect(`${frontendUrl}/settings?error=InvalidToken`);
        return;
      }
      const signedState = jwt.sign({ action: "link", userId: decoded.id, provider }, JWT_SECRET, { expiresIn: "10m" });
      res.cookie("oauth_state", signedState, {
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
        path: "/",
      });
      const authorizeUrl = buildOAuthAuthorizeUrl(req, provider, clientId, signedState, oauthCreds.baseUrl);
      if (authorizeUrl) {
        res.redirect(authorizeUrl);
        return;
      }
      if (process.env["NODE_ENV"] === "production") {
        res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
        return;
      }
      res.redirect(`${frontendUrl}/settings?error=OAuthNotConfigured&provider=${encodeURIComponent(provider)}`);
    } catch {
      res.redirect(`${frontendUrl}/settings?error=InvalidToken`);
    }
  });

  /**
   * POST /api/v1/auth/link/:provider
   * Authenticated endpoint to securely initiate OAuth account linking.
   * Expects Authorization: Bearer <token> or modelscript_token cookie.
   * Returns { redirectUrl: string } without leaking tokens into query parameters or referrer headers.
   */
  router.post("/link/:provider", (req: Request, res: Response) => {
    const provider =
      typeof req.params["provider"] === "string" ? req.params["provider"] : String(req.params["provider"] ?? "");
    const cookieHeader = req.headers.cookie || "";
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)modelscript_token=([^;]+)/);
    let cookieToken = "";
    if (cookieMatch?.[1]) {
      try {
        cookieToken = decodeURIComponent(cookieMatch[1]);
      } catch {
        cookieToken = cookieMatch[1];
      }
    }
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const token = bearerToken || cookieToken || (req.body && req.body.token);

    if (!token) {
      res.status(401).json({ error: "Authentication required to link account" });
      return;
    }

    const oauthCreds = database.getOAuthCredentials(provider);
    const clientId = oauthCreds.clientId;
    if (!clientId) {
      res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id: number;
        scope?: string | undefined;
        purpose?: string | undefined;
        tokenVersion?: number | undefined;
      };
      if (decoded.scope === "2fa_challenge" || decoded.purpose === "2fa_challenge") {
        res.status(401).json({ error: "Two-factor authentication required" });
        return;
      }
      const user = database.getUserById(decoded.id);
      if (!user || isAccountBlocked(user.status) || (decoded.tokenVersion ?? 1) !== (user.token_version ?? 1)) {
        res.status(403).json({ error: "Account is inactive or token is invalid" });
        return;
      }
      const signedState = jwt.sign({ action: "link", userId: decoded.id, provider }, JWT_SECRET, { expiresIn: "10m" });
      res.cookie("oauth_state", signedState, {
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
        path: "/",
      });
      const authorizeUrl = buildOAuthAuthorizeUrl(req, provider, clientId, signedState, oauthCreds.baseUrl);
      if (authorizeUrl) {
        res.json({ redirectUrl: authorizeUrl });
        return;
      }
      res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
    } catch {
      res.status(401).json({ error: "Invalid or expired authentication token" });
    }
  });

  /**
   * GET /api/v1/auth/callback/:provider
   */
  router.get("/callback/:provider", async (req: Request, res: Response) => {
    const provider = req.params["provider"] as string;
    const stateParam = req.query["state"] as string;
    const code = req.query["code"] as string | undefined;
    const frontendUrl = resolvePublicBaseUrl(req);
    const isProductionEnv = process.env["NODE_ENV"] === "production";

    let email = "";
    let username = "";
    let providerUserId = "";
    let accessToken = "";
    let refreshToken: string | null = null;
    let remoteDisplayName = "";
    let remoteAvatar = "";
    let remoteBio = "";
    let actorUrl = "";
    let remoteDomain = "";
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    // Validate OAuth state cookie and JWT signature first before making upstream requests
    const cookieHeader = req.headers.cookie || "";
    const oauthCookieMatch = cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/);
    const cookieState =
      req.cookies?.["oauth_state"] || (oauthCookieMatch?.[1] ? decodeURIComponent(oauthCookieMatch[1]) : undefined);
    res.clearCookie("oauth_state", { path: "/" });
    if (cookieState && stateParam && decodeURIComponent(stateParam) !== cookieState && stateParam !== cookieState) {
      res.redirect(`${frontendUrl}/settings?error=InvalidState`);
      return;
    }
    if (
      isProductionEnv &&
      (!cookieState || !stateParam || (decodeURIComponent(stateParam) !== cookieState && stateParam !== cookieState))
    ) {
      res.redirect(`${frontendUrl}/login?error=InvalidState`);
      return;
    }

    let stateData: {
      action?: string | undefined;
      userId?: number | undefined;
      provider?: string | undefined;
      domain?: string | undefined;
      targetHandle?: string | undefined;
    } | null = null;
    if (stateParam) {
      try {
        stateData = jwt.verify(decodeURIComponent(stateParam), JWT_SECRET) as {
          action?: string | undefined;
          userId?: number | undefined;
          provider?: string | undefined;
          domain?: string | undefined;
          targetHandle?: string | undefined;
        };
        if (stateData.provider && stateData.provider !== provider) {
          res.redirect(`${frontendUrl}/settings?error=InvalidState`);
          return;
        }
      } catch {
        res.redirect(`${frontendUrl}/settings?error=InvalidState`);
        return;
      }
    }

    const oauthCreds = database.getOAuthCredentials(provider);
    const clientId = oauthCreds.clientId;
    const clientSecret = oauthCreds.clientSecret;

    if (provider !== "fediverse" && (!clientId || !clientSecret)) {
      if (isProductionEnv) {
        res.status(501).json({ error: `OAuth provider '${provider}' is not configured in production.` });
        return;
      }
      res.redirect(`${frontendUrl}/login?error=OAuthNotConfigured&provider=${encodeURIComponent(provider)}`);
      return;
    }

    if (!code) {
      res.redirect(`${frontendUrl}/login?error=MissingOAuthCode`);
      return;
    }

    try {
      let verifiedLiveProfile = false;

      if (provider === "fediverse") {
        const targetDomain = stateData?.domain?.toLowerCase().trim();
        if (!targetDomain) {
          res.redirect(`${frontendUrl}/login?error=InvalidState`);
          return;
        }
        try {
          assertSafePublicUrl(`https://${targetDomain}`);
        } catch {
          res.redirect(`${frontendUrl}/login?error=DisallowedFediverseDomain`);
          return;
        }
        const client = database.getFederatedOAuthClient(targetDomain);
        if (!client) {
          res.redirect(`${frontendUrl}/login?error=OAuthNotConfigured&provider=fediverse`);
          return;
        }
        const publicBase = resolvePublicBaseUrl(req);
        const redirectUri = `${publicBase.replace(/\/$/, "")}/api/v1/auth/callback/fediverse`;
        const tokenRes = await safePublicFetch(`https://${targetDomain}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: client.client_id,
            client_secret: client.client_secret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        if (!tokenRes.ok) {
          res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
          return;
        }
        const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
        if (!tokenData.access_token) {
          res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
          return;
        }
        accessToken = tokenData.access_token;
        if (tokenData.refresh_token) refreshToken = tokenData.refresh_token;

        const verifyRes = await safePublicFetch(`https://${targetDomain}/api/v1/accounts/verify_credentials`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!verifyRes.ok) {
          res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
          return;
        }
        const accountData = (await verifyRes.json()) as {
          id?: string | number;
          username?: string;
          acct?: string;
          display_name?: string;
          avatar?: string;
          note?: string;
          url?: string;
        };
        if (!accountData.id || !accountData.username) {
          res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
          return;
        }
        providerUserId = `${targetDomain}:${accountData.id}`;
        const cleanUser = String(accountData.username)
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, "");
        username = cleanUser;
        email = `${cleanUser}@${targetDomain}`;
        remoteDomain = targetDomain;
        remoteBio = accountData.note || "";
        let resolvedActorUrl = `https://${targetDomain}/users/${cleanUser}`;
        if (typeof accountData.url === "string" && accountData.url.trim()) {
          try {
            const parsed = new URL(accountData.url.trim());
            if (parsed.hostname.toLowerCase() === targetDomain.toLowerCase()) {
              resolvedActorUrl = parsed.href;
            }
          } catch {}
        }
        actorUrl = resolvedActorUrl;
        verifiedLiveProfile = true;
      } else if (provider === "github") {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string | undefined;
          refresh_token?: string | undefined;
        };
        if (tokenData.access_token) {
          accessToken = tokenData.access_token;
          if (tokenData.refresh_token) refreshToken = tokenData.refresh_token;
          const userRes = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ModelScript" },
          });
          const userData = (await userRes.json()) as {
            id?: number | undefined;
            login?: string | undefined;
            email?: string | null | undefined;
          };
          if (userData.id && userData.login) {
            providerUserId = String(userData.id);
            username = userData.login;
            let resolvedGithubEmail = userData.email || "";
            if (!resolvedGithubEmail) {
              try {
                const emailsRes = await fetch("https://api.github.com/user/emails", {
                  headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ModelScript" },
                });
                if (emailsRes.ok) {
                  const emailsList = (await emailsRes.json()) as Array<{
                    email?: string;
                    primary?: boolean;
                    verified?: boolean;
                  }>;
                  if (Array.isArray(emailsList)) {
                    const primaryVerified = emailsList.find((e) => e.primary && e.verified && e.email);
                    const anyVerified = emailsList.find((e) => e.verified && e.email);
                    resolvedGithubEmail = primaryVerified?.email || anyVerified?.email || "";
                  }
                }
              } catch {
                // Fallback to noreply email below
              }
            }
            email = resolvedGithubEmail || `${userData.login}@users.noreply.github.com`;
            verifiedLiveProfile = true;
          }
        }
      } else if (provider === "gitlab") {
        const publicBase = resolvePublicBaseUrl(req);
        const gitlabBase = (oauthCreds.baseUrl || "https://gitlab.com").replace(/\/$/, "");
        const tokenRes = await fetch(`${gitlabBase}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: `${publicBase.replace(/\/$/, "")}/api/v1/auth/callback/gitlab`,
          }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string | undefined;
          refresh_token?: string | undefined;
        };
        if (tokenData.access_token) {
          accessToken = tokenData.access_token;
          if (tokenData.refresh_token) refreshToken = tokenData.refresh_token;
          const userRes = await fetch(`${gitlabBase}/api/v4/user`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const userData = (await userRes.json()) as {
            id?: number | undefined;
            username?: string | undefined;
            email?: string | undefined;
          };
          if (userData.id && userData.username) {
            providerUserId = String(userData.id);
            username = userData.username;
            email = userData.email || `${userData.username}@gitlab.com`;
            verifiedLiveProfile = true;
          }
        }
      }
      if (!verifiedLiveProfile) {
        res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
        return;
      }
    } catch (oauthErr) {
      console.error(`[OAuth] Live provider exchange failed:`, oauthErr);
      res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
      return;
    }

    if (!email || !username || !providerUserId || !accessToken) {
      res.redirect(`${frontendUrl}/login?error=OAuthExchangeFailed`);
      return;
    }

    try {
      if (stateData?.action === "link" && stateData.userId) {
        // Handle Account Linking
        const userId = stateData.userId;
        const user = database.getUserById(userId);
        if (!user) {
          res.redirect(`${frontendUrl}/settings?error=UserNotFound`);
          return;
        }
        if (isAccountBlocked(user.status)) {
          res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
          return;
        }

        const existingLink = database.getOAuthAccountByUserId(userId, provider);
        if (existingLink) {
          database.updateOAuthTokens(userId, provider, accessToken, refreshToken, expiresAt);
        } else {
          database.linkOAuthAccount(userId, provider, providerUserId, accessToken, refreshToken, expiresAt);
        }

        res.redirect(`${frontendUrl}/settings?success=Linked${provider}`);
        return;
      }

      // Handle Normal Login/Signup
      const oauthAcc = database.getOAuthAccount(provider, providerUserId);
      const userId = oauthAcc?.user_id;
      let user;

      if (userId) {
        user = database.getUserById(userId);
        if (user && isAccountBlocked(user.status)) {
          res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
          return;
        }
        database.updateOAuthTokens(userId, provider, accessToken, refreshToken, expiresAt);
      } else {
        // Pre-Account Takeover Defense:
        // Do not auto-link unauthenticated logins to existing accounts by remote actorUrl or email.
        // If an account already exists with that email or actorUrl, require logging in with existing credentials first.
        const existingByActor = provider === "fediverse" && actorUrl ? database.getUserByActorUrl(actorUrl) : undefined;
        const existing = existingByActor || database.getUserByEmail(email);
        if (existing) {
          if (isAccountBlocked(existing.status)) {
            res.status(403).json({ error: `Account is ${existing.status}. Please contact support.` });
            return;
          }
          if (existing.password_hash) {
            res.redirect(`${frontendUrl}/login?error=AccountExistsWithPassword&email=${encodeURIComponent(email)}`);
            return;
          }
          res.redirect(`${frontendUrl}/login?error=AccountAlreadyExists&email=${encodeURIComponent(email)}`);
          return;
        } else {
          const inviteParam = typeof req.query["invite"] === "string" ? req.query["invite"].trim() : undefined;
          const policy = evaluateRegistrationPolicy(database, { email, inviteCode: inviteParam, provider });
          if (!policy.allowed) {
            const errCode = policy.errorCode || "RegistrationRestricted";
            res.redirect(
              `${frontendUrl}/login?error=${encodeURIComponent(errCode)}&message=${encodeURIComponent(policy.error || "Registration is restricted on this instance.")}`,
            );
            return;
          }
          let finalUsername = username;
          if (database.getUserByUsername(finalUsername)) {
            if (provider === "fediverse" && remoteDomain) {
              finalUsername = `${username}_${remoteDomain.replace(/[^a-z0-9]/g, "_")}`;
              if (database.getUserByUsername(finalUsername)) {
                finalUsername = `${finalUsername}_${crypto.randomInt(1000, 10000)}`;
              }
            } else {
              finalUsername = `${username}_${crypto.randomInt(1000, 10000)}`;
            }
          }
          user = database.registerFederatedUser(finalUsername, email, provider, providerUserId, {
            accountType: provider === "fediverse" ? "community_federated" : "user",
            displayName: remoteDisplayName || username,
            avatarUrl: remoteAvatar || undefined,
            bio: remoteBio || undefined,
            remoteDomain: remoteDomain || undefined,
            actorUrl: actorUrl || undefined,
          });
          database.updateOAuthTokens(user.id, provider, accessToken, refreshToken, expiresAt);
        }
      }

      if (!user) {
        res.redirect(`${frontendUrl}/login?error=OAuthFailed`);
        return;
      }

      const fullUser = database.getUserById(user.id) || user;
      const userStatus = "status" in fullUser && typeof fullUser.status === "string" ? fullUser.status : undefined;
      if (isAccountBlocked(userStatus)) {
        res.status(403).json({ error: `Account is ${userStatus}. Please contact support.` });
        return;
      }

      if ("totp_enabled" in fullUser && fullUser.totp_enabled === 1) {
        const tempToken = jwt.sign(
          {
            id: fullUser.id,
            username: fullUser.username,
            email: fullUser.email,
            scope: "2fa_challenge",
            purpose: "2fa_challenge",
            tokenVersion: ("token_version" in fullUser ? fullUser.token_version : undefined) ?? 1,
          },
          JWT_SECRET,
          {
            expiresIn: "5m",
          },
        );
        res.redirect(`${frontendUrl}/oauth/callback?requires2FA=true&tempToken=${encodeURIComponent(tempToken)}`);
        return;
      }

      const token = jwt.sign(
        {
          id: fullUser.id,
          username: fullUser.username,
          email: fullUser.email,
          tokenVersion: ("token_version" in fullUser ? fullUser.token_version : undefined) ?? 1,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        },
      );

      setSessionCookie(res, token);

      database.logAudit({
        actorId: fullUser.id,
        action: "auth_login_success",
        resourceType: "auth",
        resourceId: String(fullUser.id),
        ipAddress: getClientIp(req),
        details: { method: "oauth", provider },
      });

      // Redirect back to the frontend SPA
      res.redirect(`${frontendUrl}/oauth/callback?token=${token}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`${frontendUrl}/login?error=OAuthFailed`);
    }
  });

  // ── Enterprise OpenID Connect (OIDC / SSO) ──
  router.get("/oidc/config", (_req: Request, res: Response) => {
    const isProductionEnv = process.env["NODE_ENV"] === "production";
    res.json({
      enabled: defaultOidcService.isConfigured(),
      issuer: process.env["OIDC_ISSUER_URL"] || null,
      ...(isProductionEnv ? {} : { adminGroup: process.env["OIDC_ADMIN_GROUP"] || "Engineering-Admins" }),
    });
  });

  router.get("/oidc/login", (_req: Request, res: Response) => {
    if (!defaultOidcService.isConfigured()) {
      res.status(501).json({ error: "Enterprise OIDC is not configured on this node" });
      return;
    }
    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    res.cookie("oidc_state", state, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
    res.cookie("oidc_nonce", nonce, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/",
    });
    const authUrl = defaultOidcService.getAuthorizationUrl(state, nonce);
    res.redirect(authUrl);
  });

  router.get("/oidc/callback", async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    const cookieHeader = req.headers.cookie || "";
    const oidcCookieMatch = cookieHeader.match(/(?:^|;\s*)oidc_state=([^;]+)/);
    const cookieState =
      req.cookies?.["oidc_state"] || (oidcCookieMatch?.[1] ? decodeURIComponent(oidcCookieMatch[1]) : undefined);
    res.clearCookie("oidc_state", { path: "/" });

    const oidcNonceCookieMatch = cookieHeader.match(/(?:^|;\s*)oidc_nonce=([^;]+)/);
    const cookieNonce =
      req.cookies?.["oidc_nonce"] ||
      (oidcNonceCookieMatch?.[1] ? decodeURIComponent(oidcNonceCookieMatch[1]) : undefined);
    res.clearCookie("oidc_nonce", { path: "/" });

    if (cookieState && state !== cookieState) {
      res.status(400).json({ error: "Invalid OIDC state parameter" });
      return;
    }
    if (process.env["NODE_ENV"] === "production" && (!state || !cookieState || state !== cookieState)) {
      res.status(400).json({ error: "OIDC state parameter is required and must match session state" });
      return;
    }

    try {
      const tokenData = await defaultOidcService.exchangeCode(code);
      let claims;
      if (defaultOidcService.isConfigured() || process.env["NODE_ENV"] === "production") {
        claims = await defaultOidcService.verifyIdToken(tokenData.idToken);
      } else {
        try {
          claims = await defaultOidcService.verifyIdToken(tokenData.idToken);
        } catch {
          claims = defaultOidcService.extractClaims(tokenData.idToken);
        }
      }
      if (
        cookieNonce &&
        claims &&
        (claims as { nonce?: string }).nonce &&
        (claims as { nonce?: string }).nonce !== cookieNonce
      ) {
        res.status(400).json({ error: "Invalid OIDC nonce in idToken" });
        return;
      }
      const result = await defaultOidcService.handleOidcLogin(database, claims, tokenData);

      const frontendUrl = process.env["PUBLIC_URL"] || "http://localhost:3000";
      if (result.requires2FA) {
        res.redirect(`${frontendUrl}/oauth/callback?requires2FA=true&tempToken=${encodeURIComponent(result.token)}`);
        return;
      }
      setSessionCookie(res, result.token);
      res.redirect(`${frontendUrl}/oauth/callback?token=${result.token}`);
    } catch (err: unknown) {
      const status = (err as { status?: number | undefined })?.status;
      if (status === 403) {
        res.status(403).json({ error: err instanceof Error ? err.message : "Account is blocked" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "OIDC authentication failed" });
    }
  });

  router.post("/oidc/token", express.json(), async (req: Request, res: Response) => {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== "string") {
      res.status(400).json({ error: "idToken is required" });
      return;
    }
    if (process.env["NODE_ENV"] === "production" && !defaultOidcService.isConfigured()) {
      res.status(501).json({ error: "Enterprise OIDC is not configured on this node" });
      return;
    }

    try {
      const claims = await defaultOidcService.verifyIdToken(idToken);
      const result = await defaultOidcService.handleOidcLogin(database, claims);
      res.json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number | undefined })?.status;
      if (status === 403) {
        res.status(403).json({ error: err instanceof Error ? err.message : "Account is blocked" });
        return;
      }
      res.status(401).json({ error: err instanceof Error ? err.message : "Invalid OIDC token payload" });
    }
  });

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

    const isSafeProfileUrl = (u: unknown): boolean => {
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
    };

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

      if (typeof totpCode === "string" && totpCode.trim()) {
        const state2FA = database.getUser2FAState(userId);
        if (state2FA?.totp_enabled && state2FA.totp_secret) {
          if (!verifyTotpCode(state2FA.totp_secret, totpCode.trim())) {
            res.status(401).json({ error: "Invalid two-factor authentication code" });
            return;
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
   * PUT /api/v1/auth/password
   *
   * Changes or initial-sets account password.
   * Increments token_version to invalidate all existing sessions and returns a refreshed token.
   */
  router.put("/password", requireAuth, async (req: Request, res: Response): Promise<void> => {
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

  /**
   * POST /api/v1/auth/revoke-sessions
   *
   * Increments the user's token_version to invalidate all existing sessions.
   * Returns a fresh JWT for the current client.
   */
  router.post("/revoke-sessions", requireAuth, (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Personal access tokens cannot revoke interactive user sessions" });
      return;
    }
    try {
      const newVersion = database.incrementTokenVersion(req.user!.id);
      const user = database.getUserById(req.user!.id);
      const newToken = jwt.sign(
        { id: user!.id, username: user!.username, email: user!.email, tokenVersion: newVersion },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      setSessionCookie(res, newToken);

      database.logAudit({
        actorId: req.user!.id,
        action: "auth_session_revoked",
        resourceType: "auth",
        resourceId: String(req.user!.id),
        ipAddress: getClientIp(req),
        details: { newVersion },
      });

      res.json({
        success: true,
        message: "All other sessions have been revoked.",
        token: newToken,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to revoke sessions" });
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
   * GET /api/v1/auth/connected-accounts
   */
  router.get("/connected-accounts", requireAuth, (req: Request, res: Response): void => {
    try {
      const userId = req.user!.id;
      const linked = database.getPublicOAuthAccounts(userId);
      const linkedMap = new Map(linked.map((acc) => [acc.provider.toLowerCase(), acc.provider_user_id]));

      const providers = [
        {
          provider: "oidc",
          name: "Enterprise Single Sign-On (OIDC)",
          connected: linkedMap.has("oidc"),
          identifier: linkedMap.get("oidc") || undefined,
        },
        {
          provider: "github",
          name: "GitHub",
          connected: linkedMap.has("github"),
          identifier: linkedMap.get("github") || undefined,
        },
        {
          provider: "gitlab",
          name: "GitLab",
          connected: linkedMap.has("gitlab"),
          identifier: linkedMap.get("gitlab") || undefined,
        },
        {
          provider: "twitter",
          name: "X (Twitter)",
          connected: linkedMap.has("twitter"),
          identifier: linkedMap.get("twitter") || undefined,
        },
      ];

      res.json({ providers });
    } catch {
      res.status(500).json({ error: "Failed to fetch connected accounts" });
    }
  });

  /**
   * DELETE /api/v1/auth/connected-accounts/:provider
   */
  router.delete("/connected-accounts/:provider", requireAuth, (req: Request, res: Response): void => {
    if (isScopedApiToken(req)) {
      res.status(403).json({ error: "Restricted personal access tokens cannot unlink connected accounts" });
      return;
    }
    const rawProvider = req.params["provider"];
    const provider = (Array.isArray(rawProvider) ? rawProvider[0] : rawProvider)?.toLowerCase();
    if (!provider) {
      res.status(400).json({ error: "Provider parameter is required" });
      return;
    }

    try {
      database.unlinkOAuthAccount(req.user!.id, provider);
      database.logAudit({
        actorId: req.user!.id,
        action: "auth_oauth_unlinked",
        resourceType: "auth",
        resourceId: String(req.user!.id),
        ipAddress: getClientIp(req),
        details: { provider },
      });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to unlink account" });
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
    const { name, scopes, packagePattern, expiresInDays } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Token name is required" });
      return;
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json({ error: "At least one scope is required in the 'scopes' array" });
      return;
    }

    const validScopes = new Set([
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
    const userRecord = database.getUserById(req.user!.id);
    const isAdminUser =
      userRecord?.account_type === "admin" ||
      req.user!.account_type === "admin" ||
      req.user!.accountType === "admin" ||
      req.user!.role === "admin";
    for (const scope of scopes) {
      if (typeof scope !== "string" || !validScopes.has(scope)) {
        res
          .status(400)
          .json({ error: `Invalid scope: '${scope}'. Valid scopes: ${Array.from(validScopes).join(", ")}` });
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
        details: { name: name.trim(), scopes, packagePattern, expiresAt },
      });

      database.createNotification(req.user!.id, req.user!.id, "security_alert", null, {
        title: "New Personal Access Token Created",
        description: `A new API token '${name.trim()}' (${tokenPrefix}...) was created with scopes: ${scopes.join(", ")}.`,
        skipEmail: true,
      });

      res.status(201).json({
        token: plaintextToken,
        id: tokenId,
        name: name.trim(),
        prefix: tokenPrefix,
        scopes,
        packagePattern: packagePattern || "*",
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
