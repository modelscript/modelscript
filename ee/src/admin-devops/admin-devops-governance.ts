// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseAdminDevopsRouters {
  optionalAuthMiddleware: RequestHandler;
  adminRouter: Router;
  webhooksRouter: Router;
  gitRouter: Router;
  sparqlFeatureGuard: RequestHandler;
  sparqlRouter: Router;
}

/**
 * Mounts Batch H Enterprise Admin, DevSecOps & Semantic Knowledge Graph subsystems:
 * - Enterprise Admin Console, Audit Log Exports & Hot DB Backups (`/api/v1/admin/*`) gated by `airgap_compliance`
 * - Signed Outbound CI/CD Webhooks (`/api/v1/webhooks`) gated by `plm_connectors`
 * - Self-Hosted GitLab / Enterprise Git Provider Bridge (`/api/v1/git`, `/api/v1/gitlab`) gated by `plm_connectors`
 * - Enterprise W3C SPARQL 1.1 & OWL 2 RL Knowledge Graph Endpoint (`/api/v1/libraries/sparql`) gated by `plm_connectors`
 */
export function mountEnterpriseAdminAndDevops(app: Express, routers: EnterpriseAdminDevopsRouters): void {
  app.use(["/api/v1/admin/stats", "/api/v1/admin/ee"], requireEnterpriseFeature("airgap_compliance"));
  app.use("/api/v1", routers.adminRouter);

  app.use("/api/v1/webhooks", requireEnterpriseFeature("plm_connectors"), routers.webhooksRouter);

  app.use("/api/v1/git", requireEnterpriseFeature("plm_connectors"), routers.optionalAuthMiddleware, routers.gitRouter);
  app.use(
    "/api/v1/gitlab",
    requireEnterpriseFeature("plm_connectors"),
    routers.optionalAuthMiddleware,
    routers.gitRouter,
  );

  const sparqlGuards: RequestHandler[] = [
    requireEnterpriseFeature("plm_connectors"),
    routers.optionalAuthMiddleware,
    routers.sparqlFeatureGuard,
  ];
  app.use("/api/v1/libraries/sparql", ...sparqlGuards, routers.sparqlRouter);
  app.use(
    ["/api/v1/libraries/:name/:version/sparql", "/api/v1/libraries/:scope/:name/:version/sparql"],
    ...sparqlGuards,
  );
  app.use("/api/v1/libraries", routers.sparqlRouter);
}
