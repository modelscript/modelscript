// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import { DistributedCounterBridge } from "./redis-store.js";

/**
 * Anti-abuse and DoS rate limiter for GDPR / CCPA user data archive exports.
 *
 * Enforces two protections:
 * 1. Cooldown interval: Minimum seconds between successive archive requests per user
 *    (preventing rapid burst CPU/memory exhaustion).
 * 2. Window ceiling: Maximum exports allowed per sliding time window (default: 5 per hour).
 *
 * Replicates increments/resets to Redis when REDIS_URL is configured.
 */
export class ArchiveExportRateLimiter {
  private readonly counter: DistributedCounterBridge;
  private readonly maxPerWindow: number;
  private readonly cooldownMs: number;

  constructor(
    maxPerWindow = 5,
    windowMs = 60 * 60 * 1000, // 1 hour window
    cooldownMs = process.env["NODE_ENV"] === "test" ? 0 : 15 * 1000,
  ) {
    this.maxPerWindow = maxPerWindow;
    this.cooldownMs = cooldownMs;
    this.counter = new DistributedCounterBridge({
      prefix: "rl:archive:",
      windowMs,
    });
  }

  public check(userId: string | number): {
    allowed: boolean;
    reason?: "cooldown" | "limit_exceeded" | undefined;
    retryAfterSeconds: number;
    remaining: number;
  } {
    const now = Date.now();
    const record = this.counter.get(String(userId), now);

    if (!record) {
      return {
        allowed: true,
        remaining: this.maxPerWindow - 1,
        retryAfterSeconds: 0,
      };
    }

    // Check cooldown between successive archive generations
    const cooldown = process.env["NODE_ENV"] === "test" ? 0 : this.cooldownMs;
    const timeSinceLast = now - record.lastEventAt;
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
    this.counter.increment(String(userId));
  }

  public reset(userId?: string | number): void {
    if (userId !== undefined) {
      this.counter.delete(String(userId));
    } else {
      this.counter.clear();
    }
  }

  public shutdown(): void {
    this.counter.shutdown();
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
