// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET } from "../middleware/auth-middleware.js";

export interface OidcClaims {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  roles?: string[];
}

export class OidcService {
  private issuerUrl: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private adminGroup: string;

  constructor(options?: {
    issuerUrl?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    adminGroup?: string;
  }) {
    this.issuerUrl = (options?.issuerUrl || process.env["OIDC_ISSUER_URL"] || "").replace(/\/+$/, "");
    this.clientId = options?.clientId || process.env["OIDC_CLIENT_ID"] || "";
    this.clientSecret = options?.clientSecret || process.env["OIDC_CLIENT_SECRET"] || "";
    this.redirectUri =
      options?.redirectUri ||
      process.env["OIDC_REDIRECT_URI"] ||
      `${process.env["PUBLIC_URL"] || "http://localhost:3000"}/api/v1/auth/oidc/callback`;
    this.adminGroup = options?.adminGroup || process.env["OIDC_ADMIN_GROUP"] || "Engineering-Admins";
  }

  public isConfigured(): boolean {
    return Boolean(this.issuerUrl && this.clientId && this.clientSecret);
  }

  public getAuthorizationUrl(state: string, nonce: string): string {
    const authEndpoint = `${this.issuerUrl}/protocol/openid-connect/auth`;
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      scope: "openid profile email groups",
      redirect_uri: this.redirectUri,
      state,
      nonce,
    });
    return `${authEndpoint}?${params.toString()}`;
  }

  public async exchangeCode(code: string): Promise<{ idToken: string; accessToken: string }> {
    const tokenEndpoint = `${this.issuerUrl}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OIDC token exchange failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    return {
      idToken: data.id_token,
      accessToken: data.access_token,
    };
  }

  public extractClaims(idToken: string): OidcClaims {
    // Decode ID token payload
    const decoded = jwt.decode(idToken) as any;
    if (!decoded || !decoded.sub || !decoded.email) {
      throw new Error("Invalid OIDC ID token: missing required sub or email claim");
    }

    return {
      sub: decoded.sub,
      email: decoded.email.toLowerCase().trim(),
      name: decoded.name || decoded.preferred_username || decoded.email.split("@")[0],
      preferred_username: decoded.preferred_username,
      groups: Array.isArray(decoded.groups)
        ? decoded.groups
        : typeof decoded.groups === "string"
          ? [decoded.groups]
          : [],
      roles: Array.isArray(decoded.roles) ? decoded.roles : typeof decoded.roles === "string" ? [decoded.roles] : [],
    };
  }

  public async handleOidcLogin(
    database: LibraryDatabase,
    claims: OidcClaims,
  ): Promise<{ token: string; user: any; isNewUser: boolean }> {
    const userGroups = [...(claims.groups || []), ...(claims.roles || [])];
    const isAdmin =
      userGroups.includes(this.adminGroup) || userGroups.includes("admin") || userGroups.includes("administrators");

    const targetAccountType = isAdmin ? "admin" : "user";

    // 1. Check if user exists by OAuth provider linkage
    const existingOauth = database.getOAuthAccount("oidc", claims.sub);
    if (existingOauth) {
      const user = database.getUserById(existingOauth.user_id);
      if (user) {
        if (isAdmin && user.account_type !== "admin") {
          database.setUserAccountType(user.id, "admin");
          user.account_type = "admin";
        }
        const sessionToken = jwt.sign(
          {
            id: user.id,
            username: user.username,
            email: user.email,
            accountType: user.account_type || targetAccountType,
          },
          JWT_SECRET,
          { expiresIn: "7d" },
        );
        return { token: sessionToken, user, isNewUser: false };
      }
    }

    // 2. Check if user exists by email address
    let user = database.getUserByEmail(claims.email);
    if (user) {
      if (isAdmin && user.account_type !== "admin") {
        database.setUserAccountType(user.id, "admin");
        user.account_type = "admin";
      }
      database.updateOAuthTokens(user.id, "oidc", "linked_oidc", undefined, undefined);
      const sessionToken = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          accountType: user.account_type || targetAccountType,
        },
        JWT_SECRET,
        { expiresIn: "7d" },
      );
      return { token: sessionToken, user, isNewUser: false };
    }

    // 3. Provision new user from corporate OIDC identity
    const emailPrefix = claims.email.split("@")[0];
    const candidate = claims.preferred_username || emailPrefix;
    if (!candidate) {
      throw new Error(
        `Unable to provision OIDC user: missing preferred_username and email prefix for sub '${claims.sub}'`,
      );
    }
    const baseUsername = candidate.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    let finalUsername = baseUsername;
    let counter = 1;
    while (database.getUserByUsername(finalUsername)) {
      finalUsername = `${baseUsername}_${counter++}`;
    }

    const dummyPasswordHash = crypto.randomBytes(32).toString("hex");
    const created = database.createUser(finalUsername, claims.email, dummyPasswordHash, {
      accountType: targetAccountType,
      emailVerified: true,
      initialCredits: 200.0,
      status: "active",
      termsAcceptedAt: new Date().toISOString(),
    });

    database.updateOAuthTokens(created.id, "oidc", "linked_oidc", undefined, undefined);

    database.logAudit({
      actorId: created.id,
      action: "user_registered_oidc",
      resourceType: "user",
      resourceId: String(created.id),
      details: {
        email: claims.email,
        sub: claims.sub,
        accountType: targetAccountType,
        groups: userGroups,
      },
    });

    const fullUser = database.getUserById(created.id)!;
    const sessionToken = jwt.sign(
      { id: fullUser.id, username: fullUser.username, email: fullUser.email, accountType: targetAccountType },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return { token: sessionToken, user: fullUser, isNewUser: true };
  }
}

export const defaultOidcService = new OidcService();
