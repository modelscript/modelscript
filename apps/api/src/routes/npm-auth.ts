// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * npm-compatible authentication routes.
 *
 * Implements the CouchDB-style user endpoint that `npm login` and `npm adduser`
 * use to register users and obtain tokens.
 *
 * npm login sends: PUT /-/user/org.couchdb.user:{username}
 *   body: { name, password, email }
 *   Expects: { ok: true, token: "..." }
 */

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";

import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, isAccountBlocked } from "../middleware/auth-middleware.js";
import { defaultLoginLimiter } from "../middleware/login-limiter.js";
import { defaultRegistrationLimiter } from "../middleware/registration-limiter.js";
import { defaultMailer } from "../services/mailer.js";
import { enforceExportCompliance } from "../util/compliance.js";
import { signEmailVerificationToken } from "../util/email-verification.js";
import { evaluateRegistrationPolicy, resolveBrandInstanceName } from "../util/registration-policy.js";
import { verifyAndConsumeBackupCode, verifyTotpCode } from "../util/totp.js";

export function npmAuthRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * PUT /-/user/org.couchdb.user:{username}
   *
   * Called by `npm login` and `npm adduser`.
   * If the user exists, verify password and return a token.
   * If the user doesn't exist, create the account and return a token.
   */
  router.put(
    "/-/user/org.couchdb.user\\::username",
    enforceExportCompliance(() => database),
    async (req: Request, res: Response): Promise<void> => {
      const rawUsername = req.params["username"];
      const username = typeof rawUsername === "string" ? rawUsername : undefined;

      const body = (req.body ?? {}) as {
        name?: string | undefined;
        password?: string | undefined;
        email?: string | undefined;
        inviteCode?: string | undefined;
      };
      const { name, password, email, inviteCode } = body;

      const effectiveUsername = username || name;

      if (!effectiveUsername || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
        res.status(400).json({ error: "Password must not exceed 72 bytes" });
        return;
      }

      const clientIp = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";

      try {
        // Check if user exists
        const existing = database.getUserByUsername(effectiveUsername);

        if (existing) {
          const ipKey = `npm_ip:${clientIp}`;
          const userKey = `npm_user:${effectiveUsername.toLowerCase()}`;
          const ipRate = defaultLoginLimiter.check(ipKey);
          const userRate = defaultLoginLimiter.check(userKey);
          if (!ipRate.allowed || !userRate.allowed) {
            const resetInMs = Math.max(ipRate.resetInMs, userRate.resetInMs);
            res.status(429).json({
              error: "Too many failed login attempts. Please try again later.",
              retryAfterSeconds: Math.ceil(resetInMs / 1000),
            });
            return;
          }

          if (isAccountBlocked(existing.status)) {
            res.status(403).json({ error: `Account is ${existing.status}. Please contact support.` });
            return;
          }

          // Verify password
          const fullUser = database.getUserByEmail(existing.email);
          if (!fullUser || !fullUser.password_hash) {
            defaultLoginLimiter.recordFailure(ipKey);
            defaultLoginLimiter.recordFailure(userKey);
            res.status(401).json({ error: "Invalid credentials" });
            return;
          }

          const valid = await bcrypt.compare(password, fullUser.password_hash);
          if (!valid) {
            defaultLoginLimiter.recordFailure(ipKey);
            defaultLoginLimiter.recordFailure(userKey);
            res.status(401).json({ error: "Invalid credentials" });
            return;
          }

          if (isAccountBlocked(fullUser.status)) {
            res.status(403).json({ error: `Account is ${fullUser.status}. Please contact support.` });
            return;
          }

          const state2FA = database.getUser2FAState(fullUser.id);
          if (state2FA && state2FA.totp_enabled === 1 && state2FA.totp_secret) {
            const otpHeader = (req.headers["npm-otp"] as string | undefined)?.trim();
            if (process.env["NODE_ENV"] === "production" || otpHeader) {
              if (!otpHeader) {
                res.setHeader("WWW-Authenticate", "OTP");
                res.status(401).json({ error: "Two-factor authentication OTP required (npm-otp header)" });
                return;
              }

              const cleanOtp = otpHeader.replace(/\s+/g, "").trim();
              let otpVerified = false;
              let usedBackupCode = false;

              if (/^\d{6}$/.test(cleanOtp)) {
                otpVerified = verifyTotpCode(state2FA.totp_secret, cleanOtp, {
                  preventReplay: process.env["NODE_ENV"] === "production",
                });
              } else {
                const backupResult = verifyAndConsumeBackupCode(cleanOtp, state2FA.backup_codes);
                if (backupResult.valid && backupResult.matchedHash) {
                  otpVerified = database.consumeBackupCode(fullUser.id, backupResult.matchedHash);
                  usedBackupCode = otpVerified;
                }
              }

              if (!otpVerified) {
                defaultLoginLimiter.recordFailure(ipKey);
                defaultLoginLimiter.recordFailure(userKey);
                res.setHeader("WWW-Authenticate", "OTP");
                res.status(401).json({ error: "Two-factor authentication OTP required (npm-otp header)" });
                return;
              }

              if (usedBackupCode) {
                const instanceName = resolveBrandInstanceName(database);
                database.logAudit({
                  actorId: fullUser.id,
                  action: "auth_2fa_backup_code_used",
                  resourceType: "auth",
                  resourceId: String(fullUser.id),
                  ipAddress: clientIp,
                  details: { channel: "npm_cli" },
                });
                database.createNotification(fullUser.id, fullUser.id, "security_alert", null, {
                  title: "2FA Backup Recovery Code Used (CLI)",
                  description: "A single-use 2FA recovery code was used to sign in via the npm CLI.",
                  skipEmail: true,
                });
                void defaultMailer
                  .sendSecurityAlertEmail(fullUser.email, {
                    username: fullUser.username,
                    eventTitle: "2FA Backup Recovery Code Used",
                    description: "A single-use 2FA recovery code was consumed to authenticate via the npm CLI.",
                    ipAddress: clientIp,
                    instanceName,
                  })
                  .catch(() => {});
              }
            }
          }

          defaultLoginLimiter.reset(ipKey);
          defaultLoginLimiter.reset(userKey);

          // Return a token
          const token = jwt.sign(
            {
              id: fullUser.id,
              username: fullUser.username,
              email: fullUser.email,
              tokenVersion: fullUser.token_version ?? 1,
            },
            JWT_SECRET,
            {
              expiresIn: "30d",
            },
          );

          res.status(201).json({
            ok: true,
            id: `org.couchdb.user:${effectiveUsername}`,
            token,
          });
          return;
        }

        // Create new user with hardened anti-Sybil & instance registration policy restrictions
        if (!email) {
          res.status(400).json({ error: "Email is required for registration" });
          return;
        }

        const rateCheck = defaultRegistrationLimiter.check(clientIp);
        if (!rateCheck.allowed) {
          res.status(429).json({
            error: "Too many registration attempts. Please try again later.",
            retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
          });
          return;
        }

        const policy = evaluateRegistrationPolicy(database, {
          email,
          inviteCode: inviteCode || (req.headers["x-msx-invite-code"] as string | undefined),
        });
        if (!policy.allowed) {
          res.status(policy.status ?? 403).json({
            error: policy.error || "Registration is not permitted by instance policy.",
          });
          return;
        }

        const existingByEmail = database.getUserByEmail(email);
        if (existingByEmail) {
          res.status(409).json({ error: "An account with this email already exists" });
          return;
        }

        const preVerified = Boolean(policy.redeemedInvite || policy.autoVerifiedByAirgap);
        const initialCredits = policy.redeemedInvite
          ? policy.redeemedInvite.initialCredits
          : policy.autoVerifiedByAirgap
            ? 50.0
            : 0.0;

        const passwordHash = await bcrypt.hash(password, 10);
        let user = database.createUser(effectiveUsername, email, passwordHash, {
          emailVerified: preVerified,
          initialCredits,
          status: preVerified ? "active" : "pending_verification",
          termsAcceptedAt: new Date().toISOString(),
          registrationIp: clientIp,
        });

        if (
          policy.redeemedInvite &&
          policy.redeemedInvite.assignedRole &&
          policy.redeemedInvite.assignedRole !== "user" &&
          (policy.redeemedInvite.assignedRole === "moderator" ||
            policy.redeemedInvite.assignedRole === "auditor" ||
            policy.redeemedInvite.assignedRole === "admin")
        ) {
          database.moderateUserAccount(user.id, {
            role: policy.redeemedInvite.assignedRole,
          });
          user = database.getUserById(user.id) ?? user;
        }

        defaultRegistrationLimiter.record(clientIp);

        const verificationToken = signEmailVerificationToken(user.id, user.email);
        const instanceName = resolveBrandInstanceName(database);
        try {
          await defaultMailer.sendVerificationEmail(user.email, user.username, verificationToken, {
            instanceName,
          });
        } catch (err) {
          console.error("[npm-auth] Failed to dispatch verification email:", err);
        }

        const token = jwt.sign(
          { id: user.id, username: user.username, email: user.email, tokenVersion: user.token_version ?? 1 },
          JWT_SECRET,
          {
            expiresIn: "30d",
          },
        );

        res.status(201).json({
          ok: true,
          id: `org.couchdb.user:${effectiveUsername}`,
          token,
          verificationRequired: !preVerified,
          message: preVerified
            ? "Account created and verified."
            : "Account created. Please verify your email address to unlock free compute credits.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        res.status(500).json({ error: message });
      }
    },
  );

  /**
   * GET /-/whoami
   *
   * Called by `npm whoami` to verify the current authentication.
   */
  router.get("/-/whoami", (req: Request, res: Response): void => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as {
        id?: number | undefined;
        username: string;
        scope?: string | undefined;
        tokenVersion?: number | undefined;
      };
      if (decoded.scope === "2fa_challenge") {
        res.status(401).json({ error: "Two-factor authentication required" });
        return;
      }
      const user =
        decoded.id !== undefined ? database.getUserById(decoded.id) : database.getUserByUsername(decoded.username);
      if (user) {
        if (isAccountBlocked(user.status)) {
          res.status(403).json({ error: `Account is ${user.status}. Please contact support.` });
          return;
        }
        if ((decoded.tokenVersion ?? 1) !== (user.token_version ?? 1)) {
          res.status(401).json({ error: "Session has expired or was revoked" });
          return;
        }
      }
      res.json({ username: decoded.username });
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  });

  /**
   * GET /-/ping
   *
   * Health check endpoint used by npm.
   */
  router.get("/-/ping", (_req: Request, res: Response): void => {
    res.json({});
  });

  return router;
}
