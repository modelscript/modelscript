// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import express, { type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../middleware/auth-middleware.js";
import { defaultLoginLimiter } from "../../middleware/login-limiter.js";
import { defaultMailer } from "../../services/mailer.js";
import { getClientIp } from "../../util/client-ip.js";
import { signEmailVerificationToken } from "../../util/email-verification.js";
import { resolveBrandInstanceName } from "../../util/registration-policy.js";
import { verifyAndConsumeBackupCode, verifyTotpCode } from "../../util/totp.js";
import { adminAuth, moderatorAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createUsersAndGovernanceRouter({ database, verifyAdminSudo }: AdminRouteContext): Router {
  const router = express.Router();

  // ── User & Account Governance ──

  /**
   * GET /api/v1/admin/users
   * Lists users with post counts, report counts, global statusBreakdown, and account status for governance
   */
  router.get("/admin/users", adminAuth, (req: Request, res: Response) => {
    try {
      const query = req.query["q"] as string | undefined;
      const status = req.query["status"] as string | undefined;
      const role = req.query["role"] as string | undefined;
      const limit = Math.min(100, Math.max(1, parseInt(req.query["limit"] as string, 10) || 50));
      const offset = Math.max(0, parseInt(req.query["offset"] as string, 10) || 0);

      const result = database.listUsersForAdmin({ query, status, role, limit, offset });
      res.json({
        users: result.users,
        total: result.total,
        count: result.users.length,
        limit,
        offset,
        statusBreakdown: result.statusBreakdown,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list users" });
    }
  });

  /**
   * POST /api/v1/admin/users
   * Directly provisions a user account as an administrator regardless of public registrationMode.
   */
  router.post(
    "/admin/users",
    adminAuth,
    express.json(),
    verifyAdminSudo,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const rawUsername = typeof req.body?.username === "string" ? req.body.username.trim() : "";
        const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const rawPassword = typeof req.body?.password === "string" ? req.body.password : "";
        const displayName =
          typeof req.body?.displayName === "string" && req.body.displayName.trim()
            ? req.body.displayName.trim()
            : undefined;
        const role: "user" | "moderator" | "auditor" | "admin" =
          req.body?.role === "admin" || req.body?.role === "moderator" || req.body?.role === "auditor"
            ? req.body.role
            : "user";
        const emailVerified = req.body?.emailVerified !== undefined ? Boolean(req.body.emailVerified) : true;
        const initialCredits =
          req.body?.initialCredits !== undefined && Number.isFinite(Number(req.body.initialCredits))
            ? Math.max(0, Number(req.body.initialCredits))
            : 100.0;

        if (!rawUsername || !/^[a-zA-Z0-9_-]{3,32}$/.test(rawUsername)) {
          res.status(400).json({
            error: "Username must be 3–32 characters and contain only letters, numbers, underscores, or hyphens.",
          });
          return;
        }

        const emailRegex =
          /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        if (!rawEmail || !emailRegex.test(rawEmail)) {
          res.status(400).json({ error: "A valid email address is required." });
          return;
        }

        if (!rawPassword || rawPassword.length < 8) {
          res.status(400).json({ error: "Password must be at least 8 characters." });
          return;
        }
        if (Buffer.byteLength(rawPassword, "utf8") > 72) {
          res.status(400).json({ error: "Password must not exceed 72 bytes." });
          return;
        }

        if (database.getUserByEmail(rawEmail)) {
          res.status(409).json({ error: "An account with this email already exists." });
          return;
        }
        if (database.getUserByUsername(rawUsername)) {
          res.status(409).json({ error: "This username is already taken." });
          return;
        }

        const passwordHash = await bcrypt.hash(rawPassword, 10);
        let user = database.createUser(rawUsername, rawEmail, passwordHash, {
          accountType: role === "admin" ? "admin" : "user",
          emailVerified,
          initialCredits,
          status: emailVerified ? "active" : "pending_verification",
          termsAcceptedAt: new Date().toISOString(),
          registrationIp: getClientIp(req),
        });

        if (displayName) {
          database.updateProfile(user.id, { display_name: displayName });
        }

        if (role !== "user") {
          database.moderateUserAccount(user.id, { role });
        }

        database.ensureUserRSAKeys(user.id);
        user = database.getUserById(user.id) ?? user;

        if (!emailVerified) {
          const verificationToken = signEmailVerificationToken(user.id, user.email);
          const instanceName = resolveBrandInstanceName(database);
          void defaultMailer
            .sendVerificationEmail(user.email, user.username, verificationToken, { instanceName })
            .catch(() => {
              // Non-blocking: verification email failure does not roll back user provisioning
            });
        }

        database.logAudit({
          actorId: req.user?.id || null,
          action: "admin.user.created",
          resourceType: "user",
          resourceId: String(user.id),
          ipAddress: getClientIp(req),
          details: {
            username: user.username,
            email: user.email,
            role,
            emailVerified,
            initialCredits,
          },
        });

        const {
          password_hash: _pw,
          github_token: _gh,
          gitlab_token: _gl,
          ...safeUser
        } = user as typeof user & {
          password_hash?: unknown;
          github_token?: unknown;
          gitlab_token?: unknown;
        };

        res.status(201).json({
          success: true,
          user: safeUser,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create user account" });
      }
    },
  );

  /**
   * PATCH /api/v1/admin/users/:id
   * Updates user account status (active, frozen, suspended), role (user, moderator, auditor, admin),
   * manual email verification (emailVerified), 2FA recovery reset (reset2FA), revokes sessions, or purges spam posts.
   */
  router.patch("/admin/users/:id", adminAuth, express.json(), verifyAdminSudo, (req: Request, res: Response) => {
    const userId = Number(req.params["id"]);
    const { status, role, revokeSessions, purgePosts, reason, emailVerified, reset2FA } = req.body;

    if (status !== undefined && !["active", "frozen", "suspended", "pending_verification"].includes(status)) {
      res.status(400).json({ error: "Invalid user status" });
      return;
    }
    if (role !== undefined && !["user", "moderator", "auditor", "admin"].includes(role)) {
      res.status(400).json({ error: "Invalid user role" });
      return;
    }

    if (
      req.user?.id === userId &&
      (status === "suspended" ||
        status === "frozen" ||
        status === "pending_verification" ||
        (role !== undefined && role !== "admin"))
    ) {
      res.status(400).json({ error: "Admins cannot suspend, freeze, or demote their own account" });
      return;
    }

    try {
      const targetUser = database.getUserById(userId);
      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const result = database.moderateUserAccount(userId, {
        status,
        role,
        revokeSessions: Boolean(revokeSessions) || Boolean(reset2FA),
        purgePosts: Boolean(purgePosts),
      });

      if (!result.success) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      let emailVerificationUpdated = false;
      if (typeof emailVerified === "boolean") {
        if (emailVerified) {
          database.verifyUserEmail(userId);
        } else {
          database.setUserEmailVerified(userId, false);
        }
        emailVerificationUpdated = true;
      }

      let twoFactorReset = false;
      if (reset2FA === true) {
        database.disableUser2FA(userId);
        twoFactorReset = true;
        database.createNotification(userId, req.user?.id || userId, "security_alert", null, {
          title: "Two-Factor Authentication Reset by Administrator",
          description: reason || "An instance administrator reset your 2FA configuration for account recovery.",
          skipEmail: true,
        });
        if (targetUser.email_verified === 1) {
          void defaultMailer
            .sendSecurityAlertEmail(targetUser.email, {
              username: targetUser.username,
              eventTitle: "Two-Factor Authentication Reset by Administrator",
              description:
                reason ||
                "An instance administrator has reset the two-factor authentication on your account and revoked active sessions.",
              ipAddress: getClientIp(req),
              instanceName: resolveBrandInstanceName(database),
            })
            .catch(() => {
              // Non-blocking: security alert email failure does not affect 2FA reset
            });
        }
      }

      if (status && ["frozen", "suspended", "active"].includes(status)) {
        database.createNotification(userId, req.user?.id || userId, "security_alert", null, {
          title: `Account Status Updated (${status})`,
          moderationAction: status === "active" ? "restore_user" : `status_${status}`,
          reason: reason || `Account status updated to ${status}`,
          canAppeal: status === "frozen" || status === "suspended",
          skipEmail: true,
        });
        if ((status === "frozen" || status === "suspended") && targetUser.email_verified === 1) {
          void defaultMailer
            .sendSecurityAlertEmail(targetUser.email, {
              username: targetUser.username,
              eventTitle: `Account ${status === "frozen" ? "Frozen" : "Suspended"}`,
              description: reason || `Your account status has been set to '${status}' by an instance administrator.`,
              ipAddress: getClientIp(req),
              instanceName: resolveBrandInstanceName(database),
            })
            .catch(() => {
              // Non-blocking: security alert email failure does not affect status update
            });
        }
      }

      const auditAction = reset2FA
        ? "admin.user.reset_2fa"
        : emailVerificationUpdated
          ? "admin.user.verify_email"
          : status
            ? `user_status_${status}`
            : role
              ? `user_role_${role}`
              : "user_moderated";

      database.logAudit({
        actorId: req.user?.id || null,
        action: auditAction,
        resourceType: "user",
        resourceId: String(userId),
        ipAddress: getClientIp(req),
        details: {
          status,
          role,
          ...(emailVerificationUpdated ? { emailVerified } : {}),
          ...(twoFactorReset ? { reset2FA: true } : {}),
          revokeSessions: result.sessionsRevoked,
          purgedPostCount: result.purgedPostCount,
          reason,
        },
      });

      res.json({
        success: true,
        userId,
        status,
        role,
        emailVerified: typeof emailVerified === "boolean" ? emailVerified : Boolean(targetUser.email_verified),
        twoFactorReset,
        reset2FA: twoFactorReset,
        sessionsRevoked: result.sessionsRevoked,
        purgedPostCount: result.purgedPostCount,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update user account" });
    }
  });

  const MAX_ADMIN_CREDIT_ADJUSTMENT = 100_000;
  const ADMIN_CREDIT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_IDEMPOTENCY_CACHE_ENTRIES = 5_000;
  const adminCreditIdempotencyCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

  /**
   * POST /api/v1/admin/users/:id/credits
   * Grants or deducts compute credits for a user account and records a ledger transaction
   */
  router.post("/admin/users/:id/credits", adminAuth, express.json(), (req: Request, res: Response) => {
    const userId = Number(req.params["id"]);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const amount = Number(req.body?.amount ?? req.body?.deltaCredits);
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "Admin compute credit adjustment";

    if (!Number.isFinite(amount) || Math.round(Math.abs(amount) * 100) === 0) {
      res.status(400).json({ error: "amount must be a non-zero number (at least 0.01 credits)" });
      return;
    }

    if (Math.abs(amount) > MAX_ADMIN_CREDIT_ADJUSTMENT) {
      res.status(400).json({
        error: `amount must be between -${MAX_ADMIN_CREDIT_ADJUSTMENT} and ${MAX_ADMIN_CREDIT_ADJUSTMENT}`,
      });
      return;
    }

    const roundedAmount = Math.round(amount * 100) / 100;
    const rawIdempotencyKey =
      typeof req.headers["idempotency-key"] === "string"
        ? req.headers["idempotency-key"].trim()
        : typeof req.body?.idempotencyKey === "string"
          ? req.body.idempotencyKey.trim()
          : "";
    const cacheKey = rawIdempotencyKey ? `${req.user?.id ?? "admin"}:${userId}:${rawIdempotencyKey.slice(0, 256)}` : "";

    if (cacheKey) {
      const cached = adminCreditIdempotencyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ ...cached.payload, idempotentReplay: true });
        return;
      }
      if (cached) {
        adminCreditIdempotencyCache.delete(cacheKey);
      }
    }

    try {
      const result = database.adjustUserCreditsForAdmin(userId, roundedAmount, reason);
      if (!result.success) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      database.logAudit({
        actorId: req.user?.id || null,
        action: "user_credits_adjusted",
        resourceType: "user",
        resourceId: String(userId),
        ipAddress: getClientIp(req),
        details: {
          userId,
          delta: roundedAmount,
          newBalance: result.newBalance,
          reason,
          ...(rawIdempotencyKey ? { idempotencyKey: rawIdempotencyKey.slice(0, 256) } : {}),
        },
      });

      const responsePayload: Record<string, unknown> = {
        success: true,
        userId,
        delta: roundedAmount,
        deltaCredits: roundedAmount,
        newBalance: result.newBalance,
        reason,
      };

      if (cacheKey) {
        if (adminCreditIdempotencyCache.size >= MAX_IDEMPOTENCY_CACHE_ENTRIES) {
          const oldestKey = adminCreditIdempotencyCache.keys().next().value;
          if (oldestKey !== undefined) {
            adminCreditIdempotencyCache.delete(oldestKey);
          }
        }
        adminCreditIdempotencyCache.set(cacheKey, {
          expiresAt: Date.now() + ADMIN_CREDIT_IDEMPOTENCY_TTL_MS,
          payload: responsePayload,
        });
      }

      res.json(responsePayload);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to adjust user credits" });
    }
  });

  /**
   * GET /api/v1/admin/users/:id/forensics
   * Returns a consolidated forensic summary for a user (posts, packages, credit ledger, audit trail, reports)
   */
  router.get("/admin/users/:id/forensics", moderatorAuth, (req: Request, res: Response) => {
    try {
      const userId = Number(req.params["id"]);
      if (!Number.isFinite(userId)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }
      const forensics = database.getUserForensicsForAdmin(userId);
      if (!forensics) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(forensics);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch user forensics" });
    }
  });

  // ── Account Warnings & Graduated Enforcement Strikes ──

  router.get("/admin/users/:id/warnings", moderatorAuth, (req: Request, res: Response) => {
    const userId = Number(req.params["id"]);
    res.json({ warnings: database.listAccountWarnings(userId) });
  });

  router.post("/admin/users/:id/warnings", moderatorAuth, express.json(), (req: Request, res: Response) => {
    const targetUserId = Number(req.params["id"]);
    const { action, text, reportId, ruleIds, rule_ids } = req.body || {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Warning text is required" });
      return;
    }
    const validActions = ["none", "sensitive", "delete_posts", "freeze", "suspend"] as const;
    const resolvedAction = validActions.includes(action) ? action : "none";
    const rawRuleIds = Array.isArray(ruleIds) ? ruleIds : Array.isArray(rule_ids) ? rule_ids : [];

    try {
      const warning = database.createAccountWarning({
        targetUserId,
        actorId: req.user?.id ?? null,
        moderatorId: req.user?.id ?? null,
        action: resolvedAction,
        text: text.trim(),
        reportId: typeof reportId === "number" ? reportId : null,
        ruleIds: rawRuleIds.map(Number).filter(Number.isFinite),
      });

      database.logAudit({
        actorId: req.user?.id || null,
        action: "account_warning_issued",
        resourceType: "user",
        resourceId: String(targetUserId),
        ipAddress: getClientIp(req),
        details: { warningId: warning.id, action: resolvedAction, text: warning.text },
      });

      res.status(201).json({ warning });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create account warning" });
    }
  });

  /**
   * POST /api/v1/admin/sudo/verify
   * Step-up re-authentication for destructive administrative operations (returns a 15m signed sudoToken).
   * Supports password verification, 2FA TOTP/backup codes, and OIDC/SSO admins without a local password.
   */
  router.post("/admin/sudo/verify", adminAuth, express.json(), async (req: Request, res: Response): Promise<void> => {
    try {
      const clientIp = getClientIp(req);
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Authenticated administrator session required" });
        return;
      }
      const userRecord = database.getUserById(userId);
      const userEmail = userRecord?.email || req.user?.email || `admin-${userId}`;
      const bypassRateLimit = process.env["NODE_ENV"] === "test" && req.headers["x-test-bypass-rate-limit"] === "true";

      if (!bypassRateLimit) {
        const rateCheck = defaultLoginLimiter.check(clientIp, userEmail);
        if (!rateCheck.allowed) {
          res.status(429).json({
            error: "Too many failed sudo verification attempts. Please try again in 15 minutes.",
            retryAfterSeconds: Math.ceil(rateCheck.resetInMs / 1000),
          });
          return;
        }
      }

      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const totpCode =
        typeof req.body?.totpCode === "string"
          ? req.body.totpCode.trim()
          : typeof req.body?.code === "string"
            ? req.body.code.trim()
            : "";

      const state2FA = database.getUser2FAState(userId);
      const hasTotp = Boolean(state2FA && state2FA.totp_enabled === 1 && state2FA.totp_secret);
      const hasPassword = Boolean(userRecord?.password_hash);
      const instanceSettings = database.getInstanceSettings();
      const enforceAdmin2FAEnrollment =
        instanceSettings.requireAdmin2FA &&
        (process.env["NODE_ENV"] === "production" || req.headers["x-enforce-admin-2fa"] === "true");

      if (enforceAdmin2FAEnrollment && !hasTotp) {
        res.status(403).json({
          error:
            "Two-factor authentication must be enabled on your administrator account before using sudo mode (requireAdmin2FA policy is active).",
          code: "ADMIN_2FA_ENROLLMENT_REQUIRED",
        });
        return;
      }

      if (!password && !totpCode) {
        res.status(400).json({ error: "Administrator password or 2FA code is required for sudo verification" });
        return;
      }

      let passwordValid = false;
      if (hasPassword && password) {
        if (userRecord!.password_hash!.startsWith("$2")) {
          passwordValid = await bcrypt.compare(password, userRecord!.password_hash!);
        } else {
          passwordValid = false;
        }
      }

      let totpValid = false;
      if (hasTotp && totpCode && state2FA?.totp_secret) {
        if (/^\d{6}$/.test(totpCode.replace(/\s+/g, ""))) {
          totpValid = verifyTotpCode(state2FA.totp_secret, totpCode, {
            preventReplay: process.env["NODE_ENV"] === "production",
          });
        } else if (state2FA.backup_codes.length > 0) {
          const backupResult = verifyAndConsumeBackupCode(totpCode, state2FA.backup_codes);
          if (backupResult.valid && backupResult.matchedHash) {
            totpValid = database.consumeBackupCode(userId, backupResult.matchedHash);
          }
        }
      }

      let valid = false;
      if (hasPassword && hasTotp) {
        if (totpCode) {
          valid = (password ? passwordValid : true) && totpValid;
        } else if (!instanceSettings.requireAdmin2FA) {
          valid = passwordValid;
        }
      } else if (hasPassword) {
        valid = passwordValid;
      } else if (hasTotp) {
        valid = totpValid;
      }

      if (!valid) {
        if (!bypassRateLimit) {
          defaultLoginLimiter.recordFailure(clientIp, userEmail);
        }
        database.logAudit({
          actorId: userId,
          action: "admin.sudo_failed",
          resourceType: "user",
          resourceId: String(userId),
          ipAddress: clientIp,
        });
        const missingRequiredTotp = Boolean(hasTotp && instanceSettings.requireAdmin2FA && !totpCode);
        res.status(401).json({
          error: missingRequiredTotp
            ? "Two-factor authentication code is required for administrator sudo verification"
            : "Invalid administrator password or 2FA code",
          ...(missingRequiredTotp ? { requires2FA: true } : {}),
        });
        return;
      }

      if (!bypassRateLimit) {
        defaultLoginLimiter.recordSuccess(clientIp, userEmail);
      }

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const sudoToken = jwt.sign(
        {
          id: userId,
          sudo: true,
          scope: "admin_sudo",
          mfaVerified: totpValid,
          tokenVersion: userRecord?.token_version ?? 1,
        },
        JWT_SECRET,
        {
          expiresIn: "15m",
        },
      );

      database.logAudit({
        actorId: userId,
        action: "admin.sudo_verified",
        resourceType: "user",
        resourceId: String(userId),
        ipAddress: clientIp,
        details: { expiresAt, mfaVerified: totpValid },
      });

      res.json({
        success: true,
        verified: true,
        sudoToken,
        mfaVerified: totpValid,
        expiresAt,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to verify sudo credentials" });
    }
  });

  // ── IP Blocks & Canonical Email Blocks ──

  router.get("/admin/ip-blocks", adminAuth, (_req: Request, res: Response) => {
    res.json({ ipBlocks: database.listIpBlocks() });
  });

  router.post("/admin/ip-blocks", adminAuth, express.json(), (req: Request, res: Response) => {
    const ipCidr = String(req.body?.ipCidr || req.body?.ip_cidr || req.body?.ip || "").trim();
    const severity = (req.body?.severity || "no_sign_up") as "sign_up_requires_approval" | "no_sign_up" | "no_access";
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : null;
    const expiresAt = typeof req.body?.expiresAt === "string" ? req.body.expiresAt : null;

    if (!ipCidr) {
      res.status(400).json({ error: "ipCidr is required" });
      return;
    }
    const block = database.createIpBlock(ipCidr, severity, comment, expiresAt, req.user?.id ?? null);
    database.logAudit({
      actorId: req.user?.id || null,
      action: "ip_block_created",
      resourceType: "ip_block",
      resourceId: String(block.id),
      ipAddress: getClientIp(req),
      details: { ipCidr, severity, comment },
    });
    res.status(201).json({ ipBlock: block });
  });

  router.delete("/admin/ip-blocks/:id", adminAuth, (req: Request, res: Response) => {
    const deleted = database.deleteIpBlock(Number(req.params["id"]));
    if (!deleted) {
      res.status(404).json({ error: "IP block not found" });
      return;
    }
    res.json({ success: true });
  });

  router.get("/admin/email-blocks", adminAuth, (_req: Request, res: Response) => {
    res.json({ emailBlocks: database.listCanonicalEmailBlocks() });
  });

  router.post("/admin/email-blocks", adminAuth, express.json(), (req: Request, res: Response) => {
    const email = String(req.body?.email || "").trim();
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Valid email address is required" });
      return;
    }
    const block = database.createCanonicalEmailBlock(email, reason, req.user?.id ?? null);
    database.logAudit({
      actorId: req.user?.id || null,
      action: "canonical_email_block_created",
      resourceType: "canonical_email_block",
      resourceId: String(block.id),
      ipAddress: getClientIp(req),
      details: { emailHint: block.email_hint, reason },
    });
    res.status(201).json({ emailBlock: block });
  });

  router.delete("/admin/email-blocks/:id", adminAuth, (req: Request, res: Response) => {
    const deleted = database.deleteCanonicalEmailBlock(Number(req.params["id"]));
    if (!deleted) {
      res.status(404).json({ error: "Email block not found" });
      return;
    }
    res.json({ success: true });
  });

  return router;
}
