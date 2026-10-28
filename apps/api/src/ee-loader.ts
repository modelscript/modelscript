// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Express, NextFunction, Request, RequestHandler, Response, Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface EnterpriseHostContext {
  app: Express;
  isFeatureFlagEnabled(flagKey: string): boolean;
  hasAdminUser(): boolean;
  isDatabaseOpen(): boolean;
  isGeoIpReady(): boolean;
  getMailerDriver(): string;
  sanctionedCountriesCount: number;
  sanctionedRegionsCount: number;
  auth?:
    | {
        organizationsRouter: Router;
        optionalAuthMiddleware: RequestHandler;
      }
    | undefined;
  hpcBilling?:
    | {
        optionalAuthMiddleware: RequestHandler;
        caeFeatureGuard: RequestHandler;
        billingFeatureGuard: RequestHandler;
        caeRouter: Router;
        cloudRouter: Router;
        billingRouter: Router;
      }
    | undefined;
  twins?:
    | {
        optionalAuthMiddleware: RequestHandler;
        cosimFeatureGuard: RequestHandler;
        twinsFeatureGuard: RequestHandler;
        historianRouter: Router;
        instancesRouter: Router;
        twinsRouter: Router;
        cosimRouter?: Router | undefined;
        mqttParticipantsRouter?: Router | undefined;
      }
    | undefined;
  interop?:
    | {
        optionalAuthMiddleware: RequestHandler;
        mcpFeatureGuard: RequestHandler;
        sysml2FeatureGuard: RequestHandler;
        mcpRouter: Router;
        sysml2OmgRouter: Router;
      }
    | undefined;
  thread?:
    | {
        optionalAuthMiddleware: RequestHandler;
        threadFeatureGuard: RequestHandler;
        threadRouter: Router;
      }
    | undefined;
  adminDevops?:
    | {
        optionalAuthMiddleware: RequestHandler;
        adminRouter: Router;
        webhooksRouter: Router;
        gitRouter: Router;
        sparqlFeatureGuard: RequestHandler;
        sparqlRouter: Router;
      }
    | undefined;
}

export type EnterprisePlugin = (ctx: EnterpriseHostContext) => void;

export interface EnterpriseEntitlementCheck {
  allowed: boolean;
  statusCode: 200 | 402 | 403 | 501;
  code?: string | undefined;
  reason?: string | undefined;
}

export interface LoadedEnterpriseModule {
  createAirgapSecurityHeadersMiddleware(): RequestHandler;
  mountEnterpriseEdition(ctx: EnterpriseHostContext): void;
  createExportComplianceMiddleware?(
    databaseGetter?: () => unknown,
    locationAdapter?: unknown,
  ): (req: Request, res: Response, next: NextFunction) => void;
  verifyEnterpriseCollabSession?(): EnterpriseEntitlementCheck;
  verifyPrivateVisibilityEntitlement?(): EnterpriseEntitlementCheck;
  OidcService?: unknown;
}

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "../../..");

let loadedEeModule: LoadedEnterpriseModule | null = null;

async function tryLoadEnterpriseModule(): Promise<LoadedEnterpriseModule | null> {
  const candidates = [path.join(REPO_ROOT, "ee", "dist", "index.js"), path.join(REPO_ROOT, "ee", "src", "index.ts")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const mod = (await import(pathToFileURL(candidate).href)) as Partial<LoadedEnterpriseModule>;
        if (
          typeof mod.createAirgapSecurityHeadersMiddleware === "function" &&
          typeof mod.mountEnterpriseEdition === "function"
        ) {
          return mod as LoadedEnterpriseModule;
        }
      } catch {
        // Continue to next candidate or fallback to CE
      }
    }
  }
  return null;
}

loadedEeModule = await tryLoadEnterpriseModule();

/**
 * Returns the loaded `@modelscript/ee` module when present on disk, or null if absent.
 */
export function getLoadedEnterpriseModule(): LoadedEnterpriseModule | null {
  return loadedEeModule;
}

/**
 * Returns true if the server is currently running in Enterprise Edition (`ee`) mode
 * (`ee/` module is available and `MSX_EDITION` is not set to `"ce"`).
 */
export function isEnterpriseEditionActive(): boolean {
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return false;
  }
  return loadedEeModule !== null;
}

/**
 * Evaluates whether Real-Time Multi-User Co-Editing (`/api/v1/collab/stream`) is entitled.
 */
export function checkCollabSessionEntitlement(): EnterpriseEntitlementCheck {
  if (!isEnterpriseEditionActive() || !loadedEeModule) {
    return {
      allowed: false,
      statusCode: 501,
      code: "EE_EDITION_REQUIRED",
      reason:
        "Real-time multi-user co-editing rooms (/api/v1/collab/stream) require ModelScript Enterprise Edition (MSX_EDITION=ee).",
    };
  }
  if (typeof loadedEeModule.verifyEnterpriseCollabSession === "function") {
    return loadedEeModule.verifyEnterpriseCollabSession();
  }
  return { allowed: true, statusCode: 200 };
}

/**
 * Evaluates whether private/internal repository visibility is entitled.
 */
export function checkPrivateVisibilityEntitlement(): EnterpriseEntitlementCheck {
  if (!isEnterpriseEditionActive() || !loadedEeModule) {
    return {
      allowed: false,
      statusCode: 501,
      code: "EE_EDITION_REQUIRED",
      reason:
        "Private and organization-internal repositories require ModelScript Enterprise Edition (MSX_EDITION=ee). Community Edition repositories must be public under AGPL-3.0-or-later.",
    };
  }
  if (typeof loadedEeModule.verifyPrivateVisibilityEntitlement === "function") {
    return loadedEeModule.verifyPrivateVisibilityEntitlement();
  }
  return { allowed: true, statusCode: 200 };
}

/**
 * Returns an Express middleware that applies Enterprise Air-Gap CSP & FERC CEII headers
 * when running in Enterprise Edition (`ee`) mode, or a no-op middleware in Community Edition (`ce`).
 */
export function createOptionalEnterpriseHeadersMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (!isEnterpriseEditionActive() || !loadedEeModule) {
      next();
      return;
    }
    const handler = loadedEeModule.createAirgapSecurityHeadersMiddleware();
    handler(req, res, next);
  };
}

const CE_UNSUPPORTED_PREFIXES = [
  "/api/v1/ee",
  "/api/v1/admin",
  "/api/v1/compliance/airgap",
  "/api/v1/compliance/readiness",
  "/api/v1/organizations",
  "/api/v1/cae",
  "/api/v1/cloud",
  "/api/v1/billing",
  "/api/v1/cosim",
  "/api/v1/mqtt/participants",
  "/api/v1/historian",
  "/api/v1/instances",
  "/api/v1/twins",
  "/api/v1/mcp",
  "/api/v1/sysml2",
  "/api/v1/threads",
  "/api/v1/webhooks",
  "/api/v1/git",
  "/api/v1/gitlab",
  "/api/v1/libraries/sparql",
  "/api/v1/repos/:id/reviews",
  "/api/v1/libraries/:name/:version/export/kpar",
  "/api/v1/libraries/:scope/:name/:version/export/kpar",
  "/api/v1/libraries/:name/:version/export/aasx",
  "/api/v1/libraries/:scope/:name/:version/export/aasx",
  "/projects",
];

/**
 * Mounts Enterprise Edition (`ee/`) routes onto `ctx.app` when active, or mounts
 * Community Edition (`ce`) 501 stub responses when `MSX_EDITION=ce` or `ee/` is absent.
 */
export function mountEditionRoutes(ctx: EnterpriseHostContext, customPlugin?: EnterprisePlugin): void {
  if (customPlugin) {
    customPlugin(ctx);
    return;
  }

  if (isEnterpriseEditionActive() && loadedEeModule) {
    loadedEeModule.mountEnterpriseEdition(ctx);
    return;
  }

  // Community Edition (CE) fallback for Enterprise-only endpoints
  ctx.app.use(CE_UNSUPPORTED_PREFIXES, (_req, res) => {
    res.status(501).json({
      edition: "ce",
      licenseSpdx: "AGPL-3.0-or-later",
      error: "Enterprise Edition Required",
      message:
        "This endpoint requires ModelScript Enterprise Edition (ee/) and is not enabled in the AGPL-3.0 Community Edition.",
      pricingUrl: "https://modelscript.org/pricing",
    });
  });
}
