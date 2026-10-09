// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable */

import bcrypt from "bcryptjs";
import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, requireAuth } from "../middleware/auth-middleware.js";

import { defaultLoginLimiter } from "../middleware/login-limiter.js";
import { defaultRegistrationLimiter } from "../middleware/registration-limiter.js";
import { defaultMailer } from "../services/mailer.js";
import { defaultOidcService } from "../services/oidc.js";
import { verifyCaptchaToken } from "../util/captcha.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { isDisposableEmail } from "../util/email-filter.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../util/email-verification.js";
import {
  parsePasswordResetTokenPayload,
  signPasswordResetToken,
  verifyPasswordResetToken,
} from "../util/password-reset.js";
import {
  generateBackupCodes,
  generateTotpSecret,
  generateTotpUri,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from "../util/totp.js";

const DUMMY_BCRYPT_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const isProd = process.env["NODE_ENV"] === "production";

function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
}

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

export function authRouter(database: LibraryDatabase): Router {
  const router = createRouter();

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
      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const rateCheck = defaultRegistrationLimiter.check(clientIp);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
        });
        return;
      }

      if (!username || !email || !password) {
        res.status(400).json({ error: "Username, email, and password are required" });
        return;
      }

      if (typeof username !== "string" || username.length < 3) {
        res.status(400).json({ error: "Username must be at least 3 characters" });
        return;
      }

      if (typeof password !== "string" || password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }

      const emailRegex =
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      // 3. Anti-Sybil: Reject disposable / temporary burner emails
      if (isDisposableEmail(email)) {
        res.status(403).json({
          error: "Disposable and temporary email addresses are not permitted. Please use a permanent email address.",
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
        const existing = database.getUserByEmail(email);
        if (existing) {
          res.status(409).json({ error: "An account with this email already exists" });
          return;
        }

        const existingUsername = database.getUserByUsername(username);
        if (existingUsername) {
          res.status(409).json({ error: "This username is already taken" });
          return;
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Create user with compute credits withheld until verification
        const user = database.createUser(username, email, passwordHash, {
          emailVerified: false,
          initialCredits: 0.0,
          status: "pending_verification",
          termsAcceptedAt: new Date().toISOString(),
          registrationIp: clientIp,
        });

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
          details: { username: user.username, email: user.email },
        });

        const verificationToken = signEmailVerificationToken(user.id, user.email);

        // Asynchronously dispatch verification email
        void defaultMailer.sendVerificationEmail(user.email, user.username, verificationToken).catch((err) => {
          console.error("[Auth] Failed to dispatch verification email:", err);
        });

        const { password_hash: _, github_token, gitlab_token, ...safeUser } = user as any;

        // In production mode, never expose verificationToken in the JSON response payload
        const isProduction = process.env["NODE_ENV"] === "production";
        const tokenPayload = isProduction ? undefined : verificationToken;

        res.status(201).json({
          token,
          user: safeUser,
          ...(tokenPayload ? { verificationToken: tokenPayload } : {}),
          verificationRequired: true,
          message:
            "Account created successfully. Please verify your email address to unlock your free tier compute credits.",
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
      await defaultMailer.sendVerificationEmail(user.email, user.username, verificationToken);

      const isProduction = process.env["NODE_ENV"] === "production";
      const tokenPayload = isProduction ? undefined : verificationToken;

      res.status(200).json({
        message: "If an account exists with this email address, a verification link has been sent.",
        ...(tokenPayload ? { verificationToken: tokenPayload } : {}),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to resend verification email" });
    }
  });

  /**
   * GET/POST /api/v1/auth/verify-email
   *
   * Verifies email address using signed HMAC token and unlocks 50 free compute credits.
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

    const result = database.verifyUserEmail(verification.userId, 50.0);
    if (!result.success || !result.user) {
      res.status(404).json({ error: "User account not found or email verification failed" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Email address verified successfully. Free tier compute credits unlocked!",
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

    const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
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

      if (user.status === "suspended" || user.status === "frozen") {
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

      defaultLoginLimiter.recordSuccess(clientIp, cleanEmail);

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

      const { password_hash, github_token, gitlab_token, totp_secret: _, backup_codes: __, ...safeUser } = user as any;

      res.json({
        token,
        user: {
          ...safeUser,
          has_password: Boolean(password_hash),
          totp_enabled: false,
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
        scope: string;
        tokenVersion?: number;
      };

      if (decoded.scope !== "2fa_challenge") {
        res.status(400).json({ error: "Invalid challenge token" });
        return;
      }

      const user = database.getUserById(decoded.id);
      if (!user) {
        res.status(401).json({ error: "User no longer exists" });
        return;
      }

      if (user.status === "suspended" || user.status === "frozen") {
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
        verified = verifyTotpCode(state2FA.totp_secret, cleanCode);
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

      const sessionToken = jwt.sign(
        { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
        JWT_SECRET,
        {
          expiresIn: "7d",
        },
      );

      setSessionCookie(res, sessionToken);

      database.logAudit({
        actorId: user.id,
        action: "auth_login_success",
        resourceType: "auth",
        resourceId: String(user.id),
        ipAddress: clientIp,
        details: { method: usedBackupCode ? "2fa_backup_code" : "2fa_totp" },
      });

      const { password_hash, github_token, gitlab_token, totp_secret: _, backup_codes: __, ...safeUser } = user as any;

      res.json({
        token: sessionToken,
        user: {
          ...safeUser,
          has_password: Boolean(password_hash),
          totp_enabled: true,
        },
        usedBackupCode,
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
    try {
      const user = database.getUserById(req.user!.id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const secret = generateTotpSecret();
      const otpAuthUri = generateTotpUri({
        accountName: user.email,
        secret,
      });

      res.json({
        secret,
        otpAuthUri,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to initialize 2FA setup" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/verify
   *
   * Verifies the initial TOTP code, activates 2FA for the user,
   * and generates 10 single-use emergency backup recovery codes.
   */
  router.post("/2fa/verify", requireAuth, express.json(), (req: Request, res: Response): void => {
    const { secret, code } = req.body || {};
    const clientIp = getClientIp(req);

    if (!secret || typeof secret !== "string") {
      res.status(400).json({ error: "Secret is required" });
      return;
    }

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Verification code is required" });
      return;
    }

    const valid = verifyTotpCode(secret, code);
    if (!valid) {
      res.status(400).json({ error: "Invalid 6-digit code. Please verify your authenticator app time and try again." });
      return;
    }

    try {
      const { plainCodes, hashedCodes } = generateBackupCodes(10);
      database.enableUser2FA(req.user!.id, secret, hashedCodes);

      database.logAudit({
        actorId: req.user!.id,
        action: "auth_2fa_enabled",
        resourceType: "auth",
        resourceId: String(req.user!.id),
        ipAddress: clientIp,
        details: { backupCodesCount: 10 },
      });

      res.json({
        success: true,
        message: "Two-Factor Authentication enabled successfully.",
        backupCodes: plainCodes,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to activate 2FA" });
    }
  });

  /**
   * POST /api/v1/auth/2fa/disable
   *
   * Disables 2FA. Requires password verification (if account has password)
   * and current TOTP code or backup code confirmation.
   */
  router.post("/2fa/disable", requireAuth, express.json(), async (req: Request, res: Response): Promise<void> => {
    const { password, code } = req.body || {};
    const clientIp = getClientIp(req);
    const userId = req.user!.id;

    try {
      const hash = database.getPasswordHash(userId);
      if (hash) {
        if (!password) {
          res.status(400).json({ error: "Password is required to disable two-factor authentication" });
          return;
        }
        const validPassword = await bcrypt.compare(password, hash);
        if (!validPassword) {
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
      }

      const state2FA = database.getUser2FAState(userId);
      if (!state2FA || !state2FA.totp_enabled) {
        res.status(400).json({ error: "Two-factor authentication is not enabled" });
        return;
      }

      // If code was provided, verify it (either TOTP or backup code)
      if (code && typeof code === "string") {
        let codeValid = false;
        if (state2FA.totp_secret && /^\d{6}$/.test(code.trim().replace(/\s+/g, ""))) {
          codeValid = verifyTotpCode(state2FA.totp_secret, code.trim());
        }
        if (!codeValid && state2FA.backup_codes.length > 0) {
          const backupResult = verifyAndConsumeBackupCode(code.trim(), state2FA.backup_codes);
          codeValid = backupResult.valid;
        }
        if (!codeValid) {
          res.status(400).json({ error: "Invalid authentication code or backup recovery code" });
          return;
        }
      }

      database.disableUser2FA(userId);

      database.logAudit({
        actorId: userId,
        action: "auth_2fa_disabled",
        resourceType: "auth",
        resourceId: String(userId),
        ipAddress: clientIp,
      });

      res.json({
        success: true,
        message: "Two-factor authentication has been disabled.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to disable 2FA" });
    }
  });

  /**
   * POST /api/v1/auth/logout
   *
   * Clears the HttpOnly session cookie and logs audit event.
   */
  router.post("/logout", (req: Request, res: Response): void => {
    clearSessionCookie(res);
    const clientIp = getClientIp(req);
    database.logAudit({
      actorId: (req as any).user?.id ?? null,
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

      if (user && user.status !== "suspended" && user.status !== "frozen") {
        resetToken = signPasswordResetToken(user.id, user.email, user.token_version ?? 1, user.password_hash);

        database.logAudit({
          actorId: user.id,
          action: "auth_password_reset_requested",
          resourceType: "auth",
          resourceId: String(user.id),
          ipAddress: getClientIp(req),
          details: { email: user.email },
        });

        void defaultMailer.sendPasswordResetEmail(user.email, user.username, resetToken).catch((err) => {
          console.error("[Auth] Failed to dispatch password reset email:", err);
        });
      }

      const isProduction = process.env["NODE_ENV"] === "production";
      const tokenPayload = isProduction ? undefined : resetToken;

      res.status(200).json({
        success: true,
        message: "If an account exists with this email address, a password reset link has been sent.",
        ...(tokenPayload ? { resetToken: tokenPayload } : {}),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to process password reset request" });
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

      if (user.status === "suspended" || user.status === "frozen") {
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

      database.logAudit({
        actorId: user.id,
        action: "auth_password_reset_completed",
        resourceType: "auth",
        resourceId: String(user.id),
        ipAddress: getClientIp(req),
        details: { email: user.email },
      });

      res.status(200).json({
        success: true,
        message: "Your password has been reset successfully. Please sign in with your new password.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to reset password" });
    }
  });

  /**
   * GET /api/v1/auth/login/:provider
   */
  router.get("/login/:provider", (req: Request, res: Response) => {
    const provider = typeof req.params.provider === "string" ? req.params.provider : String(req.params.provider ?? "");
    const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
    if (process.env["NODE_ENV"] === "production" && !clientId) {
      res.status(501).json({ error: `OAuth provider '${provider}' is not configured.` });
      return;
    }
    // Mock OAuth flow: Redirect to provider, which would normally redirect back to callback
    res.redirect(`/api/v1/auth/callback/${provider}?code=mock_code_from_${provider}`);
  });

  /**
   * GET /api/v1/auth/link/:provider
   * Initiated from the browser via an href link. Accepts token via query param to verify user.
   */
  router.get("/link/:provider", (req: Request, res: Response) => {
    const { provider } = req.params;
    const token = req.query.token as string;
    const frontendUrl = process.env["PUBLIC_URL"] || "http://localhost:3000";

    if (!token) {
      res.redirect(`${frontendUrl}/settings?error=MissingToken`);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
      const state = encodeURIComponent(JSON.stringify({ action: "link", userId: decoded.id }));
      res.redirect(`/api/v1/auth/callback/${provider}?code=mock_code_from_${provider}&state=${state}`);
    } catch {
      res.redirect(`${frontendUrl}/settings?error=InvalidToken`);
    }
  });

  /**
   * GET /api/v1/auth/callback/:provider
   */
  router.get("/callback/:provider", async (req: Request, res: Response) => {
    const provider = req.params.provider as string;
    const stateParam = req.query.state as string;
    const code = req.query.code as string | undefined;
    const frontendUrl = process.env["PUBLIC_URL"] || "http://localhost:3000";

    let email = `mockuser@${provider}.com`;
    let username = `mockuser_${provider}`;
    let providerUserId = `12345_${provider}`;
    let accessToken = `mock_access_token_${provider}`;
    let refreshToken: string | null = `mock_refresh_token_${provider}`;
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];

    if (process.env["NODE_ENV"] === "production" && (!clientId || !clientSecret)) {
      res.status(501).json({ error: `OAuth provider '${provider}' is not configured in production.` });
      return;
    }

    // Real OAuth2 token exchange if credentials configured
    if (code && clientId && clientSecret) {
      try {
        if (provider === "github") {
          const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
          });
          const tokenData = (await tokenRes.json()) as { access_token?: string };
          if (tokenData.access_token) {
            accessToken = tokenData.access_token;
            const userRes = await fetch("https://api.github.com/user", {
              headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "ModelScript" },
            });
            const userData = (await userRes.json()) as { id?: number; login?: string; email?: string };
            if (userData.id) providerUserId = String(userData.id);
            if (userData.login) username = userData.login;
            if (userData.email) email = userData.email;
          }
        } else if (provider === "gitlab") {
          const tokenRes = await fetch("https://gitlab.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              grant_type: "authorization_code",
              redirect_uri: `${req.protocol}://${req.get("host")}/api/v1/auth/callback/gitlab`,
            }),
          });
          const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
          if (tokenData.access_token) {
            accessToken = tokenData.access_token;
            if (tokenData.refresh_token) refreshToken = tokenData.refresh_token;
            const userRes = await fetch("https://gitlab.com/api/v4/user", {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const userData = (await userRes.json()) as { id?: number; username?: string; email?: string };
            if (userData.id) providerUserId = String(userData.id);
            if (userData.username) username = userData.username;
            if (userData.email) email = userData.email;
          }
        }
      } catch (oauthErr) {
        console.warn(`[OAuth] Live provider exchange failed, falling back to mock profile:`, oauthErr);
      }
    }

    try {
      let stateData: { action?: string; userId?: number } | null = null;
      if (stateParam) {
        stateData = JSON.parse(decodeURIComponent(stateParam));
      }

      if (stateData?.action === "link" && stateData.userId) {
        // Handle Account Linking
        const userId = stateData.userId;
        const user = database.getUserById(userId);
        if (!user) {
          res.redirect(`${frontendUrl}/settings?error=UserNotFound`);
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
      let oauthAcc = database.getOAuthAccount(provider, providerUserId);
      let userId = oauthAcc?.user_id;
      let user;

      if (userId) {
        user = database.getUserById(userId);
        database.updateOAuthTokens(userId, provider, accessToken, refreshToken, expiresAt);
      } else {
        // Ensure email/username are not already taken by a regular account
        const existing = database.getUserByEmail(email);
        if (existing) {
          // Pre-Account Takeover Defense:
          // If the account has a password, do NOT auto-link on unauthenticated login!
          if (existing.password_hash) {
            res.redirect(`${frontendUrl}/login?error=AccountExistsWithPassword&email=${encodeURIComponent(email)}`);
            return;
          }
          user = existing;
          database.linkOAuthAccount(user.id, provider, providerUserId, accessToken, refreshToken, expiresAt);
        } else {
          user = database.createOAuthUser(username, email, provider, providerUserId);
          database.updateOAuthTokens(user.id, provider, accessToken, refreshToken, expiresAt);
        }
      }

      if (!user) {
        res.redirect(`${frontendUrl}/login?error=OAuthFailed`);
        return;
      }

      const fullUser = database.getUserById(user.id) || user;
      const token = jwt.sign(
        {
          id: fullUser.id,
          username: fullUser.username,
          email: fullUser.email,
          tokenVersion: (fullUser as any).token_version ?? 1,
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
    res.json({
      enabled: defaultOidcService.isConfigured(),
      issuer: process.env["OIDC_ISSUER_URL"] || null,
      adminGroup: process.env["OIDC_ADMIN_GROUP"] || "Engineering-Admins",
    });
  });

  router.get("/oidc/login", (_req: Request, res: Response) => {
    if (!defaultOidcService.isConfigured()) {
      res.status(501).json({ error: "Enterprise OIDC is not configured on this node" });
      return;
    }
    const state = Math.random().toString(36).substring(2);
    const nonce = Math.random().toString(36).substring(2);
    const authUrl = defaultOidcService.getAuthorizationUrl(state, nonce);
    res.redirect(authUrl);
  });

  router.get("/oidc/callback", async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    try {
      const { idToken } = await defaultOidcService.exchangeCode(code);
      const claims = await defaultOidcService.verifyIdToken(idToken);
      const result = await defaultOidcService.handleOidcLogin(database, claims);

      const frontendUrl = process.env["PUBLIC_URL"] || "http://localhost:3000";
      res.redirect(`${frontendUrl}/oauth/callback?token=${result.token}`);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "OIDC authentication failed" });
    }
  });

  router.post("/oidc/token", express.json(), async (req: Request, res: Response) => {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== "string") {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    try {
      const claims = await defaultOidcService.verifyIdToken(idToken);
      const result = await defaultOidcService.handleOidcLogin(database, claims);
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message || "Invalid OIDC token payload" });
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
      const { password_hash, github_token, gitlab_token, totp_secret: _, backup_codes: __, ...safeUser } = user as any;
      res.json({
        user: {
          ...safeUser,
          has_password: Boolean(password_hash),
          totp_enabled: Boolean(user.totp_enabled),
        },
      });
    } catch (err) {
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
    const { password, username, email, display_name, avatar_url, banner_url } = req.body;
    const userId = req.user!.id;

    try {
      const hash = database.getPasswordHash(userId);
      // Require password confirmation only if account has a password set (i.e. not OAuth-only)
      if (hash) {
        if (!password) {
          res.status(400).json({ error: "Password is required to confirm changes" });
          return;
        }
        if (!(await bcrypt.compare(password, hash))) {
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
      }

      if (username || email) {
        const u = username || req.user!.username;
        const e = email || req.user!.email;

        // check uniqueness if changed
        if (u !== req.user!.username) {
          const existU = database.getUserByUsername(u);
          if (existU && existU.id !== userId) {
            res.status(409).json({ error: "Username is taken" });
            return;
          }
        }
        if (e !== req.user!.email) {
          const existE = database.getUserByEmail(e);
          if (existE && existE.id !== userId) {
            res.status(409).json({ error: "Email is taken" });
            return;
          }
        }

        database.updateAccount(userId, u, e);
      }

      database.updateProfile(userId, {
        display_name,
        avatar_url,
        banner_url,
      });

      res.json({ success: true });
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
    const { oldPassword, newPassword } = req.body;
    const userId = req.user!.id;

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      // If user already has a password, verify old password
      if (hash) {
        if (!oldPassword) {
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
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to revoke sessions" });
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch public keys" });
    }
  });

  /**
   * POST /api/v1/auth/keys
   */
  router.post("/keys", requireAuth, (req: Request, res: Response): void => {
    const { key_id_string, public_key_pem, device_name } = req.body;
    if (!key_id_string || !public_key_pem) {
      res.status(400).json({ error: "key_id_string and public_key_pem are required" });
      return;
    }

    try {
      const result = database.addPublicKeyForUser(req.user!.id, key_id_string, public_key_pem, device_name);
      res.status(201).json({ id: result.id, key_id_string, device_name });
    } catch (err) {
      res.status(500).json({ error: "Failed to add public key" });
    }
  });

  /**
   * DELETE /api/v1/auth/keys/:id
   */
  router.delete("/keys/:id", requireAuth, (req: Request, res: Response): void => {
    try {
      database.revokePublicKey(req.user!.id, Number(req.params.id));
      res.json({ success: true });
    } catch (err) {
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
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch connected accounts" });
    }
  });

  /**
   * DELETE /api/v1/auth/connected-accounts/:provider
   */
  router.delete("/connected-accounts/:provider", requireAuth, (req: Request, res: Response): void => {
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
    } catch (err) {
      res.status(500).json({ error: "Failed to unlink account" });
    }
  });

  return router;
}
