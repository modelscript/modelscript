// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable */

import bcrypt from "bcryptjs";
import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, requireAuth } from "../middleware/auth-middleware.js";

import { defaultRegistrationLimiter } from "../middleware/registration-limiter.js";
import { defaultMailer } from "../services/mailer.js";
import { defaultOidcService } from "../services/oidc.js";
import { verifyCaptchaToken } from "../util/captcha.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { isDisposableEmail } from "../util/email-filter.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../util/email-verification.js";

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

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
          expiresIn: "7d",
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
   */
  router.post("/login", async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    try {
      const user = database.getUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      const { password_hash: _, github_token, gitlab_token, ...safeUser } = user as any;

      res.json({
        token,
        user: safeUser,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(500).json({ error: message });
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

    if (!token) {
      res.redirect(`http://localhost:3000/settings?error=MissingToken`);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
      const state = encodeURIComponent(JSON.stringify({ action: "link", userId: decoded.id }));
      res.redirect(`/api/v1/auth/callback/${provider}?code=mock_code_from_${provider}&state=${state}`);
    } catch {
      res.redirect(`http://localhost:3000/settings?error=InvalidToken`);
    }
  });

  /**
   * GET /api/v1/auth/callback/:provider
   */
  router.get("/callback/:provider", async (req: Request, res: Response) => {
    const provider = req.params.provider as string;
    const stateParam = req.query.state as string;
    const code = req.query.code as string | undefined;

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
          res.redirect(`http://localhost:3000/settings?error=UserNotFound`);
          return;
        }

        const existingLink = database.getOAuthAccountByUserId(userId, provider);
        if (existingLink) {
          database.updateOAuthTokens(userId, provider, accessToken, refreshToken, expiresAt);
        } else {
          database.linkOAuthAccount(userId, provider, providerUserId, accessToken, refreshToken, expiresAt);
        }

        res.redirect(`http://localhost:3000/settings?success=Linked${provider}`);
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
          user = existing;
          database.linkOAuthAccount(user.id, provider, providerUserId, accessToken, refreshToken, expiresAt);
        } else {
          user = database.createOAuthUser(username, email, provider, providerUserId);
          database.updateOAuthTokens(user.id, provider, accessToken, refreshToken, expiresAt);
        }
      }

      if (!user) {
        res.redirect(`http://localhost:3000/login?error=OAuthFailed`);
        return;
      }

      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      // Redirect back to the frontend SPA
      res.redirect(`http://localhost:3000/oauth/callback?token=${token}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`http://localhost:3000/login?error=OAuthFailed`);
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
      const claims = defaultOidcService.extractClaims(idToken);
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
      const claims = defaultOidcService.extractClaims(idToken);
      const result = await defaultOidcService.handleOidcLogin(database, claims);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Invalid OIDC token payload" });
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
      const { password_hash, github_token, gitlab_token, ...safeUser } = user as any;
      res.json({ user: safeUser });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  /**
   * PUT /api/v1/auth/account
   */
  router.put("/account", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { password, username, email, display_name, avatar_url, banner_url } = req.body;
    const userId = req.user!.id;

    if (!password) {
      res.status(400).json({ error: "Password is required to confirm changes" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      if (!hash || !(await bcrypt.compare(password, hash))) {
        res.status(401).json({ error: "Incorrect password" });
        return;
      }

      if (username || email) {
        const u = username || req.user!.username;
        const e = email || req.user!.email;

        // check uniqueness if changed
        if (u !== req.user!.username) {
          const existU = database.getUserByUsername(u);
          if (existU) {
            res.status(409).json({ error: "Username is taken" });
            return;
          }
        }
        if (e !== req.user!.email) {
          const existE = database.getUserByEmail(e);
          if (existE) {
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
   */
  router.put("/password", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user!.id;

    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: "Both old and new passwords are required" });
      return;
    }

    try {
      const hash = database.getPasswordHash(userId);
      if (!hash || !(await bcrypt.compare(oldPassword, hash))) {
        res.status(401).json({ error: "Incorrect old password" });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      database.updatePassword(userId, newHash);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Password change failed" });
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

  return router;
}
