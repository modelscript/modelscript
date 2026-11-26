// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import type { LibraryDatabase } from "../../database.js";
import { JWT_SECRET, isAccountBlocked, requireAuth } from "../../middleware/auth-middleware.js";
import { registerOpenApiOperation, validateBody, type ObjectSchema } from "../../middleware/validate.js";
import { getClientIp } from "../../util/client-ip.js";
import { evaluateRegistrationPolicy } from "../../util/registration-policy.js";
import {
  buildOAuthAuthorizeUrl,
  consumeOAuthExchangeCode,
  extractSessionCookieToken,
  isScopedApiToken,
  issueOAuthExchangeCode,
  resolvePublicBaseUrl,
  setSessionCookie,
} from "./auth-helpers.js";
import { exchangeOAuthProviderCode, handleFediverseLogin, type OAuthStateData } from "./oauth-providers.js";

const OAUTH_EXCHANGE_SCHEMA: ObjectSchema = {
  type: "object",
  description: "Single-use OAuth/OIDC code exchange payload.",
  required: ["code"],
  properties: {
    code: {
      type: "string",
      required: true,
      minLength: 1,
      description: "Short-lived opaque single-use OAuth/OIDC exchange code.",
    },
  },
};

registerOpenApiOperation("post", "/api/v1/auth/oauth/exchange", {
  summary: "Exchange a single-use OAuth/OIDC code for a session token",
  tags: ["auth"],
  requestBody: OAUTH_EXCHANGE_SCHEMA,
  responses: {
    "200": { description: "OAuth code exchanged for session or 2FA challenge token." },
    "400": { description: "Missing, invalid, or expired exchange code." },
  },
});

export function createOAuthRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/auth/login/:provider
   */
  router.get("/login/:provider", (req: Request, res: Response) => {
    const provider =
      typeof req.params["provider"] === "string" ? req.params["provider"] : String(req.params["provider"] ?? "");
    const frontendUrl = resolvePublicBaseUrl(req);

    if (provider === "fediverse") {
      handleFediverseLogin(database, req, res, frontendUrl);
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
    const cookieToken = extractSessionCookieToken(req);
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
    const cookieToken = extractSessionCookieToken(req);
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

    let stateData: OAuthStateData | null = null;
    if (stateParam) {
      try {
        stateData = jwt.verify(decodeURIComponent(stateParam), JWT_SECRET) as OAuthStateData;
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

    const exchangeResult = await exchangeOAuthProviderCode({
      database,
      req,
      provider,
      code,
      frontendUrl,
      stateData,
      clientId,
      clientSecret,
      gitlabBaseUrl: oauthCreds.baseUrl,
    });

    if (!exchangeResult.ok) {
      res.redirect(exchangeResult.redirectUrl);
      return;
    }

    const {
      email,
      username,
      providerUserId,
      accessToken,
      refreshToken,
      remoteDisplayName,
      remoteAvatar,
      remoteBio,
      actorUrl,
      remoteDomain,
    } = exchangeResult.profile;

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
        const exchangeCode = issueOAuthExchangeCode({ token: tempToken, requires2FA: true });
        res.redirect(`${frontendUrl}/oauth/callback?code=${encodeURIComponent(exchangeCode)}&requires2FA=true`);
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

      const exchangeCode = issueOAuthExchangeCode({ token });
      // Redirect back to the frontend SPA with a short-lived one-time code
      res.redirect(`${frontendUrl}/oauth/callback?code=${encodeURIComponent(exchangeCode)}`);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.redirect(`${frontendUrl}/login?error=OAuthFailed`);
    }
  });

  /**
   * POST /api/v1/auth/oauth/exchange
   *
   * Single-use exchange of a short-lived opaque OAuth/OIDC code for a session
   * token (or 2FA challenge token). Prevents long-lived JWTs from appearing in
   * browser URLs, history, or Referer headers.
   */
  router.post(
    "/oauth/exchange",
    express.json(),
    validateBody(OAUTH_EXCHANGE_SCHEMA),
    (req: Request, res: Response): void => {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (!code) {
        res.status(400).json({ error: "Exchange code is required" });
        return;
      }

      const entry = consumeOAuthExchangeCode(code);
      if (!entry) {
        res.status(400).json({ error: "Invalid or expired exchange code" });
        return;
      }

      if (entry.expiresAt <= Date.now()) {
        res.status(400).json({ error: "Invalid or expired exchange code" });
        return;
      }

      if (!entry.requires2FA) {
        setSessionCookie(res, entry.token);
      }

      res.json({
        token: entry.token,
        requires2FA: Boolean(entry.requires2FA),
      });
    },
  );

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

      const linkableProviders = ["github", "gitlab"] as const;
      const supportedProviders = linkableProviders.filter((provider) => {
        const creds = database.getOAuthCredentials(provider);
        return Boolean(creds.clientId && buildOAuthAuthorizeUrl(req, provider, creds.clientId, "probe", creds.baseUrl));
      });

      res.json({ providers, supportedProviders });
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
      const userId = req.user!.id;
      const user = database.getUserById(userId);
      const hasPassword = Boolean(user?.password_hash);
      const linkedAccounts = database.getPublicOAuthAccounts(userId);
      const otherLinkedAccounts = linkedAccounts.filter((acc) => acc.provider.toLowerCase() !== provider);
      if (!hasPassword && otherLinkedAccounts.length === 0) {
        res.status(400).json({
          error: "Cannot disconnect your only sign-in method. Set a password first in Your Account settings.",
        });
        return;
      }

      database.unlinkOAuthAccount(userId, provider);
      database.logAudit({
        actorId: userId,
        action: "auth_oauth_unlinked",
        resourceType: "auth",
        resourceId: String(userId),
        ipAddress: getClientIp(req),
        details: { provider },
      });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to unlink account" });
    }
  });

  return router;
}
