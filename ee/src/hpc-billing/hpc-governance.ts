// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseHpcBillingRouters {
  optionalAuthMiddleware: RequestHandler;
  caeFeatureGuard: RequestHandler;
  billingFeatureGuard: RequestHandler;
  caeRouter: Router;
  cloudRouter: Router;
  billingRouter: Router;
}

/**
 * Mounts Enterprise Slurm HPC offload, Cloud CAE sweeps (`/api/v1/cae`, `/api/v1/cloud`),
 * and Stripe Compute Credit Wallet (`/api/v1/billing`) gated by the `slurm_hpc` license feature.
 */
export function mountEnterpriseHpcAndBilling(app: Express, routers: EnterpriseHpcBillingRouters): void {
  app.use(
    "/api/v1/cae",
    requireEnterpriseFeature("slurm_hpc"),
    routers.optionalAuthMiddleware,
    routers.caeFeatureGuard,
  );
  app.use("/api/v1", routers.caeRouter);

  app.use(
    "/api/v1/cloud",
    requireEnterpriseFeature("slurm_hpc"),
    routers.optionalAuthMiddleware,
    routers.caeFeatureGuard,
  );
  app.use("/api/v1", routers.cloudRouter);

  app.use(
    "/api/v1/billing",
    requireEnterpriseFeature("slurm_hpc"),
    routers.optionalAuthMiddleware,
    routers.billingFeatureGuard,
  );
  app.use("/api/v1", routers.billingRouter);
}
