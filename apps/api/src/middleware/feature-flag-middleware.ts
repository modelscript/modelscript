// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import type { FeatureFlagService } from "../services/feature-flag-service.js";

/**
 * Express middleware factory to guard endpoints behind a specific feature flag.
 * If the feature is disabled for the caller, returns 404 to avoid disclosing
 * internal unreleased endpoint topologies.
 */
export function requireFeatureFlag(serviceGetter: () => FeatureFlagService | undefined, flagKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const service = serviceGetter();
    if (!service) {
      next();
      return;
    }

    const isAllowed = service.isEnabled(flagKey, req.user);
    if (!isAllowed) {
      res.status(404).json({
        error: "Not Found",
        message: `The endpoint or feature '${flagKey}' is currently disabled or unavailable in this environment.`,
      });
      return;
    }

    next();
  };
}
