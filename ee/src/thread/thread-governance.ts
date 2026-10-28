// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseThreadRouters {
  optionalAuthMiddleware: RequestHandler;
  threadFeatureGuard: RequestHandler;
  threadRouter: Router;
}

/**
 * Mounts Enterprise Digital Thread Hypergraph Governance (`/api/v1/threads`) —
 * multi-domain blast radius analysis, engineering change proposals, immutable audit logs,
 * SMT Physics-Simplex conflict reconciliation, and Pareto trade studies —
 * gated by the `digital_thread_governance` license entitlement.
 */
export function mountEnterpriseThreadGovernance(app: Express, routers: EnterpriseThreadRouters): void {
  app.use(
    "/api/v1/threads",
    requireEnterpriseFeature("digital_thread_governance"),
    routers.optionalAuthMiddleware,
    routers.threadFeatureGuard,
    routers.threadRouter,
  );
}
