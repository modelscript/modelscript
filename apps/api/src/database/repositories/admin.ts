// SPDX-License-Identifier: AGPL-3.0-or-later

import { FEATURE_FLAGS } from "../../feature-flags.js";
import type { ContentReportRow, DmcaNoticeRow } from "../types.js";
import { BaseRepository } from "./base.js";

export class AdminRepository extends BaseRepository {
  // ── Feature Flags ────────────────────────────────────────────────

  getFeatureFlags(): {
    flag_key: string;
    is_enabled: number;
    rollout_percentage: number;
    allowed_roles: string;
    updated_at: string;
  }[] {
    return this.all<{
      flag_key: string;
      is_enabled: number;
      rollout_percentage: number;
      allowed_roles: string;
      updated_at: string;
    }>(`SELECT * FROM feature_flags`);
  }

  getFeatureFlag(key: string):
    | {
        flag_key: string;
        is_enabled: number;
        rollout_percentage: number;
        allowed_roles: string;
        updated_at: string;
      }
    | undefined {
    return this.get<{
      flag_key: string;
      is_enabled: number;
      rollout_percentage: number;
      allowed_roles: string;
      updated_at: string;
    }>(`SELECT * FROM feature_flags WHERE flag_key = ?`, key);
  }

  isFeatureFlagEnabled(key: string): boolean {
    const envKey = `FEATURE_FLAG_${key.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      const normalized = envVal.toLowerCase().trim();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }

    const flag = this.getFeatureFlag(key);
    if (flag !== undefined) {
      return flag.is_enabled === 1;
    }
    const def = FEATURE_FLAGS[key];
    return def ? def.defaultValue : false;
  }

  setFeatureFlag(key: string, isEnabled: boolean, allowedRoles?: string, rolloutPercentage = 100): void {
    const roles = allowedRoles !== undefined ? allowedRoles : "";
    this.run(
      `
      INSERT INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(flag_key) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        rollout_percentage = excluded.rollout_percentage,
        allowed_roles = excluded.allowed_roles,
        updated_at = datetime('now')
    `,
      key,
      isEnabled ? 1 : 0,
      rolloutPercentage,
      roles,
    );
  }

  // ── Moderation & Content Reports ─────────────────────────────────

  #hydrateContentReport(raw: ContentReportRow): ContentReportRow {
    let snapshot: {
      targetType?: string | undefined;
      targetResourceId?: string | null | undefined;
      postId?: number | null | undefined;
      postContent?: string | null | undefined;
      authorId?: number | null | undefined;
      authorUsername?: string | null | undefined;
      authorDomain?: string | null | undefined;
      apId?: string | null | undefined;
    } | null = null;

    if (raw.content_snapshot && typeof raw.content_snapshot === "string") {
      try {
        snapshot = JSON.parse(raw.content_snapshot);
      } catch {
        snapshot = null;
      }
    }

    let parsedRuleIds: number[] = [];
    if (Array.isArray(raw.rule_ids)) {
      parsedRuleIds = raw.rule_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    } else if (typeof raw.rule_ids === "string" && raw.rule_ids.trim()) {
      try {
        const arr = JSON.parse(raw.rule_ids);
        if (Array.isArray(arr)) {
          parsedRuleIds = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n));
        }
      } catch {
        // Malformed rule_ids JSON falls back to empty array
      }
    }

    const postContent = raw.post_content ?? snapshot?.postContent ?? null;
    const postAuthorId = raw.post_author_id ?? snapshot?.authorId ?? raw.target_user_id ?? null;
    const authorUsername = raw.author_username || raw.target_username || snapshot?.authorUsername || null;
    const targetUsername = raw.target_username || raw.author_username || snapshot?.authorUsername || null;
    const authorDomain = raw.author_domain || snapshot?.authorDomain || null;
    const targetType = raw.target_type || snapshot?.targetType || (raw.post_id != null ? "post" : "user");
    const targetResourceId =
      raw.target_resource_id ??
      snapshot?.targetResourceId ??
      (raw.post_id != null ? String(raw.post_id) : raw.target_user_id != null ? String(raw.target_user_id) : null);

    return {
      ...raw,
      post_content: postContent,
      post_author_id: postAuthorId,
      author_username: authorUsername,
      target_username: targetUsername,
      author_domain: authorDomain,
      target_type: targetType,
      target_resource_id: targetResourceId,
      rule_ids: parsedRuleIds,
      category: raw.category || "other",
    };
  }

  createContentReport(
    reporterId: number,
    data: {
      postId?: number | string | undefined;
      targetUserId?: number | undefined;
      targetType?: "post" | "user" | "package" | "repo" | "appeal" | string | undefined;
      targetResourceId?: string | undefined;
      reason: string;
      details?: string | undefined;
      ruleIds?: number[] | undefined;
      category?: string | undefined;
    },
  ): { id: number; status: string; autoQuarantined?: boolean } {
    let effectiveTargetUserId = data.targetUserId ?? null;
    const resolvedTargetType = data.targetType || (data.postId ? "post" : "user");
    const resolvedResourceId =
      data.targetResourceId ??
      (data.postId != null
        ? String(data.postId)
        : effectiveTargetUserId != null
          ? String(effectiveTargetUserId)
          : null);

    let snapshotObj: Record<string, unknown> = {
      targetType: resolvedTargetType,
      targetResourceId: resolvedResourceId,
      capturedAt: new Date().toISOString(),
    };

    if (data.postId) {
      const postInfo = this.get<{
        id: string | number;
        content: string | null;
        author_id: number;
        ap_id: string | null;
        created_at: string;
        username: string | null;
        remote_domain: string | null;
      }>(
        `SELECT CAST(p.id AS TEXT) as id, p.content, p.author_id, p.ap_id, p.created_at, u.username, u.remote_domain
         FROM posts p
         LEFT JOIN users u ON p.author_id = u.id
         WHERE p.id = ?`,
        data.postId,
      );

      if (postInfo) {
        if (!effectiveTargetUserId) {
          effectiveTargetUserId = postInfo.author_id;
        }
        snapshotObj = {
          targetType: resolvedTargetType,
          targetResourceId: resolvedResourceId,
          postId: postInfo.id,
          postContent: postInfo.content,
          authorId: postInfo.author_id,
          authorUsername: postInfo.username,
          authorDomain: postInfo.remote_domain,
          apId: postInfo.ap_id,
          postCreatedAt: postInfo.created_at,
          capturedAt: new Date().toISOString(),
        };
      }
    } else if (effectiveTargetUserId) {
      const userInfo = this.get<{
        id: number;
        username: string;
        display_name: string | null;
        bio: string | null;
        remote_domain: string | null;
        status: string | null;
      }>(
        `SELECT id, username, display_name, bio, remote_domain, status FROM users WHERE id = ?`,
        effectiveTargetUserId,
      );
      if (userInfo) {
        snapshotObj = {
          targetType: resolvedTargetType,
          targetResourceId: resolvedResourceId,
          authorId: userInfo.id,
          authorUsername: userInfo.username,
          authorDomain: userInfo.remote_domain,
          displayName: userInfo.display_name,
          bio: userInfo.bio,
          userStatus: userInfo.status,
          capturedAt: new Date().toISOString(),
        };
      }
    }

    const ruleIdsJson = Array.isArray(data.ruleIds)
      ? JSON.stringify(data.ruleIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      : "[]";
    const category = data.category || (Array.isArray(data.ruleIds) && data.ruleIds.length > 0 ? "violation" : "other");

    const result = this.run(
      `INSERT INTO content_reports (reporter_id, post_id, target_user_id, target_type, target_resource_id, reason, details, content_snapshot, rule_ids, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reporterId,
      data.postId ?? null,
      effectiveTargetUserId,
      resolvedTargetType,
      resolvedResourceId,
      data.reason,
      data.details ?? null,
      JSON.stringify(snapshotObj),
      ruleIdsJson,
      category,
    );

    let autoQuarantined = false;
    try {
      const settings = this.facade.getInstanceSettings();
      const threshold = settings.autoQuarantineReportThreshold;
      if (threshold > 0 && resolvedTargetType && resolvedResourceId) {
        const countRow = this.get<{ c: number }>(
          `SELECT COUNT(DISTINCT reporter_id) as c
           FROM content_reports
           WHERE status = 'pending'
             AND ((? IS NOT NULL AND post_id = ?) OR (target_type = ? AND target_resource_id = ?))`,
          data.postId ?? null,
          data.postId ?? null,
          resolvedTargetType,
          resolvedResourceId,
        );
        const distinctReporters = countRow?.c ?? 0;
        if (distinctReporters >= threshold) {
          this.quarantineResource({
            resourceType: resolvedTargetType,
            resourceId: resolvedResourceId,
            reason: `Auto-quarantined after reaching threshold of ${threshold} distinct user reports`,
          });
          if (resolvedTargetType === "post" && data.postId) {
            this.run(
              `UPDATE posts
               SET content_warning = COALESCE(content_warning, '[Auto-Quarantined Pending Moderator Review]')
               WHERE id = ?`,
              data.postId,
            );
          }
          autoQuarantined = true;
        }
      }
    } catch {
      // Non-fatal if settings table not initialized in isolated unit test
    }

    return { id: Number(result.lastInsertRowid), status: "pending", autoQuarantined };
  }

  getContentReport(reportId: number): ContentReportRow | undefined {
    const row = this.get<ContentReportRow>(
      `SELECT r.*, 
              CAST(r.post_id AS TEXT) as post_id,
              u.username as reporter_username, 
              p.content as post_content,
              p.author_id as post_author_id,
              author_u.username as author_username,
              target_u.username as target_username,
              COALESCE(author_u.remote_domain, target_u.remote_domain) as author_domain
       FROM content_reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       LEFT JOIN posts p ON r.post_id = p.id
       LEFT JOIN users author_u ON p.author_id = author_u.id
       LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
       WHERE r.id = ?`,
      reportId,
    );
    return row ? this.#hydrateContentReport(row) : undefined;
  }

  getModerationQueue(
    status?: string,
    limit: number = 50,
    offset: number = 0,
    targetType?: string,
    search?: string,
  ): ContentReportRow[] {
    const baseQuery = `
      SELECT r.*, 
             CAST(r.post_id AS TEXT) as post_id,
             u.username as reporter_username, 
             p.content as post_content,
             p.author_id as post_author_id,
             author_u.username as author_username,
             target_u.username as target_username,
             COALESCE(author_u.remote_domain, target_u.remote_domain) as author_domain,
             (
               SELECT COUNT(*) FROM content_reports r2
               WHERE (r.post_id IS NOT NULL AND r2.post_id = r.post_id)
                  OR (r.post_id IS NULL AND r.target_resource_id IS NOT NULL AND r2.target_resource_id = r.target_resource_id)
                  OR (r.post_id IS NULL AND r.target_user_id IS NOT NULL AND r2.target_user_id = r.target_user_id)
             ) as target_report_count,
             (
               SELECT COUNT(*) FROM content_reports r3
               WHERE r3.status = 'resolved'
                 AND COALESCE(r3.target_user_id, 0) = COALESCE(r.target_user_id, p.author_id, -1)
             ) as author_prior_violations
      FROM content_reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN posts p ON r.post_id = p.id
      LEFT JOIN users author_u ON p.author_id = author_u.id
      LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
    `;

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (status && status !== "all") {
      clauses.push("r.status = ?");
      params.push(status);
    }
    if (targetType && targetType !== "all") {
      if (targetType === "post") {
        clauses.push("(r.target_type = 'post' OR (r.target_type IS NULL AND r.post_id IS NOT NULL))");
      } else {
        clauses.push("r.target_type = ?");
        params.push(targetType);
      }
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(r.reason, '')) LIKE ? OR LOWER(COALESCE(r.details, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(target_u.username, '')) LIKE ? OR LOWER(COALESCE(r.target_resource_id, '')) LIKE ?)",
      );
      params.push(q, q, q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.all<ContentReportRow>(
      `${baseQuery} ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );

    return rows.map((r) => this.#hydrateContentReport(r));
  }

  getModerationQueueCount(status?: string, targetType?: string, search?: string): number {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("r.status = ?");
      params.push(status);
    }
    if (targetType && targetType !== "all") {
      if (targetType === "post") {
        clauses.push("(r.target_type = 'post' OR (r.target_type IS NULL AND r.post_id IS NOT NULL))");
      } else {
        clauses.push("r.target_type = ?");
        params.push(targetType);
      }
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(r.reason, '')) LIKE ? OR LOWER(COALESCE(r.details, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(target_u.username, '')) LIKE ? OR LOWER(COALESCE(r.target_resource_id, '')) LIKE ?)",
      );
      params.push(q, q, q, q, q, q);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.get<{ c: number }>(
      `SELECT COUNT(*) as c
       FROM content_reports r
       LEFT JOIN users u ON r.reporter_id = u.id
       LEFT JOIN posts p ON r.post_id = p.id
       LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
       ${whereSql}`,
      ...params,
    );
    return row?.c ?? 0;
  }

  resolveContentReport(
    reportId: number,
    status: "resolved" | "dismissed",
    resolutionNotes?: string,
    actionTaken?: string,
    resolveAllForTarget?: boolean,
  ): boolean {
    const current = this.getContentReport(reportId);
    const res = this.run(
      `UPDATE content_reports
       SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
       WHERE id = ?`,
      status,
      resolutionNotes ?? null,
      actionTaken ?? null,
      reportId,
    );

    if (resolveAllForTarget && current) {
      if (current.post_id) {
        this.run(
          `UPDATE content_reports
           SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
           WHERE post_id = ? AND status = 'pending' AND id != ?`,
          status,
          resolutionNotes ?? null,
          actionTaken ?? null,
          current.post_id,
          reportId,
        );
      } else if (current.target_user_id) {
        this.run(
          `UPDATE content_reports
           SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
           WHERE target_user_id = ? AND post_id IS NULL AND status = 'pending' AND id != ?`,
          status,
          resolutionNotes ?? null,
          actionTaken ?? null,
          current.target_user_id,
          reportId,
        );
      }
    }

    return res.changes > 0;
  }

  // ── DMCA Notices & Universal Resource Quarantine ──────────────────

  createDmcaNotice(data: {
    claimantName: string;
    claimantEmail: string;
    copyrightOwner: string;
    workDescription: string;
    infringingUrl: string;
    resourceType?: string | undefined;
    resourceId?: string | undefined;
  }): { id: number } {
    const res = this.run(
      `INSERT INTO dmca_notices (claimant_name, claimant_email, copyright_owner, work_description, infringing_url, resource_type, resource_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      data.claimantName,
      data.claimantEmail,
      data.copyrightOwner,
      data.workDescription,
      data.infringingUrl,
      data.resourceType ?? "package",
      data.resourceId ?? null,
    );
    return { id: Number(res.lastInsertRowid) };
  }

  listDmcaNotices(status?: string): DmcaNoticeRow[] {
    if (status) {
      return this.all<DmcaNoticeRow>(`SELECT * FROM dmca_notices WHERE status = ? ORDER BY created_at DESC`, status);
    }
    return this.all<DmcaNoticeRow>(`SELECT * FROM dmca_notices ORDER BY created_at DESC`);
  }

  getDmcaNotice(id: number): DmcaNoticeRow | undefined {
    return this.get<DmcaNoticeRow>(`SELECT * FROM dmca_notices WHERE id = ?`, id);
  }

  resolveDmcaNotice(id: number, actionTaken: string, status: "resolved" | "rejected" = "resolved"): boolean {
    const res = this.run(
      `UPDATE dmca_notices SET status = ?, action_taken = ?, resolved_at = datetime('now') WHERE id = ?`,
      status,
      actionTaken,
      id,
    );
    return res.changes > 0;
  }

  quarantineResource(data: {
    resourceType: string;
    resourceId: string;
    reason: string;
    dmcaNoticeId?: number | null | undefined;
    quarantinedBy?: number | null | undefined;
    counterNotice?: string | null | undefined;
    restoreAfter?: string | null | undefined;
  }): { id: number; resourceType: string; resourceId: string } {
    const cleanType = data.resourceType.trim().toLowerCase() || "package";
    const cleanId = data.resourceId.trim();
    this.run(
      `INSERT INTO quarantined_resources (resource_type, resource_id, reason, dmca_notice_id, quarantined_by, status, counter_notice, restore_after, created_at, restored_at)
       VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, datetime('now'), NULL)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET
         reason = excluded.reason,
         dmca_notice_id = COALESCE(excluded.dmca_notice_id, quarantined_resources.dmca_notice_id),
         quarantined_by = excluded.quarantined_by,
         status = 'quarantined',
         counter_notice = COALESCE(excluded.counter_notice, quarantined_resources.counter_notice),
         restore_after = COALESCE(excluded.restore_after, quarantined_resources.restore_after),
         restored_at = NULL`,
      cleanType,
      cleanId,
      data.reason,
      data.dmcaNoticeId ?? null,
      data.quarantinedBy ?? null,
      data.counterNotice ?? null,
      data.restoreAfter ?? null,
    );
    const row = this.get<{ id: number }>(
      `SELECT id FROM quarantined_resources WHERE resource_type = ? AND resource_id = ?`,
      cleanType,
      cleanId,
    );
    return { id: row?.id ?? 0, resourceType: cleanType, resourceId: cleanId };
  }

  restoreQuarantinedResource(resourceType: string, resourceId: string): boolean {
    const res = this.run(
      `UPDATE quarantined_resources
       SET status = 'restored', restored_at = datetime('now')
       WHERE resource_type = ? AND resource_id = ? AND status = 'quarantined'`,
      resourceType.trim().toLowerCase(),
      resourceId.trim(),
    );
    return res.changes > 0;
  }

  isResourceQuarantined(resourceType: string, resourceId: string): boolean {
    const row = this.get(
      `SELECT 1 FROM quarantined_resources
       WHERE resource_type = ? AND resource_id = ? AND status = 'quarantined'`,
      resourceType.trim().toLowerCase(),
      resourceId.trim(),
    );
    return Boolean(row);
  }

  listQuarantinedResources(status?: string): {
    id: number;
    resource_type: string;
    resource_id: string;
    reason: string;
    dmca_notice_id: number | null;
    quarantined_by: number | null;
    status: string;
    counter_notice: string | null;
    restore_after: string | null;
    created_at: string;
    restored_at: string | null;
  }[] {
    type QuarantinedRow = {
      id: number;
      resource_type: string;
      resource_id: string;
      reason: string;
      dmca_notice_id: number | null;
      quarantined_by: number | null;
      status: string;
      counter_notice: string | null;
      restore_after: string | null;
      created_at: string;
      restored_at: string | null;
    };
    if (status && status !== "all") {
      return this.all<QuarantinedRow>(
        `SELECT * FROM quarantined_resources WHERE status = ? ORDER BY created_at DESC`,
        status,
      );
    }
    return this.all<QuarantinedRow>(`SELECT * FROM quarantined_resources ORDER BY created_at DESC`);
  }

  fileDmcaCounterNotice(noticeId: number, counterNoticeText: string): { success: boolean; restoreAfter: string } {
    const notice = this.getDmcaNotice(noticeId);
    const restoreAfter = new Date(Date.now() + 14 * 86_400_000).toISOString();
    if (!notice) {
      return { success: false, restoreAfter };
    }
    const updatedAction = `${notice.action_taken ? `${notice.action_taken} | ` : ""}Counter-Notice filed: ${counterNoticeText} (Eligible for restoration after ${restoreAfter.slice(0, 10)})`;
    this.run(`UPDATE dmca_notices SET action_taken = ? WHERE id = ?`, updatedAction, noticeId);
    this.run(
      `UPDATE quarantined_resources
       SET counter_notice = ?, restore_after = ?
       WHERE dmca_notice_id = ?`,
      counterNoticeText,
      restoreAfter,
      noticeId,
    );
    return { success: true, restoreAfter };
  }

  // ── Admin Overview Pending Counts ────────────────────────────────

  getAdminPendingCounts(): {
    pendingReports: number;
    pendingDmca: number;
    failedDeliveries: number;
    suspendedDomains: number;
    restrictedUsers: number;
  } {
    const pendingReports =
      this.get<{ c: number }>(`SELECT COUNT(*) as c FROM content_reports WHERE status = 'pending'`)?.c ?? 0;
    const pendingDmca =
      this.get<{ c: number }>(`SELECT COUNT(*) as c FROM dmca_notices WHERE status = 'pending'`)?.c ?? 0;
    const failedDeliveries =
      this.get<{ c: number }>(`SELECT COUNT(*) as c FROM federation_delivery_queue WHERE status = 'failed'`)?.c ?? 0;
    const suspendedDomains =
      this.get<{ c: number }>(`SELECT COUNT(*) as c FROM federation_domains WHERE tier IN ('silence', 'suspend')`)?.c ??
      0;
    const restrictedUsers =
      this.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE status IN ('frozen', 'suspended')`)?.c ?? 0;
    return {
      pendingReports,
      pendingDmca,
      failedDeliveries,
      suspendedDomains,
      restrictedUsers,
    };
  }
}
