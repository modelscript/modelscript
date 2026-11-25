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

function assertRouterPrefix(router: Router, prefixes: string[], routerName: string): void {
  const stack = (router as unknown as { stack?: Array<{ route?: { path?: string | string[] } }> }).stack;
  if (!Array.isArray(stack)) return;
  for (const layer of stack) {
    const rawPath = layer.route?.path;
    if (!rawPath) continue;
    const paths = Array.isArray(rawPath) ? rawPath : [rawPath];
    for (const p of paths) {
      if (typeof p === "string" && !prefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
        throw new Error(
          `[ee/hpc-governance] Route '${p}' on ${routerName} does not start with any guarded prefix (${prefixes.join(", ")}) and would bypass slurm_hpc license enforcement.`,
        );
      }
    }
  }
}

/**
 * Mounts Enterprise Slurm HPC offload, Cloud CAE sweeps (`/api/v1/cae`, `/api/v1/cloud`, `/api/v1/hpc`),
 * and Stripe Compute Credit Wallet (`/api/v1/billing`) gated by the `slurm_hpc` license feature.
 */
export function mountEnterpriseHpcAndBilling(app: Express, routers: EnterpriseHpcBillingRouters): void {
  assertRouterPrefix(routers.caeRouter, ["/cae"], "caeRouter");
  assertRouterPrefix(routers.cloudRouter, ["/cloud", "/hpc"], "cloudRouter");
  assertRouterPrefix(routers.billingRouter, ["/billing"], "billingRouter");

  app.use(
    "/api/v1/cae",
    requireEnterpriseFeature("slurm_hpc", { exemptPaths: ["/cluster/status", "/cae/cluster/status"] }),
    routers.optionalAuthMiddleware,
    routers.caeFeatureGuard,
  );
  app.use("/api/v1", routers.caeRouter);

  app.use(
    ["/api/v1/cloud", "/api/v1/hpc"],
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
