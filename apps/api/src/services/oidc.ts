// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { getLoadedEnterpriseModule, isEnterpriseEditionActive } from "../ee-loader.js";

export interface OidcClaims {
  sub: string;
  email: string;
  name?: string | undefined;
  preferred_username?: string | undefined;
  groups?: string[] | undefined;
  roles?: string[] | undefined;
}

export interface OidcServiceOptions {
  issuerUrl?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
  adminGroup?: string | undefined;
}

interface EeOidcInstance {
  isConfigured(): boolean;
  getAuthorizationUrl(state: string, nonce: string): string;
  exchangeCode(code: string): Promise<{ idToken: string; accessToken: string }>;
  getSigningKey(kid?: string): Promise<string>;
  verifyIdToken(idToken: string): Promise<OidcClaims>;
  extractClaims(idToken: string): OidcClaims;
  handleOidcLogin(
    database: LibraryDatabase,
    claims: OidcClaims,
  ): Promise<{
    token: string;
    tempToken?: string | undefined;
    requires2FA?: boolean | undefined;
    user: NonNullable<ReturnType<LibraryDatabase["getUserById"]>>;
    isNewUser: boolean;
  }>;
}

type EeOidcConstructor = new (options?: OidcServiceOptions) => EeOidcInstance;

/**
 * Community Edition bridge for Enterprise OpenID Connect (OIDC) & SAML 2.0 SSO.
 * Delegates to `@modelscript/ee` (`ee/src/auth/oidc.ts`) when running in Enterprise Edition (`ee`) mode,
 * and disables corporate OIDC federation when running in Community Edition (`MSX_EDITION=ce`).
 */
export class OidcService implements EeOidcInstance {
  private delegate: EeOidcInstance | null = null;

  constructor(options?: OidcServiceOptions) {
    const eeMod = getLoadedEnterpriseModule();
    const Ctor = eeMod?.OidcService as EeOidcConstructor | undefined;
    if (Ctor) {
      this.delegate = new Ctor(options);
    }
  }

  private requireDelegate(): EeOidcInstance {
    if (!isEnterpriseEditionActive() || !this.delegate) {
      throw new Error(
        "Enterprise OIDC / SAML SSO requires ModelScript Enterprise Edition (ee/) and is not enabled in Community Edition (MSX_EDITION=ce).",
      );
    }
    return this.delegate;
  }

  public isConfigured(): boolean {
    if (!isEnterpriseEditionActive() || !this.delegate) {
      return false;
    }
    return this.delegate.isConfigured();
  }

  public getAuthorizationUrl(state: string, nonce: string): string {
    return this.requireDelegate().getAuthorizationUrl(state, nonce);
  }

  public async exchangeCode(code: string): Promise<{ idToken: string; accessToken: string }> {
    return this.requireDelegate().exchangeCode(code);
  }

  public async getSigningKey(kid?: string): Promise<string> {
    return this.requireDelegate().getSigningKey(kid);
  }

  public async verifyIdToken(idToken: string): Promise<OidcClaims> {
    return this.requireDelegate().verifyIdToken(idToken);
  }

  public extractClaims(idToken: string): OidcClaims {
    return this.requireDelegate().extractClaims(idToken);
  }

  public async handleOidcLogin(
    database: LibraryDatabase,
    claims: OidcClaims,
  ): Promise<{
    token: string;
    tempToken?: string | undefined;
    requires2FA?: boolean | undefined;
    user: NonNullable<ReturnType<LibraryDatabase["getUserById"]>>;
    isNewUser: boolean;
  }> {
    return this.requireDelegate().handleOidcLogin(database, claims);
  }
}

export const defaultOidcService = new OidcService();
