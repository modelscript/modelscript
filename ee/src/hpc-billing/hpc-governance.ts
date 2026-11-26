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

interface ExpressLayer {
  route?: { path?: string | string[] };
  path?: string;
  handle?: { stack?: ExpressLayer[] };
}

function joinRoutePath(base: string, child: string): string {
  if (!base || base === "/") return child;
  if (!child || child === "/") return base;
  return `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

function assertRouterPrefix(
  router: Router,
  prefixes: string[],
  routerName: string,
  mountPrefix = "",
  visited = new Set<unknown>(),
): void {
  if (visited.has(router)) return;
  visited.add(router);

  const stack = (router as unknown as { stack?: ExpressLayer[] }).stack;
  if (!Array.isArray(stack)) return;
  for (const layer of stack) {
    const rawPath = layer.route?.path;
    if (rawPath) {
      const paths = Array.isArray(rawPath) ? rawPath : [rawPath];
      for (const p of paths) {
        if (typeof p === "string") {
          const fullPath = joinRoutePath(mountPrefix, p);
          if (!prefixes.some((prefix) => fullPath === prefix || fullPath.startsWith(`${prefix}/`))) {
            throw new Error(
              `[ee/hpc-governance] Route '${fullPath}' on ${routerName} does not start with any guarded prefix (${prefixes.join(", ")}) and would bypass slurm_hpc license enforcement.`,
            );
          }
        }
      }
      continue;
    }

    if (layer.handle && Array.isArray(layer.handle.stack)) {
      const subMount = typeof layer.path === "string" && layer.path.startsWith("/") ? layer.path : "";
      const nextPrefix = subMount ? joinRoutePath(mountPrefix, subMount) : mountPrefix;
      assertRouterPrefix(layer.handle as unknown as Router, prefixes, routerName, nextPrefix, visited);
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
    requireEnterpriseFeature("slurm_hpc", {
      exemptPaths: ["/cluster/status", "/cae/cluster/status", "/api/v1/cae/cluster/status"],
    }),
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

  const billingFeatureGuardWithWebhookExempt: RequestHandler = (req, res, next) => {
    const normalizedPath = (req.path || "").replace(/\/+$/, "") || "/";
    const normalizedOriginal = ((req.originalUrl || "").split("?")[0] || "").replace(/\/+$/, "") || "/";
    if (
      normalizedPath === "/webhook" ||
      normalizedPath === "/billing/webhook" ||
      normalizedOriginal === "/billing/webhook" ||
      normalizedOriginal === "/api/v1/billing/webhook"
    ) {
      next();
      return;
    }
    routers.billingFeatureGuard(req, res, next);
  };

  app.use(
    "/api/v1/billing",
    requireEnterpriseFeature("slurm_hpc"),
    routers.optionalAuthMiddleware,
    billingFeatureGuardWithWebhookExempt,
  );
  app.use("/api/v1", routers.billingRouter);
}
