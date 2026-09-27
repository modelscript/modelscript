// SPDX-License-Identifier: AGPL-3.0-or-later

import type express from "express";
import type { LibraryDatabase } from "../../database.js";
import { getComputeProfile } from "./compute-profiles.js";

export interface QuotaCheckResult {
  allowed: boolean;
  userBalance: number;
  estimatedCost: number;
  reason?: string;
  profileId: string;
}

/**
 * Checks whether a user has sufficient credits in their wallet to run a job with the specified profile.
 *
 * @param userId - ID of the user submitting the job
 * @param profileId - Selected compute profile ID (e.g. 'standard', 'high-memory')
 * @param database - Database instance
 * @param estimatedHours - Minimum estimated compute duration (default: 3 minutes = 0.05 hr)
 */
export function checkComputeQuota(
  userId: number,
  profileId: string | undefined,
  database: LibraryDatabase,
  estimatedHours: number = 0.05,
): QuotaCheckResult {
  const profile = getComputeProfile(profileId);
  const userBalance = database.getUserBalance(userId);
  const minRequired = profile.costCreditsPerHour * estimatedHours;

  if (userBalance < minRequired) {
    return {
      allowed: false,
      userBalance,
      estimatedCost: minRequired,
      reason: `Insufficient compute credits. Requires at least ${minRequired.toFixed(1)} cr to dispatch a '${profile.name}' job. Your current balance is ${userBalance.toFixed(1)} cr.`,
      profileId: profile.id,
    };
  }

  return {
    allowed: true,
    userBalance,
    estimatedCost: minRequired,
    profileId: profile.id,
  };
}

/**
 * Resolves the authenticated user ID from an Express request,
 * falling back to the primary dev user in development/test environments.
 */
export function resolveRequestUserId(req: express.Request, database: LibraryDatabase): number | null {
  const reqAny = req as { user?: { id?: number }; userId?: number };
  if (reqAny.user?.id) {
    return reqAny.user.id;
  }
  if (reqAny.userId) {
    return reqAny.userId;
  }

  // Fallback to dev user in test/development
  const devUser = database.getUserByUsername("dev");
  if (devUser) {
    return devUser.id;
  }

  return 1;
}
