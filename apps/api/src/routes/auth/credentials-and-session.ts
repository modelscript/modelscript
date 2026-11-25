// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../../database.js";
import { isAccountBlocked, JWT_SECRET, optionalAuth, requireAuth } from "../../middleware/auth-middleware.js";
import { defaultLoginLimiter } from "../../middleware/login-limiter.js";
import { authRateLimiter } from "../../middleware/rate-limiter.js";
import { defaultRegistrationLimiter } from "../../middleware/registration-limiter.js";
import { defaultMailer } from "../../services/mailer.js";
import { defaultOidcService } from "../../services/oidc.js";
import { verifyCaptchaToken } from "../../util/captcha.js";
import { getClientIp } from "../../util/client-ip.js";
import { enforceExportCompliance } from "../../util/compliance.js";
import { isDisposableEmail } from "../../util/email-filter.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../../util/email-verification.js";
import { evaluateRegistrationPolicy, resolveBrandInstanceName } from "../../util/registration-policy.js";
import { isFederationDisabled } from "../../util/tier-presets.js";
import { clearSessionCookie, DUMMY_BCRYPT_HASH, isScopedApiToken, setSessionCookie } from "./auth-helpers.js";

export function createCredentialsAndSessionRouter(database: LibraryDatabase): Router {
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
  router.post("/resend-verification", authRateLimiter, async (req: Request, res: Response) => {
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
      } catch {
        // Non-fatal: session cookie has already been cleared
      }
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

  return router;
}
