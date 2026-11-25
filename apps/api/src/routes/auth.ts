// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router as createRouter, type Router } from "express";

import type { LibraryDatabase } from "../database.js";
import { createAccountAndProfileRouter } from "./auth/account-and-profile.js";
import { createCredentialsAndSessionRouter } from "./auth/credentials-and-session.js";
import { createKeysAndTokensRouter } from "./auth/keys-and-tokens.js";
import { createOAuthRouter } from "./auth/oauth.js";
import { createOidcRouter } from "./auth/oidc.js";
import { createPasswordRecoveryRouter } from "./auth/password-recovery.js";
import { createTwoFactorRouter } from "./auth/two-factor.js";

/**
 * Coordinates all `/api/v1/auth` domain sub-routers:
 * - Credentials, registration, email verification, login/logout, session revocation
 * - Two-factor authentication (TOTP & backup recovery codes)
 * - Password reset and password change flows
 * - OAuth (GitHub, GitLab, Fediverse) login, account linking, code exchange, connected accounts
 * - Enterprise OpenID Connect (OIDC / SSO)
 * - Account profile & notification preferences
 * - User public keys and API personal access tokens (PATs)
 */
export function authRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  router.use(createCredentialsAndSessionRouter(database));
  router.use(createTwoFactorRouter(database));
  router.use(createPasswordRecoveryRouter(database));
  router.use(createOAuthRouter(database));
  router.use(createOidcRouter(database));
  router.use(createAccountAndProfileRouter(database));
  router.use(createKeysAndTokensRouter(database));

  return router;
}
