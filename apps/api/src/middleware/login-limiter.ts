// SPDX-License-Identifier: AGPL-3.0-or-later

interface LoginAttemptRecord {
  failures: number;
  resetAt: number;
}

/**
 * Sliding-window brute force protection for login attempts.
 * Limits failed login attempts to 5 per 15 minutes per IP and email.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttemptRecord>();
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures = 5, windowMs = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
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

    const record = this.attempts.get(key);
    const ipRecord = this.attempts.get(ipKey);

    // Check account-specific lockout
    if (record && now < record.resetAt && record.failures >= this.maxFailures) {
      return { allowed: false, remaining: 0, resetInMs: record.resetAt - now };
    }

    // Check aggregate IP lockout (e.g. distributed credential stuffing from single IP, allow double max)
    if (ipRecord && now < ipRecord.resetAt && ipRecord.failures >= this.maxFailures * 2) {
      return { allowed: false, remaining: 0, resetInMs: ipRecord.resetAt - now };
    }

    const currentFailures = record && now < record.resetAt ? record.failures : 0;
    const remaining = Math.max(0, this.maxFailures - currentFailures);
    const resetInMs = record && now < record.resetAt ? record.resetAt - now : this.windowMs;

    return { allowed: true, remaining, resetInMs };
  }

  public recordFailure(ip: string, email?: string): void {
    const now = Date.now();
    const key = this.buildKey(ip, email);
    const ipKey = this.buildKey(ip);

    // Update specific key
    const record = this.attempts.get(key);
    if (!record || now >= record.resetAt) {
      this.attempts.set(key, { failures: 1, resetAt: now + this.windowMs });
    } else {
      record.failures += 1;
    }

    // Update aggregate IP
    if (key !== ipKey) {
      const ipRecord = this.attempts.get(ipKey);
      if (!ipRecord || now >= ipRecord.resetAt) {
        this.attempts.set(ipKey, { failures: 1, resetAt: now + this.windowMs });
      } else {
        ipRecord.failures += 1;
      }
    }
  }

  public recordSuccess(ip: string, email?: string): void {
    const key = this.buildKey(ip, email);
    this.attempts.delete(key);
  }

  public reset(ip?: string, email?: string): void {
    if (ip || email) {
      if (ip && email) {
        this.attempts.delete(this.buildKey(ip, email));
      }
      if (ip) {
        this.attempts.delete(this.buildKey(ip));
      }
    } else {
      this.attempts.clear();
    }
  }
}

export const defaultLoginLimiter = new LoginRateLimiter(5, 15 * 60 * 1000);
