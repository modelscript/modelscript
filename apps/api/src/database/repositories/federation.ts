// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { FederationRelayRow } from "../types.js";
import { BaseRepository } from "./base.js";

export class FederationRepository extends BaseRepository {
  // ── Federation Domain Moderation ─────────────────────────────────

  getDomainTier(domain: string): {
    domain: string;
    tier: "allow" | "silence" | "suspend";
    reason?: string | undefined;
    rejectMedia: boolean;
    rejectReports: boolean;
    obfuscate: boolean;
    publicComment?: string | null | undefined;
    privateComment?: string | null | undefined;
    unavailableSince?: string | null | undefined;
    consecutiveFailures: number;
    lastSeenAt?: string | null | undefined;
  } {
    const cleanDomain = domain.toLowerCase().trim();
    type DomainTierRow = {
      domain: string;
      tier: "allow" | "silence" | "suspend";
      reason: string | null;
      reject_media?: number | null;
      reject_reports?: number | null;
      obfuscate?: number | null;
      public_comment?: string | null;
      private_comment?: string | null;
      unavailable_since?: string | null;
      consecutive_failures?: number | null;
      last_seen_at?: string | null;
    };

    let row = this.get<DomainTierRow>(
      `SELECT domain, tier, reason, reject_media, reject_reports, obfuscate, public_comment, private_comment,
              unavailable_since, consecutive_failures, last_seen_at
       FROM federation_domains WHERE domain = ?`,
      cleanDomain,
    );

    if (!row && cleanDomain.includes(".")) {
      const parts = cleanDomain.split(".");
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(i).join(".");
        const wildcard = `*.${parent}`;
        const match = this.get<DomainTierRow>(
          `SELECT domain, tier, reason, reject_media, reject_reports, obfuscate, public_comment, private_comment,
                  unavailable_since, consecutive_failures, last_seen_at
           FROM federation_domains WHERE domain = ? OR domain = ?`,
          parent,
          wildcard,
        );
        if (match) {
          row = match;
          break;
        }
      }
    }
    if (!row) {
      return {
        domain: cleanDomain,
        tier: "allow",
        rejectMedia: false,
        rejectReports: false,
        obfuscate: false,
        consecutiveFailures: 0,
      };
    }
    return {
      domain: row.domain,
      tier: row.tier,
      reason: row.reason || undefined,
      rejectMedia: Boolean(row.reject_media),
      rejectReports: Boolean(row.reject_reports),
      obfuscate: Boolean(row.obfuscate),
      publicComment: row.public_comment ?? row.reason ?? null,
      privateComment: row.private_comment ?? null,
      unavailableSince: row.unavailable_since ?? null,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastSeenAt: row.last_seen_at ?? null,
    };
  }

  setDomainTier(
    domain: string,
    tier: "allow" | "silence" | "suspend",
    reason?: string,
    options?: {
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    },
  ): void {
    const cleanDomain = domain.toLowerCase().trim();
    const existing = this.getDomainTier(cleanDomain);
    const rejectMedia =
      options?.rejectMedia !== undefined ? (options.rejectMedia ? 1 : 0) : existing.rejectMedia ? 1 : 0;
    const rejectReports =
      options?.rejectReports !== undefined ? (options.rejectReports ? 1 : 0) : existing.rejectReports ? 1 : 0;
    const obfuscate = options?.obfuscate !== undefined ? (options.obfuscate ? 1 : 0) : existing.obfuscate ? 1 : 0;
    const publicComment =
      options?.publicComment !== undefined ? options.publicComment : (reason ?? existing.publicComment ?? null);
    const privateComment =
      options?.privateComment !== undefined ? options.privateComment : (existing.privateComment ?? null);
    const effectiveReason = reason ?? publicComment ?? existing.reason ?? null;

    this.run(
      `INSERT INTO federation_domains (domain, tier, reason, reject_media, reject_reports, obfuscate, public_comment, private_comment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET
         tier = excluded.tier,
         reason = excluded.reason,
         reject_media = excluded.reject_media,
         reject_reports = excluded.reject_reports,
         obfuscate = excluded.obfuscate,
         public_comment = excluded.public_comment,
         private_comment = excluded.private_comment,
         updated_at = datetime('now')`,
      cleanDomain,
      tier,
      effectiveReason,
      rejectMedia,
      rejectReports,
      obfuscate,
      publicComment,
      privateComment,
    );
  }

  deleteDomainTier(domain: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    this.run(`DELETE FROM federation_domains WHERE domain = ?`, cleanDomain);
  }

  listFederationDomains(): {
    domain: string;
    tier: string;
    reason?: string | undefined;
    reject_media: number;
    reject_reports: number;
    obfuscate: number;
    public_comment: string | null;
    private_comment: string | null;
    unavailable_since: string | null;
    consecutive_failures: number;
    last_seen_at: string | null;
    created_at: string;
    updated_at: string;
  }[] {
    return this.all<{
      domain: string;
      tier: string;
      reason?: string | undefined;
      reject_media: number;
      reject_reports: number;
      obfuscate: number;
      public_comment: string | null;
      private_comment: string | null;
      unavailable_since: string | null;
      consecutive_failures: number;
      last_seen_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT domain, tier, reason,
              COALESCE(reject_media, 0) as reject_media,
              COALESCE(reject_reports, 0) as reject_reports,
              COALESCE(obfuscate, 0) as obfuscate,
              public_comment, private_comment,
              unavailable_since,
              COALESCE(consecutive_failures, 0) as consecutive_failures,
              last_seen_at,
              created_at, updated_at
       FROM federation_domains
       ORDER BY created_at DESC`,
    );
  }

  isDomainSuspended(domain: string): boolean {
    return this.getDomainTier(domain).tier === "suspend";
  }

  isDomainSilenced(domain: string): boolean {
    return this.getDomainTier(domain).tier === "silence";
  }

  isDomainAllowedForFederation(domain: string): boolean {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return false;
    const settings = this.facade.getInstanceSettings();
    if (settings.federationMode === "disabled") {
      return false;
    }
    if (settings.federationMode === "allowlist") {
      const row = this.get<{ tier: string }>(`SELECT tier FROM federation_domains WHERE domain = ?`, cleanDomain);
      return row?.tier === "allow";
    }
    return !this.isDomainSuspended(cleanDomain);
  }

  exportFederationDomains(format: "json" | "csv" = "json"): string {
    const domains = this.listFederationDomains();
    if (format === "csv") {
      const header = "#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate";
      const rows = domains.map((d) => {
        const severity = d.tier === "suspend" ? "suspend" : d.tier === "silence" ? "silence" : "allow";
        const comment = (d.public_comment ?? d.reason ?? "").replace(/"/g, '""');
        return `${d.domain},${severity},${Boolean(d.reject_media)},${Boolean(d.reject_reports)},"${comment}",${Boolean(d.obfuscate)}`;
      });
      return [header, ...rows].join("\n");
    }
    return JSON.stringify(
      domains.map((d) => ({
        domain: d.domain,
        tier: d.tier,
        reason: d.reason ?? d.public_comment ?? "",
        rejectMedia: Boolean(d.reject_media),
        rejectReports: Boolean(d.reject_reports),
        obfuscate: Boolean(d.obfuscate),
        publicComment: d.public_comment ?? d.reason ?? "",
        privateComment: d.private_comment ?? "",
        updatedAt: d.updated_at,
      })),
      null,
      2,
    );
  }

  importFederationDomains(
    entries: {
      domain: string;
      tier?: "allow" | "silence" | "suspend";
      reason?: string | null | undefined;
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    }[],
    mode: "merge" | "replace" = "merge",
  ): { importedCount: number } {
    let importedCount = 0;
    this.transaction(() => {
      if (mode === "replace") {
        this.run(`DELETE FROM federation_domains`);
      }
      for (const entry of entries) {
        const cleanDomain = (entry.domain || "").toLowerCase().trim();
        if (!cleanDomain || cleanDomain.startsWith("#")) continue;
        const normalizedTier =
          entry.tier === "suspend" || entry.tier === "silence" || entry.tier === "allow" ? entry.tier : "suspend";
        this.setDomainTier(cleanDomain, normalizedTier, entry.reason ?? undefined, {
          rejectMedia: entry.rejectMedia,
          rejectReports: entry.rejectReports,
          obfuscate: entry.obfuscate,
          publicComment: entry.publicComment ?? entry.reason,
          privateComment: entry.privateComment,
        });
        importedCount++;
      }
    });
    return { importedCount };
  }

  // ── Federation Delivery Queue ─────────────────────────────────────

  enqueueFederationDelivery(
    activityType: string,
    activityId: string,
    payload: Record<string, unknown>,
    targetInboxUrl: string,
    targetDomain: string,
  ): { id: number; skipped?: boolean } {
    const cleanDomain = targetDomain.toLowerCase().trim();
    if (this.isDomainSuspended(cleanDomain) || this.isDomainUnavailable(cleanDomain)) {
      return { id: 0, skipped: true };
    }
    const res = this.run(
      `INSERT INTO federation_delivery_queue (activity_type, activity_id, payload, target_inbox_url, target_domain, status, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))`,
      activityType,
      activityId,
      JSON.stringify(payload),
      targetInboxUrl,
      cleanDomain,
    );
    return { id: Number(res.lastInsertRowid) };
  }

  fetchPendingFederationDeliveries(limit: number = 25): {
    id: number;
    activity_type: string;
    activity_id: string;
    payload: string;
    target_inbox_url: string;
    target_domain: string;
    attempts: number;
    max_attempts: number;
  }[] {
    return this.all<{
      id: number;
      activity_type: string;
      activity_id: string;
      payload: string;
      target_inbox_url: string;
      target_domain: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT * FROM federation_delivery_queue 
       WHERE status = 'pending' AND datetime(next_retry_at) <= datetime('now')
       ORDER BY id ASC LIMIT ?`,
      limit,
    );
  }

  updateFederationDeliveryStatus(
    id: number,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
    nextRetryMs?: number,
  ): void {
    if (status === "completed") {
      this.run(
        `UPDATE federation_delivery_queue SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
        id,
      );
    } else if (status === "failed") {
      this.run(
        `UPDATE federation_delivery_queue SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`,
        error || null,
        id,
      );
    } else if (status === "processing") {
      this.run(
        `UPDATE federation_delivery_queue SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
        id,
      );
    } else if (status === "pending" && nextRetryMs) {
      const nextDate = new Date(Date.now() + nextRetryMs).toISOString();
      this.run(
        `UPDATE federation_delivery_queue SET status = 'pending', last_error = ?, next_retry_at = ?, updated_at = datetime('now') WHERE id = ?`,
        error || null,
        nextDate,
        id,
      );
    }
  }

  getFederationQueueStats(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const rows = this.all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM federation_delivery_queue GROUP BY status`,
    );
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    for (const r of rows) {
      if (r.status === "pending") stats.pending = r.count;
      else if (r.status === "processing") stats.processing = r.count;
      else if (r.status === "completed") stats.completed = r.count;
      else if (r.status === "failed") stats.failed = r.count;
      stats.total += r.count;
    }
    return stats;
  }

  listFederationDeliveries(
    status?: string,
    domain?: string,
    limit: number = 50,
  ): {
    id: number;
    activity_type: string;
    activity_id: string;
    payload: string;
    target_inbox_url: string;
    target_domain: string;
    attempts: number;
    max_attempts: number;
    next_retry_at: string;
    last_error: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    if (domain && domain.trim()) {
      clauses.push("LOWER(target_domain) LIKE ?");
      params.push(`%${domain.trim().toLowerCase()}%`);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    return this.all<{
      id: number;
      activity_type: string;
      activity_id: string;
      payload: string;
      target_inbox_url: string;
      target_domain: string;
      attempts: number;
      max_attempts: number;
      next_retry_at: string;
      last_error: string | null;
      status: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, activity_type, activity_id, payload, target_inbox_url, target_domain, attempts, max_attempts, next_retry_at, last_error, status, created_at, updated_at
       FROM federation_delivery_queue
       ${whereSql}
       ORDER BY id DESC LIMIT ?`,
      ...params,
    );
  }

  retryFailedFederationDeliveries(domain?: string): { retriedCount: number } {
    if (domain && domain.trim()) {
      const cleanDomain = domain.trim().toLowerCase();
      this.run(
        `UPDATE federation_domains SET unavailable_since = NULL, consecutive_failures = 0 WHERE LOWER(domain) = ?`,
        cleanDomain,
      );
      const res = this.run(
        `UPDATE federation_delivery_queue
         SET status = 'pending', attempts = 0, next_retry_at = datetime('now'), updated_at = datetime('now')
         WHERE status = 'failed' AND LOWER(target_domain) = ?`,
        cleanDomain,
      );
      return { retriedCount: Number(res.changes) };
    }
    const res = this.run(
      `UPDATE federation_delivery_queue
       SET status = 'pending', attempts = 0, next_retry_at = datetime('now'), updated_at = datetime('now')
       WHERE status = 'failed'`,
    );
    return { retriedCount: Number(res.changes) };
  }

  purgeFederationDeliveries(status?: string, domain?: string): { deletedCount: number } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    if (domain && domain.trim()) {
      clauses.push("LOWER(target_domain) = ?");
      params.push(domain.trim().toLowerCase());
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = this.run(`DELETE FROM federation_delivery_queue ${whereSql}`, ...params);
    return { deletedCount: Number(res.changes) };
  }

  getFederationDomainHealth(): {
    domain: string;
    tier: "allow" | "silence" | "suspend";
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
    maxAttempts: number;
    lastError: string | null;
    lastUpdatedAt: string | null;
    unavailableSince: string | null;
    consecutiveFailures: number;
    lastSeenAt: string | null;
  }[] {
    const rows = this.all<{
      domain: string;
      tier: string;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      total: number;
      max_attempts: number;
      last_error: string | null;
      last_updated_at: string | null;
      unavailable_since: string | null;
      consecutive_failures: number;
      last_seen_at: string | null;
    }>(
      `SELECT LOWER(q.target_domain) as domain,
              COALESCE(d.tier, 'allow') as tier,
              SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN q.status = 'processing' THEN 1 ELSE 0 END) as processing,
              SUM(CASE WHEN q.status = 'completed' THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END) as failed,
              COUNT(*) as total,
              MAX(q.attempts) as max_attempts,
              MAX(q.last_error) as last_error,
              MAX(q.updated_at) as last_updated_at,
              MAX(d.unavailable_since) as unavailable_since,
              COALESCE(MAX(d.consecutive_failures), 0) as consecutive_failures,
              MAX(d.last_seen_at) as last_seen_at
       FROM federation_delivery_queue q
       LEFT JOIN federation_domains d ON LOWER(d.domain) = LOWER(q.target_domain)
       GROUP BY LOWER(q.target_domain)
       ORDER BY failed DESC, pending DESC, total DESC`,
    );

    return rows.map((r) => ({
      domain: r.domain,
      tier: r.tier === "suspend" || r.tier === "silence" ? r.tier : "allow",
      pending: Number(r.pending || 0),
      processing: Number(r.processing || 0),
      completed: Number(r.completed || 0),
      failed: Number(r.failed || 0),
      total: Number(r.total || 0),
      maxAttempts: Number(r.max_attempts || 0),
      lastError: r.last_error ?? null,
      lastUpdatedAt: r.last_updated_at ?? null,
      unavailableSince: r.unavailable_since ?? null,
      consecutiveFailures: Number(r.consecutive_failures || 0),
      lastSeenAt: r.last_seen_at ?? null,
    }));
  }

  circuitBreakFederationDomain(
    domain: string,
    tier: "silence" | "suspend" = "suspend",
    reason?: string,
  ): {
    domain: string;
    tier: "silence" | "suspend";
    purgedDeliveries: number;
  } {
    const cleanDomain = domain.trim().toLowerCase();
    if (!cleanDomain) {
      throw new Error("A valid target domain is required");
    }
    this.setDomainTier(
      cleanDomain,
      tier,
      reason || `Circuit-breaker tripped for unresponsive/dead peer '${cleanDomain}'`,
    );
    const { deletedCount } = this.purgeFederationDeliveries(undefined, cleanDomain);
    return {
      domain: cleanDomain,
      tier,
      purgedDeliveries: deletedCount,
    };
  }

  // ── Domain Availability, Auto-Circuit-Breaking & Transparency ────

  recordDomainDeliverySuccess(domain: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return;
    try {
      this.run(
        `INSERT INTO federation_domains (domain, tier, unavailable_since, consecutive_failures, last_seen_at, updated_at)
         VALUES (?, 'allow', NULL, 0, datetime('now'), datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           unavailable_since = NULL,
           consecutive_failures = 0,
           last_seen_at = datetime('now'),
           updated_at = datetime('now')`,
        cleanDomain,
      );
    } catch {
      // Ignore if table not yet migrated in isolated unit test
    }
  }

  recordDomainDeliveryFailure(
    domain: string,
    errorMessage?: string,
  ): { consecutiveFailures: number; unavailableSince: string | null } {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return { consecutiveFailures: 0, unavailableSince: null };

    let threshold = 5;
    try {
      threshold = Math.max(1, this.facade.getInstanceSettings().autoCircuitBreakThreshold || 5);
    } catch {
      // Fallback to default circuit-breaker threshold when settings unavailable
    }

    const existing = this.getDomainTier(cleanDomain);
    const nextFailures = (existing.consecutiveFailures || 0) + 1;
    const shouldMarkUnavailable = nextFailures >= threshold;
    const nowIso = new Date().toISOString();
    const unavailableSince = shouldMarkUnavailable ? existing.unavailableSince || nowIso : null;

    this.run(
      `INSERT INTO federation_domains (domain, tier, reason, unavailable_since, consecutive_failures, updated_at)
       VALUES (?, 'allow', ?, ?, ?, datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET
         unavailable_since = COALESCE(federation_domains.unavailable_since, excluded.unavailable_since),
         consecutive_failures = excluded.consecutive_failures,
         private_comment = COALESCE(federation_domains.private_comment, excluded.reason),
         updated_at = datetime('now')`,
      cleanDomain,
      errorMessage ? `Delivery failure: ${errorMessage.slice(0, 200)}` : null,
      unavailableSince,
      nextFailures,
    );

    const updated = this.getDomainTier(cleanDomain);
    return {
      consecutiveFailures: updated.consecutiveFailures,
      unavailableSince: updated.unavailableSince ?? null,
    };
  }

  isDomainUnavailable(domain: string): boolean {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return false;
    const tierInfo = this.getDomainTier(cleanDomain);
    if (!tierInfo.unavailableSince) return false;
    // Allow automatic cooldown probe after 6 hours
    const unavailableMs = new Date(tierInfo.unavailableSince).getTime();
    if (Number.isFinite(unavailableMs) && Date.now() - unavailableMs > 6 * 3600 * 1000) {
      return false;
    }
    return true;
  }

  static obfuscateDomainName(domain: string): string {
    const parts = domain.split(".");
    return parts
      .map((part, idx) => {
        if (idx === parts.length - 1 || part.length <= 2) return part;
        return `${part[0]}${"*".repeat(Math.min(5, part.length - 2))}${part[part.length - 1]}`;
      })
      .join(".");
  }

  listPublicDomainBlocks(): {
    domain: string;
    digest: string;
    severity: "silence" | "suspend";
    comment: string;
  }[] {
    const rows = this.listFederationDomains().filter((d) => d.tier === "silence" || d.tier === "suspend");
    return rows.map((d) => {
      const digest = crypto.createHash("sha256").update(d.domain.toLowerCase()).digest("hex");
      const displayDomain = d.obfuscate ? FederationRepository.obfuscateDomainName(d.domain) : d.domain;
      return {
        domain: displayDomain,
        digest,
        severity: d.tier === "suspend" ? "suspend" : "silence",
        comment: d.public_comment ?? d.reason ?? "",
      };
    });
  }

  listKnownPeers(): string[] {
    const peerSet = new Set<string>();
    const domainRows = this.all<{ domain: string }>(`SELECT domain FROM federation_domains WHERE tier != 'suspend'`);
    for (const r of domainRows) {
      if (r.domain) peerSet.add(r.domain.toLowerCase());
    }
    const userDomains = this.all<{ remote_domain: string }>(
      `SELECT DISTINCT remote_domain FROM users WHERE remote_domain IS NOT NULL AND remote_domain != ''`,
    );
    for (const u of userDomains) {
      const dom = u.remote_domain.toLowerCase();
      if (!this.isDomainSuspended(dom)) {
        peerSet.add(dom);
      }
    }
    return Array.from(peerSet).sort();
  }

  // ── ActivityPub Relays (FEP-ae97) ────────────────────────────────

  listFederationRelays(): FederationRelayRow[] {
    return this.all<FederationRelayRow>(`SELECT * FROM federation_relays ORDER BY id DESC`);
  }

  getFederationRelayById(id: number): FederationRelayRow | undefined {
    return this.get<FederationRelayRow>(`SELECT * FROM federation_relays WHERE id = ?`, id);
  }

  getFederationRelayByActor(actorUrl: string): FederationRelayRow | undefined {
    const clean = actorUrl.trim();
    return this.get<FederationRelayRow>(
      `SELECT * FROM federation_relays WHERE actor_url = ? OR inbox_url = ?`,
      clean,
      clean,
    );
  }

  addFederationRelay(
    inboxUrl: string,
    actorUrl?: string,
    followActivityId?: string,
    state: "pending" | "accepted" | "rejected" | "paused" = "pending",
  ): FederationRelayRow {
    const cleanInbox = inboxUrl.trim();
    const cleanActor = (actorUrl || cleanInbox.replace(/\/inbox\/?$/, "/actor")).trim();
    let domain = "unknown";
    try {
      domain = new URL(cleanInbox).hostname.toLowerCase();
    } catch {
      // Malformed inbox URL leaves domain empty
    }

    this.run(
      `INSERT INTO federation_relays (inbox_url, actor_url, domain, state, follow_activity_id, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(inbox_url) DO UPDATE SET
         actor_url = excluded.actor_url,
         state = excluded.state,
         follow_activity_id = COALESCE(excluded.follow_activity_id, federation_relays.follow_activity_id),
         updated_at = datetime('now')`,
      cleanInbox,
      cleanActor,
      domain,
      state,
      followActivityId ?? null,
    );

    return this.get<FederationRelayRow>(
      `SELECT * FROM federation_relays WHERE inbox_url = ?`,
      cleanInbox,
    ) as FederationRelayRow;
  }

  updateFederationRelayState(
    idOrActorUrl: number | string,
    state: "pending" | "accepted" | "rejected" | "paused",
    lastError?: string | null,
  ): FederationRelayRow | undefined {
    if (typeof idOrActorUrl === "number") {
      this.run(
        `UPDATE federation_relays
         SET state = ?, last_error = COALESCE(?, last_error), updated_at = datetime('now')
         WHERE id = ?`,
        state,
        lastError === undefined ? null : lastError,
        idOrActorUrl,
      );
      return this.getFederationRelayById(idOrActorUrl);
    }
    const clean = idOrActorUrl.trim();
    this.run(
      `UPDATE federation_relays
       SET state = ?, last_error = COALESCE(?, last_error), updated_at = datetime('now')
       WHERE actor_url = ? OR inbox_url = ?`,
      state,
      lastError === undefined ? null : lastError,
      clean,
      clean,
    );
    return this.getFederationRelayByActor(clean);
  }

  deleteFederationRelay(id: number): FederationRelayRow | undefined {
    const existing = this.getFederationRelayById(id);
    if (!existing) return undefined;
    this.run(`DELETE FROM federation_relays WHERE id = ?`, id);
    return existing;
  }

  incrementRelayStats(idOrActorUrl: number | string, direction: "forwarded" | "received"): void {
    const col = direction === "forwarded" ? "forwarded_count" : "received_count";
    if (typeof idOrActorUrl === "number") {
      this.run(
        `UPDATE federation_relays SET ${col} = ${col} + 1, updated_at = datetime('now') WHERE id = ?`,
        idOrActorUrl,
      );
    } else {
      this.run(
        `UPDATE federation_relays SET ${col} = ${col} + 1, updated_at = datetime('now') WHERE actor_url = ? OR inbox_url = ?`,
        idOrActorUrl,
        idOrActorUrl,
      );
    }
  }
}
