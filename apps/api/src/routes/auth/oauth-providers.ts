// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../../database.js";
import { JWT_SECRET } from "../../middleware/auth-middleware.js";
import { assertSafePublicUrl, safePublicFetch } from "../../util/ssrf.js";
import { isFederationDisabled } from "../../util/tier-presets.js";
import { resolvePublicBaseUrl } from "./auth-helpers.js";

const FEDIVERSE_DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export interface OAuthStateData {
  action?: string | undefined;
  userId?: number | undefined;
  provider?: string | undefined;
  domain?: string | undefined;
  targetHandle?: string | undefined;
}

export interface OAuthProviderProfile {
  email: string;
  username: string;
  providerUserId: string;
  accessToken: string;
  refreshToken: string | null;
  remoteDisplayName: string;
  remoteAvatar: string;
  remoteBio: string;
  actorUrl: string;
  remoteDomain: string;
}

export type OAuthCodeExchangeResult = { ok: true; profile: OAuthProviderProfile } | { ok: false; redirectUrl: string };

/**
 * Handles GET /api/v1/auth/login/fediverse dynamic OAuth client registration
 * and authorization redirect (or JSON redirectUrl payload).
 */
export function handleFediverseLogin(
  database: LibraryDatabase,
  req: Request,
  res: Response,
  frontendUrl: string,
): void {
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
      res.status(400).json({ error: "Disallowed Fediverse domain (SSRF protection).", code: "SSRF_DISALLOWED_DOMAIN" });
      return;
    }
    res.redirect(`${frontendUrl}/login?error=DisallowedFediverseDomain`);
    return;
  }

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
      res.redirect(`${frontendUrl}/login?error=FediverseRegistrationFailed&domain=${encodeURIComponent(targetDomain)}`);
    }
  })();
}

/**
 * Exchanges an authorization code with the upstream OAuth provider
 * (Fediverse, GitHub, or GitLab) and resolves the verified user profile.
 */
export async function exchangeOAuthProviderCode(params: {
  database: LibraryDatabase;
  req: Request;
  provider: string;
  code: string;
  frontendUrl: string;
  stateData: OAuthStateData | null;
  clientId: string | undefined;
  clientSecret: string | undefined;
  gitlabBaseUrl: string | undefined;
}): Promise<OAuthCodeExchangeResult> {
  const { database, req, provider, code, frontendUrl, stateData, clientId, clientSecret, gitlabBaseUrl } = params;

  let email = "";
  let username = "";
  let providerUserId = "";
  let accessToken = "";
  let refreshToken: string | null = null;
  const remoteDisplayName = "";
  const remoteAvatar = "";
  let remoteBio = "";
  let actorUrl = "";
  let remoteDomain = "";

  try {
    let verifiedLiveProfile = false;

    if (provider === "fediverse") {
      const targetDomain = stateData?.domain?.toLowerCase().trim();
      if (!targetDomain) {
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=InvalidState` };
      }
      try {
        assertSafePublicUrl(`https://${targetDomain}`);
      } catch {
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=DisallowedFediverseDomain` };
      }
      const client = database.getFederatedOAuthClient(targetDomain);
      if (!client) {
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthNotConfigured&provider=fediverse` };
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
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
      }
      const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
      if (!tokenData.access_token) {
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
      }
      accessToken = tokenData.access_token;
      if (tokenData.refresh_token) refreshToken = tokenData.refresh_token;

      const verifyRes = await safePublicFetch(`https://${targetDomain}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!verifyRes.ok) {
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
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
        return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
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
        } catch {
          // Fall back to default actor URL derived from targetDomain
        }
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
      const gitlabBase = (gitlabBaseUrl || "https://gitlab.com").replace(/\/$/, "");
      const tokenRes = await safePublicFetch(`${gitlabBase}/oauth/token`, {
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
        const userRes = await safePublicFetch(`${gitlabBase}/api/v4/user`, {
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
      return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
    }
  } catch (oauthErr) {
    console.error(`[OAuth] Live provider exchange failed:`, oauthErr);
    return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
  }

  if (!email || !username || !providerUserId || !accessToken) {
    return { ok: false, redirectUrl: `${frontendUrl}/login?error=OAuthExchangeFailed` };
  }

  return {
    ok: true,
    profile: {
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
    },
  };
}
