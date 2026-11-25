// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PostMetadata, PostRow } from "../types.js";
import { BaseRepository } from "./base.js";

export class ActivityPubPostRepository extends BaseRepository {
  // ── Follow State & ActivityPub Actor Collections ────────────────

  getFollowState(followerId: number, followingId: number): "pending" | "accepted" | "rejected" | null {
    const row = this.db
      .prepare(`SELECT state FROM follows WHERE follower_id = ? AND following_id = ?`)
      .get(followerId, followingId) as { state: "pending" | "accepted" | "rejected" } | undefined;
    return row ? row.state : null;
  }

  updateFollowState(followerId: number, followingId: number, state: "pending" | "accepted" | "rejected"): void {
    this.db
      .prepare(`UPDATE follows SET state = ? WHERE follower_id = ? AND following_id = ?`)
      .run(state, followerId, followingId);
  }

  getUserOutboxCount(userId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM posts
         WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0
           AND COALESCE(visibility, 'public') IN ('public', 'unlisted')`,
      )
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getUserOutboxPosts(userId: number, limit: number = 20, offset: number = 0): PostRow[] {
    const posts = this.db
      .prepare(
        `SELECT CAST(id AS TEXT) as id, author_id, content, CAST(artifact_view_id AS TEXT) as artifact_view_id, ap_id, url, metadata, visibility, created_at, updated_at
         FROM posts 
         WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0
           AND COALESCE(visibility, 'public') IN ('public', 'unlisted')
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return this.facade.hydratePostsBatch(posts);
  }

  getUserFollowerActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    const rows = this.db
      .prepare(
        `SELECT u.actor_url, u.username
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
         ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as { actor_url?: string | undefined; username: string }[];
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    return rows.map((r) => r.actor_url || `${publicUrl}/users/${r.username}`);
  }

  getUserFollowerActorsCount(userId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM follows WHERE following_id = ? AND (state = 'accepted' OR state IS NULL)`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getUserFollowingActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    const rows = this.db
      .prepare(
        `SELECT u.actor_url, u.username
         FROM follows f
         JOIN users u ON f.following_id = u.id
         WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
         ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as { actor_url?: string | undefined; username: string }[];
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    return rows.map((r) => r.actor_url || `${publicUrl}/users/${r.username}`);
  }

  getUserFollowingActorsCount(userId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM follows WHERE follower_id = ? AND (state = 'accepted' OR state IS NULL)`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  // ── ActivityPub Post Resolution & Post Lifecycle ────────────────

  getPostByApId(apId: string): PostRow | undefined {
    const direct = this.db
      .prepare(
        `SELECT p.*,
          CAST(p.id AS TEXT) as id,
          CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
          CAST(p.reply_to_id AS TEXT) as reply_to_id,
          CAST(p.quote_post_id AS TEXT) as quote_post_id,
          CAST(p.repost_of_id AS TEXT) as repost_of_id
         FROM posts p WHERE p.ap_id = ?`,
      )
      .get(apId) as PostRow | undefined;
    if (direct) return direct;
    const localMatch =
      apId.match(/\/users\/[^/]+\/posts\/([a-zA-Z0-9_-]+)\/?$/) || apId.match(/\/posts\/([a-zA-Z0-9_-]+)\/?$/);
    if (localMatch && localMatch[1]) {
      const localId = localMatch[1];
      const localPost = this.db
        .prepare(
          `SELECT p.*,
            CAST(p.id AS TEXT) as id,
            CAST(p.artifact_view_id AS TEXT) as artifact_view_id,
            CAST(p.reply_to_id AS TEXT) as reply_to_id,
            CAST(p.quote_post_id AS TEXT) as quote_post_id,
            CAST(p.repost_of_id AS TEXT) as repost_of_id
           FROM posts p WHERE p.id = ?`,
        )
        .get(localId) as PostRow | undefined;
      if (localPost) return localPost;
    }
    return undefined;
  }

  deletePostByApId(apId: string, expectedAuthorId?: number): boolean {
    let post = this.db.prepare(`SELECT CAST(id AS TEXT) as id, author_id FROM posts WHERE ap_id = ?`).get(apId) as
      { id: string | number; author_id: number } | undefined;
    if (!post) {
      const localMatch =
        apId.match(/\/users\/[^/]+\/posts\/([a-zA-Z0-9_-]+)\/?$/) || apId.match(/\/posts\/([a-zA-Z0-9_-]+)\/?$/);
      if (localMatch && localMatch[1]) {
        post = this.db
          .prepare(`SELECT CAST(id AS TEXT) as id, author_id FROM posts WHERE id = ?`)
          .get(localMatch[1]) as { id: string | number; author_id: number } | undefined;
      }
    }
    if (!post) return false;
    if (expectedAuthorId !== undefined && post.author_id !== expectedAuthorId) {
      return false;
    }
    return this.deletePost(post.id).success;
  }

  updatePostContentByApId(apId: string, content: string, expectedAuthorId?: number): boolean {
    if (expectedAuthorId !== undefined) {
      const res = this.db
        .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE ap_id = ? AND author_id = ?`)
        .run(content, apId, expectedAuthorId);
      if (res.changes > 0) return true;
    } else {
      const res = this.db
        .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE ap_id = ?`)
        .run(content, apId);
      if (res.changes > 0) return true;
    }
    const localMatch =
      apId.match(/\/users\/[^/]+\/posts\/([a-zA-Z0-9_-]+)\/?$/) || apId.match(/\/posts\/([a-zA-Z0-9_-]+)\/?$/);
    if (localMatch && localMatch[1]) {
      if (expectedAuthorId !== undefined) {
        const res = this.db
          .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ? AND author_id = ?`)
          .run(content, localMatch[1], expectedAuthorId);
        return res.changes > 0;
      }
      const res = this.db
        .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(content, localMatch[1]);
      return res.changes > 0;
    }
    return false;
  }

  silencePost(postId: number | string, silenced: boolean = true): boolean {
    const res = this.db
      .prepare(`UPDATE posts SET is_silenced = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(silenced ? 1 : 0, postId);
    return res.changes > 0;
  }

  markPostSensitive(postId: number | string, isSensitive: boolean = true, contentWarning?: string | null): boolean {
    const cw = isSensitive ? contentWarning?.trim() || "Sensitive content flagged by moderation" : null;
    const res = this.db
      .prepare(
        `UPDATE posts
         SET is_sensitive = ?,
             content_warning = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(isSensitive ? 1 : 0, cw, postId);
    return res.changes > 0;
  }

  deletePost(postId: number | string): { success: boolean; apId?: string | undefined; authorId?: number | undefined } {
    return this.db.transaction(() => {
      const post = this.db
        .prepare(
          `SELECT CAST(p.id AS TEXT) as id, p.author_id, p.ap_id, p.content, p.created_at, u.username, u.remote_domain
           FROM posts p
           LEFT JOIN users u ON p.author_id = u.id
           WHERE p.id = ?`,
        )
        .get(postId) as
        | {
            id: string | number;
            author_id: number;
            ap_id: string | null;
            content: string | null;
            created_at: string;
            username: string | null;
            remote_domain: string | null;
          }
        | undefined;
      if (!post) {
        return { success: false };
      }
      const fallbackSnapshot = JSON.stringify({
        targetType: "post",
        postId: post.id,
        postContent: post.content,
        authorId: post.author_id,
        authorUsername: post.username,
        authorDomain: post.remote_domain,
        apId: post.ap_id,
        postCreatedAt: post.created_at,
        deletedAt: new Date().toISOString(),
      });
      this.db
        .prepare(
          `UPDATE content_reports
           SET post_id = NULL,
               target_user_id = COALESCE(target_user_id, ?),
               content_snapshot = COALESCE(content_snapshot, ?)
           WHERE post_id = ?`,
        )
        .run(post.author_id, fallbackSnapshot, postId);
      const affectedTopics = this.db.prepare(`SELECT topic_id FROM post_topics WHERE post_id = ?`).all(postId) as {
        topic_id: number;
      }[];
      this.db.prepare(`DELETE FROM notifications WHERE post_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM likes WHERE post_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM bookmarks WHERE post_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM post_topics WHERE post_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM post_location_stats WHERE post_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM signed_post_evidence WHERE post_id = ?`).run(postId);
      // Clean up child relationships to prevent orphans
      this.db.prepare(`DELETE FROM posts WHERE repost_of_id = ?`).run(postId);
      this.db.prepare(`UPDATE posts SET quote_post_id = NULL WHERE quote_post_id = ?`).run(postId);
      this.db.prepare(`UPDATE posts SET reply_to_id = NULL WHERE reply_to_id = ?`).run(postId);
      this.db.prepare(`DELETE FROM posts WHERE id = ?`).run(postId);
      if (affectedTopics.length > 0) {
        this.facade.cleanupOrphanedTopics(affectedTopics.map((r) => r.topic_id));
      }
      return { success: true, apId: post.ap_id ?? undefined, authorId: post.author_id };
    })();
  }
}
