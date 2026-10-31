// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import { getClientIp } from "../util/client-ip.js";

interface RegistrationRecord {
  count: number;
  resetAt: number;
}

/**
 * Sliding-window in-memory IP velocity limiter for registration to block automated bot floods.
 */
export class RegistrationRateLimiter {
  private readonly attempts = new Map<string, RegistrationRecord>();
  private readonly maxPerHour: number;
  private readonly windowMs: number;

  constructor(maxPerHour = 5, windowMs = 60 * 60 * 1000) {
    this.maxPerHour = maxPerHour;
    this.windowMs = windowMs;
  }

  public check(ip: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const record = this.attempts.get(ip);

    if (!record || now >= record.resetAt) {
      return { allowed: true, remaining: this.maxPerHour - 1, resetInMs: this.windowMs };
    }

    if (record.count >= this.maxPerHour) {
      return { allowed: false, remaining: 0, resetInMs: record.resetAt - now };
    }

    return { allowed: true, remaining: this.maxPerHour - record.count, resetInMs: record.resetAt - now };
  }

  private static readonly MAX_RECORDS = 10_000;

  public record(ip: string): void {
    const now = Date.now();
    if (this.attempts.size >= RegistrationRateLimiter.MAX_RECORDS) {
      for (const [k, v] of this.attempts) {
        if (now >= v.resetAt) this.attempts.delete(k);
      }
      if (this.attempts.size >= RegistrationRateLimiter.MAX_RECORDS) {
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey !== undefined) this.attempts.delete(oldestKey);
      }
    }
    const record = this.attempts.get(ip);

    if (!record || now >= record.resetAt) {
      this.attempts.set(ip, { count: 1, resetAt: now + this.windowMs });
    } else {
      record.count += 1;
    }
  }

  public reset(ip?: string): void {
    if (ip) {
      this.attempts.delete(ip);
    } else {
      this.attempts.clear();
    }
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // In test mode, allow header override or bypass unless explicitly testing rate limits
      if (process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true") {
        next();
        return;
      }

      const clientIp = getClientIp(req);
      const status = this.check(clientIp);

      if (!status.allowed) {
        res.status(429).json({
          error: "Too many registration attempts. Please try again later.",
          retryAfterSeconds: Math.ceil(status.resetInMs / 1000),
        });
        return;
      }

      this.record(clientIp);
      next();
    };
  }
}

export const defaultRegistrationLimiter = new RegistrationRateLimiter(5, 60 * 60 * 1000);
