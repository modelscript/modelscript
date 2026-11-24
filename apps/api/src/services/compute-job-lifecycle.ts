// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared compute-job lifecycle helpers for simulation, physics (FEA/CFD), and CAM routes.
 *
 * Centralizes actor resolution, job ownership/authorization checks, pre-flight
 * authentication/sandboxing/quota guards, credit escrow lifecycle, job status
 * lookup/formatting, and result file delivery.
 */

import type express from "express";
import fs from "node:fs";
import type { LibraryDatabase } from "../database.js";
import type { JobInfo, JobQueue } from "../jobs.js";
import { checkComputeSandboxing } from "../util/compute-sandboxing.js";
import { getComputeProfile } from "./hpc/compute-profiles.js";
import type { ComputeProfile } from "./hpc/hpc-types.js";
import { checkComputeQuota, resolveRequestUserId } from "./hpc/quota-guard.js";

export interface ComputeActor {
  userId: number | null;
  isAdmin: boolean;
}

export interface ComputeJobAccessOptions {
  /** Whether to automatically allow access when `NODE_ENV === "test"` (default: true). */
  allowInTest?: boolean | undefined;
  /** Owner user ID of the job (`null` = unowned/anonymous, `undefined` = unknown). */
  ownerId: number | null | undefined;
  /** Whether access is allowed when the job has no recorded owner (default: false). */
  allowWhenUnowned?: boolean | undefined;
}

export interface ComputePreflightOptions {
  /** Optional requested compute profile ID. */
  profileId?: string | undefined;
  /** Whether anonymous (unauthenticated) job submissions are permitted. */
  allowAnonymous: boolean;
}

export type ComputePreflightResult =
  | {
      allowed: true;
      actor: ComputeActor;
      userId: number | null;
      profile: ComputeProfile;
      estimatedCost: number;
    }
  | {
      allowed: false;
    };

export interface HoldComputeEscrowOptions {
  database: LibraryDatabase;
  res: express.Response;
  userId: number | null;
  dbJobId: number | null;
  estimatedCost: number;
  description: string;
  metadata?: Record<string, unknown> | undefined;
  /** Custom 402 `error` field value (default: `"Payment Required: Escrow Hold Failed"`). */
  errorTitle?: string | undefined;
  /** When provided, included as `profile` in the 402 JSON body. */
  profileId?: string | undefined;
}

export interface CompleteComputeJobOptions {
  database: LibraryDatabase | undefined;
  dbJobId: number | null;
  userId: number | null;
  costCredits: number;
  description: string;
  metadata?: Record<string, unknown> | undefined;
  accounting?: Parameters<LibraryDatabase["updateJobAccounting"]>[1] | undefined;
  notificationType?: string | undefined;
  grantReferralReward?: boolean | undefined;
}

export interface FailComputeJobOptions {
  database: LibraryDatabase | undefined;
  dbJobId: number | null;
  userId: number | null;
  error: unknown;
  fallbackMessage: string;
}

export interface ComputeJobResultMessages {
  notCompleted?: string | undefined;
  missingFile?: string | undefined;
}

/**
 * Resolves the calling actor's user ID and admin privilege flag from an Express request.
 */
export function resolveComputeActor(req: express.Request, database?: LibraryDatabase): ComputeActor {
  const reqAny = req as {
    user?: { id?: number | undefined; role?: string | undefined; accountType?: string | undefined } | undefined;
  };
  const isAdmin = reqAny.user?.role === "admin" || reqAny.user?.accountType === "admin";
  const userId = database ? resolveRequestUserId(req, database) : (reqAny.user?.id ?? null);
  return { userId, isAdmin };
}

/**
 * Returns `true` if the requesting actor is authorized to access a compute job.
 */
export function isComputeJobAuthorized(
  req: express.Request,
  database: LibraryDatabase | undefined,
  options: ComputeJobAccessOptions,
): boolean {
  const allowInTest = options.allowInTest ?? true;
  if (allowInTest && process.env["NODE_ENV"] === "test") {
    return true;
  }

  const actor = resolveComputeActor(req, database);
  if (actor.isAdmin) {
    return true;
  }

  if (options.ownerId !== null && options.ownerId !== undefined) {
    return actor.userId === options.ownerId;
  }

  return Boolean(options.allowWhenUnowned);
}

/**
 * Verifies compute job access and sends `403 Forbidden` if denied.
 * Returns `true` when access is granted, `false` when a 403 response was written.
 */
export function assertComputeJobAccess(
  req: express.Request,
  res: express.Response,
  database: LibraryDatabase | undefined,
  options: ComputeJobAccessOptions,
): boolean {
  if (isComputeJobAuthorized(req, database, options)) {
    return true;
  }
  res.status(403).json({ error: "Forbidden" });
  return false;
}

/**
 * Runs pre-flight authentication (401), compute sandboxing (403), and credit quota (402) checks
 * for compute job submission endpoints.
 *
 * When a check fails, writes the appropriate HTTP error response and returns `{ allowed: false }`.
 */
export function runComputePreflight(
  req: express.Request,
  res: express.Response,
  database: LibraryDatabase | undefined,
  options: ComputePreflightOptions,
): ComputePreflightResult {
  const profile = getComputeProfile(options.profileId);
  const actor = resolveComputeActor(req, database);
  const userId = database ? actor.userId : null;

  if (!options.allowAnonymous && !userId) {
    res.status(401).json({ error: "Authentication required" });
    return { allowed: false };
  }

  if (database && userId) {
    const user = database.getUserById(userId);
    const sandbox = checkComputeSandboxing(user);
    if (sandbox.sandboxed) {
      res.status(403).json({
        error: sandbox.error,
        code: sandbox.code,
        fallbackAvailable: sandbox.fallbackAvailable,
      });
      return { allowed: false };
    }
  }

  let estimatedCost = 0;
  if (database && userId) {
    const quota = checkComputeQuota(userId, profile.id, database);
    if (!quota.allowed) {
      res.status(402).json({
        error: "Payment Required: Insufficient Compute Credits",
        message: quota.reason,
        balance: quota.userBalance,
        required: quota.estimatedCost,
        profile: quota.profileId,
      });
      return { allowed: false };
    }
    estimatedCost = quota.estimatedCost;
  }

  return {
    allowed: true,
    actor,
    userId,
    profile,
    estimatedCost,
  };
}

/**
 * Places an escrow hold on a user's compute credits before dispatching a job.
 * If the hold fails, marks the DB job as `FAILED`, sends a `402` response, and returns `false`.
 */
export function holdComputeEscrow(options: HoldComputeEscrowOptions): boolean {
  const { database, res, userId, dbJobId, estimatedCost, description, metadata, errorTitle, profileId } = options;
  if (!userId || !dbJobId || estimatedCost <= 0) {
    return true;
  }

  const holdRes = database.holdUserCredits(userId, estimatedCost, dbJobId, description, metadata);
  if (!holdRes.success) {
    database.updateJobStatus(dbJobId, "FAILED");
    const body: Record<string, unknown> = {
      error: errorTitle ?? "Payment Required: Escrow Hold Failed",
      message: holdRes.reason,
      balance: holdRes.newBalance,
      required: estimatedCost,
    };
    if (profileId !== undefined) {
      body["profile"] = profileId;
    }
    res.status(402).json(body);
    return false;
  }

  return true;
}

/**
 * Finalizes a succeeded compute job: updates DB status and accounting, settles credit escrow,
 * and optionally dispatches completion notifications and referral rewards.
 */
export function completeComputeJob(options: CompleteComputeJobOptions): void {
  const {
    database,
    dbJobId,
    userId,
    costCredits,
    description,
    metadata,
    accounting,
    notificationType,
    grantReferralReward,
  } = options;
  if (!database || !dbJobId) return;

  if (accounting) {
    database.updateJobAccounting(dbJobId, accounting);
  }
  if (userId) {
    database.settleUserEscrow(userId, dbJobId, costCredits, description, metadata);
    if (notificationType) {
      database.createNotification(userId, userId, notificationType);
    }
    if (grantReferralReward) {
      try {
        database.grantReferralReward(userId);
      } catch {
        // Ignore referral reward errors
      }
    }
  }
  database.updateJobStatus(dbJobId, "SUCCESS");
}

/**
 * Finalizes a failed compute job: marks DB status as `FAILED` and releases any held credit escrow.
 */
export function failComputeJob(options: FailComputeJobOptions): void {
  const { database, dbJobId, userId, error, fallbackMessage } = options;
  if (!database || !dbJobId) return;

  database.updateJobStatus(dbJobId, "FAILED");
  if (userId) {
    const reason =
      error instanceof Error ? error.message : typeof error === "string" && error.length > 0 ? error : fallbackMessage;
    database.releaseUserEscrow(userId, dbJobId, reason);
  }
}

/**
 * Looks up a compute job's status in the in-memory `JobQueue`, trying the raw ID first
 * and then optional key prefixes (e.g., `["physics", "cam"]`).
 */
export function lookupComputeJobStatus(
  jobQueue: JobQueue,
  rawId: string,
  prefixes: readonly string[] = [],
): JobInfo | null {
  const direct = jobQueue.getStatus(rawId);
  if (direct) return direct;
  for (const prefix of prefixes) {
    const prefixed = jobQueue.getStatus(`${prefix}-${rawId}`);
    if (prefixed) return prefixed;
  }
  return null;
}

/**
 * Formats a `JobInfo` status record into the canonical compute job status response shape.
 */
export function formatComputeJobStatus(status: JobInfo): JobInfo {
  return {
    ...status,
    profile: status.profile,
    usage: status.usage,
  };
}

/**
 * Validates that a compute job has completed with an existing result file on disk,
 * then streams the file via `res.sendFile()`. Sends 400 if incomplete or 500 if missing.
 */
export function sendComputeJobResultFile(
  res: express.Response,
  status: JobInfo,
  messages?: ComputeJobResultMessages,
): void {
  if (status.status !== "completed" || !status.resultPath) {
    res.status(400).json({ error: messages?.notCompleted ?? "Job not completed yet." });
    return;
  }
  if (!fs.existsSync(status.resultPath)) {
    res.status(500).json({ error: messages?.missingFile ?? "Result file missing." });
    return;
  }
  res.sendFile(status.resultPath);
}
