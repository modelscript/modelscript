// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextFunction, Request, Response } from "express";
import { getClientIp } from "../util/client-ip.js";
import { DistributedCounterBridge } from "./redis-store.js";

/**
 * Sliding-window IP velocity limiter for registration to block automated bot floods.
 * Replicates increments/resets to Redis when REDIS_URL is configured.
 */
export class RegistrationRateLimiter {
  private readonly counter: DistributedCounterBridge;
  private readonly maxPerHour: number;
  private readonly windowMs: number;

  constructor(maxPerHour = 5, windowMs = 60 * 60 * 1000) {
    this.maxPerHour = maxPerHour;
    this.windowMs = windowMs;
    this.counter = new DistributedCounterBridge({
      prefix: "rl:register:",
      windowMs,
    });
  }

  public check(ip: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const record = this.counter.get(ip, now);

    if (!record) {
      return { allowed: true, remaining: this.maxPerHour - 1, resetInMs: this.windowMs };
    }

    if (record.count >= this.maxPerHour) {
      return { allowed: false, remaining: 0, resetInMs: record.resetAt - now };
    }

    return { allowed: true, remaining: this.maxPerHour - record.count, resetInMs: record.resetAt - now };
  }

  public record(ip: string): void {
    this.counter.increment(ip);
  }

  public reset(ip?: string): void {
    if (ip) {
      this.counter.delete(ip);
    } else {
      this.counter.clear();
    }
  }

  public shutdown(): void {
    this.counter.shutdown();
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
