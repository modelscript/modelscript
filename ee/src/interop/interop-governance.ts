// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseInteropRouters {
  optionalAuthMiddleware: RequestHandler;
  mcpFeatureGuard: RequestHandler;
  sysml2FeatureGuard: RequestHandler;
  mcpRouter: Router;
  sysml2OmgRouter: Router;
}

/**
 * Mounts Enterprise Interoperability Gateways:
 * - Hosted Multi-Tenant MCP SSE Gateway (`/api/v1/mcp`), gated by `mcp_sse_gateway`
 * - OMG Systems Modeling REST API v2.0 (`/api/v1/sysml2` & `/projects`), gated by `sysml2_omg_api`
 */
export function mountEnterpriseInteropGateways(app: Express, routers: EnterpriseInteropRouters): void {
  app.use(
    "/api/v1/mcp",
    requireEnterpriseFeature("mcp_sse_gateway"),
    routers.optionalAuthMiddleware,
    routers.mcpFeatureGuard,
  );
  app.use("/api/v1", routers.mcpRouter);

  app.use(
    "/api/v1/sysml2",
    requireEnterpriseFeature("sysml2_omg_api"),
    routers.optionalAuthMiddleware,
    routers.sysml2FeatureGuard,
    routers.sysml2OmgRouter,
  );
  app.use(
    "/projects",
    requireEnterpriseFeature("sysml2_omg_api"),
    routers.optionalAuthMiddleware,
    routers.sysml2FeatureGuard,
  );
  app.use("/", routers.optionalAuthMiddleware, routers.sysml2OmgRouter);
}
