// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseAuthRouters {
  organizationsRouter: Router;
  optionalAuthMiddleware: RequestHandler;
}

/**
 * Mounts Enterprise Identity, Multi-Organization RBAC (`/api/v1/organizations`),
 * and SAML 2.0 / OIDC SSO governance routes gated by `saml_oidc_sso`.
 */
export function mountEnterpriseAuthAndRbac(app: Express, routers: EnterpriseAuthRouters): void {
  app.use("/api/v1/organizations", requireEnterpriseFeature("saml_oidc_sso"), routers.organizationsRouter);
  app.use("/api/v1/auth/oidc", requireEnterpriseFeature("saml_oidc_sso"));
}
