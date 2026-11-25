// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { RawAccountWarningRow, RawContentFilterRow, TrendingTopicRow } from "../../database.js";
import type {
  AccountWarningRow,
  CanonicalEmailBlockRow,
  ContentFilterKeyword,
  ContentFilterMatch,
  ContentFilterRow,
  FederationRelayRow,
  InstanceRuleRow,
  IpBlockRow,
  PostPollOption,
  PostPollView,
  PostRow,
  PushSubscriptionRow,
  RemoteArtifactCacheRow,
  StaffNoteRow,
} from "../../database/types.js";
import { FEATURE_FLAGS, getLanguageFeatureFlagKey } from "../../feature-flags.js";
import { canonicalizeEmail, hashCanonicalEmail, ipMatchesCidr, redactEmailHint } from "../../util/email-filter.js";
import { BaseRepository } from "./base.js";
export class ModerationSafetyRepository extends BaseRepository {
  // ── Domain Availability, Auto-Circuit-Breaking & Transparency ────

  recordDomainDeliverySuccess(domain: string): void {
    this.facade.federation.recordDomainDeliverySuccess(domain);
  }

  recordDomainDeliveryFailure(
    domain: string,
    errorMessage?: string,
  ): { consecutiveFailures: number; unavailableSince: string | null } {
    return this.facade.federation.recordDomainDeliveryFailure(domain, errorMessage);
  }

  isDomainUnavailable(domain: string): boolean {
    return this.facade.federation.isDomainUnavailable(domain);
  }

  listPublicDomainBlocks() {
    return this.facade.federation.listPublicDomainBlocks();
  }

  listKnownPeers(): string[] {
    return this.facade.federation.listKnownPeers();
  }

  // ── ActivityPub Relays (FEP-ae97) ────────────────────────────────

  listFederationRelays(): FederationRelayRow[] {
    return this.facade.federation.listFederationRelays();
  }

  getFederationRelayById(id: number): FederationRelayRow | undefined {
    return this.facade.federation.getFederationRelayById(id);
  }

  getFederationRelayByActor(actorUrl: string): FederationRelayRow | undefined {
    return this.facade.federation.getFederationRelayByActor(actorUrl);
  }

  addFederationRelay(
    inboxUrl: string,
    actorUrl?: string,
    followActivityId?: string,
    state: "pending" | "accepted" | "rejected" | "paused" = "pending",
  ): FederationRelayRow {
    return this.facade.federation.addFederationRelay(inboxUrl, actorUrl, followActivityId, state);
  }

  updateFederationRelayState(
    idOrActorUrl: number | string,
    state: "pending" | "accepted" | "rejected" | "paused",
    lastError?: string | null,
  ): FederationRelayRow | undefined {
    return this.facade.federation.updateFederationRelayState(idOrActorUrl, state, lastError);
  }

  deleteFederationRelay(id: number): FederationRelayRow | undefined {
    return this.facade.federation.deleteFederationRelay(id);
  }

  incrementRelayStats(idOrActorUrl: number | string, direction: "forwarded" | "received"): void {
    this.facade.federation.incrementRelayStats(idOrActorUrl, direction);
  }

  // ── Structured Instance Rules ────────────────────────────────────

  listInstanceRules(): InstanceRuleRow[] {
    return this.db.prepare(`SELECT * FROM instance_rules ORDER BY priority ASC, id ASC`).all() as InstanceRuleRow[];
  }

  createInstanceRule(text: string, hint?: string | null, priority?: number): InstanceRuleRow {
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error("Rule text is required");
    }
    const effectivePriority =
      typeof priority === "number" && Number.isFinite(priority) ? priority : this.listInstanceRules().length + 1;
    const res = this.db
      .prepare(
        `INSERT INTO instance_rules (text, hint, priority, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(cleanText, hint?.trim() || null, effectivePriority);
    return this.db
      .prepare(`SELECT * FROM instance_rules WHERE id = ?`)
      .get(Number(res.lastInsertRowid)) as InstanceRuleRow;
  }

  updateInstanceRule(
    id: number,
    updates: { text?: string | undefined; hint?: string | null | undefined; priority?: number | undefined },
  ): InstanceRuleRow | undefined {
    const existing = this.db.prepare(`SELECT * FROM instance_rules WHERE id = ?`).get(id) as
      InstanceRuleRow | undefined;
    if (!existing) return undefined;

    const nextText = updates.text !== undefined ? updates.text.trim() : existing.text;
    const nextHint = updates.hint !== undefined ? (updates.hint ? updates.hint.trim() : null) : existing.hint;
    const nextPriority = updates.priority !== undefined ? Number(updates.priority) : existing.priority;

    this.db
      .prepare(
        `UPDATE instance_rules
         SET text = ?, hint = ?, priority = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextText, nextHint, nextPriority, id);

    return this.db.prepare(`SELECT * FROM instance_rules WHERE id = ?`).get(id) as InstanceRuleRow | undefined;
  }

  deleteInstanceRule(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM instance_rules WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  // ── Account Warnings & Strikes ───────────────────────────────────

  #hydrateAccountWarning(row: RawAccountWarningRow): AccountWarningRow {
    let ruleIds: number[] = [];
    if (Array.isArray(row.rule_ids)) {
      ruleIds = row.rule_ids;
    } else if (typeof row.rule_ids === "string") {
      try {
        const parsed = JSON.parse(row.rule_ids);
        if (Array.isArray(parsed)) ruleIds = parsed.map(Number).filter(Number.isFinite);
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
    }
    let postIds: number[] = [];
    if (Array.isArray(row.post_ids)) {
      postIds = row.post_ids;
    } else if (typeof row.post_ids === "string") {
      try {
        const parsed = JSON.parse(row.post_ids);
        if (Array.isArray(parsed)) postIds = parsed.map(Number).filter(Number.isFinite);
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
    }
    return {
      id: row.id,
      target_user_id: row.target_user_id,
      actor_id: row.actor_id,
      action: row.action,
      text: row.text,
      report_id: row.report_id,
      rule_ids: ruleIds,
      post_ids: postIds,
      acknowledged_at: row.acknowledged_at,
      created_at: row.created_at,
      actor_username: row.actor_username ?? null,
      target_username: row.target_username ?? null,
    };
  }

  createAccountWarning(params: {
    targetUserId: number;
    actorId?: number | null | undefined;
    moderatorId?: number | null | undefined;
    action?: AccountWarningRow["action"] | string | undefined;
    text: string;
    reportId?: number | null | undefined;
    ruleIds?: number[] | undefined;
    postIds?: number[] | undefined;
  }): AccountWarningRow {
    const validActions = [
      "none",
      "disable",
      "mark_statuses_sensitive",
      "delete_statuses",
      "silence",
      "suspend",
      "warn",
    ] as const;
    const action: AccountWarningRow["action"] =
      params.action && (validActions as readonly string[]).includes(params.action)
        ? (params.action as AccountWarningRow["action"])
        : "warn";
    const ruleIdsJson = JSON.stringify((params.ruleIds || []).map(Number).filter(Number.isFinite));
    const postIdsJson = JSON.stringify((params.postIds || []).map(Number).filter(Number.isFinite));
    const effectiveActorId = params.actorId ?? params.moderatorId ?? null;

    const res = this.db
      .prepare(
        `INSERT INTO account_warnings (target_user_id, actor_id, action, text, report_id, rule_ids, post_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        params.targetUserId,
        effectiveActorId,
        action,
        params.text.trim(),
        params.reportId ?? null,
        ruleIdsJson,
        postIdsJson,
      );

    const warningId = Number(res.lastInsertRowid);
    this.facade.createNotification(
      params.targetUserId,
      effectiveActorId || params.targetUserId,
      "moderation_warning",
      undefined,
      {
        warningId,
        action,
        text: params.text.trim(),
        ruleIds: params.ruleIds || [],
      },
    );

    const row = this.db
      .prepare(
        `SELECT w.*, u.username as target_username, a.username as actor_username
         FROM account_warnings w
         LEFT JOIN users u ON w.target_user_id = u.id
         LEFT JOIN users a ON w.actor_id = a.id
         WHERE w.id = ?`,
      )
      .get(warningId) as RawAccountWarningRow;
    return this.#hydrateAccountWarning(row);
  }

  listAccountWarnings(targetUserId?: number): AccountWarningRow[] {
    if (typeof targetUserId === "number") {
      const rows = this.db
        .prepare(
          `SELECT w.*, u.username as target_username, a.username as actor_username
           FROM account_warnings w
           LEFT JOIN users u ON w.target_user_id = u.id
           LEFT JOIN users a ON w.actor_id = a.id
           WHERE w.target_user_id = ?
           ORDER BY w.id DESC`,
        )
        .all(targetUserId) as RawAccountWarningRow[];
      return rows.map((r) => this.#hydrateAccountWarning(r));
    }
    const rows = this.db
      .prepare(
        `SELECT w.*, u.username as target_username, a.username as actor_username
         FROM account_warnings w
         LEFT JOIN users u ON w.target_user_id = u.id
         LEFT JOIN users a ON w.actor_id = a.id
         ORDER BY w.id DESC LIMIT 100`,
      )
      .all() as RawAccountWarningRow[];
    return rows.map((r) => this.#hydrateAccountWarning(r));
  }

  acknowledgeAccountWarning(warningId: number, userId: number): boolean {
    const res = this.db
      .prepare(
        `UPDATE account_warnings
         SET acknowledged_at = datetime('now')
         WHERE id = ? AND target_user_id = ? AND acknowledged_at IS NULL`,
      )
      .run(warningId, userId);
    return res.changes > 0;
  }

  // ── Internal Staff Notes ─────────────────────────────────────────

  createStaffNote(
    targetType: "user" | "domain" | "report",
    targetId: string,
    authorId: number,
    content: string,
  ): StaffNoteRow {
    const cleanContent = content.trim();
    if (!cleanContent) {
      throw new Error("Staff note content is required");
    }
    const res = this.db
      .prepare(
        `INSERT INTO staff_notes (target_type, target_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(targetType, String(targetId).trim(), authorId, cleanContent);
    const noteId = Number(res.lastInsertRowid);
    return this.db
      .prepare(
        `SELECT n.*, u.username as author_username
         FROM staff_notes n
         LEFT JOIN users u ON n.author_id = u.id
         WHERE n.id = ?`,
      )
      .get(noteId) as StaffNoteRow;
  }

  listStaffNotes(targetType: "user" | "domain" | "report", targetId?: string): StaffNoteRow[] {
    if (targetId !== undefined && targetId.trim() !== "") {
      return this.db
        .prepare(
          `SELECT n.*, u.username as author_username
           FROM staff_notes n
           LEFT JOIN users u ON n.author_id = u.id
           WHERE n.target_type = ? AND n.target_id = ?
           ORDER BY n.id DESC`,
        )
        .all(targetType, String(targetId).trim()) as StaffNoteRow[];
    }
    return this.db
      .prepare(
        `SELECT n.*, u.username as author_username
         FROM staff_notes n
         LEFT JOIN users u ON n.author_id = u.id
         WHERE n.target_type = ?
         ORDER BY n.id DESC LIMIT 100`,
      )
      .all(targetType) as StaffNoteRow[];
  }

  deleteStaffNote(noteId: number): boolean {
    const res = this.db.prepare(`DELETE FROM staff_notes WHERE id = ?`).run(noteId);
    return res.changes > 0;
  }

  // ── IP Blocks & Canonical Email Blocks ───────────────────────────

  listIpBlocks(): IpBlockRow[] {
    return this.db
      .prepare(
        `SELECT * FROM ip_blocks
         WHERE expires_at IS NULL OR datetime(expires_at) > datetime('now')
         ORDER BY id DESC`,
      )
      .all() as IpBlockRow[];
  }

  createIpBlock(
    paramsOrCidr:
      | string
      | {
          cidr: string;
          severity?: IpBlockRow["severity"] | undefined;
          comment?: string | null | undefined;
          createdBy?: number | null | undefined;
          expiresAt?: string | null | undefined;
        },
    severityArg?: IpBlockRow["severity"],
    commentArg?: string | null,
    expiresAtArg?: string | null,
    createdByArg?: number | null,
  ): IpBlockRow {
    const params =
      typeof paramsOrCidr === "string"
        ? {
            cidr: paramsOrCidr,
            severity: severityArg,
            comment: commentArg,
            expiresAt: expiresAtArg,
            createdBy: createdByArg,
          }
        : paramsOrCidr;
    const cleanCidr = params.cidr.trim();
    if (!cleanCidr) {
      throw new Error("CIDR or IP address is required");
    }
    const severity = params.severity || "no_sign_up";
    this.db
      .prepare(
        `INSERT INTO ip_blocks (cidr, severity, comment, created_by, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(cidr) DO UPDATE SET
           severity = excluded.severity,
           comment = excluded.comment,
           expires_at = excluded.expires_at,
           updated_at = datetime('now')`,
      )
      .run(cleanCidr, severity, params.comment?.trim() || null, params.createdBy ?? null, params.expiresAt ?? null);

    return this.db.prepare(`SELECT * FROM ip_blocks WHERE cidr = ?`).get(cleanCidr) as IpBlockRow;
  }

  deleteIpBlock(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM ip_blocks WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  checkIpBlock(clientIp?: string | null): IpBlockRow | null {
    if (!clientIp || !clientIp.trim()) return null;
    const blocks = this.listIpBlocks();
    for (const block of blocks) {
      if (ipMatchesCidr(clientIp, block.cidr)) {
        return block;
      }
    }
    return null;
  }

  listCanonicalEmailBlocks(): CanonicalEmailBlockRow[] {
    return this.db.prepare(`SELECT * FROM canonical_email_blocks ORDER BY id DESC`).all() as CanonicalEmailBlockRow[];
  }

  createCanonicalEmailBlock(
    emailOrHash: string,
    reason?: string | null,
    createdBy?: number | null,
  ): CanonicalEmailBlockRow {
    const raw = emailOrHash.trim();
    const isDirectHash = /^[a-f0-9]{64}$/i.test(raw);
    const emailHash = isDirectHash ? raw.toLowerCase() : hashCanonicalEmail(raw);
    const emailHint = isDirectHash ? `${raw.slice(0, 8)}…` : redactEmailHint(canonicalizeEmail(raw));

    this.db
      .prepare(
        `INSERT INTO canonical_email_blocks (canonical_email_hash, canonical_email_hint, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(canonical_email_hash) DO UPDATE SET
           reason = COALESCE(excluded.reason, canonical_email_blocks.reason)`,
      )
      .run(emailHash, emailHint, reason?.trim() || null, createdBy ?? null);

    return this.db
      .prepare(`SELECT * FROM canonical_email_blocks WHERE canonical_email_hash = ?`)
      .get(emailHash) as CanonicalEmailBlockRow;
  }

  deleteCanonicalEmailBlock(id: number): boolean {
    const res = this.db.prepare(`DELETE FROM canonical_email_blocks WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  isCanonicalEmailBlocked(email: string): {
    blocked: boolean;
    reason?: string | undefined;
    block?: CanonicalEmailBlockRow | undefined;
  } {
    const hash = hashCanonicalEmail(email);
    const row = this.db.prepare(`SELECT * FROM canonical_email_blocks WHERE canonical_email_hash = ?`).get(hash) as
      CanonicalEmailBlockRow | undefined;
    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.reason || "This email address has been blocked by instance administration",
      block: row,
    };
  }

  // ── Mastodon v2 Content Filters ──────────────────────────────────

  #hydrateContentFilter(row: RawContentFilterRow): ContentFilterRow {
    let context: ContentFilterRow["context"] = ["home", "public", "notifications", "thread", "account"];
    if (Array.isArray(row.context)) {
      context = row.context;
    } else if (typeof row.context === "string") {
      try {
        const parsed = JSON.parse(row.context);
        if (Array.isArray(parsed)) context = parsed;
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
    }

    let keywords: ContentFilterKeyword[] = [];
    if (typeof row.keywords_json === "string") {
      try {
        const parsed = JSON.parse(row.keywords_json);
        if (Array.isArray(parsed)) {
          keywords = parsed
            .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
            .map((k) => ({
              keyword: String(k.keyword).trim(),
              whole_word: k.whole_word !== false,
            }));
        }
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
    }

    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      context,
      contexts: context,
      filter_action: row.filter_action,
      keywords,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listContentFilters(userId?: number | null): ContentFilterRow[] {
    if (typeof userId === "number" && userId > 0) {
      const rows = this.db
        .prepare(
          `SELECT * FROM content_filters
           WHERE (user_id = ? OR user_id IS NULL)
             AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
           ORDER BY id DESC`,
        )
        .all(userId) as RawContentFilterRow[];
      return rows.map((r) => this.#hydrateContentFilter(r));
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM content_filters
         WHERE user_id IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
         ORDER BY id DESC`,
      )
      .all() as RawContentFilterRow[];
    return rows.map((r) => this.#hydrateContentFilter(r));
  }

  getContentFilter(id: number): ContentFilterRow | undefined {
    const row = this.db.prepare(`SELECT * FROM content_filters WHERE id = ?`).get(id) as
      RawContentFilterRow | undefined;
    return row ? this.#hydrateContentFilter(row) : undefined;
  }

  createContentFilter(params: {
    userId?: number | null | undefined;
    title: string;
    context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
    filterAction?: "warn" | "hide" | "drop" | undefined;
    keywords: { keyword: string; whole_word?: boolean | undefined }[];
    expiresAt?: string | null | undefined;
  }): ContentFilterRow {
    const cleanTitle = params.title.trim();
    if (!cleanTitle) {
      throw new Error("Filter title is required");
    }
    const context =
      Array.isArray(params.context) && params.context.length > 0
        ? params.context
        : (["home", "public", "notifications", "thread", "account"] as const);
    const filterAction = params.filterAction || "warn";
    const normalizedKeywords: ContentFilterKeyword[] = (params.keywords || [])
      .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
      .map((k) => ({
        keyword: k.keyword.trim(),
        whole_word: k.whole_word !== false,
      }));

    const res = this.db
      .prepare(
        `INSERT INTO content_filters (user_id, title, context, filter_action, keywords_json, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        params.userId ?? null,
        cleanTitle,
        JSON.stringify(context),
        filterAction,
        JSON.stringify(normalizedKeywords),
        params.expiresAt ?? null,
      );

    return this.getContentFilter(Number(res.lastInsertRowid))!;
  }

  updateContentFilter(
    id: number,
    userId: number | null,
    updates: {
      title?: string | undefined;
      context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
      filterAction?: "warn" | "hide" | "drop" | undefined;
      keywords?: { keyword: string; whole_word?: boolean | undefined }[] | undefined;
      expiresAt?: string | null | undefined;
    },
  ): ContentFilterRow | undefined {
    const existing = this.getContentFilter(id);
    if (!existing) return undefined;
    if (userId !== null && existing.user_id !== userId) {
      return undefined;
    }

    const nextTitle = updates.title !== undefined ? updates.title.trim() : existing.title;
    const nextContext = updates.context !== undefined ? updates.context : existing.context;
    const nextAction = updates.filterAction !== undefined ? updates.filterAction : existing.filter_action;
    const nextKeywords =
      updates.keywords !== undefined
        ? updates.keywords
            .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
            .map((k) => ({ keyword: k.keyword.trim(), whole_word: k.whole_word !== false }))
        : existing.keywords;
    const nextExpiresAt = updates.expiresAt !== undefined ? updates.expiresAt : existing.expires_at;

    this.db
      .prepare(
        `UPDATE content_filters
         SET title = ?, context = ?, filter_action = ?, keywords_json = ?, expires_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextTitle, JSON.stringify(nextContext), nextAction, JSON.stringify(nextKeywords), nextExpiresAt, id);

    return this.getContentFilter(id);
  }

  deleteContentFilter(id: number, userId?: number | null): boolean {
    if (typeof userId === "number") {
      const res = this.db.prepare(`DELETE FROM content_filters WHERE id = ? AND user_id = ?`).run(id, userId);
      return res.changes > 0;
    }
    const res = this.db.prepare(`DELETE FROM content_filters WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  applyContentFiltersToPosts(
    posts: PostRow[],
    context: "home" | "public" | "notifications" | "thread" | "account",
    currentUserId?: number,
  ): PostRow[] {
    if (posts.length === 0) return posts;

    // Filter out posts whose language feature flag is disabled
    const isModelScriptEnabled =
      this.facade.isFeatureFlagEnabled("lang_modelscript") || this.facade.isFeatureFlagEnabled("lang_modelscript_msx");

    const languageFilteredPosts: PostRow[] = [];
    for (const post of posts) {
      let meta: Record<string, unknown> | undefined =
        typeof post.metadata === "object" && post.metadata !== null
          ? (post.metadata as Record<string, unknown>)
          : undefined;
      if (typeof post.metadata === "string") {
        try {
          meta = JSON.parse(post.metadata) as Record<string, unknown>;
        } catch {
          meta = undefined;
        }
      }
      const postRec = post as unknown as Record<string, unknown>;
      const artifactView = post.artifact_view as Record<string, unknown> | undefined;
      const metaLang = String(meta?.["language"] || postRec["language"] || "")
        .trim()
        .toLowerCase();
      const metaDialect = String(meta?.["dialect"] || "")
        .trim()
        .toLowerCase();
      const viewType = String(artifactView?.["view_type"] || postRec["view_type"] || "")
        .trim()
        .toLowerCase();
      const filename = String(meta?.["filename"] || artifactView?.["name"] || artifactView?.["title"] || "")
        .trim()
        .toLowerCase();
      const title = String(meta?.["artifactTitle"] || artifactView?.["title"] || postRec["title"] || "")
        .trim()
        .toLowerCase();
      const content = String(post.content || "").toLowerCase();

      const isMsx =
        metaLang === "modelscript" ||
        metaLang === "msx" ||
        metaDialect === "modelscript" ||
        metaDialect === "msx" ||
        viewType === "modelscript" ||
        viewType === "msx" ||
        filename.endsWith(".msx") ||
        filename.endsWith(".modelscript") ||
        title.includes(".msx") ||
        content.includes("tiltrotortransitioncontroller.msx") ||
        (content.includes("#modelscript") && (content.includes(".msx") || viewType === "modelscript"));

      if (isMsx && !isModelScriptEnabled) {
        continue;
      }

      if (metaLang) {
        const flagKey = getLanguageFeatureFlagKey(metaLang);
        if (flagKey in FEATURE_FLAGS && !this.facade.isFeatureFlagEnabled(flagKey)) {
          continue;
        }
      }

      languageFilteredPosts.push(post);
    }

    let filters: ContentFilterRow[] = [];
    try {
      filters = this.listContentFilters(currentUserId).filter((f) => f.context.includes(context));
    } catch {
      return languageFilteredPosts;
    }
    if (filters.length === 0) return languageFilteredPosts;

    const result: PostRow[] = [];
    for (const post of languageFilteredPosts) {
      const haystack = `${post.content || ""} ${post.content_warning || ""}`.toLowerCase();
      const matched: ContentFilterMatch[] = [];
      let shouldDrop = false;

      for (const filter of filters) {
        const keywordMatches: string[] = [];
        for (const kw of filter.keywords) {
          const term = kw.keyword.toLowerCase();
          if (!term) continue;
          if (kw.whole_word) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "i");
            if (re.test(haystack)) {
              keywordMatches.push(kw.keyword);
            }
          } else if (haystack.includes(term)) {
            keywordMatches.push(kw.keyword);
          }
        }
        if (keywordMatches.length > 0) {
          if (filter.filter_action === "drop" || filter.filter_action === "hide") {
            shouldDrop = true;
          }
          matched.push({
            filter_id: filter.id,
            title: filter.title,
            filter_action: filter.filter_action,
            keyword_matches: keywordMatches,
            filter: {
              id: filter.id,
              title: filter.title,
              context: filter.context,
              filter_action: filter.filter_action,
            },
          });
        }
      }

      if (shouldDrop) {
        continue;
      }
      if (matched.length > 0) {
        post.filtered = matched;
        if (!post.content_warning) {
          post.content_warning = `Filtered: ${matched.map((m) => m.title).join(", ")}`;
          post.is_sensitive = 1;
        }
      }
      result.push(post);
    }
    return result;
  }

  // ── Federated Polls (`Question`) ─────────────────────────────────

  createPostPoll(
    postId: number | string,
    options: (string | { title: string; votes_count?: number })[],
    expiresAt?: string | null,
    multiple: boolean = false,
  ): PostPollView {
    const normalizedOptions: PostPollOption[] = options
      .map((opt) =>
        typeof opt === "string"
          ? { title: opt.trim(), votes_count: 0 }
          : { title: String(opt.title || "").trim(), votes_count: Number(opt.votes_count || 0) },
      )
      .filter((o) => o.title.length > 0);

    if (normalizedOptions.length < 2) {
      throw new Error("A poll must include at least 2 options");
    }

    const totalVotes = normalizedOptions.reduce((sum, o) => sum + o.votes_count, 0);
    this.db
      .prepare(
        `INSERT INTO post_polls (post_id, options_json, expires_at, multiple, votes_count, voters_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(post_id) DO UPDATE SET
           options_json = excluded.options_json,
           expires_at = excluded.expires_at,
           multiple = excluded.multiple,
           votes_count = excluded.votes_count`,
      )
      .run(postId, JSON.stringify(normalizedOptions), expiresAt ?? null, multiple ? 1 : 0, totalVotes, totalVotes);

    return this.getPostPoll(postId)!;
  }

  getPostPoll(postId: number | string, currentUserId?: number): PostPollView | null {
    try {
      const row = this.db.prepare(`SELECT * FROM post_polls WHERE post_id = ?`).get(postId) as
        | {
            id: number;
            post_id: number | string;
            options_json: string;
            expires_at: string | null;
            multiple: number;
            votes_count: number;
            voters_count: number;
          }
        | undefined;
      if (!row) return null;

      let options: PostPollOption[] = [];
      try {
        const parsed = JSON.parse(row.options_json);
        if (Array.isArray(parsed)) {
          options = parsed.map((o) => ({
            title: String(o.title || ""),
            votes_count: Number(o.votes_count || 0),
          }));
        }
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }

      const ownVotes: number[] = [];
      if (currentUserId && currentUserId > 0) {
        const voteRows = this.db
          .prepare(`SELECT option_index FROM post_poll_votes WHERE poll_id = ? AND voter_user_id = ?`)
          .all(row.id, currentUserId) as { option_index: number }[];
        for (const v of voteRows) {
          ownVotes.push(Number(v.option_index));
        }
      }

      const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= Date.now());
      return {
        id: row.id,
        post_id: String(row.post_id),
        expires_at: row.expires_at,
        expired,
        multiple: Boolean(row.multiple),
        votes_count: Number(row.votes_count || 0),
        voters_count: Number(row.voters_count || 0),
        voted: ownVotes.length > 0,
        own_votes: ownVotes,
        options,
      };
    } catch {
      return null;
    }
  }

  votePostPoll(
    postId: number | string,
    choices: number[],
    voterUserId?: number | null,
    voterActorUrl?: string | null,
  ): PostPollView {
    const poll = this.getPostPoll(postId, voterUserId ?? undefined);
    if (!poll) {
      throw new Error("Poll not found for this post");
    }
    if (poll.expired) {
      throw new Error("This poll has already expired");
    }
    const uniqueChoices = Array.from(new Set(choices.map((c) => Number(c)))).filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < poll.options.length,
    );
    if (uniqueChoices.length === 0) {
      throw new Error("At least one valid poll option index is required");
    }
    if (!poll.multiple && uniqueChoices.length > 1) {
      throw new Error("This poll does not allow multiple choices");
    }

    const tx = this.db.transaction(() => {
      if (voterUserId) {
        const existingVote = this.db
          .prepare(`SELECT 1 FROM post_poll_votes WHERE poll_id = ? AND voter_user_id = ? LIMIT 1`)
          .get(poll.id, voterUserId);
        if (existingVote) {
          throw new Error("You have already voted in this poll");
        }
      } else if (voterActorUrl) {
        const existingRemote = this.db
          .prepare(`SELECT 1 FROM post_poll_votes WHERE poll_id = ? AND voter_actor_url = ? LIMIT 1`)
          .get(poll.id, voterActorUrl);
        if (existingRemote) {
          return;
        }
      }

      const insertVote = this.db.prepare(
        `INSERT INTO post_poll_votes (poll_id, post_id, voter_user_id, voter_actor_url, option_index, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      );
      const updatedOptions = poll.options.map((o) => ({ ...o }));
      for (const choiceIdx of uniqueChoices) {
        insertVote.run(poll.id, postId, voterUserId ?? null, voterActorUrl ?? null, choiceIdx);
        const opt = updatedOptions[choiceIdx];
        if (opt) {
          opt.votes_count += 1;
        }
      }

      const nextVotesCount = updatedOptions.reduce((sum, o) => sum + o.votes_count, 0);
      this.db
        .prepare(
          `UPDATE post_polls
           SET options_json = ?, votes_count = ?, voters_count = voters_count + 1
           WHERE id = ?`,
        )
        .run(JSON.stringify(updatedOptions), nextVotesCount, poll.id);
    });
    tx();

    return this.getPostPoll(postId, voterUserId ?? undefined)!;
  }

  // ── Follow Requests (Locked Accounts) ────────────────────────────

  getPendingFollowRequests(userId: number): {
    id: number;
    follower_id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    actor_url: string | null;
    inbox_url: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT f.id, f.follower_id, u.username, u.display_name, u.avatar_url, u.bio, u.actor_url, u.inbox_url, f.created_at
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND f.state = 'pending'
         ORDER BY f.id DESC`,
      )
      .all(userId) as {
      id: number;
      follower_id: number;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      actor_url: string | null;
      inbox_url: string | null;
      created_at: string;
    }[];
  }

  acceptFollowRequest(followingId: number, followerId: number): boolean {
    const res = this.db
      .prepare(`UPDATE follows SET state = 'accepted' WHERE following_id = ? AND follower_id = ?`)
      .run(followingId, followerId);
    if (res.changes > 0) {
      this.facade.createNotification(followerId, followingId, "follow_accepted");
      return true;
    }
    return false;
  }

  rejectFollowRequest(followingId: number, followerId: number): boolean {
    const res = this.db
      .prepare(`DELETE FROM follows WHERE following_id = ? AND follower_id = ? AND state = 'pending'`)
      .run(followingId, followerId);
    return res.changes > 0;
  }

  // ── Account Migration, Key Rotation & Social Graph Portability ───

  rotateUserKeys(userId: number): { publicKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    this.db.prepare(`UPDATE users SET public_key = ?, private_key = ? WHERE id = ?`).run(publicKey, privateKey, userId);
    return { publicKey };
  }

  setUserAliases(userId: number, alsoKnownAs: string[]): string[] {
    const normalized = Array.from(new Set(alsoKnownAs.map((u) => String(u || "").trim()).filter((u) => u.length > 0)));
    this.db.prepare(`UPDATE users SET also_known_as = ? WHERE id = ?`).run(JSON.stringify(normalized), userId);
    return normalized;
  }

  initiateLocalUserMove(
    userId: number,
    targetActorUrl: string,
  ): { movedToActorUrl: string; migratedLocalFollowers: number } {
    const cleanTarget = targetActorUrl.trim();
    if (!cleanTarget) {
      throw new Error("Target actor URL is required");
    }
    this.db.prepare(`UPDATE users SET moved_to_actor_url = ? WHERE id = ?`).run(cleanTarget, userId);

    // If the target actor already exists locally, migrate local followers immediately
    let migratedLocalFollowers = 0;
    const targetUser = this.facade.getUserByActorUrl(cleanTarget);
    if (targetUser && targetUser.id !== userId) {
      const followers = this.db
        .prepare(`SELECT follower_id, state FROM follows WHERE following_id = ?`)
        .all(userId) as { follower_id: number; state: string | null }[];
      const insertFollow = this.db.prepare(
        `INSERT OR IGNORE INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)`,
      );
      const deleteOld = this.db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`);
      const tx = this.db.transaction(() => {
        for (const f of followers) {
          if (f.follower_id === targetUser.id) continue;
          insertFollow.run(f.follower_id, targetUser.id, f.state || "accepted");
          deleteOld.run(f.follower_id, userId);
          migratedLocalFollowers++;
        }
      });
      tx();
    }

    return { movedToActorUrl: cleanTarget, migratedLocalFollowers };
  }

  executeInboundActorMove(
    sourceActorUrl: string,
    targetActorUrl: string,
    targetAlsoKnownAs: string[],
    targetProfile?: {
      username?: string | undefined;
      displayName?: string | undefined;
      inboxUrl?: string | undefined;
      sharedInboxUrl?: string | undefined;
      publicKey?: string | undefined;
    },
  ): { success: boolean; reason?: string | undefined; migratedFollowers: number } {
    const cleanSource = sourceActorUrl.trim();
    const cleanTarget = targetActorUrl.trim();
    if (!cleanSource || !cleanTarget || cleanSource === cleanTarget) {
      return { success: false, reason: "Invalid source or target actor URL", migratedFollowers: 0 };
    }

    // Verify bidirectional alsoKnownAs claim per ActivityPub Move specification
    const normalizedAliases = targetAlsoKnownAs.map((a) => a.trim().replace(/\/$/, ""));
    if (!normalizedAliases.includes(cleanSource.replace(/\/$/, ""))) {
      return {
        success: false,
        reason: `Target actor '${cleanTarget}' does not list source '${cleanSource}' in alsoKnownAs`,
        migratedFollowers: 0,
      };
    }

    const sourceUser = this.facade.getUserByActorUrl(cleanSource);
    if (!sourceUser) {
      return { success: false, reason: "Source actor not found", migratedFollowers: 0 };
    }

    let targetUser = this.facade.getUserByActorUrl(cleanTarget);
    if (!targetUser) {
      let username = targetProfile?.username || "migrated_actor";
      try {
        const parsed = new URL(cleanTarget);
        const pathParts = parsed.pathname.split("/").filter(Boolean);
        username = targetProfile?.username || pathParts[pathParts.length - 1] || "migrated_actor";
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
      const created = this.facade.getOrCreateRemoteUser(cleanTarget, {
        preferredUsername: username,
        name: targetProfile?.displayName,
        inbox: targetProfile?.inboxUrl || `${cleanTarget.replace(/\/$/, "")}/inbox`,
        sharedInbox: targetProfile?.sharedInboxUrl,
        publicKey: targetProfile?.publicKey || "",
        alsoKnownAs: targetAlsoKnownAs,
      });
      const fetched = this.facade.getUserById(created.id);
      if (!fetched) {
        return { success: false, reason: "Failed to initialize target remote user", migratedFollowers: 0 };
      }
      targetUser = fetched;
    }

    let migratedFollowers = 0;
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE users SET moved_to_actor_url = ? WHERE id = ?`).run(cleanTarget, sourceUser.id);
      const followers = this.db
        .prepare(`SELECT follower_id, state FROM follows WHERE following_id = ?`)
        .all(sourceUser.id) as { follower_id: number; state: string | null }[];
      const insertFollow = this.db.prepare(
        `INSERT OR IGNORE INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)`,
      );
      const deleteOld = this.db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`);
      for (const f of followers) {
        if (f.follower_id === targetUser!.id) continue;
        insertFollow.run(f.follower_id, targetUser!.id, f.state || "accepted");
        deleteOld.run(f.follower_id, sourceUser.id);
        migratedFollowers++;
      }
    });
    tx();

    return { success: true, migratedFollowers };
  }

  exportUserSocialGraph(userId: number): {
    following: string[];
    followers: string[];
    blocks: string[];
    mutes: string[];
    bookmarks: number[];
    followingCsv: string;
    blocksCsv: string;
    mutesCsv: string;
  } {
    const followingRows = this.db
      .prepare(
        `SELECT u.username, u.remote_domain
         FROM follows f JOIN users u ON f.following_id = u.id
         WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(userId) as { username: string; remote_domain: string | null }[];
    const following = followingRows.map((r) =>
      r.username.includes("@") || !r.remote_domain ? r.username : `${r.username}@${r.remote_domain}`,
    );

    const followerRows = this.db
      .prepare(
        `SELECT u.username, u.remote_domain
         FROM follows f JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(userId) as { username: string; remote_domain: string | null }[];
    const followers = followerRows.map((r) =>
      r.username.includes("@") || !r.remote_domain ? r.username : `${r.username}@${r.remote_domain}`,
    );

    const blockRows = this.db
      .prepare(`SELECT u.username FROM user_blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?`)
      .all(userId) as { username: string }[];
    const blocks = blockRows.map((r) => r.username);

    const muteRows = this.db
      .prepare(`SELECT u.username FROM user_mutes m JOIN users u ON m.muted_id = u.id WHERE m.muter_id = ?`)
      .all(userId) as { username: string }[];
    const mutes = muteRows.map((r) => r.username);

    const bookmarkRows = this.db
      .prepare(`SELECT post_id FROM bookmarks WHERE user_id = ? ORDER BY id DESC`)
      .all(userId) as { post_id: number }[];
    const bookmarks = bookmarkRows.map((r) => Number(r.post_id));

    const followingCsv = [
      "Account address,Show boosts,Notify on new posts,Languages",
      ...following.map((acct) => `${acct},true,false,`),
    ].join("\n");
    const blocksCsv = ["Account address", ...blocks].join("\n");
    const mutesCsv = ["Account address,Hide notifications", ...mutes.map((acct) => `${acct},true`)].join("\n");

    return {
      following,
      followers,
      blocks,
      mutes,
      bookmarks,
      followingCsv,
      blocksCsv,
      mutesCsv,
    };
  }

  importUserSocialGraph(
    userId: number,
    data: {
      following?: string[] | undefined;
      blocks?: string[] | undefined;
      mutes?: string[] | undefined;
      mode?: "merge" | "replace" | "overwrite" | undefined;
    },
    modeArg: "merge" | "replace" | "overwrite" = "merge",
  ): {
    importedFollowing: number;
    importedBlocks: number;
    importedMutes: number;
  } {
    const effectiveMode =
      data.mode === "overwrite" || data.mode === "replace" || modeArg === "overwrite" || modeArg === "replace"
        ? "replace"
        : "merge";
    let importedFollowing = 0;
    let importedBlocks = 0;
    let importedMutes = 0;

    const resolveOrCreateTarget = (rawHandle: string): number | null => {
      const clean = rawHandle.trim().replace(/^@/, "").split(",")[0]?.trim() || "";
      if (!clean || clean === "Account address") return null;
      const existing = this.facade.getUserByUsername(clean) || this.facade.getUserByActorUrl(clean);
      if (existing) return existing.id;
      if (clean.includes("@")) {
        const [uname, dom] = clean.split("@");
        if (uname && dom) {
          const byLocal = this.facade.getUserByUsername(uname);
          if (byLocal) return byLocal.id;
          const actorUrl = `https://${dom.toLowerCase()}/users/${uname}`;
          const remote = this.facade.getOrCreateRemoteUser(actorUrl, {
            preferredUsername: uname,
            inbox: `https://${dom.toLowerCase()}/users/${uname}/inbox`,
            publicKey: "",
          });
          return remote.id;
        }
      }
      return null;
    };

    const tx = this.db.transaction(() => {
      if (Array.isArray(data.following)) {
        if (effectiveMode === "replace") {
          this.db.prepare(`DELETE FROM follows WHERE follower_id = ?`).run(userId);
        }
        for (const handle of data.following) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.facade.followUser(userId, targetId, "accepted");
            importedFollowing++;
          }
        }
      }

      if (Array.isArray(data.blocks)) {
        if (effectiveMode === "replace") {
          this.db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ?`).run(userId);
        }
        for (const handle of data.blocks) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.facade.blockUser(userId, targetId);
            importedBlocks++;
          }
        }
      }

      if (Array.isArray(data.mutes)) {
        if (effectiveMode === "replace") {
          this.db.prepare(`DELETE FROM user_mutes WHERE muter_id = ?`).run(userId);
        }
        for (const handle of data.mutes) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.facade.muteUser(userId, targetId);
            importedMutes++;
          }
        }
      }
    });
    tx();

    return { importedFollowing, importedBlocks, importedMutes };
  }

  // ── Remote Media Cache Proxy & Retention Pruning ─────────────────

  getCachedRemoteArtifact(sourceUrl: string): RemoteArtifactCacheRow | undefined {
    const clean = sourceUrl.trim();
    const row = this.db
      .prepare(
        `SELECT * FROM remote_artifact_cache
         WHERE source_url = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
      )
      .get(clean) as RemoteArtifactCacheRow | undefined;
    if (row) {
      this.db.prepare(`UPDATE remote_artifact_cache SET last_accessed_at = datetime('now') WHERE id = ?`).run(row.id);
    }
    return row;
  }

  putCachedRemoteArtifact(entry: {
    sourceUrl: string;
    remoteDomain: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
    data: Buffer;
    ttlDays?: number | undefined;
  }): RemoteArtifactCacheRow {
    const ttlDays = entry.ttlDays ?? (this.facade.getInstanceSettings().remoteMediaCacheRetentionDays || 14);
    const expiresAt = new Date(Date.now() + Math.max(1, ttlDays) * 86_400_000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    try {
      const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM remote_artifact_cache`).get() as
        { c: number } | undefined;
      if (countRow && countRow.c >= 5000) {
        this.db
          .prepare(
            `DELETE FROM remote_artifact_cache WHERE id IN (SELECT id FROM remote_artifact_cache ORDER BY last_accessed_at ASC LIMIT 100)`,
          )
          .run();
      }
    } catch {
      // Malformed JSON/URL or best-effort fallback ignored
    }

    this.db
      .prepare(
        `INSERT INTO remote_artifact_cache (source_url, remote_domain, media_type, byte_size, sha256, data_blob, last_accessed_at, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
         ON CONFLICT(source_url) DO UPDATE SET
           media_type = excluded.media_type,
           byte_size = excluded.byte_size,
           sha256 = excluded.sha256,
           data_blob = excluded.data_blob,
           last_accessed_at = datetime('now'),
           expires_at = excluded.expires_at`,
      )
      .run(
        entry.sourceUrl.trim(),
        entry.remoteDomain.toLowerCase().trim(),
        entry.mediaType,
        entry.byteSize,
        entry.sha256,
        entry.data,
        expiresAt,
      );

    return this.db
      .prepare(`SELECT * FROM remote_artifact_cache WHERE source_url = ?`)
      .get(entry.sourceUrl.trim()) as RemoteArtifactCacheRow;
  }

  pruneRemoteMediaCache(olderThanDays?: number): { deletedFiles: number; freedBytes: number } {
    const days = olderThanDays ?? this.facade.getInstanceSettings().remoteMediaCacheRetentionDays ?? 14;
    const cutoff =
      days <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const statsRow = this.db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(byte_size), 0) as totalBytes
         FROM remote_artifact_cache
         WHERE last_accessed_at <= ? OR (expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now'))`,
      )
      .get(cutoff) as { c: number; totalBytes: number } | undefined;

    const res = this.db
      .prepare(
        `DELETE FROM remote_artifact_cache
         WHERE last_accessed_at <= ? OR (expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now'))`,
      )
      .run(cutoff);

    return {
      deletedFiles: Number(res.changes || statsRow?.c || 0),
      freedBytes: Number(statsRow?.totalBytes || 0),
    };
  }

  pruneRemoteContent(olderThanDays?: number): { deletedPosts: number } {
    const days = olderThanDays ?? this.facade.getInstanceSettings().remoteContentRetentionDays ?? 90;
    const cutoff =
      days <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const res = this.db
      .prepare(
        `DELETE FROM posts
         WHERE created_at <= ?
           AND (ap_id IS NOT NULL OR author_id IN (SELECT id FROM users WHERE account_type = 'remote' OR remote_domain IS NOT NULL))
           AND id NOT IN (SELECT DISTINCT post_id FROM likes WHERE post_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT post_id FROM bookmarks WHERE post_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT reply_to_id FROM posts WHERE reply_to_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT repost_of_id FROM posts WHERE repost_of_id IS NOT NULL)`,
      )
      .run(cutoff);

    return { deletedPosts: Number(res.changes) };
  }

  pruneRemoteAccounts(olderThanDays: number = 90): { deletedAccounts: number } {
    const cutoff =
      olderThanDays <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - olderThanDays * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const res = this.db
      .prepare(
        `DELETE FROM users
         WHERE (account_type = 'remote' OR remote_domain IS NOT NULL)
           AND created_at <= ?
           AND id NOT IN (SELECT following_id FROM follows)
           AND id NOT IN (SELECT follower_id FROM follows)
           AND id NOT IN (SELECT author_id FROM posts)`,
      )
      .run(cutoff);

    return { deletedAccounts: Number(res.changes) };
  }

  // ── Trending Topic Moderation ────────────────────────────────────

  listTrendingTopicsForAdmin(reviewStatus?: string, limit: number = 50): TrendingTopicRow[] {
    if (reviewStatus && reviewStatus !== "all") {
      return this.db
        .prepare(
          `SELECT * FROM trending_topics
           WHERE COALESCE(review_status, 'approved') = ?
           ORDER BY current_score DESC LIMIT ?`,
        )
        .all(reviewStatus, limit) as TrendingTopicRow[];
    }
    return this.db
      .prepare(`SELECT * FROM trending_topics ORDER BY current_score DESC LIMIT ?`)
      .all(limit) as TrendingTopicRow[];
  }

  reviewTrendingTopic(
    topicId: number,
    status: "pending" | "approved" | "rejected",
    reviewerId?: number | null,
  ): TrendingTopicRow | undefined {
    this.db
      .prepare(
        `UPDATE trending_topics
         SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now')
         WHERE id = ?`,
      )
      .run(status, reviewerId ?? null, topicId);
    return this.db.prepare(`SELECT * FROM trending_topics WHERE id = ?`).get(topicId) as TrendingTopicRow | undefined;
  }

  // ── Web Push Subscriptions (RFC 8030) ────────────────────────────

  #mapPushSubscription(row: {
    id: number;
    user_id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    alerts_json?: string | null;
    policy?: string | null;
    created_at: string;
    updated_at?: string | null;
  }): PushSubscriptionRow {
    let alerts: Record<string, boolean> = {
      mention: true,
      follow: true,
      reblog: true,
      favourite: true,
      poll: true,
    };
    if (row?.alerts_json) {
      try {
        alerts = JSON.parse(row.alerts_json);
      } catch {
        // Malformed JSON/URL or best-effort fallback ignored
      }
    }
    return {
      id: row.id,
      user_id: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      alerts,
      policy: (row.policy as "all" | "followed" | "follower" | "none") || "all",
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
    };
  }

  listPushSubscriptions(userId: number): PushSubscriptionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC`)
      .all(userId) as Array<{
      id: number;
      user_id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      alerts_json?: string | null;
      policy?: string | null;
      created_at: string;
      updated_at?: string | null;
    }>;
    return rows.map((r) => this.#mapPushSubscription(r));
  }

  upsertPushSubscription(
    userId: number,
    endpoint: string,
    p256dh: string,
    auth: string,
    alerts: Record<string, boolean> = {
      mention: true,
      follow: true,
      reblog: true,
      favourite: true,
      poll: true,
    },
    policy: string = "all",
  ): PushSubscriptionRow {
    const cleanEndpoint = endpoint.trim();
    if (!cleanEndpoint) {
      throw new Error("Push subscription endpoint URL is required");
    }
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, alerts_json, policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           alerts_json = excluded.alerts_json,
           policy = excluded.policy,
           updated_at = datetime('now')`,
      )
      .run(userId, cleanEndpoint, p256dh, auth, JSON.stringify(alerts), policy);

    const row = this.db
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
      .get(userId, cleanEndpoint) as
      | {
          id: number;
          user_id: number;
          endpoint: string;
          p256dh: string;
          auth: string;
          alerts_json?: string | null;
          policy?: string | null;
          created_at: string;
          updated_at?: string | null;
        }
      | undefined;
    if (!row) {
      throw new Error("Failed to retrieve upserted push subscription");
    }
    return this.#mapPushSubscription(row);
  }

  deletePushSubscription(userId: number, idOrEndpoint: number | string): boolean {
    if (typeof idOrEndpoint === "number") {
      const res = this.db
        .prepare(`DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?`)
        .run(idOrEndpoint, userId);
      return res.changes > 0;
    }
    const res = this.db
      .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`)
      .run(idOrEndpoint.trim(), userId);
    return res.changes > 0;
  }
}
