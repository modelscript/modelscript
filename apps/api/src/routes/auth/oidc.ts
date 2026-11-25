// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import crypto from "node:crypto";

import type { LibraryDatabase } from "../../database.js";
import { defaultOidcService } from "../../services/oidc.js";
import { issueOAuthExchangeCode, setSessionCookie } from "./auth-helpers.js";

export function createOidcRouter(database: LibraryDatabase): Router {
  const router = createRouter();

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
        } catch (verifyErr) {
          if (process.env["NODE_ENV"] === "production") {
            res.status(401).json({
              error: `OIDC ID token verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`,
            });
            return;
          }
          claims = defaultOidcService.extractClaims(tokenData.idToken);
        }
      }
      if (cookieNonce && (!claims || (claims as { nonce?: string }).nonce !== cookieNonce)) {
        res.status(400).json({ error: "Invalid or missing OIDC nonce in idToken" });
        return;
      }
      const result = await defaultOidcService.handleOidcLogin(database, claims, tokenData);

      const frontendUrl = process.env["PUBLIC_URL"] || "http://localhost:3000";
      if (result.requires2FA) {
        const exchangeCode = issueOAuthExchangeCode({ token: result.token, requires2FA: true });
        res.redirect(`${frontendUrl}/oauth/callback?code=${encodeURIComponent(exchangeCode)}&requires2FA=true`);
        return;
      }
      setSessionCookie(res, result.token);
      const exchangeCode = issueOAuthExchangeCode({ token: result.token });
      res.redirect(`${frontendUrl}/oauth/callback?code=${encodeURIComponent(exchangeCode)}`);
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

  return router;
}
