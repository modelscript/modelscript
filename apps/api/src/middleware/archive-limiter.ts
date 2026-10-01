// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";

interface ExportRateRecord {
  count: number;
  lastExportAt: number;
  resetAt: number;
}

/**
 * Anti-abuse and DoS rate limiter for GDPR / CCPA user data archive exports.
 *
 * Enforces two protections:
 * 1. Cooldown interval: Minimum seconds between successive archive requests per user
 *    (preventing rapid burst CPU/memory exhaustion).
 * 2. Window ceiling: Maximum exports allowed per sliding time window (default: 5 per hour).
 */
export class ArchiveExportRateLimiter {
  private readonly userRecords = new Map<string | number, ExportRateRecord>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  constructor(
    maxPerWindow = 5,
    windowMs = 60 * 60 * 1000, // 1 hour window
    cooldownMs = process.env["NODE_ENV"] === "test" ? 0 : 15 * 1000,
  ) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
  }

  public check(userId: string | number): {
    allowed: boolean;
    reason?: "cooldown" | "limit_exceeded";
    retryAfterSeconds: number;
    remaining: number;
  } {
    const now = Date.now();
    const record = this.userRecords.get(userId);

    if (!record || now >= record.resetAt) {
      return {
        allowed: true,
        remaining: this.maxPerWindow - 1,
        retryAfterSeconds: 0,
      };
    }

    // Check cooldown between successive archive generations
    const cooldown = process.env["NODE_ENV"] === "test" ? 0 : this.cooldownMs;
    const timeSinceLast = now - record.lastExportAt;
    if (cooldown > 0 && timeSinceLast < cooldown) {
      const waitSeconds = Math.ceil((cooldown - timeSinceLast) / 1000);
      return {
        allowed: false,
        reason: "cooldown",
        retryAfterSeconds: waitSeconds,
        remaining: Math.max(0, this.maxPerWindow - record.count),
      };
    }

    // Check window capacity
    if (record.count >= this.maxPerWindow) {
      const waitSeconds = Math.ceil((record.resetAt - now) / 1000);
      return {
        allowed: false,
        reason: "limit_exceeded",
        retryAfterSeconds: waitSeconds,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      remaining: this.maxPerWindow - record.count,
      retryAfterSeconds: 0,
    };
  }

  public record(userId: string | number): void {
    const now = Date.now();
    const record = this.userRecords.get(userId);

    if (!record || now >= record.resetAt) {
      this.userRecords.set(userId, {
        count: 1,
        lastExportAt: now,
        resetAt: now + this.windowMs,
      });
    } else {
      record.count += 1;
      record.lastExportAt = now;
    }
  }

  public reset(userId?: string | number): void {
    if (userId !== undefined) {
      this.userRecords.delete(userId);
    } else {
      this.userRecords.clear();
    }
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // In test mode, allow bypass header or skip cooldown unless testing the rate limiter directly
      if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true") {
        next();
        return;
      }

      const identifier = req.user?.id ?? req.ip ?? "anonymous";
      const status = this.check(identifier);

      if (!status.allowed) {
        res.setHeader("Retry-After", String(status.retryAfterSeconds));
        const message =
          status.reason === "cooldown"
            ? `Please wait ${status.retryAfterSeconds} seconds before requesting another archive generation.`
            : `Archive export limit reached (${this.maxPerWindow} exports per hour). Please try again in ${Math.ceil(status.retryAfterSeconds / 60)} minutes.`;

        res.status(429).json({
          error: message,
          reason: status.reason,
          retryAfterSeconds: status.retryAfterSeconds,
        });
        return;
      }

      this.record(identifier);
      next();
    };
  }
}

export const defaultArchiveExportLimiter = new ArchiveExportRateLimiter();
