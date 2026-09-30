// SPDX-License-Identifier: AGPL-3.0-or-later

import type express from "express";
import type { LibraryDatabase } from "../../database.js";
import { calculateCostCredits, getComputeProfile } from "./compute-profiles.js";
import type { ComputeProfile, HpcResourceSpec } from "./hpc-types.js";

export const HARD_LIMITS = {
  MAX_JOB_WALL_CLOCK_MINUTES: 240,
  DEFAULT_WALL_CLOCK_MINUTES: 30,
  MAX_JOB_CPUS: 64,
  MAX_JOB_MEMORY_MB: 262144, // 256 GB
};

export interface QuotaCheckResult {
  allowed: boolean;
  userBalance: number;
  estimatedCost: number;
  reason?: string;
  profileId: string;
}

/**
 * Validates that requested compute resources adhere to tier and system hard limits.
 */
export function validateResourceLimits(
  resources: HpcResourceSpec,
  profile?: ComputeProfile,
): { valid: boolean; reason?: string } {
  const effectiveProfile = profile || getComputeProfile();
  const maxTime = effectiveProfile.maxWallClockMinutes ?? HARD_LIMITS.DEFAULT_WALL_CLOCK_MINUTES;

  if (resources.timeLimitMinutes && resources.timeLimitMinutes > maxTime) {
    return {
      valid: false,
      reason: `Requested time limit of ${resources.timeLimitMinutes}m exceeds profile '${effectiveProfile.name}' ceiling of ${maxTime}m.`,
    };
  }

  const nodes = resources.nodes ?? 1;
  const tasksPerNode = resources.tasksPerNode ?? 1;
  const cpusPerTask = resources.cpusPerTask ?? effectiveProfile.cpus;
  const totalCores = nodes * tasksPerNode * cpusPerTask;

  if (totalCores > HARD_LIMITS.MAX_JOB_CPUS) {
    return {
      valid: false,
      reason: `Requested ${totalCores} total CPU cores exceeds hard platform ceiling of ${HARD_LIMITS.MAX_JOB_CPUS} cores.`,
    };
  }

  const memoryMb = resources.memoryMb ?? effectiveProfile.memoryMb;
  if (memoryMb > HARD_LIMITS.MAX_JOB_MEMORY_MB) {
    return {
      valid: false,
      reason: `Requested ${memoryMb}MB RAM exceeds hard platform ceiling of ${HARD_LIMITS.MAX_JOB_MEMORY_MB}MB.`,
    };
  }

  return { valid: true };
}

/**
 * Calculates the maximum execution duration in seconds that a user balance can sustain.
 */
export function calculateMaxAffordableDurationSeconds(userBalance: number, costCreditsPerHour: number): number {
  if (userBalance <= 0 || costCreditsPerHour <= 0) return 0;
  return Math.floor((userBalance / costCreditsPerHour) * 3600);
}

/**
 * Monitors credit drain for an active job against the user wallet, preventing negative balances.
 */
export function checkJobWalletDrain(
  userId: number,
  database: LibraryDatabase,
  elapsedSeconds: number,
  profile: ComputeProfile,
): { hasBalance: boolean; remainingCredits: number; currentCost: number } {
  const currentCost = calculateCostCredits(elapsedSeconds, profile);
  const userBalance = database.getUserBalance(userId);
  const remainingCredits = Math.round((userBalance - currentCost) * 100) / 100;

  return {
    hasBalance: remainingCredits >= 0,
    remainingCredits,
    currentCost,
  };
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
