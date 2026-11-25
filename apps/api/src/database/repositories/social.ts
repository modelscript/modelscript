// SPDX-License-Identifier: AGPL-3.0-or-later

import { normalizeUtcTimestamp } from "../../database.js";
import {
  preloadPostHydrationBatch,
  type PostHydrationBatchContext,
} from "../../database/repositories/social-hydration.js";
import type { ArtifactViewRow, NotificationRow, PostMetadata, PostRow, PostVisibility } from "../../database/types.js";
import { type BatchAnalyticsPayload } from "../../services/analytics-buffer.js";
import { defaultMailer, type DigestNotificationItem } from "../../services/mailer.js";
import { generateSnowflakeId } from "../../util/snowflake.js";
import { BaseRepository } from "./base.js";
export class SocialRepository extends BaseRepository {
  // ── Social & Posts ──────────────────────────────────────────────

  createPost(
    authorId: number,
    content: string | null,
    artifactViewId?: number | string,
    replyToId?: number | string,
    quotePostId?: number | string,
    repostOfId?: number | string,
    apId?: string,
    url?: string,
    createdAt?: string,
    updatedAt?: string,
    metadata?: PostMetadata | string | null,
    replyVisibility?: string,
    isSilenced?: boolean | number,
    isSensitiveOrVisibility?: boolean | number | PostVisibility | string,
    contentWarning?: string | null,
    visibility?: PostVisibility | string,
    explicitId?: number | string,
  ): {
    id: number;
    id_str?: string;
    visibility: PostVisibility;
    autoFiltered?: boolean;
    autoFilterAction?: string;
    is_sensitive?: number;
    content_warning?: string | null;
  } {
    if (typeof artifactViewId === "object" && artifactViewId !== null) {
      const opts = artifactViewId as {
        artifactViewId?: number | string;
        replyToId?: number | string;
        quotePostId?: number | string;
        repostOfId?: number | string;
        explicitId?: number | string;
        visibility?: PostVisibility | string;
      };
      if (opts.explicitId !== undefined) explicitId = opts.explicitId;
      if (opts.replyToId !== undefined) replyToId = opts.replyToId;
      if (opts.quotePostId !== undefined) quotePostId = opts.quotePostId;
      if (opts.repostOfId !== undefined) repostOfId = opts.repostOfId;
      if (opts.visibility !== undefined) visibility = opts.visibility;
      artifactViewId = opts.artifactViewId;
    }

    const resolvedVisibilityArg =
      visibility ?? (typeof isSensitiveOrVisibility === "string" ? isSensitiveOrVisibility : undefined);
    const resolvedIsSensitive =
      typeof isSensitiveOrVisibility === "boolean" || typeof isSensitiveOrVisibility === "number"
        ? isSensitiveOrVisibility
          ? 1
          : 0
        : contentWarning
          ? 1
          : 0;
    let effectiveVisibility: PostVisibility = "public";
    if (
      resolvedVisibilityArg === "public" ||
      resolvedVisibilityArg === "unlisted" ||
      resolvedVisibilityArg === "followers" ||
      resolvedVisibilityArg === "direct"
    ) {
      effectiveVisibility = resolvedVisibilityArg;
    } else {
      try {
        const userVis = this.db.prepare(`SELECT default_post_visibility FROM users WHERE id = ?`).get(authorId) as
          { default_post_visibility?: string | null } | undefined;
        const dv = userVis?.default_post_visibility;
        if (dv === "public" || dv === "unlisted" || dv === "followers" || dv === "direct") {
          effectiveVisibility = dv;
        }
      } catch {
        effectiveVisibility = "public";
      }
    }

    const snowflakeId = explicitId !== undefined && explicitId !== null ? String(explicitId) : generateSnowflakeId();

    this.db
      .prepare(
        `
      INSERT INTO posts (id, author_id, content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id, ap_id, url, metadata, visibility, reply_visibility, is_silenced, is_sensitive, content_warning, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'everyone'), ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    `,
      )
      .run(
        snowflakeId,
        authorId,
        content,
        artifactViewId !== undefined && artifactViewId !== null ? String(artifactViewId) : null,
        replyToId !== undefined && replyToId !== null ? String(replyToId) : null,
        quotePostId !== undefined && quotePostId !== null ? String(quotePostId) : null,
        repostOfId !== undefined && repostOfId !== null ? String(repostOfId) : null,
        apId ?? null,
        url ?? null,
        metadata ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : null,
        effectiveVisibility,
        replyVisibility ?? "everyone",
        isSilenced ? 1 : 0,
        resolvedIsSensitive,
        contentWarning ?? null,
        createdAt ?? null,
        updatedAt ?? null,
      );
    const postId = snowflakeId;

    if (content && content.trim().length > 0) {
      try {
        const settings = this.facade.getInstanceSettings();
        if (settings.autoFilterKeywords.length > 0) {
          const lowerContent = content.toLowerCase();
          let matchedTerm: string | null = null;
          for (const rawPattern of settings.autoFilterKeywords) {
            const term = rawPattern.trim();
            if (!term) continue;
            const regexMatch = term.match(/^\/(.+)\/([gimsuy]*)$/);
            if (regexMatch) {
              try {
                const re = new RegExp(regexMatch[1]!, regexMatch[2] || "i");
                if (re.test(content)) {
                  matchedTerm = term;
                  break;
                }
              } catch {
                // fallback to literal match
              }
            }
            if (lowerContent.includes(term.toLowerCase())) {
              matchedTerm = term;
              break;
            }
          }

          if (matchedTerm) {
            const action = settings.autoFilterAction;
            let cwText: string | null = null;
            let isSensitive = 0;
            if (action === "silence") {
              this.facade.silencePost(postId, true);
            } else if (action === "quarantine") {
              this.facade.quarantineResource({
                resourceType: "post",
                resourceId: String(postId),
                reason: `Automated filter match: '${matchedTerm}'`,
              });
              cwText = `Automated filter match: '${matchedTerm}'`;
              isSensitive = 1;
              this.facade.markPostSensitive(postId, true, cwText);
            } else {
              cwText = `Automated filter match: '${matchedTerm}'`;
              isSensitive = 1;
              this.facade.markPostSensitive(postId, true, cwText);
            }
            return {
              id: postId as unknown as number,
              id_str: String(postId),
              autoFiltered: true,
              autoFilterAction: action,
              is_sensitive: isSensitive,
              content_warning: cwText,
              visibility: effectiveVisibility,
            };
          }
        }
      } catch {
        // Non-fatal if settings table not initialized in isolated unit test
      }
      try {
        this.facade.syncPostTopics(postId);
      } catch {
        // Non-fatal
      }
      try {
        const mentionRegex = /(?:^|\s)@([a-zA-Z0-9_.-]+)/g;
        let match: RegExpExecArray | null;
        const mentionedUsernames = new Set<string>();
        while ((match = mentionRegex.exec(content)) !== null) {
          const raw = match[1]?.split("@")[0]?.trim();
          if (raw) mentionedUsernames.add(raw.toLowerCase());
        }
        if (mentionedUsernames.size > 0) {
          const insertMention = this.db.prepare(`INSERT OR IGNORE INTO post_mentions (post_id, user_id) VALUES (?, ?)`);
          const findUser = this.db.prepare(`SELECT id FROM users WHERE LOWER(username) = ?`);
          for (const uName of mentionedUsernames) {
            const u = findUser.get(uName) as { id: number } | undefined;
            if (u) {
              insertMention.run(postId, u.id);
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    return { id: postId as unknown as number, id_str: String(postId), visibility: effectiveVisibility };
  }

  updatePostArtifactViewId(postId: number | string, artifactViewId: number | string) {
    this.db.prepare(`UPDATE posts SET artifact_view_id = ? WHERE id = ?`).run(String(artifactViewId), String(postId));
  }

  updatePost(
    postId: number | string,
    updates: {
      content?: string | null | undefined;
      artifactViewId?: number | string | null | undefined;
      metadata?: PostMetadata | string | null | undefined;
      replyVisibility?: string | undefined;
      contentWarning?: string | null | undefined;
    },
  ): void {
    const existing = this.db
      .prepare(
        `SELECT content, CAST(artifact_view_id AS TEXT) as artifact_view_id, metadata, reply_visibility, content_warning FROM posts WHERE id = ?`,
      )
      .get(String(postId)) as
      | {
          content: string | null;
          artifact_view_id: string | null;
          metadata: string | null;
          reply_visibility: string;
          content_warning: string | null;
        }
      | undefined;
    if (!existing) return;

    const nextContent = updates.content !== undefined ? updates.content : existing.content;
    const nextArtifactViewId =
      updates.artifactViewId !== undefined
        ? updates.artifactViewId !== null
          ? String(updates.artifactViewId)
          : null
        : existing.artifact_view_id;
    const nextMetadata =
      updates.metadata !== undefined
        ? typeof updates.metadata === "string"
          ? updates.metadata
          : JSON.stringify(updates.metadata)
        : existing.metadata;
    const nextReplyVisibility =
      updates.replyVisibility !== undefined ? updates.replyVisibility : existing.reply_visibility;
    const nextContentWarning = updates.contentWarning !== undefined ? updates.contentWarning : existing.content_warning;

    this.db
      .prepare(
        `UPDATE posts
         SET content = ?, artifact_view_id = ?, metadata = ?, reply_visibility = ?, content_warning = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        nextContent ?? null,
        nextArtifactViewId ?? null,
        nextMetadata ?? null,
        nextReplyVisibility,
        nextContentWarning ?? null,
        postId,
      );

    if (updates.content !== undefined) {
      try {
        this.facade.syncPostTopics(postId);
      } catch {
        // Non-fatal
      }
    }
  }

  flushAnalyticsBatch(batch: BatchAnalyticsPayload): void {
    if (
      batch.postViews.length === 0 &&
      batch.postLocationViews.length === 0 &&
      batch.pageViews.length === 0 &&
      batch.pageLocationViews.length === 0 &&
      batch.packageDownloads.length === 0
    ) {
      return;
    }

    const analyticsTarget = this.facade.analyticsDb ?? this.db;
    const analyticsTx = analyticsTarget.transaction(() => {
      const postExistsStmt = this.db.prepare(`SELECT 1 FROM posts WHERE id = ?`);

      if (batch.postLocationViews.length > 0) {
        const stmt = analyticsTarget.prepare(`
          INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(post_id, country_code, COALESCE(region_code, ''))
          DO UPDATE SET view_count = post_location_stats.view_count + excluded.view_count
        `);
        for (const item of batch.postLocationViews) {
          if (!postExistsStmt.get(item.postId)) continue;
          stmt.run(item.postId, item.countryCode, item.regionCode, item.count);
        }
      }

      if (batch.pageViews.length > 0) {
        const stmt = analyticsTarget.prepare(`
          INSERT INTO page_views_daily (view_date, surface, path, views_count, unique_visitors)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(view_date, surface, path) DO UPDATE SET
            views_count = page_views_daily.views_count + excluded.views_count,
            unique_visitors = page_views_daily.unique_visitors + excluded.unique_visitors
        `);
        for (const item of batch.pageViews) {
          stmt.run(item.viewDate, item.surface, item.path, item.views, item.uniques);
        }
      }

      if (batch.pageLocationViews.length > 0) {
        const stmt = analyticsTarget.prepare(`
          INSERT INTO page_location_stats_daily (view_date, surface, country_code, region_code, views_count)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(view_date, surface, country_code, region_code) DO UPDATE SET
            views_count = page_location_stats_daily.views_count + excluded.views_count
        `);
        for (const item of batch.pageLocationViews) {
          stmt.run(item.viewDate, item.surface, item.countryCode, item.regionCode, item.count);
        }
      }

      if (batch.packageDownloads.length > 0) {
        const stmt = analyticsTarget.prepare(`
          INSERT INTO package_downloads_daily (library_name, library_version, download_date, downloads_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(library_name, library_version, download_date)
          DO UPDATE SET downloads_count = package_downloads_daily.downloads_count + excluded.downloads_count
        `);
        for (const item of batch.packageDownloads) {
          stmt.run(item.libraryName, item.libraryVersion, item.downloadDate, item.count);
        }
      }
    });

    analyticsTx();

    if (batch.postViews.length > 0) {
      const mainTx = this.db.transaction(() => {
        const postExistsStmt = this.db.prepare(`SELECT 1 FROM posts WHERE id = ?`);
        const stmt = this.db.prepare(`UPDATE posts SET view_count = view_count + ? WHERE id = ?`);
        for (const [postId, delta] of batch.postViews) {
          if (!postExistsStmt.get(postId)) continue;
          stmt.run(delta, postId);
        }
      });
      mainTx();
    }
  }

  incrementPostView(postId: number | string, countryCode?: string, regionCode?: string) {
    if (this.facade.analyticsBuffer) {
      this.facade.analyticsBuffer.incrementPostView(postId, countryCode, regionCode);
      return;
    }

    this.db.prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`).run(postId);

    const normCountry = countryCode ? countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        regionCode && /^[A-Za-z0-9]{1,6}$/.test(regionCode.trim()) ? regionCode.trim().toUpperCase() : null;
      const analyticsTarget = this.facade.analyticsDb ?? this.db;
      analyticsTarget
        .prepare(
          `
        INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(post_id, country_code, COALESCE(region_code, '')) DO UPDATE SET view_count = post_location_stats.view_count + 1
      `,
        )
        .run(postId, normCountry, normRegion);
    }
  }

  getPostLocationStats(postId: number | string): { country: string; views: number }[] {
    if (this.facade.analyticsBuffer?.hasPostPending(postId)) {
      this.facade.analyticsBuffer.flushSync();
    }
    const targetDb = this.facade.analyticsDb ?? this.db;
    return targetDb
      .prepare(
        `
      SELECT country_code as country, SUM(view_count) as views 
      FROM post_location_stats 
      WHERE post_id = ? 
      GROUP BY country_code
      ORDER BY views DESC
    `,
      )
      .all(postId) as { country: string; views: number }[];
  }

  getPostRegionStats(postId: number | string): { country: string; region: string; views: number }[] {
    if (this.facade.analyticsBuffer?.hasPostPending(postId)) {
      this.facade.analyticsBuffer.flushSync();
    }
    const targetDb = this.facade.analyticsDb ?? this.db;
    return targetDb
      .prepare(
        `
      SELECT country_code as country, region_code as region, SUM(view_count) as views 
      FROM post_location_stats 
      WHERE post_id = ? AND region_code IS NOT NULL AND region_code != ''
      GROUP BY country_code, region_code
      ORDER BY views DESC
    `,
      )
      .all(postId) as { country: string; region: string; views: number }[];
  }

  recordPageView(params: {
    surface: "web" | "docs";
    path: string;
    isUniqueVisitor?: boolean | undefined;
    countryCode?: string | undefined;
    regionCode?: string | undefined;
    date?: string | undefined;
  }): void {
    if (this.facade.analyticsBuffer) {
      this.facade.analyticsBuffer.recordPageView(params);
      return;
    }

    const viewDate =
      params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : new Date().toISOString().slice(0, 10);
    const surface: "web" | "docs" = params.surface === "docs" ? "docs" : "web";
    let cleanPath =
      String(params.path || "/")
        .split("?")[0]
        ?.split("#")[0]
        ?.trim() || "/";
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }
    while (cleanPath.length > 1 && cleanPath.endsWith("/")) {
      cleanPath = cleanPath.slice(0, -1);
    }
    if (cleanPath.length > 256) {
      cleanPath = cleanPath.slice(0, 256);
    }

    const uniqueInc = params.isUniqueVisitor ? 1 : 0;
    const analyticsTarget = this.facade.analyticsDb ?? this.db;

    analyticsTarget
      .prepare(
        `
        INSERT INTO page_views_daily (view_date, surface, path, views_count, unique_visitors)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(view_date, surface, path) DO UPDATE SET
          views_count = page_views_daily.views_count + 1,
          unique_visitors = page_views_daily.unique_visitors + excluded.unique_visitors
      `,
      )
      .run(viewDate, surface, cleanPath, uniqueInc);

    const normCountry = params.countryCode ? params.countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        params.regionCode && /^[A-Za-z0-9]{1,6}$/.test(params.regionCode.trim())
          ? params.regionCode.trim().toUpperCase()
          : "";
      analyticsTarget
        .prepare(
          `
          INSERT INTO page_location_stats_daily (view_date, surface, country_code, region_code, views_count)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(view_date, surface, country_code, region_code) DO UPDATE SET
            views_count = page_location_stats_daily.views_count + 1
        `,
        )
        .run(viewDate, surface, normCountry, normRegion);
    }
  }

  getPageAnalyticsSummary(
    days = 30,
    surface?: "web" | "docs",
  ): {
    totalViews: number;
    uniqueVisitors: number;
    webViews: number;
    docsViews: number;
    postViewsTotal: number;
    packageDownloadsTotal: number;
    daily: { date: string; views: number; uniqueVisitors: number; webViews: number; docsViews: number }[];
    topPages: { surface: "web" | "docs"; path: string; views: number; uniqueVisitors: number }[];
    locationStats: { country: string; views: number }[];
    regionStats: { country: string; region: string; views: number }[];
  } {
    this.facade.analyticsBuffer?.flushSync();
    const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
    const cutoff = new Date(Date.now() - (safeDays - 1) * 86_400_000).toISOString().slice(0, 10);
    const hasSurface = surface === "web" || surface === "docs";
    const targetDb = this.facade.analyticsDb ?? this.db;

    const totalsRow = targetDb
      .prepare(
        `
        SELECT
          COALESCE(SUM(views_count), 0) AS totalViews,
          COALESCE(SUM(unique_visitors), 0) AS uniqueVisitors,
          COALESCE(SUM(CASE WHEN surface = 'web' THEN views_count ELSE 0 END), 0) AS webViews,
          COALESCE(SUM(CASE WHEN surface = 'docs' THEN views_count ELSE 0 END), 0) AS docsViews
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
      `,
      )
      .get(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      totalViews: number;
      uniqueVisitors: number;
      webViews: number;
      docsViews: number;
    };

    const dailyRows = targetDb
      .prepare(
        `
        SELECT
          view_date AS date,
          SUM(views_count) AS views,
          SUM(unique_visitors) AS uniqueVisitors,
          SUM(CASE WHEN surface = 'web' THEN views_count ELSE 0 END) AS webViews,
          SUM(CASE WHEN surface = 'docs' THEN views_count ELSE 0 END) AS docsViews
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY view_date
        ORDER BY view_date ASC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      date: string;
      views: number;
      uniqueVisitors: number;
      webViews: number;
      docsViews: number;
    }[];

    const topPages = targetDb
      .prepare(
        `
        SELECT
          surface,
          path,
          SUM(views_count) AS views,
          SUM(unique_visitors) AS uniqueVisitors
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY surface, path
        ORDER BY views DESC, uniqueVisitors DESC
        LIMIT 25
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      surface: "web" | "docs";
      path: string;
      views: number;
      uniqueVisitors: number;
    }[];

    const locationStats = targetDb
      .prepare(
        `
        SELECT country_code AS country, SUM(views_count) AS views
        FROM page_location_stats_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY country_code
        ORDER BY views DESC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as { country: string; views: number }[];

    const regionStats = targetDb
      .prepare(
        `
        SELECT country_code AS country, region_code AS region, SUM(views_count) AS views
        FROM page_location_stats_daily
        WHERE view_date >= ? AND region_code != '' ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY country_code, region_code
        ORDER BY views DESC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as { country: string; region: string; views: number }[];

    const postViewsRow = this.db.prepare(`SELECT COALESCE(SUM(view_count), 0) AS total FROM posts`).get() as {
      total: number;
    };
    const pkgDlRow = targetDb
      .prepare(
        `SELECT COALESCE(SUM(downloads_count), 0) AS total FROM package_downloads_daily WHERE download_date >= ?`,
      )
      .get(cutoff) as { total: number };

    return {
      totalViews: totalsRow.totalViews || 0,
      uniqueVisitors: totalsRow.uniqueVisitors || 0,
      webViews: totalsRow.webViews || 0,
      docsViews: totalsRow.docsViews || 0,
      postViewsTotal: postViewsRow?.total || 0,
      packageDownloadsTotal: pkgDlRow?.total || 0,
      daily: dailyRows,
      topPages,
      locationStats,
      regionStats,
    };
  }

  prunePageAnalytics(retainDays: number): {
    deletedDailyRows: number;
    deletedLocationRows: number;
    cutoffDate: string;
  } {
    const safeDays = Math.max(0, Math.floor(retainDays));
    const cutoffDate =
      safeDays === 0 ? "9999-12-31" : new Date(Date.now() - safeDays * 86_400_000).toISOString().slice(0, 10);

    const targetDb = this.facade.analyticsDb ?? this.db;
    const r1 = targetDb.prepare(`DELETE FROM page_views_daily WHERE view_date < ?`).run(cutoffDate);
    const r2 = targetDb.prepare(`DELETE FROM page_location_stats_daily WHERE view_date < ?`).run(cutoffDate);
    return {
      deletedDailyRows: r1.changes,
      deletedLocationRows: r2.changes,
      cutoffDate,
    };
  }

  hydratePost(
    p: (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined }) | null | undefined,
    currentUserId?: number,
    depth: number = 0,
    preloaded?: PostHydrationBatchContext,
  ): PostRow | null {
    if (!p) return null;
    if (p.id !== undefined && p.id !== null) {
      p.id = String(p.id);
      p.id_str = String(p.id);
    }
    if (p.created_at) {
      p.created_at = normalizeUtcTimestamp(p.created_at);
    }
    if (p.updated_at) {
      p.updated_at = normalizeUtcTimestamp(p.updated_at);
    }
    if ((p as { published_at?: string }).published_at) {
      (p as { published_at?: string }).published_at = normalizeUtcTimestamp(
        (p as { published_at?: string }).published_at,
      );
    }
    if (p.artifact_view_id !== undefined && p.artifact_view_id !== null) {
      p.artifact_view_id = String(p.artifact_view_id);
    }
    if (p.reply_to_id !== undefined && p.reply_to_id !== null) {
      p.reply_to_id = String(p.reply_to_id);
    }
    if (p.quote_post_id !== undefined && p.quote_post_id !== null) {
      p.quote_post_id = String(p.quote_post_id);
    }
    if (p.repost_of_id !== undefined && p.repost_of_id !== null) {
      p.repost_of_id = String(p.repost_of_id);
    }
    if (p.metadata && typeof p.metadata === "string") {
      try {
        p.metadata = JSON.parse(p.metadata) as PostMetadata | string;
        if (typeof p.metadata === "string") {
          p.metadata = JSON.parse(p.metadata) as PostMetadata;
        }
      } catch {
        // Optional JSON parse or best-effort async side-effect ignored
      }
    }
    const meta = p.metadata && typeof p.metadata === "object" ? p.metadata : undefined;
    if (meta) {
      if (!p.client_signature && meta.clientSignature) {
        p.client_signature = meta.clientSignature;
      }
      if (!p.key_id_string && meta.keyIdString) {
        p.key_id_string = meta.keyIdString;
      }
      if (!p.content_warning && typeof meta.contentWarning === "string" && meta.contentWarning.trim()) {
        p.content_warning = meta.contentWarning.trim();
      }
    }
    if (p.content_warning && !p.is_sensitive) {
      p.is_sensitive = 1;
    }
    if (p.artifact_view_id && !p.artifact_view) {
      p.artifact_view = this.facade.getArtifactView(p.artifact_view_id) ?? null;
    }
    const extraArtifactIds = new Set<string>();
    if (p.artifact_view_id !== undefined && p.artifact_view_id !== null) {
      extraArtifactIds.add(String(p.artifact_view_id));
    }
    const customArtifactIds = meta?.["artifactIds"];
    if (Array.isArray(customArtifactIds)) {
      for (const aid of customArtifactIds) {
        if (aid !== undefined && aid !== null && String(aid).trim().length > 0)
          extraArtifactIds.add(String(aid).trim());
      }
    }
    if (Array.isArray(meta?.notebook?.artifactIds)) {
      for (const aid of meta.notebook.artifactIds) {
        if (aid !== undefined && aid !== null && String(aid).trim().length > 0)
          extraArtifactIds.add(String(aid).trim());
      }
    }
    if (Array.isArray(meta?.notebook?.cells)) {
      for (const cell of meta.notebook.cells) {
        if (
          cell?.type === "artifact" &&
          cell.artifactId !== undefined &&
          cell.artifactId !== null &&
          String(cell.artifactId).trim().length > 0
        ) {
          extraArtifactIds.add(String(cell.artifactId).trim());
        }
      }
    }
    if (typeof p.content === "string" && p.content.includes("::artifact")) {
      const directiveRe = /::artifact(?:\[[^\]]*\])?\{([^}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = directiveRe.exec(p.content)) !== null) {
        const idMatch = (match[1] || "").match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
        if (idMatch && idMatch[1]) {
          extraArtifactIds.add(String(idMatch[1]));
        }
      }
    }
    if (extraArtifactIds.size > 0) {
      const viewsMap: Record<string, ArtifactViewRow> = {};
      for (const aid of extraArtifactIds) {
        const view =
          String(aid) === String(p.artifact_view_id) && p.artifact_view
            ? p.artifact_view
            : this.facade.getArtifactView(aid);
        if (view) {
          viewsMap[aid] = view;
        }
      }
      p.artifact_views = viewsMap;
    }
    p.visibility = ((p as { visibility?: string }).visibility as PostVisibility) || "public";
    if (p.bookmark_count === undefined) {
      if (preloaded) {
        p.bookmark_count = preloaded.bookmarkCounts.get(p.id) ?? 0;
      } else {
        const bmRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM bookmarks WHERE post_id = ?`).get(p.id) as
          { cnt: number } | undefined;
        p.bookmark_count = bmRow?.cnt ?? 0;
      }
    }
    const poll = preloaded ? (preloaded.pollsByPostId.get(p.id) ?? null) : this.facade.getPostPoll(p.id, currentUserId);
    if (poll) {
      p.poll = poll;
    }
    if (depth < 2) {
      if (p.repost_of_id && p.repost_of_id !== p.id) {
        const rp = this.getPost(p.repost_of_id, currentUserId, depth + 1);
        if (rp && this.#isPostVisibleToUser(rp, currentUserId)) {
          p.repost_post = rp;
        }
      }
      if (p.quote_post_id && p.quote_post_id !== p.id) {
        const qp = this.getPost(p.quote_post_id, currentUserId, depth + 1);
        if (qp && this.#isPostVisibleToUser(qp, currentUserId)) {
          p.quote_post = qp;
        }
      }
    }
    return p as PostRow;
  }

  hydratePostsBatch(
    rows: (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined })[],
    currentUserId?: number,
    depth: number = 0,
  ): PostRow[] {
    if (!rows || rows.length === 0) return [];
    const preloaded = preloadPostHydrationBatch(this.db, rows, currentUserId);
    const hydrated: PostRow[] = [];
    for (const row of rows) {
      const post = this.hydratePost(row, currentUserId, depth, preloaded);
      if (post) hydrated.push(post);
    }
    return hydrated;
  }

  #isPostVisibleToUser(post: PostRow, currentUserId?: number): boolean {
    const vis = post.visibility || "public";
    if (vis === "public" || vis === "unlisted") return true;
    if (!currentUserId || currentUserId <= 0) return false;
    if (post.author_id === currentUserId) return true;
    const viewer = this.facade.getUserById(currentUserId);
    if (viewer?.account_type === "admin") return true;
    if (vis === "followers") {
      return this.facade.isFollowing(currentUserId, post.author_id);
    }
    if (vis === "direct") {
      if (!viewer?.username) return false;
      const escaped = viewer.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\s)@${escaped}\\b`, "i").test(post.content || "");
    }
    return false;
  }

  getPost(id: number | string, currentUserId?: number, depth: number = 0): PostRow | null {
    if (depth === 0 && this.facade.analyticsBuffer?.hasPostPending(id)) {
      this.facade.analyticsBuffer.flushSync();
    }
    const uid = currentUserId || -1;
    const p = this.db
      .prepare(
        `
      SELECT p.*,
        CAST(p.id AS TEXT) as id,
        CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
        CAST(p.reply_to_id AS TEXT) as reply_to_id,
        CAST(p.quote_post_id AS TEXT) as quote_post_id,
        CAST(p.repost_of_id AS TEXT) as repost_of_id,
        u.username, u.display_name, u.avatar_url, u.account_type, COALESCE(u.signing_verified, 0) as signing_verified,
        COALESCE(p.like_count, 0) as like_count,
        COALESCE(p.reply_count, 0) as reply_count,
        COALESCE(p.repost_count, 0) as repost_count,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id) as bookmark_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `,
      )
      .get(uid, uid, uid, id) as
      (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined }) | undefined;
    return this.hydratePost(p, currentUserId, depth);
  }

  getReplies(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "thread");
    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.reply_to_id = ?
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at ASC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, ...visFilter.params, ...modFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = this.hydratePostsBatch(posts, currentUserId);
    return this.facade.applyContentFiltersToPosts(hydrated, "thread", currentUserId);
  }

  getQuotes(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "thread");
    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.quote_post_id = ?
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, ...visFilter.params, ...modFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return this.hydratePostsBatch(posts, currentUserId);
  }

  getReposts(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "thread");
    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.repost_of_id = ?
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, ...visFilter.params, ...modFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return this.hydratePostsBatch(posts, currentUserId);
  }

  getPostParents(postId: number | string, currentUserId?: number, depth: number = 5): PostRow[] {
    const parents: PostRow[] = [];
    let currentId = postId;
    let currentDepth = 0;

    while (currentDepth < depth) {
      const p = this.db
        .prepare(`SELECT CAST(reply_to_id AS TEXT) as reply_to_id FROM posts WHERE id = ?`)
        .get(currentId) as { reply_to_id: string | null } | undefined;
      if (!p || !p.reply_to_id) break;

      const parentPost = this.getPost(p.reply_to_id, currentUserId);
      if (parentPost && this.#isPostVisibleToUser(parentPost, currentUserId)) {
        parents.unshift(parentPost); // Add to beginning (oldest first)
        currentId = p.reply_to_id;
      } else {
        break;
      }
      currentDepth++;
    }
    return parents;
  }

  buildArtifactFilter(artifactType?: string): { sql: string; params: (string | number)[] } {
    if (!artifactType || artifactType === "all") return { sql: "", params: [] };
    const norm = artifactType.toLowerCase();
    if (norm === "cad") {
      return {
        sql: " AND a.view_type IN ('cad', 'cad-step', 'cad_step', 'cad-3d-viewer', 'step', 'stp', '3d-model')",
        params: [],
      };
    }
    if (norm === "fmu" || norm === "fmi") {
      return { sql: " AND a.view_type IN ('fmu', 'fmu-package', 'fmu-simulator', 'fmi')", params: [] };
    }
    if (norm === "sysml" || norm === "kerml") {
      return { sql: " AND a.view_type IN ('sysml', 'sysml2', 'sysml-architecture-viewer', 'kerml')", params: [] };
    }
    if (norm === "simulation" || norm === "cfd" || norm === "fea") {
      return {
        sql: " AND a.view_type IN ('simulation', 'simulation-result', 'fea-result', 'cfd-result', 'cfd-animation', 'fmu', 'fmu-package', 'fmu-simulator')",
        params: [],
      };
    }
    if (norm === "plot" || norm === "csv" || norm === "dataset") {
      return {
        sql: " AND a.view_type IN ('simulation-plot', 'simulation-result', 'csv', 'tsv', 'dataset', 'dataset-table', 'json-table')",
        params: [],
      };
    }
    if (norm === "modelica" || norm === "code") {
      return {
        sql: " AND a.view_type IN ('modelica-code', 'modelica-diagram', 'ansatz', 'sysml', 'sysml2')",
        params: [],
      };
    }
    if (norm === "aas" || norm === "twin") {
      return {
        sql: " AND a.view_type IN ('aas-package', 'cyber-physical-system', 'hardware-project', 'digital-thread', 'digital-twin-dashboard')",
        params: [],
      };
    }
    if (norm === "gcode" || norm === "cam") {
      return { sql: " AND a.view_type IN ('gcode', 'cam-result')", params: [] };
    }
    if (norm === "webgpu") {
      return { sql: " AND a.view_type IN ('webgpu', 'webgpu-simulation', 'gpu-simulation')", params: [] };
    }
    if (norm === "has_artifact" || norm === "artifacts") {
      return { sql: " AND p.artifact_view_id IS NOT NULL", params: [] };
    }
    if (norm === "notebook" || norm === "notebooks") {
      return {
        sql: " AND (p.metadata LIKE '%\"isNotebook\":true%' OR p.content LIKE '%::artifact%')",
        params: [],
      };
    }
    return { sql: " AND LOWER(a.view_type) = ?", params: [norm] };
  }

  private buildTagFilter(tag?: string): { sql: string; params: (string | number)[] } {
    if (!tag) return { sql: "", params: [] };
    const clean = tag.replace(/^#/, "").trim().toLowerCase();
    if (!clean) return { sql: "", params: [] };
    return {
      sql: ` AND (
        EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN trending_topics t ON pt.topic_id = t.id
          WHERE pt.post_id = p.id AND (LOWER(t.concept) = ? OR LOWER(t.display_name) = ?)
        ) OR LOWER(p.content) LIKE ?
      )`,
      params: [clean, clean, `%#${clean}%`],
    };
  }

  buildMuteBlockFilter(userId?: number): { sql: string; params: (string | number)[] } {
    if (!userId || userId <= 0) return { sql: "", params: [] };
    return {
      sql: ` AND p.author_id NOT IN (SELECT muted_id FROM user_mutes WHERE muter_id = ?)
        AND p.author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        AND p.author_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)`,
      params: [userId, userId, userId],
    };
  }

  buildVisibilityFilter(
    currentUserId?: number,
    scope: "home" | "following" | "public" | "outbox" | "profile" | "thread" = "public",
  ): { sql: string; params: (string | number)[] } {
    if (scope === "public") {
      return {
        sql: " AND COALESCE(p.visibility, 'public') = 'public'",
        params: [],
      };
    }
    if (scope === "outbox") {
      return {
        sql: " AND COALESCE(p.visibility, 'public') IN ('public', 'unlisted')",
        params: [],
      };
    }
    if (!currentUserId || currentUserId <= 0) {
      return {
        sql: " AND COALESCE(p.visibility, 'public') IN ('public', 'unlisted')",
        params: [],
      };
    }
    return {
      sql: ` AND (
        COALESCE(p.visibility, 'public') IN ('public', 'unlisted')
        OR p.author_id = ?
        OR (COALESCE(p.visibility, 'public') = 'followers' AND p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        OR (COALESCE(p.visibility, 'public') = 'direct' AND (
          p.author_id = ?
          OR EXISTS (SELECT 1 FROM post_mentions pm WHERE pm.post_id = p.id AND pm.user_id = ?)
          OR EXISTS (
            SELECT 1 FROM users uv WHERE uv.id = ? AND (
              ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || ' %'
              OR ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || '.%'
              OR ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || '!%'
              OR ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || '?%'
              OR ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || ':%'
            )
          )
        ))
      )`,
      params: [currentUserId, currentUserId, currentUserId, currentUserId, currentUserId],
    };
  }

  getHomeTimeline(
    userId: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    try {
      this.facade.deriveUserTopics(userId);
    } catch (e) {
      console.error("Failed to derive user topics", e);
    }

    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(userId);
    const visFilter = this.buildVisibilityFilter(userId, "home");
    const allParams = [
      userId,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

    const posts = this.db
      .prepare(
        `
      WITH viewer AS (SELECT ? AS uid)
      SELECT p.*,
        CAST(p.id AS TEXT) as id,
        CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
        CAST(p.reply_to_id AS TEXT) as reply_to_id,
        CAST(p.quote_post_id AS TEXT) as quote_post_id,
        CAST(p.repost_of_id AS TEXT) as repost_of_id,
        u.username, u.display_name, u.avatar_url, u.account_type, COALESCE(u.signing_verified, 0) as signing_verified,
        COALESCE(p.like_count, 0) as like_count,
        COALESCE(p.reply_count, 0) as reply_count,
        COALESCE(p.repost_count, 0) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=(SELECT uid FROM viewer)) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=(SELECT uid FROM viewer)) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=(SELECT uid FROM viewer)) as bookmarked,
        (
          (
            (CASE
              WHEN p.author_id = (SELECT uid FROM viewer)
                OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = (SELECT uid FROM viewer))
                OR p.author_id IN (SELECT f.user_id FROM user_rss_subscriptions s JOIN rss_feeds f ON s.rss_feed_id = f.id WHERE s.user_id = (SELECT uid FROM viewer))
              THEN 25
              ELSE 0
            END) +
            (CASE
              WHEN u.engineering_persona IS NOT NULL
                AND u.engineering_persona = (SELECT engineering_persona FROM users WHERE id = (SELECT uid FROM viewer))
              THEN 10
              ELSE 0
            END) +
            (CASE
              WHEN EXISTS (
                SELECT 1 FROM likes l2
                JOIN posts p2 ON l2.post_id = p2.id
                WHERE l2.user_id = (SELECT uid FROM viewer)
                  AND p2.author_id = p.author_id
                  AND p2.id != p.id
              )
              THEN 12
              ELSE 0
            END) +
            (
              SELECT COALESCE(SUM(CASE WHEN ut.is_active = 1 THEN 20 ELSE -100 END), 0)
              FROM post_topics pt
              JOIN trending_topics t ON pt.topic_id = t.id
              JOIN user_topics ut ON LOWER(ut.concept) = LOWER(t.concept) AND ut.user_id = (SELECT uid FROM viewer)
              WHERE pt.post_id = p.id
            ) +
            (
              (SELECT COUNT(*) FROM likes l JOIN follows f ON l.user_id = f.following_id WHERE l.post_id = p.id AND f.follower_id = (SELECT uid FROM viewer)) * 8
            ) +
            (COALESCE(p.like_count, 0) * 3) +
            (COALESCE(p.reply_count, 0) * 5) +
            (COALESCE(p.repost_count, 0) * 6) +
            ((SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id) * 7) +
            MIN(10.0, COALESCE(p.view_count, 0) * 0.1) +
            (CASE WHEN p.artifact_view_id IS NOT NULL THEN 12 ELSE 0 END) -
            (CASE
              WHEN p.author_id != (SELECT uid FROM viewer)
                AND EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = (SELECT uid FROM viewer))
              THEN 15
              ELSE 0
            END)
          ) / (
            (MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL)) + 2.0) *
            (1.0 + 0.15 * MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL)))
          )
        ) as total_score
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE
        (
          p.reply_to_id IS NULL
          OR p.author_id = (SELECT uid FROM viewer)
          OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = (SELECT uid FROM viewer))
        )
        AND (
          p.author_id = (SELECT uid FROM viewer)
          OR NOT EXISTS (
            SELECT 1 FROM post_topics pt
            JOIN trending_topics t ON pt.topic_id = t.id
            JOIN user_topics ut ON LOWER(ut.concept) = LOWER(t.concept)
            WHERE pt.post_id = p.id AND ut.user_id = (SELECT uid FROM viewer) AND ut.is_active = 0
          )
        )
        AND (
          p.author_id = (SELECT uid FROM viewer) OR
          p.author_id IN (SELECT following_id FROM follows WHERE follower_id = (SELECT uid FROM viewer)) OR
          p.author_id IN (SELECT f.user_id FROM user_rss_subscriptions s JOIN rss_feeds f ON s.rss_feed_id = f.id WHERE s.user_id = (SELECT uid FROM viewer)) OR
          (
            COALESCE(p.visibility, 'public') = 'public' AND
            (p.is_silenced IS NULL OR p.is_silenced = 0) AND
            (
              EXISTS (
                SELECT 1 FROM post_topics pt
                JOIN trending_topics t ON pt.topic_id = t.id
                JOIN user_topics ut ON LOWER(ut.concept) = LOWER(t.concept) AND ut.user_id = (SELECT uid FROM viewer) AND ut.is_active = 1
                WHERE pt.post_id = p.id
              ) OR
              (
                u.engineering_persona IS NOT NULL AND
                u.engineering_persona = (SELECT engineering_persona FROM users WHERE id = (SELECT uid FROM viewer))
              ) OR
              p.author_id IN (
                SELECT f2.following_id
                FROM follows f1
                JOIN follows f2 ON f1.following_id = f2.follower_id
                WHERE f1.follower_id = (SELECT uid FROM viewer)
              )
            )
          )
        )
        ${artFilter.sql}
        ${tagFilter.sql}
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY total_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = this.hydratePostsBatch(posts, userId);
    return this.facade.applyContentFiltersToPosts(hydrated, "home", userId);
  }

  getFollowingTimeline(
    userId: number,
    limit: number = 20,
    sort: string = "recent",
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    const orderBy =
      sort === "popular"
        ? "((like_count * 10 + reply_count * 15 + repost_count * 20 + MIN(50, COALESCE(p.view_count, 0))) / ((MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL)) + 2.0) * (1.0 + 0.1 * MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 AS REAL))))) DESC, diversity_score DESC"
        : "diversity_score DESC";
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(userId);
    const visFilter = this.buildVisibilityFilter(userId, "following");
    const allParams = [
      userId,
      userId,
      userId,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      userId,
      userId,
      userId,
      limit,
      offset,
    ];

    const posts = this.db
      .prepare(
        `
      WITH author_ranks AS (
        SELECT
          p.id AS post_id,
          (ROW_NUMBER() OVER (PARTITION BY p.author_id ORDER BY p.id DESC) - 1) AS newer_author_posts
        FROM posts p
        JOIN users u ON p.author_id = u.id
        LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
        WHERE (
          p.author_id = ? OR
          p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR
          p.author_id IN (SELECT f.user_id FROM user_rss_subscriptions s JOIN rss_feeds f ON s.rss_feed_id = f.id WHERE s.user_id = ?)
        )
          ${artFilter.sql}
          ${tagFilter.sql}
          ${visFilter.sql}
          ${modFilter.sql}
      )
      SELECT p.*,
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
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          strftime('%s', p.created_at) -
          ar.newer_author_posts * 14400 -- 4 hours penalty for each newer post by the same author
        ) as diversity_score
      FROM author_ranks ar
      JOIN posts p ON p.id = ar.post_id
      JOIN users u ON p.author_id = u.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = this.hydratePostsBatch(posts, userId);
    return this.facade.applyContentFiltersToPosts(hydrated, "home", userId);
  }

  private buildSearchFilter(searchQuery?: string): { sql: string; params: (string | number)[] } {
    if (!searchQuery) return { sql: "", params: [] };
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 10);
    if (tokens.length === 0) return { sql: "", params: [] };

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    for (const token of tokens) {
      const escaped = token.replace(/([%_\\])/g, "\\$1");
      const like = `%${escaped}%`;
      clauses.push(`(
        LOWER(COALESCE(p.content, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(a.title, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(a.view_type, '')) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN trending_topics t ON pt.topic_id = t.id
          WHERE pt.post_id = p.id AND (LOWER(t.concept) LIKE ? ESCAPE '\\' OR LOWER(t.display_name) LIKE ? ESCAPE '\\')
        )
      )`);
      params.push(like, like, like, like, like, like, like);
    }
    return {
      sql: ` AND ${clauses.join(" AND ")}`,
      params,
    };
  }

  getExploreTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
    searchQuery?: string,
  ): PostRow[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const searchFilter = this.buildSearchFilter(searchQuery);
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "public");
    const allParams = [
      uid,
      ...artFilter.params,
      ...tagFilter.params,
      ...searchFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

    const posts = this.db
      .prepare(
        `
      WITH viewer AS (SELECT ? AS uid)
      SELECT p.*,
        CAST(p.id AS TEXT) as id,
        CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
        CAST(p.reply_to_id AS TEXT) as reply_to_id,
        CAST(p.quote_post_id AS TEXT) as quote_post_id,
        CAST(p.repost_of_id AS TEXT) as repost_of_id,
        u.username, u.display_name, u.avatar_url, u.account_type, COALESCE(u.signing_verified, 0) as signing_verified,
        COALESCE(p.like_count, 0) as like_count,
        COALESCE(p.reply_count, 0) as reply_count,
        COALESCE(p.repost_count, 0) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=(SELECT uid FROM viewer)) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=(SELECT uid FROM viewer)) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=(SELECT uid FROM viewer)) as bookmarked,
        (
          MIN(50, COALESCE(p.view_count, 0)) * 1 +
          COALESCE(p.view_count, 0) * 0.1 +
          COALESCE(p.like_count, 0) * 10 +
          COALESCE(p.reply_count, 0) * 15 +
          COALESCE(p.repost_count, 0) * 20 +
          (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id) * 25 +
          (CASE WHEN p.artifact_view_id IS NOT NULL THEN 15 ELSE 0 END) +
          (
            SELECT COALESCE(SUM(CASE WHEN ut.is_active = 1 THEN 15 ELSE -100 END), 0)
            FROM post_topics pt
            JOIN trending_topics t ON pt.topic_id = t.id
            JOIN user_topics ut ON LOWER(ut.concept) = LOWER(t.concept) AND ut.user_id = (SELECT uid FROM viewer)
            WHERE pt.post_id = p.id
          )
        ) as engagement_score
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE p.reply_to_id IS NULL AND (p.is_silenced IS NULL OR p.is_silenced = 0)
        AND NOT EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN trending_topics t ON pt.topic_id = t.id
          JOIN user_topics ut ON LOWER(ut.concept) = LOWER(t.concept)
          WHERE pt.post_id = p.id AND ut.user_id = (SELECT uid FROM viewer) AND ut.is_active = 0
        )
        ${artFilter.sql}
        ${tagFilter.sql}
        ${searchFilter.sql}
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY (
        engagement_score / (
          (MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 as REAL)) + 2.0) *
          (1.0 + 0.12 * MAX(0.0, CAST((julianday('now') - julianday(p.created_at)) * 24.0 as REAL)))
        )
      ) DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];

    const hydrated = this.hydratePostsBatch(posts, currentUserId);
    return this.facade.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  getFederatedTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "public");
    const allParams = [
      uid,
      uid,
      uid,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
      WHERE (u.account_type = 'remote' OR p.ap_id IS NOT NULL OR u.username LIKE '%@%')
        AND p.reply_to_id IS NULL AND (p.is_silenced IS NULL OR p.is_silenced = 0)
        ${artFilter.sql}
        ${tagFilter.sql}
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];

    const hydrated = this.hydratePostsBatch(posts, currentUserId);
    return this.facade.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  getUserTimeline(username: string, currentUserId?: number, limit: number = 20, type?: string): PostRow[] {
    let typeFilter = "";
    if (type === "replies" || type === "reply") {
      typeFilter = "AND p.reply_to_id IS NOT NULL";
    } else if (type === "reposts" || type === "repost") {
      typeFilter = "AND p.repost_of_id IS NOT NULL";
    } else if (type === "artifacts" || type === "artifact") {
      typeFilter = "AND p.artifact_view_id IS NOT NULL";
    } else if (type === "articles" || type === "article") {
      typeFilter = `AND p.reply_to_id IS NULL AND p.repost_of_id IS NULL
        AND CASE WHEN json_valid(p.metadata) THEN json_extract(p.metadata, '$.notebook.isNotebook') END = 1`;
    } else if (type === "posts" || type === "post") {
      typeFilter = "AND p.reply_to_id IS NULL";
    }

    const uid = currentUserId || -1;
    const visFilter = this.buildVisibilityFilter(currentUserId, "profile");
    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE u.username = ? ${typeFilter}
        ${visFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, username, ...visFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = this.hydratePostsBatch(posts, currentUserId).filter(
      (p) => !p.repost_of_id || Boolean(p.repost_post),
    );
    return this.facade.applyContentFiltersToPosts(hydrated, "account", currentUserId);
  }

  blockUser(blockerId: number, blockedId: number): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`)
      .run(blockerId, blockedId);
    this.facade.unfollowUser(blockerId, blockedId);
    this.facade.unfollowUser(blockedId, blockerId);
  }

  unblockUser(blockerId: number, blockedId: number): void {
    this.db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`).run(blockerId, blockedId);
  }

  isUserBlocked(blockerId: number, blockedId: number): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`)
      .get(blockerId, blockedId);
    return Boolean(row);
  }

  muteUser(muterId: number, mutedId: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO user_mutes (muter_id, muted_id) VALUES (?, ?)`).run(muterId, mutedId);
  }

  unmuteUser(muterId: number, mutedId: number): void {
    this.db.prepare(`DELETE FROM user_mutes WHERE muter_id = ? AND muted_id = ?`).run(muterId, mutedId);
  }

  isUserMuted(muterId: number, mutedId: number): boolean {
    const row = this.db.prepare(`SELECT 1 FROM user_mutes WHERE muter_id = ? AND muted_id = ?`).get(muterId, mutedId);
    return Boolean(row);
  }

  toggleLike(userId: number, postId: number | string): boolean {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`).get(userId, postId);
      if (existing) {
        this.db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
        this.db
          .prepare(`DELETE FROM notifications WHERE actor_id = ? AND post_id = ? AND type = 'like'`)
          .run(userId, postId);
        const post = this.db.prepare(`SELECT visibility, is_silenced FROM posts WHERE id = ?`).get(postId) as
          { visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && (post.visibility ?? "public") === "public" && !post.is_silenced) {
          this.facade.boostPostTopics(postId, -0.25);
        }
        return false; // unliked
      } else {
        this.db.prepare(`INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
        try {
          this.facade.deriveUserTopics(userId, true);
        } catch {
          // Optional JSON parse or best-effort async side-effect ignored
        }
        const post = this.db
          .prepare(`SELECT author_id, visibility, is_silenced FROM posts WHERE id = ?`)
          .get(postId) as { author_id: number; visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && post.author_id !== userId) {
          this.createNotification(post.author_id, userId, "like", postId);
          if ((post.visibility ?? "public") === "public" && !post.is_silenced) {
            this.facade.boostPostTopics(postId, 0.25);
          }
        }
        return true; // liked
      }
    })();
  }

  likePost(userId: number, postId: number | string): boolean {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`).get(userId, postId);
      if (!existing) {
        this.db.prepare(`INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
        try {
          this.facade.deriveUserTopics(userId, true);
        } catch {
          // Optional JSON parse or best-effort async side-effect ignored
        }
        const post = this.db
          .prepare(`SELECT author_id, visibility, is_silenced FROM posts WHERE id = ?`)
          .get(postId) as { author_id: number; visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && post.author_id !== userId) {
          this.createNotification(post.author_id, userId, "like", postId);
          if ((post.visibility ?? "public") === "public" && !post.is_silenced) {
            this.facade.boostPostTopics(postId, 0.25);
          }
        }
        return true;
      }
      return false;
    })();
  }

  unlikePost(userId: number, postId: number | string): boolean {
    return this.db.transaction(() => {
      const res = this.db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
      if (res.changes > 0) {
        this.db
          .prepare(`DELETE FROM notifications WHERE actor_id = ? AND post_id = ? AND type = 'like'`)
          .run(userId, postId);
        const post = this.db.prepare(`SELECT visibility, is_silenced FROM posts WHERE id = ?`).get(postId) as
          { visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && (post.visibility ?? "public") === "public" && !post.is_silenced) {
          this.facade.boostPostTopics(postId, -0.25);
        }
        return true;
      }
      return false;
    })();
  }

  toggleBookmark(userId: number, postId: number | string): boolean {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?`).get(userId, postId);
      if (existing) {
        this.db.prepare(`DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?`).run(userId, postId);
        const post = this.db.prepare(`SELECT visibility, is_silenced FROM posts WHERE id = ?`).get(postId) as
          { visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && (post.visibility ?? "public") === "public" && !post.is_silenced) {
          this.facade.boostPostTopics(postId, -0.35);
        }
        return false;
      } else {
        this.db.prepare(`INSERT OR IGNORE INTO bookmarks (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
        try {
          this.facade.deriveUserTopics(userId, true);
        } catch {
          // Optional JSON parse or best-effort async side-effect ignored
        }
        const post = this.db
          .prepare(`SELECT author_id, visibility, is_silenced FROM posts WHERE id = ?`)
          .get(postId) as { author_id: number; visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && post.author_id !== userId && (post.visibility ?? "public") === "public" && !post.is_silenced) {
          this.facade.boostPostTopics(postId, 0.35);
        }
        return true;
      }
    })();
  }

  toggleRepost(userId: number, postId: number | string): boolean {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT CAST(id AS TEXT) as id FROM posts WHERE author_id = ? AND repost_of_id = ?`)
        .get(userId, postId) as { id: string } | undefined;
      if (existing) {
        this.db.prepare(`DELETE FROM posts WHERE id = ?`).run(existing.id);
        this.db
          .prepare(`DELETE FROM notifications WHERE actor_id = ? AND post_id = ? AND type = 'repost'`)
          .run(userId, postId);
        const post = this.db.prepare(`SELECT visibility, is_silenced FROM posts WHERE id = ?`).get(postId) as
          { visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && (post.visibility ?? "public") === "public" && !post.is_silenced) {
          this.facade.boostPostTopics(postId, -0.5);
        }
        return false; // un-reposted
      } else {
        this.createPost(userId, null, undefined, undefined, undefined, postId);
        try {
          this.facade.deriveUserTopics(userId, true);
        } catch {
          // Optional JSON parse or best-effort async side-effect ignored
        }
        const post = this.db
          .prepare(`SELECT author_id, visibility, is_silenced FROM posts WHERE id = ?`)
          .get(postId) as { author_id: number; visibility?: string | null; is_silenced?: number | null } | undefined;
        if (post && post.author_id !== userId) {
          this.createNotification(post.author_id, userId, "repost", postId);
          if ((post.visibility ?? "public") === "public" && !post.is_silenced) {
            this.facade.boostPostTopics(postId, 0.5);
          }
        }
        return true; // reposted
      }
    })();
  }

  getBookmarks(userId: number, limit: number = 20): PostRow[] {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const posts = this.db
      .prepare(
        `
      SELECT p.*,
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
        1 as bookmarked
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.author_id = u.id
      WHERE b.user_id = ?
        AND (
          COALESCE(p.visibility, 'public') IN ('public', 'unlisted')
          OR p.author_id = ?
          OR (COALESCE(p.visibility, 'public') = 'followers' AND p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
          OR (COALESCE(p.visibility, 'public') = 'direct' AND EXISTS (
            SELECT 1 FROM users uv WHERE uv.id = ? AND (
              ' ' || LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.content, ''), char(10), ' '), char(13), ' '), char(9), ' '), ',', ' ')) || ' '
              LIKE '% @' || LOWER(uv.username) || ' %'
            )
          ))
        )
        AND p.author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        AND p.author_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
      ORDER BY b.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, userId, userId, userId, userId, userId, safeLimit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return this.hydratePostsBatch(posts, userId);
  }

  createNotification(
    userId: number,
    actorId: number,
    type: string,
    postId?: number | string | null,
    metadata?: Record<string, unknown> | string | null,
  ): void {
    const isSystemNotification = [
      "simulation",
      "simulation_completed",
      "simulation_failed",
      "package",
      "package_published",
      "package_yanked",
      "security_alert",
      "credit_warning",
    ].includes(type);
    if (userId === actorId && !isSystemNotification) return;

    if (!isSystemNotification) {
      try {
        if (
          this.isUserBlocked(userId, actorId) ||
          this.isUserBlocked(actorId, userId) ||
          this.isUserMuted(userId, actorId)
        ) {
          return;
        }
      } catch {
        // Optional JSON parse or best-effort async side-effect ignored
      }
    }

    let parsedSettings: Record<string, unknown> | null = null;
    try {
      const rawSettings = this.facade.getNotificationSettings(userId);
      if (rawSettings) {
        const parsed: unknown = JSON.parse(rawSettings);
        if (parsed && typeof parsed === "object") {
          parsedSettings = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // Optional JSON parse or best-effort async side-effect ignored
    }

    // security_alert notifications are non-mutable and always delivered
    if (type !== "security_alert" && parsedSettings) {
      if (parsedSettings[type] === false || parsedSettings[`${type}s`] === false) {
        return;
      }
      type NotificationEventsConfig = {
        social?: {
          mentions?: boolean;
          replies?: boolean;
          follows?: boolean;
          reposts?: boolean;
        };
        engineering?: {
          packageUpdates?: boolean;
          starredRepoCommits?: boolean;
          federatedMentions?: boolean;
        };
        computeHpc?: {
          jobCompleted?: boolean;
          jobFailed?: boolean;
          quotaThresholdAlert?: boolean;
        };
      };
      const ev = parsedSettings["events"] as NotificationEventsConfig | undefined;
      if (ev && typeof ev === "object") {
        if (type === "mention" && ev.social?.mentions === false) return;
        if (type === "reply" && ev.social?.replies === false) return;
        if (type === "follow" && ev.social?.follows === false) return;
        if ((type === "repost" || type === "like") && ev.social?.reposts === false) return;
        if (
          (type === "package" || type === "package_published" || type === "package_yanked") &&
          ev.engineering?.packageUpdates === false
        ) {
          return;
        }
        if (
          (type === "commit" || type === "repo_commit" || type === "star") &&
          ev.engineering?.starredRepoCommits === false
        ) {
          return;
        }
        if (type === "mention" && ev.engineering?.federatedMentions === false && actorId !== userId) {
          const actorFed = this.facade.getUserFederationInfo(actorId);
          if (actorFed?.remote_domain) return;
        }
        if ((type === "simulation" || type === "simulation_completed") && ev.computeHpc?.jobCompleted === false) {
          return;
        }
        if (type === "simulation_failed" && ev.computeHpc?.jobFailed === false) return;
        if (type === "credit_warning" && ev.computeHpc?.quotaThresholdAlert === false) return;
      }
      if (parsedSettings["qualityFilter"] === true && actorId !== userId && type !== "security_alert") {
        const actorRow = this.db.prepare(`SELECT status, account_type FROM users WHERE id = ?`).get(actorId) as
          { status?: string | null; account_type?: string | null } | undefined;
        if (actorRow?.status === "suspended" || actorRow?.status === "frozen") return;
      }
    }

    let metadataObj: Record<string, unknown> | null = null;
    let metadataStr: string | null = null;
    if (metadata) {
      if (typeof metadata === "string") {
        metadataStr = metadata;
        try {
          metadataObj = JSON.parse(metadata) as Record<string, unknown>;
        } catch {
          // Optional JSON parse or best-effort async side-effect ignored
        }
      } else {
        metadataObj = metadata;
        metadataStr = JSON.stringify(metadata);
      }
    }

    const channels = parsedSettings?.["channels"] as
      { email?: boolean; browserPush?: boolean; inApp?: boolean } | undefined;
    const deliveryChannels = parsedSettings?.["deliveryChannels"] as
      { inApp?: boolean; emailNotifications?: boolean } | undefined;
    const inAppEnabled = type === "security_alert" || (channels?.inApp !== false && deliveryChannels?.inApp !== false);
    if (inAppEnabled) {
      const isIdempotentSocial = ["like", "repost", "follow", "follow_request"].includes(type);
      const existingNotif = isIdempotentSocial
        ? (this.db
            .prepare(
              `SELECT id FROM notifications
               WHERE user_id = ? AND actor_id = ? AND type = ? AND (post_id = ? OR (post_id IS NULL AND ? IS NULL))
               LIMIT 1`,
            )
            .get(userId, actorId, type, postId ?? null, postId ?? null) as { id: number } | undefined)
        : undefined;

      if (existingNotif) {
        this.db
          .prepare(`UPDATE notifications SET read = 0, created_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(existingNotif.id);
      } else {
        try {
          this.db
            .prepare(
              `
            INSERT INTO notifications (user_id, actor_id, type, post_id, metadata)
            VALUES (?, ?, ?, ?, ?)
          `,
            )
            .run(userId, actorId, type, postId ?? null, metadataStr);
        } catch {
          this.db
            .prepare(
              `
            INSERT INTO notifications (user_id, actor_id, type, post_id)
            VALUES (?, ?, ?, ?)
          `,
            )
            .run(userId, actorId, type, postId ?? null);
        }
      }
    }

    // Dispatch instant email notification when opted in (or for security_alert unless skipEmail is set)
    try {
      const emailChannelEnabled =
        channels?.email !== undefined ? channels.email === true : deliveryChannels?.emailNotifications === true;
      const emailNotificationsOptIn =
        emailChannelEnabled && (parsedSettings?.["emailDigestFrequency"] ?? "instant") === "instant";
      const shouldEmail =
        (type === "security_alert" && metadataObj?.["skipEmail"] !== true && emailNotificationsOptIn) ||
        (type !== "security_alert" && emailNotificationsOptIn);
      if (shouldEmail) {
        const recipient = this.facade.getUserById(userId);
        if (recipient?.email && (recipient.email_verified === 1 || type === "security_alert")) {
          const rawInstanceName = this.facade.getInstanceSettings().instanceName?.trim();
          const instanceName = rawInstanceName || "Ansatz";
          const richCopy = this.formatSocialNotificationCopy(type, actorId, postId ?? null, metadataObj, instanceName);
          void defaultMailer
            .sendNotificationEmail(recipient.email, {
              username: recipient.username,
              type,
              title: richCopy.title,
              body: richCopy.body,
              link: richCopy.link,
              instanceName,
              actorHandle: richCopy.actorHandle,
              actorDisplayName: richCopy.actorDisplayName,
              postSnippet: richCopy.postSnippet,
              ctaLabel: richCopy.ctaLabel,
            })
            .catch(() => {});
        }
      }
    } catch {
      // Optional JSON parse or best-effort async side-effect ignored
    }

    // Dispatch instant Web Push notification when opted in and push subscriptions exist
    try {
      const browserPushEnabled = channels?.browserPush !== false;
      if (browserPushEnabled) {
        const rawInstanceName = this.facade.getInstanceSettings().instanceName?.trim();
        const instanceName = rawInstanceName || "Ansatz";
        const richCopy = this.formatSocialNotificationCopy(type, actorId, postId ?? null, metadataObj, instanceName);
        void this.facade.webPushService
          .dispatchUserPush(userId, {
            title: richCopy.title,
            body: richCopy.body,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            data: { url: richCopy.link },
          })
          .catch(() => {});
      }
    } catch {
      // Optional JSON parse or best-effort async side-effect ignored
    }
  }

  private formatSocialNotificationCopy(
    type: string,
    actorId: number,
    postId: number | string | null,
    metadataObj: Record<string, unknown> | null,
    instanceName: string,
  ): {
    title: string;
    body: string;
    link: string;
    actorHandle?: string | undefined;
    actorDisplayName?: string | undefined;
    postSnippet?: string | undefined;
    ctaLabel?: string | undefined;
  } {
    const actor = actorId > 0 ? this.facade.getUserById(actorId) : undefined;
    const actorHandle = actor?.username ? `@${actor.username}` : "Someone";
    const actorDisplayName = actor?.display_name?.trim() || actorHandle;
    const actorLabel =
      actor?.display_name?.trim() && actor.display_name.trim() !== actor.username
        ? `${actorHandle} (${actor.display_name.trim()})`
        : actorHandle;

    let postSnippet: string | undefined;
    if (postId) {
      try {
        const postRow = this.db.prepare(`SELECT content FROM posts WHERE id = ?`).get(postId) as
          { content: string | null } | undefined;
        if (postRow?.content) {
          const cleaned = postRow.content
            .replace(/::artifact(?:\[[^\]]*\])?\{[^}]*\}/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (cleaned) {
            postSnippet = cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
          }
        }
      } catch {
        // Optional JSON parse or best-effort async side-effect ignored
      }
    } else if (type === "follow" && actor?.bio) {
      const cleanedBio = actor.bio.replace(/\s+/g, " ").trim();
      if (cleanedBio) {
        postSnippet = cleanedBio.length > 160 ? `${cleanedBio.slice(0, 157)}...` : cleanedBio;
      }
    }

    const explicitTitle =
      (typeof metadataObj?.["title"] === "string" && metadataObj["title"].trim()) ||
      (typeof metadataObj?.["message"] === "string" && metadataObj["message"].trim()) ||
      "";
    const explicitDesc =
      typeof metadataObj?.["description"] === "string" && metadataObj["description"].trim()
        ? metadataObj["description"].trim()
        : "";
    const explicitLink =
      typeof metadataObj?.["link"] === "string" && metadataObj["link"].trim() ? metadataObj["link"].trim() : "";

    let defaultTitle = `New ${type.replace(/_/g, " ")} notification`;
    let defaultBody = `You have a new ${type.replace(/_/g, " ")} notification on ${instanceName}.`;
    let defaultLink = postId ? `/post/${postId}` : "/notifications";
    let ctaLabel = `View in ${instanceName}`;

    if (type === "follow") {
      defaultTitle = `${actorHandle} started following you on ${instanceName}`;
      defaultBody = `${actorLabel} is now following your engineering updates and publications on ${instanceName}.`;
      defaultLink = actor?.username ? `/u/${actor.username}` : "/notifications";
      ctaLabel = actor?.username ? `View ${actorHandle}'s Profile` : `View Profile`;
    } else if (type === "like") {
      defaultTitle = `${actorHandle} liked your post`;
      defaultBody = `${actorLabel} liked your post on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "repost") {
      defaultTitle = `${actorHandle} reposted your post`;
      defaultBody = `${actorLabel} shared your post with their followers on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "reply") {
      defaultTitle = `${actorHandle} replied to your post`;
      defaultBody = `${actorLabel} replied to your discussion thread on ${instanceName}.`;
      ctaLabel = "View Conversation";
    } else if (type === "mention") {
      defaultTitle = `${actorHandle} mentioned you in a post`;
      defaultBody = `${actorLabel} mentioned you in a post on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "package" || type === "package_published") {
      const pkgName = typeof metadataObj?.["packageName"] === "string" ? metadataObj["packageName"] : "";
      defaultTitle = pkgName
        ? `Package ${pkgName} published on ${instanceName}`
        : `New package release on ${instanceName}`;
      defaultBody = pkgName
        ? `A new release of '${pkgName}' is now available in the ${instanceName} registry.`
        : `A package you follow has published a new release on ${instanceName}.`;
      ctaLabel = "View Package";
    } else if (type === "simulation" || type === "simulation_completed") {
      defaultTitle = `Simulation job completed on ${instanceName}`;
      defaultBody = `Your simulation run finished executing and results are ready for inspection.`;
      ctaLabel = "View Simulation Results";
    } else if (type === "simulation_failed") {
      defaultTitle = `Simulation job failed on ${instanceName}`;
      defaultBody = `Your simulation run encountered an error during solver execution.`;
      ctaLabel = "Inspect Solver Diagnostics";
    } else if (type === "credit_warning") {
      defaultTitle = `Compute credit balance alert on ${instanceName}`;
      defaultBody = `Your compute credit balance has crossed your configured alert threshold.`;
      defaultLink = "/settings";
      ctaLabel = "Manage Compute Credits";
    }

    return {
      title: explicitTitle || defaultTitle,
      body: explicitDesc || defaultBody,
      link: explicitLink || defaultLink,
      actorHandle,
      actorDisplayName,
      postSnippet,
      ctaLabel,
    };
  }

  public async dispatchEmailDigests(frequencyFilter?: "daily" | "weekly"): Promise<{
    dispatchedUsers: number;
    totalItemsCompiled: number;
    results: { userId: number; username: string; email: string; frequency: "daily" | "weekly"; itemCount: number }[];
  }> {
    const rawInstanceName = this.facade.getInstanceSettings().instanceName?.trim() || "Ansatz";
    const rows = this.db
      .prepare(
        `SELECT id, username, email, email_verified, notification_settings
         FROM users
         WHERE email IS NOT NULL AND email != '' AND email_verified = 1 AND status = 'active'`,
      )
      .all() as {
      id: number;
      username: string;
      email: string;
      email_verified: number;
      notification_settings: string | null;
    }[];

    const results: {
      userId: number;
      username: string;
      email: string;
      frequency: "daily" | "weekly";
      itemCount: number;
    }[] = [];
    let totalItemsCompiled = 0;

    for (const row of rows) {
      if (!row.notification_settings) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.notification_settings) as Record<string, unknown>;
      } catch {
        continue;
      }
      const channels = parsed?.["channels"] as { email?: boolean } | undefined;
      const deliveryChannels = parsed?.["deliveryChannels"] as { emailNotifications?: boolean } | undefined;
      const emailEnabled =
        channels?.email !== undefined ? channels.email === true : deliveryChannels?.emailNotifications === true;
      if (!emailEnabled) continue;
      const freq = parsed?.["emailDigestFrequency"];
      if (freq !== "daily" && freq !== "weekly") continue;
      if (frequencyFilter && freq !== frequencyFilter) continue;

      const unreadRows = this.db
        .prepare(
          `SELECT id, actor_id, type, post_id, metadata, created_at
           FROM notifications
           WHERE user_id = ? AND read = 0
           ORDER BY created_at DESC
           LIMIT 15`,
        )
        .all(row.id) as {
        id: number;
        actor_id: number;
        type: string;
        post_id: number | null;
        metadata: string | null;
        created_at: string;
      }[];

      if (unreadRows.length === 0) continue;

      const items: DigestNotificationItem[] = unreadRows.map((n) => {
        let metaObj: Record<string, unknown> | null = null;
        if (n.metadata) {
          try {
            metaObj = JSON.parse(n.metadata) as Record<string, unknown>;
          } catch {
            // Optional JSON parse or best-effort async side-effect ignored
          }
        }
        const rich = this.formatSocialNotificationCopy(n.type, n.actor_id, n.post_id, metaObj, rawInstanceName);
        return {
          type: n.type,
          title: rich.title,
          snippet: rich.postSnippet,
          link: rich.link,
          createdAt: n.created_at,
        };
      });

      const sendRes = await defaultMailer.sendDigestEmail(row.email, {
        username: row.username,
        frequency: freq,
        items,
        instanceName: rawInstanceName,
      });

      if (sendRes.success) {
        totalItemsCompiled += items.length;
        results.push({
          userId: row.id,
          username: row.username,
          email: row.email,
          frequency: freq,
          itemCount: items.length,
        });
      }
    }

    return {
      dispatchedUsers: results.length,
      totalItemsCompiled,
      results,
    };
  }

  getNotifications(userId: number, limit: number = 20, category?: string): NotificationRow[] {
    let typeClause = "";
    if (category === "engineering") {
      typeClause =
        "AND n.type IN ('simulation', 'simulation_completed', 'simulation_failed', 'cae_completed', 'cae_failed')";
    } else if (category === "packages") {
      typeClause = "AND n.type IN ('package', 'package_published', 'package_yanked')";
    } else if (category === "social" || category === "mentions") {
      typeClause =
        "AND n.type IN ('mention', 'reply', 'quote', 'like', 'repost', 'follow', 'follow_request', 'follow_accepted')";
    } else if (category === "system") {
      typeClause = "AND n.type IN ('security_alert', 'credit_warning')";
    }

    const rows = this.db
      .prepare(
        `
      SELECT n.*, 
             COALESCE(n.archived, 0) as archived,
             COALESCE(n.starred, 0) as starred,
             CAST(n.post_id AS TEXT) as post_id,
             u.username as actor_username, 
             u.display_name as actor_display_name, 
             u.avatar_url as actor_avatar_url,
             p.content as post_content,
             pu.username as post_author,
             a.view_config as post_artifact_config,
             a.view_type as post_artifact_type
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN users pu ON p.author_id = pu.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE n.user_id = ? ${typeClause}
        AND n.actor_id NOT IN (SELECT muted_id FROM user_mutes WHERE muter_id = ?)
        AND n.actor_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        AND n.actor_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
      ORDER BY n.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, userId, limit) as NotificationRow[];

    return rows.map((r) => {
      if (r.metadata && typeof r.metadata === "string") {
        try {
          r.metadata = JSON.parse(r.metadata) as Record<string, unknown>;
        } catch {
          // Keep as string
        }
      }
      if (r.created_at) {
        r.created_at = normalizeUtcTimestamp(r.created_at);
      }
      return r;
    });
  }

  markNotificationsRead(userId: number, category?: string, ids?: number[]): void {
    if (ids && ids.length > 0) {
      const validIds = ids.filter((id) => Number.isFinite(id));
      if (validIds.length > 0) {
        const placeholders = validIds.map(() => "?").join(", ");
        this.db
          .prepare(
            `UPDATE notifications
             SET read = 1
             WHERE user_id = ? AND read = 0 AND (
               id IN (${placeholders})
               OR EXISTS (
                 SELECT 1 FROM notifications target
                 WHERE target.id IN (${placeholders})
                   AND target.user_id = notifications.user_id
                   AND target.post_id IS NOT NULL
                   AND target.type IN ('like', 'repost')
                   AND target.type = notifications.type
                   AND target.post_id = notifications.post_id
               )
             )`,
          )
          .run(userId, ...validIds, ...validIds);
        return;
      }
    }
    let typeClause = "";
    if (category === "engineering") {
      typeClause =
        "AND type IN ('simulation', 'simulation_completed', 'simulation_failed', 'cae_completed', 'cae_failed')";
    } else if (category === "packages") {
      typeClause = "AND type IN ('package', 'package_published', 'package_yanked')";
    } else if (category === "social" || category === "mentions") {
      typeClause =
        "AND type IN ('mention', 'reply', 'quote', 'like', 'repost', 'follow', 'follow_request', 'follow_accepted')";
    } else if (category === "system") {
      typeClause = "AND type IN ('security_alert', 'credit_warning')";
    }
    this.db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0 ${typeClause}`).run(userId);
  }

  triageNotifications(
    userId: number,
    options: {
      ids?: number[] | undefined;
      category?: string | undefined;
      archived?: boolean | undefined;
      starred?: boolean | undefined;
      read?: boolean | undefined;
    },
  ): void {
    const setClauses: string[] = [];
    const setValues: number[] = [];

    if (typeof options.archived === "boolean") {
      setClauses.push("archived = ?");
      setValues.push(options.archived ? 1 : 0);
      if (options.archived && typeof options.read !== "boolean") {
        setClauses.push("read = ?");
        setValues.push(1);
      }
    }
    if (typeof options.starred === "boolean") {
      setClauses.push("starred = ?");
      setValues.push(options.starred ? 1 : 0);
    }
    if (typeof options.read === "boolean") {
      setClauses.push("read = ?");
      setValues.push(options.read ? 1 : 0);
    }

    if (setClauses.length === 0) return;

    const validIds = (options.ids || []).filter((id) => Number.isFinite(id));
    if (validIds.length > 0) {
      const placeholders = validIds.map(() => "?").join(", ");
      this.db
        .prepare(
          `UPDATE notifications
           SET ${setClauses.join(", ")}
           WHERE user_id = ? AND (
             id IN (${placeholders})
             OR EXISTS (
               SELECT 1 FROM notifications target
               WHERE target.id IN (${placeholders})
                 AND target.user_id = notifications.user_id
                 AND target.post_id IS NOT NULL
                 AND target.type IN ('like', 'repost')
                 AND target.type = notifications.type
                 AND target.post_id = notifications.post_id
             )
           )`,
        )
        .run(...setValues, userId, ...validIds, ...validIds);
      return;
    }

    let typeClause = "";
    if (options.category === "engineering") {
      typeClause =
        "AND type IN ('simulation', 'simulation_completed', 'simulation_failed', 'cae_completed', 'cae_failed')";
    } else if (options.category === "packages") {
      typeClause = "AND type IN ('package', 'package_published', 'package_yanked')";
    } else if (options.category === "social" || options.category === "mentions") {
      typeClause =
        "AND type IN ('mention', 'reply', 'quote', 'like', 'repost', 'follow', 'follow_request', 'follow_accepted')";
    } else if (options.category === "system") {
      typeClause = "AND type IN ('security_alert', 'credit_warning')";
    }
    this.db
      .prepare(`UPDATE notifications SET ${setClauses.join(", ")} WHERE user_id = ? ${typeClause}`)
      .run(...setValues, userId);
  }

  getUnreadNotificationCount(userId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT CASE
          WHEN post_id IS NOT NULL AND type IN ('like', 'repost')
          THEN type || '-' || CAST(post_id AS TEXT)
          ELSE 'id-' || CAST(id AS TEXT)
        END) as count
        FROM notifications
        WHERE user_id = ? AND read = 0 AND COALESCE(archived, 0) = 0`,
      )
      .get(userId) as { count: number };
    return row.count;
  }
}
