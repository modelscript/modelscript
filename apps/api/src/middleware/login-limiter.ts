// SPDX-License-Identifier: AGPL-3.0-or-later

import { DistributedCounterBridge } from "./redis-store.js";

/**
 * Sliding-window brute force protection for login attempts.
 * Limits failed login attempts to 5 per 15 minutes per IP and email.
 * Replicates increments/resets to Redis when REDIS_URL is configured.
 */
export class LoginRateLimiter {
  private readonly counter: DistributedCounterBridge;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures = 5, windowMs = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.counter = new DistributedCounterBridge({
      prefix: "rl:login:",
      windowMs,
    });
  }

  private buildKey(ip: string, email?: string): string {
    const cleanIp = ip || "127.0.0.1";
    if (email) {
      return `${cleanIp}:${email.toLowerCase().trim()}`;
    }
    return cleanIp;
  }

  public check(ip: string, email?: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const key = this.buildKey(ip, email);
    const ipKey = this.buildKey(ip);

    const record = this.counter.get(key, now);
    const ipRecord = this.counter.get(ipKey, now);

    // Check account-specific lockout for this IP
    if (record && record.count >= this.maxFailures) {
      return { allowed: false, remaining: 0, resetInMs: record.resetAt - now };
    }

    // Check aggregate account lockout across rotating IPs (3x max failures)
    if (email) {
      const emailRecord = this.counter.get(`email:${email.toLowerCase().trim()}`, now);
      if (emailRecord && emailRecord.count >= this.maxFailures * 3) {
        return { allowed: false, remaining: 0, resetInMs: emailRecord.resetAt - now };
      }
    }

    // Check aggregate IP lockout (e.g. distributed credential stuffing from single IP, allow double max)
    if (ipRecord && ipRecord.count >= this.maxFailures * 2) {
      return { allowed: false, remaining: 0, resetInMs: ipRecord.resetAt - now };
    }

    const currentFailures = record ? record.count : 0;
    const remaining = Math.max(0, this.maxFailures - currentFailures);
    const resetInMs = record ? record.resetAt - now : this.windowMs;

    return { allowed: true, remaining, resetInMs };
  }

  public recordFailure(ip: string, email?: string): void {
    const now = Date.now();
    const key = this.buildKey(ip, email);
    const ipKey = this.buildKey(ip);

    // Update specific key
    this.counter.increment(key, now);

    // Update aggregate account across IPs
    if (email) {
      this.counter.increment(`email:${email.toLowerCase().trim()}`, now);
    }

    // Update aggregate IP
    if (key !== ipKey) {
      this.counter.increment(ipKey, now);
    }
  }

  public recordSuccess(ip: string, email?: string): void {
    const key = this.buildKey(ip, email);
    this.counter.delete(key);
    if (email) {
      this.counter.delete(`email:${email.toLowerCase().trim()}`);
    }
  }

  public reset(ip?: string, email?: string): void {
    if (ip || email) {
      if (ip && email) {
        this.counter.delete(this.buildKey(ip, email));
      }
      if (ip) {
        this.counter.delete(this.buildKey(ip));
      }
      if (email) {
        this.counter.delete(`email:${email.toLowerCase().trim()}`);
      }
    } else {
      this.counter.clear();
    }
  }

  public shutdown(): void {
    this.counter.shutdown();
  }
}

export const defaultLoginLimiter = new LoginRateLimiter(5, 15 * 60 * 1000);
