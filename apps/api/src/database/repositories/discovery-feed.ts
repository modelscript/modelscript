// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { normalizeUtcTimestamp, type RepoWebhookRecord, type TrendingTopicRow } from "../../database.js";
import type {
  AccountKeyLogEntry,
  AccountSigningKey,
  ArtifactViewRow,
  LinkedRepoRow,
  PostMetadata,
  PostRow,
  RemotePackageRow,
  RssFeedRow,
  SignedPostEvidence,
  UserArchiveData,
} from "../../database/types.js";
import { extractHashtags } from "../../util/extract-topics.js";
import { generateSnowflakeId } from "../../util/snowflake.js";
import { BaseRepository } from "./base.js";
export class DiscoveryFeedRepository extends BaseRepository {
  // ── RSS Feeds ───────────────────────────────────────────────────

  createRssProfile(
    url: string,
    title: string,
    description: string,
    siteUrl: string,
    avatarUrl: string,
    customUsername?: string,
  ): number {
    const transaction = this.db.transaction(() => {
      // Create user profile for the RSS feed
      let domain = "rss";
      try {
        domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, "_");
      } catch {
        // Ignore parsing error
      }
      const uniqueSuffix = crypto.randomInt(1000000);
      const username = customUsername || `rss_${domain}_${uniqueSuffix}`;

      const userResult = this.db
        .prepare(
          `INSERT INTO users (username, email, display_name, bio, avatar_url, account_type) VALUES (?, ?, ?, ?, ?, 'rss')`,
        )
        .run(
          username,
          `${username.replace(/[^a-zA-Z0-9_-]/g, "_")}@rss.modelscript.local`,
          title,
          description,
          avatarUrl,
        );
      const userId = Number(userResult.lastInsertRowid);

      const feedResult = this.db
        .prepare(`INSERT INTO rss_feeds (url, user_id, title, description, site_url) VALUES (?, ?, ?, ?, ?)`)
        .run(url, userId, title, description, siteUrl);

      return Number(feedResult.lastInsertRowid);
    });

    return transaction();
  }

  getRssFeedByUrl(url: string): RssFeedRow | undefined {
    return this.db.prepare(`SELECT * FROM rss_feeds WHERE url = ?`).get(url) as RssFeedRow | undefined;
  }

  getRssFeedsToPoll(): RssFeedRow[] {
    // Only fetch feeds where last_polled_at is null OR last_polled_at + poll_interval_mins < now
    return this.db
      .prepare(
        `
      SELECT * FROM rss_feeds 
      WHERE last_polled_at IS NULL 
         OR datetime(last_polled_at, '+' || poll_interval_mins || ' minutes') <= datetime('now')
    `,
      )
      .all() as RssFeedRow[];
  }

  updateRssFeedPollMetadata(
    feedId: number,
    etag: string | null,
    lastModified: string | null,
    pollIntervalMins: number,
  ): void {
    this.db
      .prepare(
        `
      UPDATE rss_feeds 
      SET etag = ?, last_modified = ?, poll_interval_mins = ?, last_polled_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(etag, lastModified, pollIntervalMins, feedId);
  }

  subscribeToRssFeed(userId: number, rssFeedId: number): void {
    // Check limit first
    const subCount = (
      this.db.prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE user_id = ?`).get(userId) as {
        count: number;
      }
    ).count;

    // Check if already subscribed to avoid double-counting limit
    const existing = this.db
      .prepare(`SELECT 1 FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
      .get(userId, rssFeedId);
    if (!existing && subCount >= 10) {
      throw new Error("Maximum of 10 RSS feed subscriptions reached.");
    }

    try {
      this.db.prepare(`INSERT INTO user_rss_subscriptions (user_id, rss_feed_id) VALUES (?, ?)`).run(userId, rssFeedId);
    } catch {
      // Ignore unique constraint violation (already subscribed)
    }
  }

  unsubscribeFromRssFeed(userId: number, rssFeedId: number): void {
    const transaction = this.db.transaction(() => {
      const feed = this.db.prepare(`SELECT * FROM rss_feeds WHERE id = ?`).get(rssFeedId) as RssFeedRow | undefined;
      if (!feed) return;

      this.db
        .prepare(`DELETE FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
        .run(userId, rssFeedId);

      const subCount = (
        this.db
          .prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE rss_feed_id = ?`)
          .get(rssFeedId) as { count: number }
      ).count;

      if (subCount === 0) {
        // Delete any notifications associated with posts by this feed profile
        this.db
          .prepare(`DELETE FROM notifications WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)`)
          .run(feed.user_id);

        // Delete any notifications where the feed profile was the actor (if any)
        this.db.prepare(`DELETE FROM notifications WHERE actor_id = ?`).run(feed.user_id);

        // Delete artifact views created by this profile
        this.db.prepare(`DELETE FROM artifact_views WHERE creator_id = ?`).run(feed.user_id);

        // Finally, delete the feed profile (which cascades to rss_feeds, posts, likes, follows, etc.)
        this.db.prepare(`DELETE FROM users WHERE id = ?`).run(feed.user_id);
      }
    });
    transaction();
  }

  getUserRssSubscriptions(userId: number): RssFeedRow[] {
    return this.db
      .prepare(
        `
        SELECT f.*, u.username, u.display_name, u.avatar_url
        FROM user_rss_subscriptions s
        JOIN rss_feeds f ON s.rss_feed_id = f.id
        JOIN users u ON f.user_id = u.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
      `,
      )
      .all(userId) as RssFeedRow[];
  }

  getAllRssFeeds(): RssFeedRow[] {
    return this.db.prepare(`SELECT * FROM rss_feeds`).all() as RssFeedRow[];
  }

  updateRssFeedStatus(rssFeedId: number, lastFetchedAt: string, lastGuid: string | null): void {
    this.db
      .prepare(`UPDATE rss_feeds SET last_fetched_at = ?, last_guid = ? WHERE id = ?`)
      .run(lastFetchedAt, lastGuid, rssFeedId);
  }

  getArtifactView(id: number | string): ArtifactViewRow | undefined {
    let row = this.db.prepare(`SELECT *, CAST(id AS TEXT) as id FROM artifact_views WHERE id = ?`).get(id) as
      ArtifactViewRow | undefined;
    if (!row) {
      const idStr = String(id).trim();
      if (idStr.length >= 17 && /^\d+$/.test(idStr)) {
        const num = Number(idStr);
        if (Number.isFinite(num)) {
          row = this.db
            .prepare(
              `
            SELECT *, CAST(id AS TEXT) as id
            FROM artifact_views
            WHERE id BETWEEN ? AND ?
            ORDER BY ABS(id - ?) ASC
            LIMIT 1
          `,
            )
            .get(num - 128, num + 128, num) as ArtifactViewRow | undefined;
        }
      }
    }
    if (row && row.created_at) {
      row.created_at = normalizeUtcTimestamp(row.created_at);
    }
    return row;
  }

  createArtifactView(
    creatorId: number,
    type: string,
    source_type: string,
    viewConfig: string,
    title?: string | null | undefined,
    thumbnailUrl?: string | null | undefined,
    remoteOriginUrl?: string | null | undefined,
    explicitId?: number | string | null | undefined,
  ): string {
    const idToUse = explicitId !== undefined && explicitId !== null ? String(explicitId) : generateSnowflakeId();
    this.db
      .prepare(
        `
      INSERT INTO artifact_views (id, creator_id, view_type, source_type, view_config, title, thumbnail_url, remote_origin_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        idToUse,
        creatorId,
        type,
        source_type,
        viewConfig,
        title || null,
        thumbnailUrl || null,
        remoteOriginUrl || null,
      );
    return idToUse;
  }

  /** Lightweight listing (no view_config) of a user's own artifact views, newest first. */
  listArtifactViewsByCreator(
    creatorId: number,
    viewTypes: string[],
    limit = 50,
  ): Pick<ArtifactViewRow, "id" | "view_type" | "title" | "thumbnail_url" | "created_at">[] {
    const cappedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const typeClause = viewTypes.length > 0 ? ` AND view_type IN (${viewTypes.map(() => "?").join(",")})` : "";
    return this.db
      .prepare(
        `SELECT CAST(id AS TEXT) as id, view_type, title, thumbnail_url, created_at FROM artifact_views WHERE creator_id = ?${typeClause} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(creatorId, ...viewTypes, cappedLimit) as Pick<
      ArtifactViewRow,
      "id" | "view_type" | "title" | "thumbnail_url" | "created_at"
    >[];
  }

  getAllArtifactViews(): ArtifactViewRow[] {
    return this.db
      .prepare(`SELECT CAST(id AS TEXT) as id, view_type, view_config FROM artifact_views`)
      .all() as ArtifactViewRow[];
  }

  getArtifactViewByTitle(title: string): ArtifactViewRow | undefined {
    return this.db
      .prepare(
        `SELECT CAST(id AS TEXT) as id, view_type, title, thumbnail_url, view_config FROM artifact_views WHERE title = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(title) as ArtifactViewRow | undefined;
  }

  updateArtifactViewConfig(id: number | string, viewConfig: string, title?: string | null | undefined): void {
    try {
      if (title !== undefined && title !== null) {
        this.db
          .prepare(`UPDATE artifact_views SET view_config = ?, title = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(viewConfig, title, id);
      } else {
        this.db
          .prepare(`UPDATE artifact_views SET view_config = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(viewConfig, id);
      }
      return;
    } catch {
      // Fallback if updated_at column is not present
      if (title !== undefined && title !== null) {
        this.db.prepare(`UPDATE artifact_views SET view_config = ?, title = ? WHERE id = ?`).run(viewConfig, title, id);
      } else {
        this.db.prepare(`UPDATE artifact_views SET view_config = ? WHERE id = ?`).run(viewConfig, id);
      }
    }
  }

  updateArtifactThumbnail(id: number | string, thumbnailUrl: string, thumbnailUrlDark?: string): void {
    const darkUrl = thumbnailUrlDark || thumbnailUrl;
    try {
      this.db
        .prepare(
          `UPDATE artifact_views
           SET thumbnail_url = ?,
               view_config = CASE
                 WHEN view_config IS NOT NULL AND json_valid(view_config)
                 THEN json_set(view_config, '$.thumbnailUrl', ?, '$.thumbnailUrlLight', ?, '$.thumbnailUrlDark', ?)
                 ELSE view_config
               END
           WHERE id = ?`,
        )
        .run(thumbnailUrl, thumbnailUrl, thumbnailUrl, darkUrl, id);
      return;
    } catch {
      // Optional archive/settings fallback ignored
    }
    this.db.prepare(`UPDATE artifact_views SET thumbnail_url = ? WHERE id = ?`).run(thumbnailUrl, id);
  }

  updateArtifactThumbnailsByTitle(title: string, thumbnailUrl: string, thumbnailUrlDark?: string): number {
    const darkUrl = thumbnailUrlDark || thumbnailUrl;
    try {
      const res = this.db
        .prepare(
          `UPDATE artifact_views
           SET thumbnail_url = ?,
               view_config = CASE
                 WHEN view_config IS NOT NULL AND json_valid(view_config)
                 THEN json_set(view_config, '$.thumbnailUrl', ?, '$.thumbnailUrlLight', ?, '$.thumbnailUrlDark', ?)
                 ELSE view_config
               END
           WHERE title = ?`,
        )
        .run(thumbnailUrl, thumbnailUrl, thumbnailUrl, darkUrl, title);
      return res.changes;
    } catch {
      const res = this.db
        .prepare(`UPDATE artifact_views SET thumbnail_url = ? WHERE title = ?`)
        .run(thumbnailUrl, title);
      return res.changes;
    }
  }

  getUserArchiveData(userId: number): UserArchiveData {
    let posts: UserArchiveData["posts"] = [];
    try {
      posts = this.db
        .prepare(
          `SELECT CAST(p.id AS TEXT) as id, p.content, p.created_at,
             COALESCE(p.like_count, 0) as like_count,
             COALESCE(p.reply_count, 0) as reply_count,
             COALESCE(p.repost_count, 0) as repost_count
           FROM posts p WHERE p.author_id = ? ORDER BY p.id DESC`,
        )
        .all(userId) as UserArchiveData["posts"];
    } catch {
      // Optional archive/settings fallback ignored
    }

    let libraries: UserArchiveData["libraries"] = [];
    try {
      libraries = this.db
        .prepare(
          `SELECT p.name, pv.version, pv.published_at as created_at
           FROM package_versions pv
           JOIN packages p ON pv.package_id = p.id
           WHERE pv.published_by = ?
           ORDER BY pv.id DESC`,
        )
        .all(userId) as UserArchiveData["libraries"];
    } catch {
      // Optional archive/settings fallback ignored
    }

    let billingHistory: UserArchiveData["billingHistory"] = [];
    try {
      billingHistory = this.db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as UserArchiveData["billingHistory"];
    } catch {
      // Optional archive/settings fallback ignored
    }

    let auditHistory: UserArchiveData["auditHistory"] = [];
    try {
      auditHistory = this.db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 200`,
        )
        .all(userId) as UserArchiveData["auditHistory"];
    } catch {
      // Optional archive/settings fallback ignored
    }

    let bookmarks: UserArchiveData["bookmarks"] = [];
    try {
      bookmarks = this.db
        .prepare(
          `SELECT CAST(b.post_id AS TEXT) as post_id, p.content, b.created_at FROM bookmarks b LEFT JOIN posts p ON b.post_id = p.id WHERE b.user_id = ? ORDER BY b.id DESC`,
        )
        .all(userId) as UserArchiveData["bookmarks"];
    } catch {
      // Optional archive/settings fallback ignored
    }

    let following: string[] = [];
    try {
      const rows = this.db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ?`)
        .all(userId) as { username: string }[];
      following = rows.map((r) => r.username);
    } catch {
      // Optional archive/settings fallback ignored
    }

    let followers: string[] = [];
    try {
      const rows = this.db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ?`)
        .all(userId) as { username: string }[];
      followers = rows.map((r) => r.username);
    } catch {
      // Optional archive/settings fallback ignored
    }

    let studies: NonNullable<UserArchiveData["studies"]> = [];
    try {
      const jobRows = this.db
        .prepare(
          `SELECT id, name, status, type, metadata, started_at, completed_at
           FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
        )
        .all(userId) as {
        id: number;
        name: string;
        status: string;
        type: string;
        metadata: string | null;
        started_at: string;
        completed_at: string | null;
      }[];
      studies = jobRows.map((j) => {
        let sourceCode: string | undefined;
        let format: string | undefined;
        try {
          if (j.metadata) {
            const parsed = JSON.parse(j.metadata);
            sourceCode = parsed.studyInstanceSource || parsed.modelCode || parsed.code || undefined;
            format = parsed.standardFormat || undefined;
          }
        } catch {
          // Optional archive/settings fallback ignored
        }
        return {
          id: j.id,
          name: j.name,
          status: j.status,
          type: j.type,
          started_at: j.started_at,
          completed_at: j.completed_at ?? undefined,
          format,
          source_code: sourceCode,
        };
      });
    } catch {
      // Optional archive/settings fallback ignored
    }

    return { posts, libraries, billingHistory, auditHistory, bookmarks, studies, following, followers };
  }

  // ── Git Sync Mapping (Bidirectional Account Portability) ────────

  getGitSyncMapping(
    userId: number,
    path: string,
  ): { id: number; entity_type: string; entity_id: string; content_sha?: string } | undefined {
    return this.db
      .prepare(`SELECT id, entity_type, entity_id, content_sha FROM git_sync_map WHERE user_id = ? AND path = ?`)
      .get(userId, path) as { id: number; entity_type: string; entity_id: string; content_sha?: string } | undefined;
  }

  setGitSyncMapping(userId: number, path: string, entityType: string, entityId: string, contentSha?: string): void {
    this.db
      .prepare(
        `INSERT INTO git_sync_map (user_id, path, entity_type, entity_id, content_sha, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, path) DO UPDATE SET
           entity_type = excluded.entity_type,
           entity_id = excluded.entity_id,
           content_sha = excluded.content_sha,
           updated_at = datetime('now')`,
      )
      .run(userId, path, entityType, entityId, contentSha ?? null);
  }

  deleteGitSyncMapping(userId: number, path: string): boolean {
    const res = this.db.prepare(`DELETE FROM git_sync_map WHERE user_id = ? AND path = ?`).run(userId, path);
    return res.changes > 0;
  }

  // ── Account Signing Keys & Cryptographic Verification ─────────────

  registerSigningKey(key: {
    userId: number;
    publicKeyMultibase: string;
    publicKeyOpenssh: string;
    fingerprintSha256: string;
    algo?: string;
    label?: string | null;
    trustLevel?: string;
    prevKeyId?: number | null;
    rotationProof?: string | null;
  }): AccountSigningKey {
    const info = this.db
      .prepare(
        `INSERT INTO account_signing_keys
         (user_id, public_key_multibase, public_key_openssh, fingerprint_sha256, algo, label, trust_level, prev_key_id, rotation_proof)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key.userId,
        key.publicKeyMultibase,
        key.publicKeyOpenssh,
        key.fingerprintSha256,
        key.algo || "ed25519",
        key.label ?? null,
        key.trustLevel || "hardware_or_cli",
        key.prevKeyId ?? null,
        key.rotationProof ?? null,
      );

    // Auto-mark account as signing_verified only if trustLevel is verified (not unverified_paste)
    if (key.trustLevel !== "unverified_paste") {
      this.db.prepare(`UPDATE users SET signing_verified = 1 WHERE id = ?`).run(key.userId);
    }

    return this.getSigningKeyById(Number(info.lastInsertRowid))!;
  }

  getSigningKeyById(keyId: number): AccountSigningKey | null {
    const row = this.db.prepare(`SELECT * FROM account_signing_keys WHERE id = ?`).get(keyId);
    return (row as AccountSigningKey) || null;
  }

  getSigningKeyByFingerprint(fingerprint: string): AccountSigningKey | null {
    const row = this.db.prepare(`SELECT * FROM account_signing_keys WHERE fingerprint_sha256 = ?`).get(fingerprint);
    return (row as AccountSigningKey) || null;
  }

  getSigningKeysForUser(userId: number, includeRevoked: boolean = false): AccountSigningKey[] {
    const query = includeRevoked
      ? `SELECT * FROM account_signing_keys WHERE user_id = ? ORDER BY id ASC`
      : `SELECT * FROM account_signing_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY id ASC`;
    return this.db.prepare(query).all(userId) as AccountSigningKey[];
  }

  revokeSigningKey(keyId: number, userId: number, reason: string = "User revoked key"): boolean {
    const res = this.db
      .prepare(
        `UPDATE account_signing_keys
         SET revoked_at = datetime('now'), revoked_reason = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(reason, keyId, userId);

    if (res.changes > 0) {
      // Check if user still has any active keys
      const activeCount = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM account_signing_keys WHERE user_id = ? AND revoked_at IS NULL`)
        .get(userId) as { cnt: number } | undefined;
      if (!activeCount || activeCount.cnt === 0) {
        this.db.prepare(`UPDATE users SET signing_verified = 0 WHERE id = ?`).run(userId);
      }
      return true;
    }
    return false;
  }

  delegateSigningKey(keyId: number, userId: number, masterKeyId: number, delegationProof: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE account_signing_keys
         SET trust_level = 'delegated_by_master', prev_key_id = ?, rotation_proof = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(masterKeyId, delegationProof, keyId, userId);
    return res.changes > 0;
  }

  insertKeyLogEntry(entry: {
    user_id: number;
    event: string;
    payload_json: string;
    prev_hash: string;
    entry_hash: string;
  }): AccountKeyLogEntry {
    const info = this.db
      .prepare(
        `INSERT INTO account_key_log (user_id, event, payload_json, prev_hash, entry_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(entry.user_id, entry.event, entry.payload_json, entry.prev_hash, entry.entry_hash);
    return {
      seq: Number(info.lastInsertRowid),
      user_id: entry.user_id,
      event: entry.event,
      payload_json: entry.payload_json,
      prev_hash: entry.prev_hash,
      entry_hash: entry.entry_hash,
      created_at: new Date().toISOString(),
    };
  }

  getKeyLogForUser(userId: number): AccountKeyLogEntry[] {
    return this.db
      .prepare(
        `SELECT seq, user_id, event, payload_json, prev_hash, entry_hash, created_at FROM account_key_log WHERE user_id = ? ORDER BY seq ASC`,
      )
      .all(userId) as AccountKeyLogEntry[];
  }

  recordSignedPostEvidence(evidence: {
    postId: string;
    rev?: number;
    payloadJson: string;
    proofJson: string;
    keyId?: number | null;
    commitOid?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO signed_post_evidence (post_id, rev, payload_json, proof_json, key_id, commit_oid, received_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(post_id, rev) DO UPDATE SET
           payload_json = excluded.payload_json,
           proof_json = excluded.proof_json,
           key_id = excluded.key_id,
           commit_oid = excluded.commit_oid,
           received_at = datetime('now')`,
      )
      .run(
        evidence.postId,
        evidence.rev || 1,
        evidence.payloadJson,
        evidence.proofJson,
        evidence.keyId ?? null,
        evidence.commitOid ?? null,
      );
  }

  getSignedPostEvidence(postId: string, rev?: number): SignedPostEvidence | null {
    if (rev !== undefined) {
      const row = this.db.prepare(`SELECT * FROM signed_post_evidence WHERE post_id = ? AND rev = ?`).get(postId, rev);
      return (row as SignedPostEvidence) || null;
    }
    const row = this.db
      .prepare(`SELECT * FROM signed_post_evidence WHERE post_id = ? ORDER BY rev DESC LIMIT 1`)
      .get(postId);
    return (row as SignedPostEvidence) || null;
  }

  listSignedPostEvidence(postId: string): SignedPostEvidence[] {
    return this.db
      .prepare(`SELECT * FROM signed_post_evidence WHERE post_id = ? ORDER BY rev ASC`)
      .all(postId) as SignedPostEvidence[];
  }

  isSigningKeyBanned(fingerprint: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM banned_signing_keys WHERE fingerprint_sha256 = ?`).get(fingerprint);
    return Boolean(row);
  }

  banSigningKey(fingerprint: string, reason: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO banned_signing_keys (fingerprint_sha256, reason, banned_at) VALUES (?, ?, datetime('now'))`,
      )
      .run(fingerprint, reason);
  }

  setSigningPolicyStrict(userId: number, strict: boolean): void {
    this.db.prepare(`UPDATE users SET signing_policy_strict = ? WHERE id = ?`).run(strict ? 1 : 0, userId);
  }

  setSigningVerified(userId: number, verified: boolean): void {
    this.db.prepare(`UPDATE users SET signing_verified = ? WHERE id = ?`).run(verified ? 1 : 0, userId);
  }

  updateUserBranchTip(userId: number, tipOid: string): void {
    this.db.prepare(`UPDATE users SET branch_tip_oid = ? WHERE id = ?`).run(tipOid, userId);
  }

  // ── Remote Packages (Federated Registry) ─────────────────────────

  recordRemotePackage(pkg: {
    name: string;
    version: string;
    actorUrl: string;
    downloadUrl: string;
    checksum: string;
    license?: string | null | undefined;
    description?: string | null | undefined;
    metadata?: string | null | undefined;
  }): { id: number } {
    const res = this.db
      .prepare(
        `
      INSERT INTO remote_packages (name, version, actor_url, download_url, checksum, license, description, metadata, is_deleted, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      ON CONFLICT(name, version, actor_url) DO UPDATE SET
        download_url = excluded.download_url,
        checksum = excluded.checksum,
        license = excluded.license,
        description = excluded.description,
        metadata = excluded.metadata,
        is_deleted = 0,
        updated_at = datetime('now')
    `,
      )
      .run(
        pkg.name,
        pkg.version,
        pkg.actorUrl,
        pkg.downloadUrl,
        pkg.checksum,
        pkg.license || null,
        pkg.description || null,
        pkg.metadata || null,
      );
    return { id: Number(res.lastInsertRowid) };
  }

  getRemotePackage(name: string, version: string): RemotePackageRow | undefined {
    return this.db
      .prepare(`SELECT * FROM remote_packages WHERE name = ? AND version = ? AND is_deleted = 0`)
      .get(name, version) as RemotePackageRow | undefined;
  }

  getRemotePackages(limit = 50, offset = 0): RemotePackageRow[] {
    return this.db
      .prepare(`SELECT * FROM remote_packages WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as RemotePackageRow[];
  }

  deleteRemotePackage(name: string, version: string, actorUrl?: string): void {
    if (actorUrl) {
      this.db
        .prepare(
          `UPDATE remote_packages SET is_deleted = 1, updated_at = datetime('now') WHERE name = ? AND version = ? AND actor_url = ?`,
        )
        .run(name, version, actorUrl);
    } else {
      this.db
        .prepare(
          `UPDATE remote_packages SET is_deleted = 1, updated_at = datetime('now') WHERE name = ? AND version = ?`,
        )
        .run(name, version);
    }
  }

  // ── Trending Topics ─────────────────────────────────────────────

  /**
   * Applies half-life exponential decay to a topic's score and adds new weight.
   * Half-life is defined in hours.
   */
  updateTopicScore(
    concept: string,
    displayName: string,
    weight: number,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): number {
    const existing = this.db
      .prepare(`SELECT id, current_score, last_updated_at FROM trending_topics WHERE concept = ? AND location IS ?`)
      .get(concept, location) as { id: number; current_score: number; last_updated_at: string } | undefined;

    if (!existing) {
      let initialReviewStatus = "approved";
      try {
        if (this.facade.getInstanceSettings().trendingRequiresApproval) {
          initialReviewStatus = "pending";
        }
      } catch {
        // Optional archive/settings fallback ignored
      }
      const res = this.db
        .prepare(
          `
        INSERT INTO trending_topics (concept, display_name, current_score, location, review_status) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(concept, displayName, weight, location, initialReviewStatus);
      return Number(res.lastInsertRowid);
    } else {
      const lastUpdatedMs = new Date(existing.last_updated_at.replace(" ", "T") + "Z").getTime();
      const currentMs = Date.now();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);

      const decayedScore = existing.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      const newScore = decayedScore + weight;

      this.db
        .prepare(
          `
        UPDATE trending_topics SET current_score = ?, last_updated_at = datetime('now') WHERE id = ?
      `,
        )
        .run(newScore, existing.id);

      return existing.id;
    }
  }

  linkPostToTopic(postId: number | string, topicId: number): void {
    try {
      this.db.prepare(`INSERT INTO post_topics (post_id, topic_id) VALUES (?, ?)`).run(postId, topicId);
    } catch {
      // Ignore unique constraint violation
    }
  }

  cleanupOrphanedTopics(topicIds?: number[]): void {
    if (topicIds && topicIds.length > 0) {
      const uniqueIds = Array.from(new Set(topicIds));
      const checkStmt = this.db.prepare(
        `SELECT COUNT(*) as c
         FROM post_topics pt
         JOIN posts p ON p.id = pt.post_id
         WHERE pt.topic_id = ?
           AND COALESCE(p.visibility, 'public') = 'public'
           AND COALESCE(p.is_silenced, 0) = 0`,
      );
      const delStmt = this.db.prepare(`DELETE FROM trending_topics WHERE id = ?`);
      for (const tid of uniqueIds) {
        const row = checkStmt.get(tid) as { c: number } | undefined;
        if (!row || row.c === 0) {
          delStmt.run(tid);
        }
      }
      return;
    }

    this.db
      .prepare(
        `DELETE FROM trending_topics
         WHERE COALESCE(review_status, 'approved') != 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM post_topics pt
             JOIN posts p ON p.id = pt.post_id
             WHERE pt.topic_id = trending_topics.id
               AND COALESCE(p.visibility, 'public') = 'public'
               AND COALESCE(p.is_silenced, 0) = 0
           )`,
      )
      .run();
  }

  boostPostTopics(postId: number | string, weight: number): void {
    if (weight <= 0) return;
    const linked = this.db
      .prepare(
        `SELECT t.concept, t.display_name, t.location
         FROM post_topics pt
         JOIN trending_topics t ON t.id = pt.topic_id
         WHERE pt.post_id = ?`,
      )
      .all(postId) as { concept: string; display_name: string; location: string | null }[];
    for (const item of linked) {
      this.updateTopicScore(item.concept, item.display_name, weight, 24, item.location);
    }
  }

  syncPostTopics(postId: number | string): void {
    const post = this.db
      .prepare(`SELECT CAST(id AS TEXT) as id, author_id, content, visibility, is_silenced FROM posts WHERE id = ?`)
      .get(postId) as
      | {
          id: string | number;
          author_id: number;
          content: string | null;
          visibility: string | null;
          is_silenced: number | null;
        }
      | undefined;

    const existingLinks = this.db
      .prepare(
        `SELECT pt.topic_id, t.concept
         FROM post_topics pt
         JOIN trending_topics t ON t.id = pt.topic_id
         WHERE pt.post_id = ?`,
      )
      .all(postId) as { topic_id: number; concept: string }[];

    if (!post || (post.visibility ?? "public") !== "public" || post.is_silenced) {
      if (existingLinks.length > 0) {
        this.db.prepare(`DELETE FROM post_topics WHERE post_id = ?`).run(postId);
        this.cleanupOrphanedTopics(existingLinks.map((l) => l.topic_id));
      }
      return;
    }

    const hashtags = extractHashtags(post.content || "");
    const nextByConcept = new Map<string, { concept: string; displayName: string }>();
    for (const h of hashtags) {
      nextByConcept.set(h.concept.toLowerCase(), h);
    }

    const existingConcepts = new Set<string>();
    const removedTopicIds: number[] = [];
    for (const link of existingLinks) {
      const lower = link.concept.toLowerCase();
      if (!nextByConcept.has(lower)) {
        this.db.prepare(`DELETE FROM post_topics WHERE post_id = ? AND topic_id = ?`).run(postId, link.topic_id);
        removedTopicIds.push(link.topic_id);
      } else {
        existingConcepts.add(lower);
      }
    }
    if (removedTopicIds.length > 0) {
      this.cleanupOrphanedTopics(removedTopicIds);
    }

    const toAdd = hashtags.filter((h) => !existingConcepts.has(h.concept.toLowerCase()));
    if (toAdd.length === 0) return;

    const author = this.facade.getUserById(post.author_id);
    const profile = author ? this.facade.getFullProfileByUsername(author.username) : undefined;
    const followerCount = profile?.follower_count || 0;
    const location = profile?.location || null;
    const basePostWeight = 1.0 + Math.log10(followerCount + 1) * 0.5;

    const recentAuthorTopicStmt = this.db.prepare(
      `SELECT COUNT(DISTINCT p.id) as cnt
       FROM posts p
       JOIN post_topics pt ON pt.post_id = p.id
       JOIN trending_topics t ON t.id = pt.topic_id
       WHERE p.author_id = ?
         AND p.id != ?
         AND LOWER(t.concept) = LOWER(?)
         AND p.created_at >= datetime('now', '-24 hours')`,
    );

    for (const topic of toAdd) {
      const recentRow = recentAuthorTopicStmt.get(post.author_id, postId, topic.concept) as { cnt: number } | undefined;
      const priorAuthorPosts24h = Number(recentRow?.cnt || 0);
      // Harmonic diminishing returns per author per 24h window to prevent single-user hashtag spam
      const effectiveWeight = basePostWeight / (1 + priorAuthorPosts24h);
      const topicId = this.updateTopicScore(topic.concept, topic.displayName, effectiveWeight, 24, location);
      this.linkPostToTopic(postId, topicId);
    }
  }

  /**
   * Worker function: Decays older topics and writes back to DB to prevent
   * permanent index clogging. Intended to be run periodically.
   */
  decayTrendingTopics(halfLifeHours: number = 24): void {
    this.cleanupOrphanedTopics();

    const topicsToDecay = this.db
      .prepare(
        `
      SELECT id, current_score, last_updated_at 
      FROM trending_topics 
      WHERE current_score > 0.001
    `,
      )
      .all() as { id: number; current_score: number; last_updated_at: string }[];

    if (topicsToDecay.length === 0) return;

    const currentMs = Date.now();
    const updateStmt = this.db.prepare(`
      UPDATE trending_topics 
      SET current_score = ?, last_updated_at = datetime('now') 
      WHERE id = ?
    `);

    // Use a transaction for fast bulk updates
    const transaction = this.db.transaction((updates: { id: number; score: number }[]) => {
      for (const u of updates) {
        updateStmt.run(u.score, u.id);
      }
    });

    const updates = topicsToDecay.map((t) => {
      const isoStr = t.last_updated_at.includes("T")
        ? t.last_updated_at.endsWith("Z")
          ? t.last_updated_at
          : `${t.last_updated_at}Z`
        : `${t.last_updated_at.replace(" ", "T")}Z`;
      const lastUpdatedMs = new Date(isoStr).getTime();
      const deltaHours = Number.isFinite(lastUpdatedMs) ? Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60) : 0;
      const newScore = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      return { id: t.id, score: newScore };
    });

    transaction(updates);
  }

  getTopTrendingTopics(
    limit: number = 10,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): (TrendingTopicRow & { real_score: number; post_count: number; unique_authors?: number })[] {
    let requiresApproval = false;
    try {
      requiresApproval = this.facade.getInstanceSettings().trendingRequiresApproval;
    } catch {
      // Optional archive/settings fallback ignored
    }
    const reviewClause = requiresApproval
      ? `AND COALESCE(t.review_status, 'approved') = 'approved'`
      : `AND COALESCE(t.review_status, 'approved') != 'rejected'`;
    const postCountSubquery = `(
      SELECT COUNT(DISTINCT pt.post_id)
      FROM post_topics pt
      JOIN posts p ON p.id = pt.post_id
      WHERE pt.topic_id = t.id
        AND COALESCE(p.visibility, 'public') = 'public'
        AND COALESCE(p.is_silenced, 0) = 0
    )`;
    const uniqueAuthorsSubquery = `(
      SELECT COUNT(DISTINCT p.author_id)
      FROM post_topics pt
      JOIN posts p ON p.id = pt.post_id
      WHERE pt.topic_id = t.id
        AND COALESCE(p.visibility, 'public') = 'public'
        AND COALESCE(p.is_silenced, 0) = 0
    )`;
    const recent24hSubquery = `(
      SELECT COUNT(DISTINCT pt.post_id)
      FROM post_topics pt
      JOIN posts p ON p.id = pt.post_id
      WHERE pt.topic_id = t.id
        AND COALESCE(p.visibility, 'public') = 'public'
        AND COALESCE(p.is_silenced, 0) = 0
        AND p.created_at >= datetime('now', '-24 hours')
    )`;
    const query = location
      ? `SELECT t.*, ${postCountSubquery} as post_count, ${uniqueAuthorsSubquery} as unique_authors, ${recent24hSubquery} as recent_24h FROM trending_topics t WHERE t.current_score > 0.001 ${reviewClause} AND t.location = ? ORDER BY t.current_score DESC LIMIT ?`
      : `SELECT t.*, ${postCountSubquery} as post_count, ${uniqueAuthorsSubquery} as unique_authors, ${recent24hSubquery} as recent_24h FROM trending_topics t WHERE t.current_score > 0.001 ${reviewClause} ORDER BY t.current_score DESC LIMIT ?`;
    const params = location ? [location, limit * 10] : [limit * 10];

    const topics = this.db.prepare(query).all(...params) as (TrendingTopicRow & {
      post_count?: number | undefined;
      unique_authors?: number | undefined;
      recent_24h?: number | undefined;
    })[];

    const currentMs = Date.now();
    const byConcept = new Map<
      string,
      TrendingTopicRow & { real_score: number; post_count: number; unique_authors: number }
    >();

    for (const t of topics) {
      const postCount = Number(t.post_count || 0);
      if (postCount <= 0) continue;
      const uniqueAuthors = Math.max(1, Number(t.unique_authors || 1));
      const recent24h = Number(t.recent_24h || 0);

      const isoStr = t.last_updated_at.includes("T")
        ? t.last_updated_at.endsWith("Z")
          ? t.last_updated_at
          : `${t.last_updated_at}Z`
        : `${t.last_updated_at.replace(" ", "T")}Z`;
      const lastUpdatedMs = new Date(isoStr).getTime();
      const deltaHours = Number.isFinite(lastUpdatedMs) ? Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60) : 0;
      const decayedScore = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      // Author diversity entropy multiplier + 24h velocity burst multiplier
      const authorDiversityFactor = 1.0 + 0.35 * Math.log2(uniqueAuthors);
      const velocityFactor = 1.0 + 0.12 * Math.min(20, recent24h);
      const real_score = decayedScore * authorDiversityFactor * velocityFactor;
      if (real_score <= 0.001) continue;

      const key = t.concept.toLowerCase();
      const existing = byConcept.get(key);
      if (!existing) {
        byConcept.set(key, {
          ...t,
          real_score,
          post_count: postCount,
          unique_authors: uniqueAuthors,
        });
      } else {
        existing.real_score += real_score;
        existing.current_score += t.current_score;
        existing.post_count += postCount;
        existing.unique_authors = Math.max(existing.unique_authors, uniqueAuthors);
        if (existing.location !== t.location) {
          existing.location = null;
        }
        if (t.last_updated_at > existing.last_updated_at) {
          existing.last_updated_at = t.last_updated_at;
        }
      }
    }

    const scoredTopics = Array.from(byConcept.values());
    scoredTopics.sort((a, b) => b.real_score - a.real_score || b.post_count - a.post_count);
    return scoredTopics.slice(0, limit);
  }

  getRelatedTopics(
    concept: string,
    limit: number = 8,
  ): { concept: string; display_name: string; co_occurrence_count: number; post_count: number }[] {
    const cleanConcept = concept.replace(/^#/, "").trim().toLowerCase();
    if (!cleanConcept) return [];

    const coOccurring = this.db
      .prepare(
        `
      SELECT
        LOWER(t2.concept) as concept,
        t2.display_name as display_name,
        COUNT(DISTINCT pt1.post_id) as co_occurrence_count,
        (
          SELECT COUNT(DISTINCT pt3.post_id)
          FROM post_topics pt3
          JOIN posts p3 ON p3.id = pt3.post_id
          WHERE pt3.topic_id = t2.id
            AND COALESCE(p3.visibility, 'public') = 'public'
            AND COALESCE(p3.is_silenced, 0) = 0
        ) as post_count,
        MAX(t2.current_score) as current_score
      FROM trending_topics t1
      JOIN post_topics pt1 ON pt1.topic_id = t1.id
      JOIN posts p ON p.id = pt1.post_id
      JOIN post_topics pt2 ON pt2.post_id = pt1.post_id AND pt2.topic_id != pt1.topic_id
      JOIN trending_topics t2 ON t2.id = pt2.topic_id
      WHERE (LOWER(t1.concept) = ? OR LOWER(t1.display_name) = ?)
        AND LOWER(t2.concept) != ?
        AND COALESCE(p.visibility, 'public') = 'public'
        AND COALESCE(p.is_silenced, 0) = 0
        AND COALESCE(t2.review_status, 'approved') != 'rejected'
      GROUP BY LOWER(t2.concept)
      ORDER BY (CAST(COUNT(DISTINCT pt1.post_id) AS REAL) * 10.0 + MAX(t2.current_score)) DESC
      LIMIT ?
    `,
      )
      .all(cleanConcept, cleanConcept, cleanConcept, limit) as {
      concept: string;
      display_name: string;
      co_occurrence_count: number;
      post_count: number;
    }[];

    if (coOccurring.length >= limit) {
      return coOccurring;
    }

    const seen = new Set(coOccurring.map((c) => c.concept.toLowerCase()));
    seen.add(cleanConcept);
    const fallbackTrending = this.getTopTrendingTopics(limit * 2);
    for (const t of fallbackTrending) {
      const cLower = t.concept.toLowerCase();
      if (seen.has(cLower)) continue;
      seen.add(cLower);
      coOccurring.push({
        concept: t.concept,
        display_name: t.display_name,
        co_occurrence_count: 0,
        post_count: t.post_count,
      });
      if (coOccurring.length >= limit) break;
    }
    return coOccurring;
  }

  getTopicPosts(
    concept: string,
    currentUserId?: number,
    limit = 20,
    offset = 0,
    artifactType?: string,
    sort: string = "recent",
  ): PostRow[] {
    const cleanConcept = concept.replace(/^#/, "").trim().toLowerCase();
    const artifactFilter = this.facade.social.buildArtifactFilter(artifactType);
    const visFilter = this.facade.social.buildVisibilityFilter(currentUserId, "public");
    const modFilter = this.facade.social.buildMuteBlockFilter(currentUserId);
    const uid = currentUserId || -1;
    const orderBy =
      sort === "top"
        ? "((like_count * 10 + reply_count * 15 + repost_count * 20 + MIN(50, COALESCE(p.view_count, 0))) / ((MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL)) + 2.0) * (1.0 + 0.1 * MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL))))) DESC, p.created_at DESC"
        : "p.created_at DESC";

    const query = `
      SELECT DISTINCT p.*,
        CAST(p.id AS TEXT) as id,
        CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
        CAST(p.reply_to_id AS TEXT) as reply_to_id,
        CAST(p.quote_post_id AS TEXT) as quote_post_id,
        CAST(p.repost_of_id AS TEXT) as repost_of_id,
        u.username, u.display_name, u.avatar_url, u.account_type, COALESCE(u.signing_verified, 0) as signing_verified,
        COALESCE(p.like_count, 0) as like_count,
        COALESCE(p.reply_count, 0) as reply_count,
        COALESCE(p.repost_count, 0) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked
      FROM posts p 
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      LEFT JOIN post_topics pt ON pt.post_id = p.id
      LEFT JOIN trending_topics t ON t.id = pt.topic_id
      WHERE (lower(t.concept) = ? OR lower(t.display_name) = ? OR lower(p.content) LIKE ?)
        AND (p.is_silenced IS NULL OR p.is_silenced = 0)
        ${visFilter.sql}
        ${artifactFilter.sql}
        ${modFilter.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const params = [
      uid,
      uid,
      uid,
      cleanConcept,
      cleanConcept,
      `%#${cleanConcept}%`,
      ...visFilter.params,
      ...artifactFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

    const posts = this.db.prepare(query).all(...params) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = this.facade.hydratePostsBatch(posts, currentUserId);
    return this.facade.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  // ── Linked Repositories ─────────────────────────────────────────

  getLinkedRepos(userId: number): LinkedRepoRow[] {
    return this.db
      .prepare(
        `
        SELECT r.*, u.username, u.display_name, COALESCE(r.avatar_url, u.avatar_url) as avatar_url
        FROM linked_repos r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.user_id = ?
        ORDER BY r.pinned DESC, r.id ASC
      `,
      )
      .all(userId) as LinkedRepoRow[];
  }

  getUserRepos(userId: number): LinkedRepoRow[] {
    return this.getLinkedRepos(userId);
  }

  getPopularRepos(limit: number = 5): LinkedRepoRow[] {
    return this.db
      .prepare(
        `
        SELECT
          r.*,
          u.username,
          u.display_name,
          COALESCE(r.avatar_url, u.avatar_url) as avatar_url,
          (
            COUNT(DISTINCT r.user_id) * 15 +
            MAX(COALESCE(r.pinned, 0)) * 8 +
            (SELECT COUNT(*) FROM repo_webhooks rw WHERE rw.repo_id = r.id AND rw.is_active = 1) * 10 +
            (SELECT COUNT(*) FROM repo_bot_reviews br WHERE br.repo_id = r.id) * 8 +
            (SELECT COUNT(*) FROM follows f WHERE f.following_id = r.user_id AND (f.state = 'accepted' OR f.state IS NULL)) * 3 +
            (
              SELECT COUNT(*) FROM posts p
              WHERE p.reply_to_id IS NULL
                AND COALESCE(p.visibility, 'public') = 'public'
                AND LOWER(COALESCE(p.content, '')) LIKE '%' || LOWER(r.namespace || '/' || r.project) || '%'
            ) * 12
          ) as popularity_score
        FROM linked_repos r
        JOIN users u ON r.user_id = u.id
        WHERE COALESCE(r.visibility, 'public') = 'public'
          AND COALESCE(u.status, 'active') = 'active'
        GROUP BY r.provider, r.namespace, r.project
        ORDER BY popularity_score DESC, MAX(COALESCE(r.pinned, 0)) DESC, MIN(r.id) ASC
        LIMIT ?
      `,
      )
      .all(limit) as LinkedRepoRow[];
  }

  linkRepo(
    userId: number,
    provider: string,
    externalId: string,
    repoFullName: string,
    defaultBranch?: string,
    description?: string,
    avatarUrl?: string,
  ): LinkedRepoRow | undefined {
    const parts = repoFullName.split("/");
    const namespace = parts[0] || "";
    const project = parts.slice(1).join("/") || repoFullName;
    const branch = defaultBranch || "main";

    const matchingRows = this.db
      .prepare(
        `SELECT id FROM linked_repos
         WHERE user_id = ? AND ((? != '' AND external_id = ?) OR (provider = ? AND namespace = ? AND project = ?))
         ORDER BY CASE WHEN provider = ? AND namespace = ? AND project = ? THEN 0 ELSE 1 END, id ASC`,
      )
      .all(userId, externalId || "", externalId || "", provider, namespace, project, provider, namespace, project) as {
      id: number;
    }[];
    const existing = matchingRows[0];
    if (matchingRows.length > 1 && existing) {
      const deleteDuplicate = this.db.prepare(`DELETE FROM linked_repos WHERE id = ?`);
      for (let i = 1; i < matchingRows.length; i++) {
        const dup = matchingRows[i];
        if (dup) {
          deleteDuplicate.run(dup.id);
        }
      }
    }
    if (!existing) {
      const info = this.db
        .prepare(
          `
        INSERT INTO linked_repos (user_id, provider, namespace, project, external_id, default_branch, description, avatar_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(userId, provider, namespace, project, externalId, branch, description || null, avatarUrl || null);
      return this.getLinkedRepoById(Number(info.lastInsertRowid));
    } else {
      this.db
        .prepare(
          `
        UPDATE linked_repos
        SET provider = ?,
            namespace = ?,
            project = ?,
            external_id = COALESCE(?, external_id),
            default_branch = COALESCE(?, default_branch),
            description = COALESCE(?, description),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `,
        )
        .run(
          provider,
          namespace,
          project,
          externalId || null,
          defaultBranch || null,
          description || null,
          avatarUrl || null,
          existing.id,
        );
      return this.getLinkedRepoById(existing.id);
    }
  }

  unlinkRepo(userId: number, repoIdOrName: number | string): void {
    const idStr = String(repoIdOrName);
    const numId = Number(repoIdOrName);
    if (!Number.isNaN(numId) && Number.isFinite(numId)) {
      this.db
        .prepare(`DELETE FROM linked_repos WHERE (id = ? OR external_id = ?) AND user_id = ?`)
        .run(numId, idStr, userId);
    } else {
      this.db
        .prepare(
          `DELETE FROM linked_repos WHERE (external_id = ? OR (namespace || '/' || project) = ? OR project = ?) AND user_id = ?`,
        )
        .run(idStr, idStr, idStr, userId);
    }
  }

  updateLinkedRepo(
    userId: number,
    repoIdOrName: number | string,
    updates: {
      name?: string | undefined;
      repo_full_name?: string | undefined;
      visibility?: string | undefined;
      default_branch?: string | undefined;
      social_preview_url?: string | undefined;
      description?: string | undefined;
    },
  ): LinkedRepoRow | undefined {
    const idStr = String(repoIdOrName);
    const numId = Number(repoIdOrName);
    const existing = (
      !Number.isNaN(numId) && Number.isFinite(numId)
        ? this.db
            .prepare(`SELECT * FROM linked_repos WHERE (id = ? OR external_id = ?) AND user_id = ?`)
            .get(numId, idStr, userId)
        : this.db
            .prepare(
              `SELECT * FROM linked_repos WHERE (external_id = ? OR (namespace || '/' || project) = ? OR project = ?) AND user_id = ?`,
            )
            .get(idStr, idStr, idStr, userId)
    ) as LinkedRepoRow | undefined;

    if (!existing) return undefined;

    let nextNamespace = existing.namespace;
    let nextProject = existing.project;
    if (updates.repo_full_name) {
      const parts = updates.repo_full_name.split("/");
      nextNamespace = parts[0] || existing.namespace;
      nextProject = parts.slice(1).join("/") || updates.name || existing.project;
    } else if (updates.name) {
      nextProject = updates.name;
    }

    this.db
      .prepare(
        `UPDATE linked_repos
         SET namespace = ?,
             project = ?,
             visibility = COALESCE(?, visibility),
             default_branch = COALESCE(?, default_branch),
             social_preview_url = COALESCE(?, social_preview_url),
             description = COALESCE(?, description),
             avatar_url = COALESCE(?, avatar_url)
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        nextNamespace,
        nextProject,
        updates.visibility ?? null,
        updates.default_branch ?? null,
        updates.social_preview_url ?? null,
        updates.description ?? null,
        updates.social_preview_url ?? null,
        existing.id,
        userId,
      );

    return this.getLinkedRepoById(existing.id);
  }

  getLinkedRepoById(idOrSlug: number | string, preferredUserId?: number): LinkedRepoRow | undefined {
    const idStr = String(idOrSlug).trim();
    const numId = Number(idStr);
    if (!Number.isNaN(numId) && Number.isFinite(numId) && /^\d+$/.test(idStr)) {
      const byPk = this.db.prepare(`SELECT * FROM linked_repos WHERE id = ?`).get(numId) as LinkedRepoRow | undefined;
      if (byPk) return byPk;
    }
    if (preferredUserId !== undefined) {
      const byUserSlug = this.db
        .prepare(
          `SELECT * FROM linked_repos
           WHERE user_id = ? AND (external_id = ? OR LOWER(namespace || '/' || project) = LOWER(?) OR LOWER(project) = LOWER(?))
           ORDER BY id ASC LIMIT 1`,
        )
        .get(preferredUserId, idStr, idStr, idStr) as LinkedRepoRow | undefined;
      if (byUserSlug) return byUserSlug;
    }
    return this.db
      .prepare(
        `SELECT * FROM linked_repos
         WHERE external_id = ? OR LOWER(namespace || '/' || project) = LOWER(?) OR LOWER(project) = LOWER(?)
         ORDER BY id ASC LIMIT 1`,
      )
      .get(idStr, idStr, idStr) as LinkedRepoRow | undefined;
  }

  // ==========================================
  // Repository Webhooks & CI/CD Ingestion
  // ==========================================

  createRepoWebhook(params: {
    repoId: number;
    provider: "github" | "gitlab" | "local" | "custom";
    secret: string;
    events?: string[] | undefined;
    autoPublish?: boolean | undefined;
    tagPattern?: string | undefined;
  }): RepoWebhookRecord {
    const eventsJson = JSON.stringify(params.events ?? ["push", "release"]);
    const autoPublish = params.autoPublish !== false ? 1 : 0;
    const tagPattern = params.tagPattern || "^v?([0-9]+\\.[0-9]+\\.[0-9]+)$";

    const info = this.db
      .prepare(
        `INSERT INTO repo_webhooks (repo_id, provider, secret, events, auto_publish, tag_pattern)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(params.repoId, params.provider, params.secret, eventsJson, autoPublish, tagPattern);

    return this.getRepoWebhookById(Number(info.lastInsertRowid))!;
  }

  getRepoWebhooks(repoId: number): RepoWebhookRecord[] {
    return this.db
      .prepare(`SELECT * FROM repo_webhooks WHERE repo_id = ? ORDER BY created_at DESC`)
      .all(repoId) as RepoWebhookRecord[];
  }

  getRepoWebhookById(id: number): RepoWebhookRecord | null {
    const row = this.db.prepare(`SELECT * FROM repo_webhooks WHERE id = ?`).get(id) as RepoWebhookRecord | undefined;
    return row ?? null;
  }

  deleteRepoWebhook(id: number, repoId?: number): boolean {
    let stmt;
    if (repoId) {
      stmt = this.db.prepare(`DELETE FROM repo_webhooks WHERE id = ? AND repo_id = ?`).run(id, repoId);
    } else {
      stmt = this.db.prepare(`DELETE FROM repo_webhooks WHERE id = ?`).run(id);
    }
    return stmt.changes > 0;
  }

  findWebhooksForRepo(
    provider: string,
    namespace: string,
    project: string,
  ): (RepoWebhookRecord & { namespace: string; project: string; user_id: number })[] {
    return this.db
      .prepare(
        `SELECT w.*, r.namespace, r.project, r.user_id
         FROM repo_webhooks w
         JOIN linked_repos r ON w.repo_id = r.id
         WHERE w.provider = ? AND LOWER(r.namespace) = LOWER(?) AND LOWER(r.project) = LOWER(?) AND w.is_active = 1`,
      )
      .all(provider, namespace, project) as (RepoWebhookRecord & {
      namespace: string;
      project: string;
      user_id: number;
    })[];
  }

  recordWebhookDelivery(params: {
    webhookId: number;
    eventType: string;
    payload: string;
    responseStatus?: number | undefined;
    errorMessage?: string | undefined;
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, response_status, error_message)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.webhookId,
        params.eventType,
        params.payload,
        params.responseStatus ?? 200,
        params.errorMessage ?? null,
      );

    return Number(info.lastInsertRowid);
  }

  // ==========================================
  // Repository Bot Reviews
  // ==========================================

  createRepoBotReview(params: {
    repoId: number;
    botId: number;
    prNumber?: number | undefined;
    commitSha?: string | undefined;
    verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    summary: string;
    issuesJson?: string | undefined;
    postId?: number | undefined;
  }): { id: number } {
    const result = this.db
      .prepare(
        `INSERT INTO repo_bot_reviews (repo_id, bot_id, pr_number, commit_sha, verdict, summary, issues_json, post_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.repoId,
        params.botId,
        params.prNumber ?? null,
        params.commitSha ?? null,
        params.verdict,
        params.summary,
        params.issuesJson ?? null,
        params.postId ?? null,
      );

    return { id: Number(result.lastInsertRowid) };
  }

  getRepoBotReviews(
    repoId: number,
    limit: number = 50,
  ): {
    id: number;
    repo_id: number;
    bot_id: number;
    bot_username: string;
    bot_display_name: string;
    pr_number: number | null;
    commit_sha: string | null;
    verdict: string;
    summary: string;
    issues_json: string | null;
    post_id: number | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT r.*, u.username as bot_username, u.display_name as bot_display_name
         FROM repo_bot_reviews r
         JOIN users u ON r.bot_id = u.id
         WHERE r.repo_id = ?
         ORDER BY r.created_at DESC
         LIMIT ?`,
      )
      .all(repoId, limit) as {
      id: number;
      repo_id: number;
      bot_id: number;
      bot_username: string;
      bot_display_name: string;
      pr_number: number | null;
      commit_sha: string | null;
      verdict: string;
      summary: string;
      issues_json: string | null;
      post_id: number | null;
      created_at: string;
    }[];
  }

  getRepoBotReviewById(id: number):
    | {
        id: number;
        repo_id: number;
        bot_id: number;
        bot_username: string;
        bot_display_name: string;
        pr_number: number | null;
        commit_sha: string | null;
        verdict: string;
        summary: string;
        issues_json: string | null;
        post_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT r.*, u.username as bot_username, u.display_name as bot_display_name
         FROM repo_bot_reviews r
         JOIN users u ON r.bot_id = u.id
         WHERE r.id = ?`,
      )
      .get(id) as
      | {
          id: number;
          repo_id: number;
          bot_id: number;
          bot_username: string;
          bot_display_name: string;
          pr_number: number | null;
          commit_sha: string | null;
          verdict: string;
          summary: string;
          issues_json: string | null;
          post_id: number | null;
          created_at: string;
        }
      | undefined;
  }

  // ── Global Search ───────────────────────────────────────────────

  globalSearch(query: string, limitPerCategory: number = 3) {
    const tokens = query
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 10);
    if (tokens.length === 0) {
      return { topics: [], users: [], packages: [], repositories: [] };
    }

    const escapeWildcards = (str: string) => str.replace(/([%_\\])/g, "\\$1");
    const escapedTokens = tokens.map(escapeWildcards);

    const primaryToken = tokens[0]!.toLowerCase();
    const escapedPrimary = escapeWildcards(primaryToken);
    const prefixPattern = `${escapedPrimary}%`;

    const topicClauses = escapedTokens
      .map(() => `(t.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.concept LIKE ? ESCAPE '\\' COLLATE NOCASE)`)
      .join(" AND ");
    const topicParams = escapedTokens.flatMap((tok) => [`%${tok}%`, `%${tok}%`]);

    const topics = this.db
      .prepare(
        `
      SELECT t.id, t.display_name, MAX(t.current_score) as current_score
      FROM trending_topics t
      WHERE (${topicClauses})
        AND COALESCE(t.review_status, 'approved') != 'rejected'
        AND EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN posts p ON p.id = pt.post_id
          WHERE pt.topic_id = t.id
            AND COALESCE(p.visibility, 'public') = 'public'
            AND COALESCE(p.is_silenced, 0) = 0
        )
      GROUP BY LOWER(t.display_name)
      ORDER BY
        CASE
          WHEN LOWER(t.concept) = ? OR LOWER(t.display_name) = ? THEN 2
          WHEN LOWER(t.concept) LIKE ? ESCAPE '\\' OR LOWER(t.display_name) LIKE ? ESCAPE '\\' THEN 1
          ELSE 0
        END DESC,
        current_score DESC
      LIMIT ?
    `,
      )
      .all(...topicParams, primaryToken, primaryToken, prefixPattern, prefixPattern, limitPerCategory);

    const userClauses = escapedTokens
      .map(
        () =>
          `(username LIKE ? ESCAPE '\\' COLLATE NOCASE OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(bio, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      )
      .join(" AND ");
    const userParams = escapedTokens.flatMap((tok) => [`%${tok}%`, `%${tok}%`, `%${tok}%`]);

    const users = this.db
      .prepare(
        `
      SELECT id, username, display_name, avatar_url, bio 
      FROM users 
      WHERE (${userClauses})
        AND COALESCE(indexable, 1) = 1
        AND COALESCE(status, 'active') = 'active'
      ORDER BY
        CASE
          WHEN LOWER(username) = ? OR LOWER(COALESCE(display_name, '')) = ? THEN 3
          WHEN LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(display_name, '')) LIKE ? ESCAPE '\\' THEN 2
          WHEN LOWER(username) LIKE ? ESCAPE '\\' THEN 1
          ELSE 0
        END DESC,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id AND (f.state = 'accepted' OR f.state IS NULL)) DESC,
        id DESC
      LIMIT ?
    `,
      )
      .all(
        ...userParams,
        primaryToken,
        primaryToken,
        prefixPattern,
        prefixPattern,
        `%${escapedPrimary}%`,
        limitPerCategory,
      );

    const pkgClauses = escapedTokens
      .map(
        () => `(name LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(description, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      )
      .join(" AND ");
    const pkgParams = escapedTokens.flatMap((tok) => [`%${tok}%`, `%${tok}%`]);

    const packages = this.db
      .prepare(
        `
      SELECT id, name, description
      FROM packages 
      WHERE (${pkgClauses})
      ORDER BY
        CASE
          WHEN LOWER(name) = ? THEN 3
          WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 2
          WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 1
          ELSE 0
        END DESC,
        (SELECT COUNT(*) FROM package_versions pv WHERE pv.package_id = packages.id) DESC,
        id DESC
      LIMIT ?
    `,
      )
      .all(...pkgParams, primaryToken, prefixPattern, `%${escapedPrimary}%`, limitPerCategory);

    const repoClauses = escapedTokens
      .map(
        () =>
          `(namespace LIKE ? ESCAPE '\\' COLLATE NOCASE OR project LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(description, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
      )
      .join(" AND ");
    const repoParams = escapedTokens.flatMap((tok) => [`%${tok}%`, `%${tok}%`, `%${tok}%`]);

    const repositories = this.db
      .prepare(
        `
      SELECT id, provider, namespace, project, description, avatar_url
      FROM linked_repos 
      WHERE (${repoClauses})
        AND COALESCE(visibility, 'public') = 'public'
      GROUP BY provider, namespace, project
      ORDER BY
        CASE
          WHEN LOWER(project) = ? THEN 3
          WHEN LOWER(project) LIKE ? ESCAPE '\\' OR LOWER(namespace) LIKE ? ESCAPE '\\' THEN 2
          WHEN LOWER(project) LIKE ? ESCAPE '\\' THEN 1
          ELSE 0
        END DESC,
        MAX(COALESCE(pinned, 0)) DESC,
        COUNT(DISTINCT user_id) DESC,
        id DESC
      LIMIT ?
    `,
      )
      .all(...repoParams, primaryToken, prefixPattern, prefixPattern, `%${escapedPrimary}%`, limitPerCategory);

    return { topics, users, packages, repositories };
  }
}
