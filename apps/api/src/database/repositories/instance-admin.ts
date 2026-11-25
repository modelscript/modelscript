// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import type { LibraryDatabase } from "../../database.js";
import { decryptSecretAtRest, encryptSecretAtRest, maskSecretPreview } from "../../util/totp.js";
import type { AccountWarningRow, AdminUserSummaryRow, AuditLogRow, StaffNoteRow } from "../types.js";
import { BaseRepository } from "./base.js";

/**
 * Repository encapsulating instance administration, user moderation, cryptographic audit log chains,
 * instance settings & OAuth credentials, setup wizard state, invites, diagnostics, and forensics.
 */
export class InstanceAdminRepository extends BaseRepository {
  #auditChainCache: {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    headHash: string | null;
    brokenAtId?: number | undefined;
    secretUsed?: string | undefined;
  } | null = null;
  #instanceSettingsMapCache: Map<string, string> | null = null;

  clearAuditChainCache(): void {
    this.#auditChainCache = null;
  }

  clearInstanceSettingsCache(): void {
    this.#instanceSettingsMapCache = null;
  }

  clearCaches(): void {
    this.#auditChainCache = null;
    this.#instanceSettingsMapCache = null;
  }

  listUsersForAdmin(options?: {
    query?: string | undefined;
    status?: string | undefined;
    role?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): {
    users: AdminUserSummaryRow[];
    total: number;
    statusBreakdown: {
      active: number;
      frozen: number;
      suspended: number;
      admins: number;
      moderators: number;
      auditors: number;
    };
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.query && options.query.trim()) {
      const q = `%${options.query.trim().toLowerCase()}%`;
      clauses.push(`(LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.display_name, '')) LIKE ?)`);
      params.push(q, q, q);
    }
    if (options?.status && options.status !== "all") {
      clauses.push(`COALESCE(u.status, 'active') = ?`);
      params.push(options.status);
    }
    if (options?.role && options.role !== "all") {
      clauses.push(`COALESCE(u.account_type, 'user') = ?`);
      params.push(options.role);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalRow = this.db.prepare(`SELECT COUNT(*) as c FROM users u ${whereSql}`).get(...params) as
      { c: number } | undefined;
    const total = totalRow?.c ?? 0;

    const breakdownRow = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status = 'frozen' THEN 1 ELSE 0 END) as frozen,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
           SUM(CASE WHEN account_type = 'admin' THEN 1 ELSE 0 END) as admins,
           SUM(CASE WHEN account_type = 'moderator' THEN 1 ELSE 0 END) as moderators,
           SUM(CASE WHEN account_type = 'auditor' THEN 1 ELSE 0 END) as auditors
         FROM users`,
      )
      .get() as
      | {
          active: number | null;
          frozen: number | null;
          suspended: number | null;
          admins: number | null;
          moderators: number | null;
          auditors: number | null;
        }
      | undefined;

    const limit = Math.min(100, Math.max(1, options?.limit || 50));
    const offset = Math.max(0, options?.offset || 0);

    const users = this.db
      .prepare(
        `SELECT u.id,
                u.username,
                u.email,
                u.display_name,
                COALESCE(u.account_type, 'user') as account_type,
                COALESCE(u.status, 'active') as status,
                COALESCE(u.email_verified, 0) as email_verified,
                COALESCE(u.totp_enabled, 0) as totp_enabled,
                COALESCE(u.credit_balance, 0) as credit_balance,
                u.remote_domain,
                u.created_at,
                (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) as post_count,
                (SELECT COUNT(*) FROM content_reports r WHERE r.target_user_id = u.id) as report_count,
                (SELECT COUNT(*) FROM content_reports r WHERE r.target_user_id = u.id AND r.status = 'resolved') as resolved_violation_count
         FROM users u
         ${whereSql}
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AdminUserSummaryRow[];

    return {
      users,
      total,
      statusBreakdown: {
        active: Number(breakdownRow?.active ?? 0),
        frozen: Number(breakdownRow?.frozen ?? 0),
        suspended: Number(breakdownRow?.suspended ?? 0),
        admins: Number(breakdownRow?.admins ?? 0),
        moderators: Number(breakdownRow?.moderators ?? 0),
        auditors: Number(breakdownRow?.auditors ?? 0),
      },
    };
  }

  moderateUserAccount(
    userId: number,
    options: {
      status?: "active" | "frozen" | "suspended" | "pending_verification" | undefined;
      role?: "user" | "moderator" | "auditor" | "admin" | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
    },
  ): {
    success: boolean;
    purgedPostCount: number;
    sessionsRevoked: boolean;
  } {
    const user = this.facade.getUserById(userId);
    if (!user) {
      return { success: false, purgedPostCount: 0, sessionsRevoked: false };
    }

    if (options.status) {
      this.db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(options.status, userId);
    }
    if (options.role) {
      this.db.prepare(`UPDATE users SET account_type = ? WHERE id = ?`).run(options.role, userId);
    }

    const isRoleDemotion =
      Boolean(options.role) &&
      options.role !== user.account_type &&
      Boolean(user.account_type && user.account_type !== "user");
    const shouldRevoke =
      Boolean(options.revokeSessions) ||
      options.status === "suspended" ||
      options.status === "frozen" ||
      isRoleDemotion;
    if (shouldRevoke) {
      this.db.prepare(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`).run(userId);
    }

    let purgedPostCount = 0;
    if (options.purgePosts) {
      const userPostIds = this.db.prepare(`SELECT id FROM posts WHERE author_id = ?`).all(userId) as {
        id: number;
      }[];
      for (const p of userPostIds) {
        if (this.facade.deletePost(p.id).success) {
          purgedPostCount++;
        }
      }
    }

    return {
      success: true,
      purgedPostCount,
      sessionsRevoked: shouldRevoke,
    };
  }

  adjustUserCreditsForAdmin(
    userId: number,
    deltaCredits: number,
    reason: string,
  ): {
    success: boolean;
    userId: number;
    previousBalance: number;
    newBalance: number;
  } {
    return this.facade.billing.adjustUserCreditsForAdmin(userId, deltaCredits, reason);
  }

  static #hashAuditIpToken(ipAddress?: string | null): string {
    if (!ipAddress) return "";
    if (ipAddress.startsWith("REDACTED:")) {
      return ipAddress.slice("REDACTED:".length);
    }
    return crypto.createHash("sha256").update(`msx-audit-ip-v1:${ipAddress}`).digest("hex").slice(0, 16);
  }

  logAudit(data: {
    actorId?: number | null | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | null | undefined;
    ipAddress?: string | null | undefined;
    details?: Record<string, unknown> | string | undefined;
  }): void {
    const detailsStr = typeof data.details === "object" ? JSON.stringify(data.details) : (data.details ?? null);
    const auditTarget = this.facade.auditDb ?? this.db;
    try {
      const insertAuditTx = auditTarget.transaction(() => {
        const prevRow = auditTarget
          .prepare(`SELECT entry_hash FROM audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1`)
          .get() as { entry_hash: string } | undefined;
        const prevHash = prevRow?.entry_hash || "GENESIS";
        const ipToken = InstanceAdminRepository.#hashAuditIpToken(data.ipAddress);
        const actorIdStr =
          typeof data.actorId === "number" && Number.isFinite(data.actorId) ? String(data.actorId) : "";
        const rawResourceId = data.resourceId ? String(data.resourceId) : "";
        const resourceIdStr = rawResourceId.replace(/[^a-zA-Z0-9_.-]/g, "");
        const canonicalPayload = [
          prevHash,
          actorIdStr,
          data.action,
          data.resourceType,
          resourceIdStr,
          ipToken,
          detailsStr ?? "",
        ].join("|");
        const auditSecret = process.env["AUDIT_HMAC_SECRET"]?.trim() || "msx-audit-chain-v1";
        const entryHash = crypto.createHmac("sha256", auditSecret).update(canonicalPayload).digest("hex");

        auditTarget
          .prepare(
            `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.actorId ?? null,
            data.action,
            data.resourceType,
            data.resourceId ?? null,
            data.ipAddress ?? null,
            detailsStr,
            prevHash,
            entryHash,
          );

        if (
          this.#auditChainCache &&
          this.#auditChainCache.valid &&
          this.#auditChainCache.secretUsed === auditSecret &&
          (this.#auditChainCache.headHash ?? "GENESIS") === prevHash
        ) {
          this.#auditChainCache = {
            valid: true,
            totalEntries: this.#auditChainCache.totalEntries + 1,
            verifiedEntries: this.#auditChainCache.verifiedEntries + 1,
            headHash: entryHash,
            secretUsed: auditSecret,
          };
        } else {
          this.#auditChainCache = null;
        }
      });
      insertAuditTx.immediate();
    } catch (e) {
      this.#auditChainCache = null;
      console.error("[AuditLog] Failed to insert audit log entry:", e);
    }
  }

  verifyAuditLogChain(): {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    headHash: string | null;
    brokenAtId?: number | undefined;
  } {
    const auditSecret = process.env["AUDIT_HMAC_SECRET"]?.trim() || "msx-audit-chain-v1";
    if (this.#auditChainCache && this.#auditChainCache.secretUsed === auditSecret) {
      const { secretUsed: _s, ...cached } = this.#auditChainCache;
      return { ...cached };
    }

    const auditTarget = this.facade.auditDb ?? this.db;
    const rows = auditTarget
      .prepare(
        `SELECT id, actor_id, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash
         FROM audit_logs
         ORDER BY id ASC`,
      )
      .all() as AuditLogRow[];

    let verifiedEntries = 0;
    let expectedPrevHash: string | null = null;
    let headHash: string | null = null;
    const hasCustomSecret = auditSecret !== "msx-audit-chain-v1";
    let seenCustomSecretEntry = false;

    for (const row of rows) {
      if (!row.entry_hash) {
        continue;
      }
      const prevHash: string = expectedPrevHash ?? row.prev_hash ?? "GENESIS";
      if (expectedPrevHash !== null && row.prev_hash !== expectedPrevHash) {
        const brokenResult = {
          valid: false,
          totalEntries: rows.length,
          verifiedEntries,
          headHash,
          brokenAtId: row.id,
        };
        this.#auditChainCache = { ...brokenResult, secretUsed: auditSecret };
        return { ...brokenResult };
      }
      const ipToken = InstanceAdminRepository.#hashAuditIpToken(row.ip_address);
      const rawResourceId = row.resource_id ? String(row.resource_id) : "";
      const sanitizedResourceId = rawResourceId.replace(/[^a-zA-Z0-9_.-]/g, "");

      const candidatePayloads = [
        [
          prevHash,
          String(row.actor_id ?? ""),
          row.action,
          row.resource_type,
          sanitizedResourceId,
          ipToken,
          row.details ?? "",
        ].join("|"),
        [
          prevHash,
          String(row.actor_id ?? ""),
          row.action,
          row.resource_type,
          rawResourceId,
          ipToken,
          row.details ?? "",
        ].join("|"),
      ];

      let matchedCustomSecret = false;
      const matchesHash = candidatePayloads.some((payload) => {
        const hmac = crypto.createHmac("sha256", auditSecret).update(payload).digest("hex");
        if (hmac === row.entry_hash) {
          if (hasCustomSecret) matchedCustomSecret = true;
          return true;
        }
        if (!seenCustomSecretEntry) {
          if (hasCustomSecret) {
            const defaultHmac = crypto.createHmac("sha256", "msx-audit-chain-v1").update(payload).digest("hex");
            if (defaultHmac === row.entry_hash) return true;
          }
          const sha = crypto.createHash("sha256").update(payload).digest("hex");
          return sha === row.entry_hash;
        }
        return false;
      });
      if (matchedCustomSecret) {
        seenCustomSecretEntry = true;
      }

      const legacyPayload: string = [
        prevHash,
        String(row.actor_id ?? ""),
        row.action,
        row.resource_type,
        rawResourceId,
        String(row.ip_address ?? ""),
        row.details ?? "",
      ].join("|");
      const matchesLegacy =
        !seenCustomSecretEntry && crypto.createHash("sha256").update(legacyPayload).digest("hex") === row.entry_hash;

      if (!matchesHash && !matchesLegacy) {
        const brokenResult = {
          valid: false,
          totalEntries: rows.length,
          verifiedEntries,
          headHash,
          brokenAtId: row.id,
        };
        this.#auditChainCache = { ...brokenResult, secretUsed: auditSecret };
        return { ...brokenResult };
      }
      verifiedEntries++;
      expectedPrevHash = row.entry_hash;
      headHash = row.entry_hash;
    }

    const validResult = {
      valid: true,
      totalEntries: rows.length,
      verifiedEntries,
      headHash,
    };
    this.#auditChainCache = { ...validResult, secretUsed: auditSecret };
    return { ...validResult };
  }

  getAuditLogs(limit: number = 50, offset: number = 0, action?: string, resourceType?: string): AuditLogRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (action && action.trim()) {
      clauses.push(`(a.action = ? OR LOWER(a.action) LIKE ?)`);
      params.push(action.trim(), `%${action.trim().toLowerCase()}%`);
    }
    if (resourceType && resourceType.trim() && resourceType !== "all") {
      clauses.push(`a.resource_type = ?`);
      params.push(resourceType.trim());
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    if (!this.facade.auditDb) {
      return this.db
        .prepare(
          `SELECT a.*, u.username as actor_username
           FROM audit_logs a
           LEFT JOIN users u ON a.actor_id = u.id
           ${whereSql}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as AuditLogRow[];
    }

    const rows = this.facade.auditDb
      .prepare(
        `SELECT a.*
         FROM audit_logs a
         ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AuditLogRow[];

    const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((id): id is number => id !== null)));
    if (actorIds.length > 0) {
      const placeholders = actorIds.map(() => "?").join(", ");
      const users = this.db
        .prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
        .all(...actorIds) as { id: number; username: string }[];
      const usernameById = new Map(users.map((u) => [u.id, u.username]));
      for (const row of rows) {
        row.actor_username = row.actor_id !== null ? (usernameById.get(row.actor_id) ?? null) : null;
      }
    }
    return rows;
  }

  /**
   * GDPR / Security Compliance: Redacts raw IP addresses on audit log entries
   * older than the specified retention window (default: 30 days) while preserving
   * the cryptographic SHA-256 hash chain (`REDACTED:<ipToken>`).
   */
  purgeExpiredLogs(retentionDays: number = 30): { deletedCount: number; redactedCount: number } {
    const cutoffMs = retentionDays <= 0 ? Date.now() + 60_000 : Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs).toISOString().replace("T", " ").slice(0, 19);
    const auditTarget = this.facade.auditDb ?? this.db;
    const expiredRows = auditTarget
      .prepare(
        `SELECT id, ip_address FROM audit_logs
         WHERE created_at <= ? AND ip_address IS NOT NULL AND ip_address != '' AND ip_address NOT LIKE 'REDACTED:%'`,
      )
      .all(cutoffDate) as { id: number; ip_address: string }[];

    let redactedCount = 0;
    const updateStmt = auditTarget.prepare(`UPDATE audit_logs SET ip_address = ? WHERE id = ?`);
    const tx = auditTarget.transaction(() => {
      for (const row of expiredRows) {
        const token = InstanceAdminRepository.#hashAuditIpToken(row.ip_address);
        updateStmt.run(`REDACTED:${token}`, row.id);
        redactedCount++;
      }
    });
    tx();
    this.#auditChainCache = null;
    return { deletedCount: redactedCount, redactedCount };
  }

  getAuditLogsCount(action?: string, resourceType?: string): number {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (action && action.trim()) {
      clauses.push(`(a.action = ? OR LOWER(a.action) LIKE ?)`);
      params.push(action.trim(), `%${action.trim().toLowerCase()}%`);
    }
    if (resourceType && resourceType.trim() && resourceType !== "all") {
      clauses.push(`a.resource_type = ?`);
      params.push(resourceType.trim());
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const auditTarget = this.facade.auditDb ?? this.db;
    const row = auditTarget.prepare(`SELECT COUNT(*) as c FROM audit_logs a ${whereSql}`).get(...params) as
      { c: number } | undefined;
    return row?.c ?? 0;
  }

  // ── Instance Settings, Invites & System Diagnostics ──────────────

  #getInstanceSettingsMap(): Map<string, string> {
    if (this.#instanceSettingsMapCache) {
      return this.#instanceSettingsMapCache;
    }
    const rows = this.db.prepare(`SELECT key, value FROM instance_settings`).all() as { key: string; value: string }[];
    const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
    this.#instanceSettingsMapCache = map;
    return map;
  }

  getInstanceSettings(): {
    instanceName: string;
    instanceBadge: string;
    instanceTagline: string;
    instanceDescription: string;
    contactEmail: string;
    brandLogoUrl: string;
    brandLogoDarkUrl: string;
    brandFaviconUrl: string;
    brandAccentColor: string;
    docsBaseUrl: string;
    showPoweredBy: boolean;
    registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
    allowedEmailDomains: string[];
    federationMode: "open" | "allowlist" | "disabled" | "mesh" | "consortium";
    maintenanceMode: boolean;
    maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown";
    maintenanceEta: string;
    maintenanceStartedAt: string;
    announcementBanner: string;
    announcementLevel: "info" | "warning" | "critical";
    autoQuarantineReportThreshold: number;
    backupRetentionCount: number;
    autoBackupIntervalHours: number;
    autoFilterKeywords: string[];
    autoFilterAction: "cw" | "silence" | "quarantine";
    customTermsMarkdown: string;
    customPrivacyMarkdown: string;
    customCookiesMarkdown: string;
    legalPolicyMode: "append" | "override";
    legalJurisdiction: string;
    legalEffectiveDate: string;
    requireAdmin2FA: boolean;
    waitlistEnabled: boolean;
    userInvitesEnabled: boolean;
    userDefaultInviteCount: number;
    academicFastTrackEnabled: boolean;
    academicDomainPatterns: string[];
    onboardingWizardEnabled: boolean;
    ingressMode: "direct" | "cloudflare";
    cloudflareTunnelConfigured: boolean;
    cloudflareTunnelTokenMasked: string;
    authorizedFetchEnabled: boolean;
    federatedTimelinePublic: boolean;
    domainBlocksPublic: boolean;
    trendingRequiresApproval: boolean;
    remoteContentRetentionDays: number;
    remoteMediaCacheRetentionDays: number;
    autoCircuitBreakThreshold: number;
    artifactCdnHost: string;
    githubClientId: string;
    githubClientSecretConfigured: boolean;
    githubClientSecretMasked: string;
    gitlabClientId: string;
    gitlabClientSecretConfigured: boolean;
    gitlabClientSecretMasked: string;
    gitlabUrl: string;
    lockedByEnv: string[];
  } {
    const map = this.#getInstanceSettingsMap();

    const lockedByEnv: string[] = [];
    if (process.env["MSX_INSTANCE_NAME"]) lockedByEnv.push("instanceName");
    if (process.env["MSX_INSTANCE_BADGE"] !== undefined) lockedByEnv.push("instanceBadge");
    if (process.env["MSX_INSTANCE_TAGLINE"]) lockedByEnv.push("instanceTagline");
    if (process.env["MSX_BRAND_LOGO_URL"]) lockedByEnv.push("brandLogoUrl");
    if (process.env["MSX_BRAND_LOGO_DARK_URL"]) lockedByEnv.push("brandLogoDarkUrl");
    if (process.env["MSX_BRAND_FAVICON_URL"]) lockedByEnv.push("brandFaviconUrl");
    if (process.env["MSX_BRAND_ACCENT_COLOR"]) lockedByEnv.push("brandAccentColor");
    if (process.env["MSX_DOCS_BASE_URL"]) lockedByEnv.push("docsBaseUrl");
    if (process.env["MSX_SHOW_POWERED_BY"] !== undefined) lockedByEnv.push("showPoweredBy");
    if (process.env["MSX_REGISTRATION_MODE"]) lockedByEnv.push("registrationMode");
    if (process.env["MSX_ALLOWED_EMAIL_DOMAINS"] || process.env["ALLOWED_EMAIL_DOMAINS"]) {
      lockedByEnv.push("allowedEmailDomains");
    }
    if (
      process.env["MSX_FEDERATION_MODE"] ||
      process.env["FEDERATION_MODE"] ||
      process.env["AIRGAP_ENFORCED"] === "true" ||
      process.env["ENTERPRISE_APPLIANCE"] === "true"
    ) {
      lockedByEnv.push("federationMode");
    }
    if (process.env["MSX_REQUIRE_ADMIN_2FA"] !== undefined) lockedByEnv.push("requireAdmin2FA");
    if (process.env["MSX_WAITLIST_ENABLED"] !== undefined) lockedByEnv.push("waitlistEnabled");
    if (process.env["MSX_USER_INVITES_ENABLED"] !== undefined) lockedByEnv.push("userInvitesEnabled");
    if (process.env["MSX_USER_DEFAULT_INVITES"] !== undefined) lockedByEnv.push("userDefaultInviteCount");
    if (process.env["MSX_ACADEMIC_FAST_TRACK"] !== undefined) lockedByEnv.push("academicFastTrackEnabled");
    if (process.env["MSX_ONBOARDING_WIZARD_ENABLED"] !== undefined) lockedByEnv.push("onboardingWizardEnabled");
    if (process.env["MSX_INGRESS_MODE"]) lockedByEnv.push("ingressMode");
    if (process.env["MSX_MAINTENANCE_MODE"] !== undefined) {
      lockedByEnv.push("maintenanceMode", "maintenanceLevel");
    }
    if (process.env["MSX_AUTHORIZED_FETCH"] !== undefined || process.env["AUTHORIZED_FETCH"] !== undefined) {
      lockedByEnv.push("authorizedFetchEnabled");
    }
    if (process.env["GITHUB_CLIENT_ID"] || process.env["OAUTH_GITHUB_CLIENT_ID"]) lockedByEnv.push("githubClientId");
    if (process.env["GITHUB_CLIENT_SECRET"] || process.env["OAUTH_GITHUB_CLIENT_SECRET"]) {
      lockedByEnv.push("githubClientSecret");
    }
    if (process.env["GITLAB_CLIENT_ID"] || process.env["OAUTH_GITLAB_CLIENT_ID"]) lockedByEnv.push("gitlabClientId");
    if (process.env["GITLAB_CLIENT_SECRET"] || process.env["OAUTH_GITLAB_CLIENT_SECRET"]) {
      lockedByEnv.push("gitlabClientSecret");
    }
    if (process.env["GITLAB_URL"]) lockedByEnv.push("gitlabUrl");

    const storedTunnelToken = (map.get("cloudflare_tunnel_token") || map.get("tunnelToken") || "").trim();
    const envTunnelToken = (process.env["CLOUDFLARE_TUNNEL_TOKEN"] || "").trim();
    const cloudflareTunnelConfigured = Boolean(envTunnelToken || storedTunnelToken);
    const rawIngressMode = (
      process.env["MSX_INGRESS_MODE"] ||
      map.get("ingress_mode") ||
      map.get("ingressMode") ||
      (cloudflareTunnelConfigured ? "cloudflare" : "direct")
    )
      .trim()
      .toLowerCase();
    const ingressMode: "direct" | "cloudflare" = rawIngressMode === "cloudflare" ? "cloudflare" : "direct";

    const rawRegMode = process.env["MSX_REGISTRATION_MODE"] || map.get("registrationMode") || "open";
    const registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed" =
      rawRegMode === "invite_only" || rawRegMode === "domain_allowlist" || rawRegMode === "closed"
        ? rawRegMode
        : "open";

    const isAirgapDefault = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";
    const rawFedMode =
      process.env["MSX_FEDERATION_MODE"] ||
      process.env["FEDERATION_MODE"] ||
      map.get("federationMode") ||
      (isAirgapDefault ? "disabled" : "open");
    const federationMode: "open" | "allowlist" | "disabled" | "mesh" | "consortium" =
      rawFedMode === "allowlist" || rawFedMode === "disabled" || rawFedMode === "mesh" || rawFedMode === "consortium"
        ? rawFedMode
        : "open";

    let allowedEmailDomains: string[] = [];
    try {
      const rawDomains =
        process.env["MSX_ALLOWED_EMAIL_DOMAINS"] ||
        process.env["ALLOWED_EMAIL_DOMAINS"] ||
        map.get("allowedEmailDomains") ||
        "[]";
      if (rawDomains.trim().startsWith("[")) {
        const parsed = JSON.parse(rawDomains);
        if (Array.isArray(parsed)) {
          allowedEmailDomains = parsed.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
        }
      } else {
        allowedEmailDomains = rawDomains
          .split(/[,\s]+/)
          .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean);
      }
    } catch {
      allowedEmailDomains = [];
    }

    let autoFilterKeywords: string[] = [];
    try {
      const rawKeywords = map.get("autoFilterKeywords") || "[]";
      if (rawKeywords.trim().startsWith("[")) {
        const parsed = JSON.parse(rawKeywords);
        if (Array.isArray(parsed)) {
          autoFilterKeywords = parsed.map((k) => String(k).trim()).filter(Boolean);
        }
      } else {
        autoFilterKeywords = rawKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
      }
    } catch {
      autoFilterKeywords = [];
    }

    const rawFilterAction = map.get("autoFilterAction") || "cw";
    const autoFilterAction: "cw" | "silence" | "quarantine" =
      rawFilterAction === "silence" || rawFilterAction === "quarantine" ? rawFilterAction : "cw";

    const rawLevel = map.get("announcementLevel") || "info";
    const announcementLevel: "info" | "warning" | "critical" =
      rawLevel === "warning" || rawLevel === "critical" ? rawLevel : "info";

    const rawAutoBackup = map.get("autoBackupIntervalHours");
    const parsedAutoBackup = rawAutoBackup !== undefined ? Number.parseInt(rawAutoBackup, 10) : 24;

    const airgapDefaultDocs =
      process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true"
        ? "/docs"
        : "https://modelscript.org";

    const showPoweredBy =
      process.env["MSX_SHOW_POWERED_BY"] !== undefined
        ? process.env["MSX_SHOW_POWERED_BY"] !== "false"
        : map.has("showPoweredBy")
          ? map.get("showPoweredBy") !== "false"
          : true;

    const envMaint = process.env["MSX_MAINTENANCE_MODE"]?.trim().toLowerCase();
    const dbMaintBool = map.get("maintenanceMode") === "true";
    const dbMaintLevel = map.get("maintenanceLevel") || (dbMaintBool ? "read_only" : "off");

    let maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown" = "off";
    if (envMaint !== undefined && envMaint !== "") {
      if (envMaint === "lockdown" || envMaint === "hard") {
        maintenanceLevel = "lockdown";
      } else if (envMaint === "scheduled") {
        maintenanceLevel = "scheduled";
      } else if (envMaint === "true" || envMaint === "1" || envMaint === "read_only" || envMaint === "readonly") {
        maintenanceLevel = "read_only";
      } else {
        maintenanceLevel = "off";
      }
    } else if (dbMaintLevel === "scheduled" || dbMaintLevel === "read_only" || dbMaintLevel === "lockdown") {
      maintenanceLevel = dbMaintLevel;
    } else if (dbMaintBool) {
      maintenanceLevel = "read_only";
    }

    const maintenanceMode = maintenanceLevel === "read_only" || maintenanceLevel === "lockdown";

    const waitlistEnabled =
      process.env["MSX_WAITLIST_ENABLED"] !== undefined
        ? process.env["MSX_WAITLIST_ENABLED"] === "true"
        : map.get("waitlistEnabled") === "true";

    const userInvitesEnabled =
      process.env["MSX_USER_INVITES_ENABLED"] !== undefined
        ? process.env["MSX_USER_INVITES_ENABLED"] === "true"
        : map.get("userInvitesEnabled") === "true";

    const userDefaultInviteCount = Math.max(
      0,
      Number.parseInt(process.env["MSX_USER_DEFAULT_INVITES"] || map.get("userDefaultInviteCount") || "5", 10) || 5,
    );

    const academicFastTrackEnabled =
      process.env["MSX_ACADEMIC_FAST_TRACK"] !== undefined
        ? process.env["MSX_ACADEMIC_FAST_TRACK"] === "true"
        : map.get("academicFastTrackEnabled") === "true";

    let academicDomainPatterns: string[] = ["edu", "ac.uk", "dlr.de", "nasa.gov", "cern.ch"];
    try {
      const rawAcademic = map.get("academicDomainPatterns");
      if (rawAcademic) {
        if (rawAcademic.trim().startsWith("[")) {
          const parsed = JSON.parse(rawAcademic);
          if (Array.isArray(parsed)) {
            academicDomainPatterns = parsed.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
          }
        } else {
          academicDomainPatterns = rawAcademic
            .split(/[,\s]+/)
            .map((p) => p.trim().toLowerCase().replace(/^@/, ""))
            .filter(Boolean);
        }
      }
    } catch {
      // Keep default
    }

    const onboardingWizardEnabled =
      process.env["MSX_ONBOARDING_WIZARD_ENABLED"] !== undefined
        ? process.env["MSX_ONBOARDING_WIZARD_ENABLED"] === "true"
        : map.get("onboardingWizardEnabled") === "true";

    const rawAuthFetch =
      process.env["MSX_AUTHORIZED_FETCH"] ?? process.env["AUTHORIZED_FETCH"] ?? map.get("authorizedFetchEnabled");
    const authorizedFetchEnabled = rawAuthFetch === "true" || rawAuthFetch === "1";

    const rawFedTimelinePublic = process.env["MSX_FEDERATED_TIMELINE_PUBLIC"] ?? map.get("federatedTimelinePublic");
    const federatedTimelinePublic = rawFedTimelinePublic !== undefined ? rawFedTimelinePublic !== "false" : true;

    const rawDomainBlocksPublic = process.env["MSX_DOMAIN_BLOCKS_PUBLIC"] ?? map.get("domainBlocksPublic");
    const domainBlocksPublic = rawDomainBlocksPublic !== undefined ? rawDomainBlocksPublic !== "false" : true;

    const rawTrendingApproval = process.env["MSX_TRENDING_REQUIRES_APPROVAL"] ?? map.get("trendingRequiresApproval");
    const trendingRequiresApproval = rawTrendingApproval === "true" || rawTrendingApproval === "1";

    const remoteContentRetentionDays = Math.max(
      0,
      Number.parseInt(map.get("remoteContentRetentionDays") || "90", 10) || 90,
    );
    const remoteMediaCacheRetentionDays = Math.max(
      0,
      Number.parseInt(map.get("remoteMediaCacheRetentionDays") || "14", 10) || 14,
    );
    const autoCircuitBreakThreshold = Math.max(
      0,
      Number.parseInt(map.get("autoCircuitBreakThreshold") || "5", 10) || 5,
    );
    const artifactCdnHost = (process.env["MSX_ARTIFACT_CDN_HOST"] || map.get("artifactCdnHost") || "").trim();

    const githubClientId = (
      process.env["GITHUB_CLIENT_ID"] ||
      process.env["OAUTH_GITHUB_CLIENT_ID"] ||
      map.get("githubClientId") ||
      ""
    ).trim();
    const githubClientSecretRaw =
      process.env["GITHUB_CLIENT_SECRET"] ||
      process.env["OAUTH_GITHUB_CLIENT_SECRET"] ||
      decryptSecretAtRest(map.get("githubClientSecretEncrypted") || "") ||
      "";
    const gitlabClientId = (
      process.env["GITLAB_CLIENT_ID"] ||
      process.env["OAUTH_GITLAB_CLIENT_ID"] ||
      map.get("gitlabClientId") ||
      ""
    ).trim();
    const gitlabClientSecretRaw =
      process.env["GITLAB_CLIENT_SECRET"] ||
      process.env["OAUTH_GITLAB_CLIENT_SECRET"] ||
      decryptSecretAtRest(map.get("gitlabClientSecretEncrypted") || "") ||
      "";
    const gitlabUrl = (process.env["GITLAB_URL"] || map.get("gitlabUrl") || "https://gitlab.com")
      .trim()
      .replace(/\/$/, "");

    return {
      instanceName:
        process.env["ANSATZ_INSTANCE_NAME"] || process.env["MSX_INSTANCE_NAME"] || map.get("instanceName") || "Ansatz",
      instanceBadge:
        process.env["ANSATZ_INSTANCE_BADGE"] ?? process.env["MSX_INSTANCE_BADGE"] ?? map.get("instanceBadge") ?? "",
      instanceTagline:
        process.env["ANSATZ_INSTANCE_TAGLINE"] ||
        process.env["MSX_INSTANCE_TAGLINE"] ||
        map.get("instanceTagline") ||
        "The Federated Scientific & Engineering Network",
      instanceDescription:
        map.get("instanceDescription") ||
        "Federated polyglot engineering simulation, Modelica, SysML v2, and digital twin platform.",
      contactEmail:
        process.env["ANSATZ_CONTACT_EMAIL"] ||
        process.env["MSX_CONTACT_EMAIL"] ||
        map.get("contactEmail") ||
        "admin@ansatz.social",
      brandLogoUrl:
        process.env["ANSATZ_BRAND_LOGO_URL"] || process.env["MSX_BRAND_LOGO_URL"] || map.get("brandLogoUrl") || "",
      brandLogoDarkUrl:
        process.env["ANSATZ_BRAND_LOGO_DARK_URL"] ||
        process.env["MSX_BRAND_LOGO_DARK_URL"] ||
        map.get("brandLogoDarkUrl") ||
        "",
      brandFaviconUrl:
        process.env["ANSATZ_BRAND_FAVICON_URL"] ||
        process.env["MSX_BRAND_FAVICON_URL"] ||
        map.get("brandFaviconUrl") ||
        "",
      brandAccentColor:
        process.env["ANSATZ_BRAND_ACCENT_COLOR"] ||
        process.env["MSX_BRAND_ACCENT_COLOR"] ||
        map.get("brandAccentColor") ||
        "",
      docsBaseUrl: process.env["MSX_DOCS_BASE_URL"] || map.get("docsBaseUrl") || airgapDefaultDocs,
      showPoweredBy,
      registrationMode,
      allowedEmailDomains,
      federationMode,
      maintenanceMode,
      maintenanceLevel,
      maintenanceEta: process.env["MSX_MAINTENANCE_ETA"] || map.get("maintenanceEta") || "",
      maintenanceStartedAt: map.get("maintenanceStartedAt") || "",
      announcementBanner: map.get("announcementBanner") || "",
      announcementLevel,
      autoQuarantineReportThreshold: Math.max(
        0,
        Number.parseInt(map.get("autoQuarantineReportThreshold") || "5", 10) || 5,
      ),
      backupRetentionCount: Math.max(1, Number.parseInt(map.get("backupRetentionCount") || "7", 10) || 7),
      autoBackupIntervalHours: Number.isNaN(parsedAutoBackup) ? 24 : Math.max(0, parsedAutoBackup),
      autoFilterKeywords,
      autoFilterAction,
      customTermsMarkdown: map.get("customTermsMarkdown") || "",
      customPrivacyMarkdown: map.get("customPrivacyMarkdown") || "",
      customCookiesMarkdown: map.get("customCookiesMarkdown") || "",
      legalPolicyMode: map.get("legalPolicyMode") === "override" ? "override" : "append",
      legalJurisdiction: map.get("legalJurisdiction") || "",
      legalEffectiveDate: map.get("legalEffectiveDate") || "",
      requireAdmin2FA:
        process.env["MSX_REQUIRE_ADMIN_2FA"] !== undefined
          ? process.env["MSX_REQUIRE_ADMIN_2FA"] === "true"
          : map.get("requireAdmin2FA") === "true",
      waitlistEnabled,
      userInvitesEnabled,
      userDefaultInviteCount,
      academicFastTrackEnabled,
      academicDomainPatterns,
      onboardingWizardEnabled,
      ingressMode,
      cloudflareTunnelConfigured,
      cloudflareTunnelTokenMasked: maskSecretPreview(envTunnelToken || storedTunnelToken),
      authorizedFetchEnabled,
      federatedTimelinePublic,
      domainBlocksPublic,
      trendingRequiresApproval,
      remoteContentRetentionDays,
      remoteMediaCacheRetentionDays,
      autoCircuitBreakThreshold,
      artifactCdnHost,
      githubClientId,
      githubClientSecretConfigured: Boolean(githubClientSecretRaw),
      githubClientSecretMasked: maskSecretPreview(githubClientSecretRaw),
      gitlabClientId,
      gitlabClientSecretConfigured: Boolean(gitlabClientSecretRaw),
      gitlabClientSecretMasked: maskSecretPreview(gitlabClientSecretRaw),
      gitlabUrl,
      lockedByEnv,
    };
  }

  getOAuthCredentials(provider: string): {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  } {
    const rows = this.db
      .prepare(
        `SELECT key, value FROM instance_settings WHERE key IN ('githubClientId', 'githubClientSecretEncrypted', 'gitlabClientId', 'gitlabClientSecretEncrypted', 'gitlabUrl')`,
      )
      .all() as { key: string; value: string }[];
    const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
    const normalized = provider.trim().toLowerCase();

    if (normalized === "github") {
      return {
        clientId: (
          process.env["GITHUB_CLIENT_ID"] ||
          process.env["OAUTH_GITHUB_CLIENT_ID"] ||
          map.get("githubClientId") ||
          ""
        ).trim(),
        clientSecret: (
          process.env["GITHUB_CLIENT_SECRET"] ||
          process.env["OAUTH_GITHUB_CLIENT_SECRET"] ||
          decryptSecretAtRest(map.get("githubClientSecretEncrypted") || "") ||
          ""
        ).trim(),
        baseUrl: "https://github.com",
      };
    }

    if (normalized === "gitlab") {
      return {
        clientId: (
          process.env["GITLAB_CLIENT_ID"] ||
          process.env["OAUTH_GITLAB_CLIENT_ID"] ||
          map.get("gitlabClientId") ||
          ""
        ).trim(),
        clientSecret: (
          process.env["GITLAB_CLIENT_SECRET"] ||
          process.env["OAUTH_GITLAB_CLIENT_SECRET"] ||
          decryptSecretAtRest(map.get("gitlabClientSecretEncrypted") || "") ||
          ""
        ).trim(),
        baseUrl: (process.env["GITLAB_URL"] || map.get("gitlabUrl") || "https://gitlab.com").trim().replace(/\/$/, ""),
      };
    }

    const envPrefix = normalized.toUpperCase();
    return {
      clientId: (process.env[`${envPrefix}_CLIENT_ID`] || "").trim(),
      clientSecret: (process.env[`${envPrefix}_CLIENT_SECRET`] || "").trim(),
      baseUrl: "",
    };
  }

  getMaintenanceState(): {
    mode: "off" | "scheduled" | "read_only" | "lockdown";
    active: boolean;
    eta: string;
    startedAt: string;
    banner: string;
  } {
    const settings = this.getInstanceSettings();
    return {
      mode: settings.maintenanceLevel,
      active: settings.maintenanceMode,
      eta: settings.maintenanceEta,
      startedAt: settings.maintenanceStartedAt,
      banner: settings.announcementBanner,
    };
  }

  resolveValidActorId(actorId: number | null = null): number | null {
    return this.#resolveValidActorId(actorId);
  }

  #resolveValidActorId(actorId: number | null = null): number | null {
    if (typeof actorId !== "number" || !Number.isInteger(actorId) || actorId <= 0) {
      return null;
    }
    const user = this.db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(actorId);
    return user ? actorId : null;
  }

  updateInstanceSettings(
    patch: Record<string, unknown>,
    actorId: number | null = null,
  ): ReturnType<InstanceAdminRepository["getInstanceSettings"]> {
    const normalizedPatch: Record<string, unknown> = { ...patch };

    const rawIngressPatch = normalizedPatch["ingressMode"] ?? normalizedPatch["ingress_mode"];
    if (rawIngressPatch !== undefined) {
      const modeVal = String(rawIngressPatch).trim().toLowerCase() === "cloudflare" ? "cloudflare" : "direct";
      normalizedPatch["ingressMode"] = modeVal;
      normalizedPatch["ingress_mode"] = modeVal;
    }

    const rawTunnelTokenPatch =
      normalizedPatch["tunnelToken"] ??
      normalizedPatch["cloudflareTunnelToken"] ??
      normalizedPatch["cloudflare_tunnel_token"];
    if (rawTunnelTokenPatch !== undefined) {
      const tokenVal = String(rawTunnelTokenPatch).trim();
      normalizedPatch["cloudflare_tunnel_token"] = tokenVal;
      delete normalizedPatch["tunnelToken"];
      delete normalizedPatch["cloudflareTunnelToken"];
    }

    // Synchronize maintenanceMode boolean and maintenanceLevel enum seamlessly
    if (normalizedPatch["maintenanceLevel"] !== undefined) {
      const lvl = String(normalizedPatch["maintenanceLevel"]);
      if (lvl === "read_only" || lvl === "lockdown") {
        normalizedPatch["maintenanceMode"] = true;
        if (!normalizedPatch["maintenanceStartedAt"]) {
          const prev = this.getInstanceSettings();
          if (!prev.maintenanceMode) {
            normalizedPatch["maintenanceStartedAt"] = new Date().toISOString();
          }
        }
      } else {
        normalizedPatch["maintenanceMode"] = false;
        if (lvl === "off") {
          normalizedPatch["maintenanceStartedAt"] = "";
        }
      }
    } else if (normalizedPatch["maintenanceMode"] !== undefined) {
      const enabled = Boolean(normalizedPatch["maintenanceMode"]);
      const prev = this.getInstanceSettings();
      if (enabled) {
        if (prev.maintenanceLevel !== "lockdown") {
          normalizedPatch["maintenanceLevel"] = "read_only";
        }
        if (!prev.maintenanceMode && !normalizedPatch["maintenanceStartedAt"]) {
          normalizedPatch["maintenanceStartedAt"] = new Date().toISOString();
        }
      } else {
        normalizedPatch["maintenanceLevel"] = "off";
        normalizedPatch["maintenanceStartedAt"] = "";
      }
    }

    const allowedKeys = [
      "instanceName",
      "instanceBadge",
      "instanceTagline",
      "instanceDescription",
      "contactEmail",
      "brandLogoUrl",
      "brandLogoDarkUrl",
      "brandFaviconUrl",
      "brandAccentColor",
      "docsBaseUrl",
      "showPoweredBy",
      "registrationMode",
      "allowedEmailDomains",
      "federationMode",
      "maintenanceMode",
      "maintenanceLevel",
      "maintenanceEta",
      "maintenanceStartedAt",
      "announcementBanner",
      "announcementLevel",
      "autoQuarantineReportThreshold",
      "backupRetentionCount",
      "autoBackupIntervalHours",
      "autoFilterKeywords",
      "autoFilterAction",
      "customTermsMarkdown",
      "customPrivacyMarkdown",
      "customCookiesMarkdown",
      "legalPolicyMode",
      "legalJurisdiction",
      "legalEffectiveDate",
      "requireAdmin2FA",
      "waitlistEnabled",
      "userInvitesEnabled",
      "userDefaultInviteCount",
      "academicFastTrackEnabled",
      "academicDomainPatterns",
      "onboardingWizardEnabled",
      "ingressMode",
      "ingress_mode",
      "cloudflare_tunnel_token",
      "authorizedFetchEnabled",
      "federatedTimelinePublic",
      "domainBlocksPublic",
      "trendingRequiresApproval",
      "remoteContentRetentionDays",
      "remoteMediaCacheRetentionDays",
      "autoCircuitBreakThreshold",
      "artifactCdnHost",
      "githubClientId",
      "gitlabClientId",
      "gitlabUrl",
    ];
    const upsertStmt = this.db.prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    );
    const deleteStmt = this.db.prepare(`DELETE FROM instance_settings WHERE key = ?`);

    const validActorId = this.#resolveValidActorId(actorId);

    const tx = this.db.transaction(() => {
      for (const key of allowedKeys) {
        if (normalizedPatch[key] === undefined) continue;
        const val = normalizedPatch[key];
        const serialized = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
        upsertStmt.run(key, serialized, validActorId);
      }
      if (normalizedPatch["clearGithubClientSecret"] === true) {
        deleteStmt.run("githubClientSecretEncrypted");
      } else if (
        typeof normalizedPatch["githubClientSecret"] === "string" &&
        normalizedPatch["githubClientSecret"].trim().length > 0
      ) {
        upsertStmt.run(
          "githubClientSecretEncrypted",
          encryptSecretAtRest(normalizedPatch["githubClientSecret"].trim()),
          validActorId,
        );
      }
      if (normalizedPatch["clearGitlabClientSecret"] === true) {
        deleteStmt.run("gitlabClientSecretEncrypted");
      } else if (
        typeof normalizedPatch["gitlabClientSecret"] === "string" &&
        normalizedPatch["gitlabClientSecret"].trim().length > 0
      ) {
        upsertStmt.run(
          "gitlabClientSecretEncrypted",
          encryptSecretAtRest(normalizedPatch["gitlabClientSecret"].trim()),
          validActorId,
        );
      }
    });
    tx();
    this.facade.syncMailerFromDatabase();
    return this.getInstanceSettings();
  }

  getPreflightChecks(): {
    allPassed: boolean;
    warningCount: number;
    checks: {
      id: string;
      label: string;
      status: "ok" | "warning" | "error";
      detail: string;
    }[];
  } {
    const checks: {
      id: string;
      label: string;
      status: "ok" | "warning" | "error";
      detail: string;
    }[] = [];

    // 1. Data directory writable
    let dataDirWritable = false;
    try {
      fs.accessSync(this.facade.dbDir, fs.constants.W_OK);
      dataDirWritable = true;
    } catch {
      dataDirWritable = false;
    }
    checks.push({
      id: "data_dir_writable",
      label: "Data Volume Writable",
      status: dataDirWritable ? "ok" : "error",
      detail: dataDirWritable
        ? `SQLite directory '${this.facade.dbDir}' is writable.`
        : `Directory '${this.facade.dbDir}' is not writable.`,
    });

    // 2. SQLite WAL mode
    let walEnabled = false;
    try {
      const mode = String(this.db.pragma("journal_mode", { simple: true }) || "").toLowerCase();
      walEnabled = mode === "wal" || mode === "memory";
    } catch {
      walEnabled = false;
    }
    checks.push({
      id: "sqlite_wal",
      label: "SQLite WAL Journal Mode",
      status: walEnabled ? "ok" : "warning",
      detail: walEnabled
        ? "Write-Ahead Logging (WAL) is active for concurrent reads and hot backups."
        : "SQLite is not running in WAL mode.",
    });

    // 3. PUBLIC_URL configured
    const publicUrl = process.env["PUBLIC_URL"] || "";
    const isHttpsPublicUrl = publicUrl.startsWith("https://") && !publicUrl.includes("localhost");
    checks.push({
      id: "public_url",
      label: "Public Origin URL (PUBLIC_URL)",
      status: isHttpsPublicUrl ? "ok" : "warning",
      detail: isHttpsPublicUrl
        ? `Configured as '${publicUrl}'.`
        : publicUrl
          ? `Set to '${publicUrl}' (HTTPS domain recommended for ActivityPub federation).`
          : "PUBLIC_URL env var not set; defaulting to https://ansatz.social.",
    });

    // 4. JWT_SECRET hardened
    const jwtSecret = process.env["JWT_SECRET"] || "";
    const jwtHardened = jwtSecret.length >= 24 && !jwtSecret.includes("dev-secret");
    checks.push({
      id: "jwt_secret",
      label: "JWT Session Signing Secret",
      status: jwtHardened ? "ok" : "warning",
      detail: jwtHardened
        ? "Custom high-entropy JWT_SECRET is configured."
        : "Using default development JWT secret; set JWT_SECRET (>= 32 chars) in production.",
    });

    // 5. Outbound Mailer configured
    const mailerConfigured = Boolean(
      process.env["SMTP_HOST"] || process.env["SENDGRID_API_KEY"] || process.env["RESEND_API_KEY"],
    );
    checks.push({
      id: "outbound_mailer",
      label: "Outbound Transactional Mailer",
      status: mailerConfigured ? "ok" : "warning",
      detail: mailerConfigured
        ? `Live mail driver configured (${process.env["SENDGRID_API_KEY"] ? "SendGrid" : process.env["RESEND_API_KEY"] ? "Resend" : "SMTP"}).`
        : "Using console mail driver; set SMTP_HOST, SENDGRID_API_KEY, or RESEND_API_KEY for live email delivery.",
    });

    // 6. Instance Ed25519 signing keys
    let keysReady = false;
    try {
      const keys = this.facade.getInstanceKeys();
      keysReady = Boolean(keys?.publicKey && keys?.privateKey);
    } catch {
      keysReady = false;
    }
    checks.push({
      id: "instance_keys",
      label: "Instance Cryptographic Keys",
      status: keysReady ? "ok" : "error",
      detail: keysReady
        ? "Ed25519 package provenance & federation signing keys provisioned."
        : "Instance cryptographic keys could not be initialized.",
    });

    const hasError = checks.some((c) => c.status === "error");
    const warningCount = checks.filter((c) => c.status === "warning").length;
    return {
      allPassed: !hasError,
      warningCount,
      checks,
    };
  }

  exportEnvConfigSnippet(): {
    envText: string;
    envSnippet: string;
    dockerComposeSnippet: string;
    generatedAt: string;
  } {
    const s = this.getInstanceSettings();
    const rawRows = this.db
      .prepare(`SELECT key, value FROM instance_settings WHERE key IN ('cloudflare_tunnel_token', 'tunnelToken')`)
      .all() as { key: string; value: string }[];
    const storedToken =
      rawRows.find((r) => r.key === "cloudflare_tunnel_token")?.value ||
      rawRows.find((r) => r.key === "tunnelToken")?.value ||
      "";
    const tunnelTokenVal = process.env["CLOUDFLARE_TUNNEL_TOKEN"]?.trim() || storedToken.trim();
    const publicUrl = process.env["PUBLIC_URL"] || "https://ansatz.social";
    const generatedAt = new Date().toISOString();
    const escapeEnvValue = (val: string): string => val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const envLines = [
      `# ${s.instanceName} — Declarative Instance & White-Label Configuration`,
      `# Generated at ${generatedAt}`,
      `NODE_ENV=production`,
      `PUBLIC_URL=${publicUrl}`,
      `MSX_INSTANCE_NAME="${escapeEnvValue(s.instanceName)}"`,
      `MSX_INSTANCE_BADGE="${escapeEnvValue(s.instanceBadge)}"`,
      `MSX_INSTANCE_TAGLINE="${escapeEnvValue(s.instanceTagline)}"`,
      `MSX_CONTACT_EMAIL="${escapeEnvValue(s.contactEmail)}"`,
      `MSX_BRAND_LOGO_URL="${escapeEnvValue(s.brandLogoUrl)}"`,
      `MSX_BRAND_LOGO_DARK_URL="${escapeEnvValue(s.brandLogoDarkUrl)}"`,
      `MSX_BRAND_FAVICON_URL="${escapeEnvValue(s.brandFaviconUrl)}"`,
      `MSX_BRAND_ACCENT_COLOR="${escapeEnvValue(s.brandAccentColor)}"`,
      `MSX_DOCS_BASE_URL="${escapeEnvValue(s.docsBaseUrl)}"`,
      `MSX_SHOW_POWERED_BY=${s.showPoweredBy ? "true" : "false"}`,
      `MSX_REGISTRATION_MODE=${s.registrationMode}`,
      `MODELSCRIPT_REGISTRATION_MODE=${s.registrationMode}`,
      `MSX_FEDERATION_MODE=${s.federationMode}`,
      `MSX_INGRESS_MODE=${s.ingressMode}`,
      `CLOUDFLARE_TUNNEL_TOKEN=${tunnelTokenVal ? "<REDACTED_CLOUDFLARE_TUNNEL_TOKEN>" : ""}`,
      `JWT_SECRET=${process.env["JWT_SECRET"] ? "<REDACTED_CUSTOM_JWT_SECRET>" : crypto.randomBytes(32).toString("hex")}`,
      `SMTP_HOST=${process.env["SMTP_HOST"] || "smtp.example.org"}`,
      `SMTP_PORT=${process.env["SMTP_PORT"] || "587"}`,
      `EMAIL_FROM="${escapeEnvValue(s.instanceName)} <${s.contactEmail}>"`,
      `GITHUB_CLIENT_ID="${escapeEnvValue(s.githubClientId)}"`,
      `GITHUB_CLIENT_SECRET=${s.githubClientSecretConfigured ? "<REDACTED_GITHUB_CLIENT_SECRET>" : ""}`,
      `GITLAB_CLIENT_ID="${escapeEnvValue(s.gitlabClientId)}"`,
      `GITLAB_CLIENT_SECRET=${s.gitlabClientSecretConfigured ? "<REDACTED_GITLAB_CLIENT_SECRET>" : ""}`,
      `GITLAB_URL="${escapeEnvValue(s.gitlabUrl)}"`,
    ];

    const dockerComposeLines = [
      `services:`,
      `  ansatz-node:`,
      `    image: ghcr.io/modelscript/api-ce:latest`,
      `    restart: unless-stopped`,
      `    ports:`,
      `      - "3000:3000"`,
      `    volumes:`,
      `      - ./data:/app/apps/api/data`,
      `    environment:`,
      `      NODE_ENV: "production"`,
      `      PUBLIC_URL: "${publicUrl}"`,
      `      MSX_INSTANCE_NAME: "${escapeEnvValue(s.instanceName)}"`,
      `      MSX_INSTANCE_BADGE: "${escapeEnvValue(s.instanceBadge)}"`,
      `      MSX_INSTANCE_TAGLINE: "${escapeEnvValue(s.instanceTagline)}"`,
      `      MSX_CONTACT_EMAIL: "${escapeEnvValue(s.contactEmail)}"`,
      `      MSX_DOCS_BASE_URL: "${escapeEnvValue(s.docsBaseUrl)}"`,
      `      MSX_SHOW_POWERED_BY: "${s.showPoweredBy ? "true" : "false"}"`,
      `      MSX_REGISTRATION_MODE: "${s.registrationMode}"`,
      `      MSX_FEDERATION_MODE: "${s.federationMode}"`,
      `      MSX_INGRESS_MODE: "${s.ingressMode}"`,
    ];
    if (tunnelTokenVal) {
      dockerComposeLines.push(`      CLOUDFLARE_TUNNEL_TOKEN: "<REDACTED_CLOUDFLARE_TUNNEL_TOKEN>"`);
    }
    if (s.githubClientId) {
      dockerComposeLines.push(`      GITHUB_CLIENT_ID: "${escapeEnvValue(s.githubClientId)}"`);
    }
    if (s.gitlabClientId) {
      dockerComposeLines.push(`      GITLAB_CLIENT_ID: "${escapeEnvValue(s.gitlabClientId)}"`);
      dockerComposeLines.push(`      GITLAB_URL: "${escapeEnvValue(s.gitlabUrl)}"`);
    }

    const envStr = envLines.join("\n");
    return {
      envText: envStr,
      envSnippet: envStr,
      dockerComposeSnippet: dockerComposeLines.join("\n"),
      generatedAt,
    };
  }

  isSetupCompleted(): boolean {
    const row = this.db.prepare(`SELECT value FROM instance_settings WHERE key = 'setupCompleted'`).get() as
      { value: string } | undefined;
    return row?.value === "true";
  }

  isSetupForceReopened(): boolean {
    const row = this.db.prepare(`SELECT value FROM instance_settings WHERE key = 'setupCompleted'`).get() as
      { value: string } | undefined;
    return row?.value === "reopen";
  }

  resetSetupWizard(actorId: number | null = null): void {
    const validActorId = this.#resolveValidActorId(actorId);
    this.db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by, updated_at)
         VALUES ('setupCompleted', 'reopen', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = 'reopen',
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`,
      )
      .run(validActorId);
  }

  markSetupCompleted(actorId: number | null = null): void {
    const validActorId = this.#resolveValidActorId(actorId);
    this.db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by, updated_at)
         VALUES ('setupCompleted', 'true', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = 'true',
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`,
      )
      .run(validActorId);
  }

  isInstanceInitialized(): boolean {
    if (this.isSetupForceReopened()) return false;
    return this.facade.hasAdminUser() || this.isSetupCompleted();
  }

  getSetupStatus(): {
    needsSetup: boolean;
    hasAdmin: boolean;
    setupCompleted: boolean;
    reopened: boolean;
    userCount: number;
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    preflight: ReturnType<LibraryDatabase["getPreflightChecks"]>;
  } {
    const hasAdmin = this.facade.hasAdminUser();
    const explicitSetupCompleted = this.isSetupCompleted();
    const reopened = this.isSetupForceReopened();
    const needsSetup = reopened || (!hasAdmin && !explicitSetupCompleted);
    return {
      needsSetup,
      hasAdmin: reopened ? false : hasAdmin,
      setupCompleted: reopened ? false : explicitSetupCompleted || hasAdmin,
      reopened,
      userCount: this.facade.getTotalUsersCount(),
      settings: this.getInstanceSettings(),
      preflight: this.getPreflightChecks(),
    };
  }

  createInstanceInvite(options?: {
    code?: string | undefined;
    createdBy?: number | null | undefined;
    maxUses?: number | undefined;
    initialCredits?: number | undefined;
    assignedRole?: string | undefined;
    note?: string | undefined;
    expiresInDays?: number | undefined;
  }): {
    id: number;
    code: string;
    createdBy: number | null;
    maxUses: number;
    usedCount: number;
    usesCount: number;
    initialCredits: number;
    assignedRole: string;
    note: string | null;
    expiresAt: string | null;
    revoked: boolean;
    createdAt: string;
  } {
    const rawCode = options?.code?.trim() || `msx-inv-${crypto.randomBytes(4).toString("hex")}`;
    const maxUses = Math.max(1, Math.min(10000, Number(options?.maxUses) || 1));
    const initialCredits = options?.initialCredits !== undefined ? Math.max(0, Number(options.initialCredits)) : 100.0;
    const assignedRole =
      options?.assignedRole && ["user", "moderator", "auditor", "admin"].includes(options.assignedRole)
        ? options.assignedRole
        : "user";
    const note = options?.note?.trim() || null;
    const expiresAt =
      options?.expiresInDays && Number(options.expiresInDays) > 0
        ? new Date(Date.now() + Number(options.expiresInDays) * 86_400_000).toISOString()
        : null;

    const res = this.db
      .prepare(
        `INSERT INTO instance_invites (code, created_by, max_uses, used_count, initial_credits, assigned_role, note, expires_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(rawCode, options?.createdBy ?? null, maxUses, initialCredits, assignedRole, note, expiresAt);

    return {
      id: Number(res.lastInsertRowid),
      code: rawCode,
      createdBy: options?.createdBy ?? null,
      maxUses,
      usedCount: 0,
      usesCount: 0,
      initialCredits,
      assignedRole,
      note,
      expiresAt,
      revoked: false,
      createdAt: new Date().toISOString(),
    };
  }

  listInstanceInvites(): {
    id: number;
    code: string;
    created_by: number | null;
    createdBy: number | null;
    creator_username: string | null;
    max_uses: number;
    maxUses: number;
    used_count: number;
    usesCount: number;
    initial_credits: number;
    assigned_role: string;
    note: string | null;
    expires_at: string | null;
    expiresAt: string | null;
    revoked_at: string | null;
    revoked: boolean;
    created_at: string;
    createdAt: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, u.username as creator_username
         FROM instance_invites i
         LEFT JOIN users u ON i.created_by = u.id
         ORDER BY i.id DESC`,
      )
      .all() as {
      id: number;
      code: string;
      created_by: number | null;
      creator_username: string | null;
      max_uses: number;
      used_count: number;
      initial_credits: number;
      assigned_role: string;
      note: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      ...r,
      createdBy: r.created_by,
      maxUses: r.max_uses,
      usesCount: r.used_count,
      expiresAt: r.expires_at,
      revoked: Boolean(r.revoked_at),
      createdAt: r.created_at,
    }));
  }

  revokeInstanceInvite(id: number): boolean {
    const res = this.db
      .prepare(`UPDATE instance_invites SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
      .run(id);
    return res.changes > 0;
  }

  getSystemDiagnostics(): {
    dbSizeBytes: number;
    walSizeBytes: number;
    counts: {
      users: number;
      posts: number;
      packages: number;
      repositories: number;
      jobs: number;
      auditLogs: number;
      pendingReports: number;
      quarantinedResources: number;
    };
    backups: {
      count: number;
      totalBytes: number;
      latestAt: string | null;
    };
    jobQueue: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
  } {
    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    try {
      const dbPath = this.facade.dbPath;
      if (fs.existsSync(dbPath)) dbSizeBytes = fs.statSync(dbPath).size;
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) walSizeBytes = fs.statSync(walPath).size;
    } catch {
      // Ignore stat errors for in-memory DBs
    }

    const countTable = (sql: string): number => {
      try {
        const r = this.db.prepare(sql).get() as { c: number } | undefined;
        return r?.c ?? 0;
      } catch {
        return 0;
      }
    };

    const backups = this.facade.listBackups();
    const totalBackupBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

    return {
      dbSizeBytes,
      walSizeBytes,
      counts: {
        users: countTable("SELECT COUNT(*) as c FROM users"),
        posts: countTable("SELECT COUNT(*) as c FROM posts"),
        packages: countTable("SELECT COUNT(*) as c FROM packages"),
        repositories: countTable("SELECT COUNT(*) as c FROM linked_repos"),
        jobs: countTable("SELECT COUNT(*) as c FROM jobs"),
        auditLogs: countTable("SELECT COUNT(*) as c FROM audit_logs"),
        pendingReports: countTable("SELECT COUNT(*) as c FROM content_reports WHERE status = 'pending'"),
        quarantinedResources: countTable(
          "SELECT COUNT(*) as c FROM quarantined_resources WHERE status = 'quarantined'",
        ),
      },
      backups: {
        count: backups.length,
        totalBytes: totalBackupBytes,
        latestAt: backups[0]?.createdAt ?? null,
      },
      jobQueue: {
        pending: countTable("SELECT COUNT(*) as c FROM jobs WHERE status IN ('PENDING', 'QUEUED')"),
        running: countTable("SELECT COUNT(*) as c FROM jobs WHERE status = 'RUNNING'"),
        completed: countTable("SELECT COUNT(*) as c FROM jobs WHERE status = 'SUCCESS'"),
        failed: countTable("SELECT COUNT(*) as c FROM jobs WHERE status IN ('FAILED', 'ERROR', 'CANCELLED')"),
      },
    };
  }

  validateAndConsumeInstanceInvite(code: string): {
    valid: boolean;
    reason?: string | undefined;
    invite?:
      | {
          id: number;
          code: string;
          initialCredits: number;
          assignedRole: string;
          createdBy?: number | null | undefined;
        }
      | undefined;
  } {
    const cleanCode = code.trim();
    if (!cleanCode) {
      return { valid: false, reason: "Invite code is required" };
    }
    const row = this.db.prepare(`SELECT * FROM instance_invites WHERE code = ?`).get(cleanCode) as
      | {
          id: number;
          code: string;
          created_by: number | null;
          max_uses: number;
          used_count: number;
          initial_credits: number;
          assigned_role: string;
          expires_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!row) {
      return { valid: false, reason: "Invalid registration invite code" };
    }
    if (row.revoked_at) {
      return { valid: false, reason: "This registration invite code has been revoked" };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { valid: false, reason: "This registration invite code has expired" };
    }
    if (row.used_count >= row.max_uses) {
      return { valid: false, reason: "This registration invite code has reached its maximum uses" };
    }

    this.db.prepare(`UPDATE instance_invites SET used_count = used_count + 1 WHERE id = ?`).run(row.id);

    return {
      valid: true,
      invite: {
        id: row.id,
        code: row.code,
        createdBy: row.created_by ?? null,
        initialCredits: Number(row.initial_credits ?? 100),
        assignedRole: row.assigned_role || "user",
      },
    };
  }

  getUserForensicsForAdmin(userId: number): {
    user: {
      id: number;
      username: string;
      email: string | null;
      display_name: string | null;
      account_type: string;
      status: string;
      credit_balance: number;
      total_spent: number;
      remote_domain: string | null;
      email_verified: number;
      totp_enabled: number;
      created_at: string;
    };
    recentPosts: {
      id: number;
      content: string;
      content_warning: string | null;
      visibility: string;
      created_at: string;
    }[];
    publishedPackages: {
      name: string;
      description: string | null;
      created_at: string;
    }[];
    recentTransactions: {
      id: number;
      amount: number;
      balance_after: number;
      type: string;
      description: string | null;
      created_at: string;
    }[];
    recentAuditLogs: {
      id: number;
      action: string;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      created_at: string;
    }[];
    reportsAgainstUser: {
      id: number;
      reason: string;
      status: string;
      target_type: string | null;
      created_at: string;
    }[];
    warnings: AccountWarningRow[];
    accountWarnings: AccountWarningRow[];
    staffNotes: StaffNoteRow[];
  } | null {
    const user = this.db
      .prepare(
        `SELECT id, username, email, display_name, COALESCE(account_type, 'user') as account_type,
                COALESCE(status, 'active') as status,
                COALESCE(credit_balance, 0) as credit_balance,
                COALESCE((SELECT SUM(ABS(amount)) FROM credit_transactions ct WHERE ct.user_id = users.id AND ct.amount < 0), 0) as total_spent,
                remote_domain, COALESCE(email_verified, 0) as email_verified,
                COALESCE(totp_enabled, 0) as totp_enabled, created_at
         FROM users WHERE id = ?`,
      )
      .get(userId) as
      | {
          id: number;
          username: string;
          email: string | null;
          display_name: string | null;
          account_type: string;
          status: string;
          credit_balance: number;
          total_spent: number;
          remote_domain: string | null;
          email_verified: number;
          totp_enabled: number;
          created_at: string;
        }
      | undefined;

    if (!user) return null;

    const recentPosts = this.db
      .prepare(
        `SELECT id, content, content_warning,
                COALESCE(visibility, reply_visibility, 'public') as visibility,
                created_at
         FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 10`,
      )
      .all(userId) as {
      id: number;
      content: string;
      content_warning: string | null;
      visibility: string;
      created_at: string;
    }[];

    let publishedPackages: { name: string; description: string | null; created_at: string }[] = [];
    try {
      publishedPackages = this.db
        .prepare(
          `SELECT DISTINCT p.name, p.description, p.created_at
           FROM packages p
           JOIN package_versions pv ON pv.package_id = p.id
           WHERE pv.published_by = ?
           ORDER BY p.id DESC LIMIT 10`,
        )
        .all(userId) as { name: string; description: string | null; created_at: string }[];
    } catch {
      publishedPackages = [];
    }

    const recentTransactions = this.db
      .prepare(
        `SELECT id, amount, balance_after, type, description, created_at
         FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
      )
      .all(userId) as {
      id: number;
      amount: number;
      balance_after: number;
      type: string;
      description: string | null;
      created_at: string;
    }[];

    const recentAuditLogs = this.db
      .prepare(
        `SELECT id, action, resource_type, resource_id, ip_address, created_at
         FROM audit_logs
         WHERE actor_id = ? OR (resource_type = 'user' AND resource_id = ?)
         ORDER BY id DESC LIMIT 15`,
      )
      .all(userId, String(userId)) as {
      id: number;
      action: string;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      created_at: string;
    }[];

    const reportsAgainstUser = this.db
      .prepare(
        `SELECT r.id, r.reason, r.status, r.target_type, r.created_at
         FROM content_reports r
         LEFT JOIN posts p ON r.post_id = p.id
         WHERE r.target_user_id = ? OR p.author_id = ?
         ORDER BY r.id DESC LIMIT 10`,
      )
      .all(userId, userId) as {
      id: number;
      reason: string;
      status: string;
      target_type: string | null;
      created_at: string;
    }[];

    const warnings = this.facade.listAccountWarnings(userId);
    return {
      user,
      recentPosts,
      publishedPackages,
      recentTransactions,
      recentAuditLogs,
      reportsAgainstUser,
      warnings,
      accountWarnings: warnings,
      staffNotes: this.facade.listStaffNotes("user", String(userId)),
    };
  }

  exportInstanceBundle(): {
    formatVersion: number;
    exportedAt: string;
    snapshot: {
      fileName: string;
      sizeBytes: number;
      sha256: string;
    };
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    federationDomains: ReturnType<LibraryDatabase["listFederationDomains"]>;
    quarantinedResources: ReturnType<LibraryDatabase["listQuarantinedResources"]>;
    featureFlags: ReturnType<LibraryDatabase["getFeatureFlags"]>;
    packageCount: number;
    userCount: number;
    bundleSha256: string;
  } {
    const snapshot = this.facade.createHotBackup("bundle-export");
    const settings = this.getInstanceSettings();
    const federationDomains = this.facade.listFederationDomains();
    const quarantinedResources = this.facade.listQuarantinedResources();
    const featureFlags = this.facade.getFeatureFlags();
    const diag = this.getSystemDiagnostics();

    const payloadWithoutHash = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: {
        fileName: snapshot.fileName,
        sizeBytes: snapshot.sizeBytes,
        sha256: snapshot.sha256,
      },
      settings,
      federationDomains,
      quarantinedResources,
      featureFlags,
      packageCount: diag.counts.packages,
      userCount: diag.counts.users,
    };
    const integrityMetadata = {
      formatVersion: 1,
      exportedAt: payloadWithoutHash.exportedAt,
      snapshotSha256: snapshot.sha256,
      snapshotSizeBytes: snapshot.sizeBytes,
      packageCount: diag.counts.packages,
      userCount: diag.counts.users,
    };
    const bundleSha256 = crypto.createHash("sha256").update(JSON.stringify(integrityMetadata)).digest("hex");

    return {
      ...payloadWithoutHash,
      bundleSha256,
    };
  }

  importInstanceBundle(
    bundle: {
      settings?: Record<string, unknown> | undefined;
      federationDomains?:
        { domain: string; tier?: "allow" | "silence" | "suspend"; reason?: string | null }[] | undefined;
      featureFlags?:
        | { flag_key: string; is_enabled: number | boolean; allowed_roles?: string; rollout_percentage?: number }[]
        | undefined;
      quarantinedResources?: { resource_type: string; resource_id: string; reason: string }[] | undefined;
    },
    actorId: number | null = null,
  ): {
    success: boolean;
    settingsUpdated: boolean;
    importedDomains: number;
    importedFlags: number;
    importedQuarantines: number;
  } {
    let settingsUpdated = false;
    if (bundle.settings && typeof bundle.settings === "object") {
      this.updateInstanceSettings(bundle.settings, actorId);
      settingsUpdated = true;
    }

    let importedDomains = 0;
    if (Array.isArray(bundle.federationDomains) && bundle.federationDomains.length > 0) {
      const res = this.facade.importFederationDomains(bundle.federationDomains, "merge");
      importedDomains = res.importedCount;
    }

    let importedFlags = 0;
    if (Array.isArray(bundle.featureFlags)) {
      for (const f of bundle.featureFlags) {
        if (!f.flag_key) continue;
        this.facade.setFeatureFlag(
          String(f.flag_key),
          Boolean(f.is_enabled),
          f.allowed_roles ?? "",
          typeof f.rollout_percentage === "number" ? f.rollout_percentage : 100,
        );
        importedFlags++;
      }
    }

    let importedQuarantines = 0;
    if (Array.isArray(bundle.quarantinedResources)) {
      for (const q of bundle.quarantinedResources) {
        if (!q.resource_type || !q.resource_id) continue;
        this.facade.quarantineResource({
          resourceType: String(q.resource_type),
          resourceId: String(q.resource_id),
          reason: String(q.reason || "Imported from instance migration bundle"),
          quarantinedBy: actorId,
        });
        importedQuarantines++;
      }
    }

    return {
      success: true,
      settingsUpdated,
      importedDomains,
      importedFlags,
      importedQuarantines,
    };
  }

  recordActivityPubMigration(data: {
    sourceActorUri: string;
    targetActorUri: string;
    alsoKnownAs?: string[] | undefined;
    actorId?: number | null | undefined;
  }): {
    activityId: string;
    type: "Move";
    actor: string;
    object: string;
    target: string;
    alsoKnownAs: string[];
    queuedDeliveries: number;
  } {
    let cleanSourceUri = data.sourceActorUri;
    while (cleanSourceUri.endsWith("/")) {
      cleanSourceUri = cleanSourceUri.slice(0, -1);
    }
    const activityId = `${cleanSourceUri}#move-${Date.now()}`;
    const activityPayload = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityId,
      type: "Move",
      actor: data.sourceActorUri,
      object: data.sourceActorUri,
      target: data.targetActorUri,
      alsoKnownAs: data.alsoKnownAs ?? [data.targetActorUri],
      published: new Date().toISOString(),
    };

    // Enqueue Move activity to all known active peer federation domains
    const domains = this.facade.listFederationDomains().filter((d) => d.tier === "allow");
    let queuedDeliveries = 0;
    for (const d of domains) {
      this.facade.enqueueFederationDelivery("Move", activityId, activityPayload, `https://${d.domain}/inbox`, d.domain);
      queuedDeliveries++;
    }

    return {
      activityId,
      type: "Move",
      actor: data.sourceActorUri,
      object: data.sourceActorUri,
      target: data.targetActorUri,
      alsoKnownAs: activityPayload.alsoKnownAs,
      queuedDeliveries,
    };
  }
}
