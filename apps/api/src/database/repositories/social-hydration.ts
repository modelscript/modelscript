// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import type { PostPollOption, PostPollView } from "../types.js";

const SQLITE_IN_CHUNK_SIZE = 500;

export interface PostHydrationBatchContext {
  bookmarkCounts: Map<string, number>;
  pollsByPostId: Map<string, PostPollView>;
}

interface RawPollRow {
  id: number;
  post_id: number | string;
  options_json: string;
  expires_at: string | null;
  multiple: number;
  votes_count: number;
  voters_count: number;
}

/**
 * Batch-loads bookmark counts for a set of post IDs in O(1) SQL queries
 * (chunked only if > 500 IDs to stay well below SQLite's bind parameter limit).
 */
export function batchLoadBookmarkCounts(db: Database.Database, postIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const uniqueIds = Array.from(new Set(postIds));
  if (uniqueIds.length === 0) return counts;

  for (let i = 0; i < uniqueIds.length; i += SQLITE_IN_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + SQLITE_IN_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT CAST(post_id AS TEXT) as post_id, COUNT(*) as cnt
         FROM bookmarks
         WHERE post_id IN (${placeholders})
         GROUP BY post_id`,
      )
      .all(...chunk) as { post_id: string; cnt: number }[];
    for (const row of rows) {
      counts.set(String(row.post_id), Number(row.cnt || 0));
    }
  }

  return counts;
}

/**
 * Batch-loads polls (and current user's votes, if any) for a set of post IDs
 * in O(1) SQL queries instead of 1-2 queries per post.
 */
export function batchLoadPostPolls(
  db: Database.Database,
  postIds: readonly string[],
  currentUserId?: number,
): Map<string, PostPollView> {
  const pollsByPostId = new Map<string, PostPollView>();
  const uniqueIds = Array.from(new Set(postIds));
  if (uniqueIds.length === 0) return pollsByPostId;

  try {
    const rawPolls: RawPollRow[] = [];
    for (let i = 0; i < uniqueIds.length; i += SQLITE_IN_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + SQLITE_IN_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT *, CAST(post_id AS TEXT) as post_id
           FROM post_polls
           WHERE post_id IN (${placeholders})`,
        )
        .all(...chunk) as RawPollRow[];
      for (const r of rows) {
        rawPolls.push(r);
      }
    }

    if (rawPolls.length === 0) return pollsByPostId;

    const votesByPollId = new Map<number, number[]>();
    if (currentUserId && currentUserId > 0) {
      const pollIds = Array.from(new Set(rawPolls.map((r) => r.id)));
      for (let i = 0; i < pollIds.length; i += SQLITE_IN_CHUNK_SIZE) {
        const chunk = pollIds.slice(i, i + SQLITE_IN_CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(", ");
        const voteRows = db
          .prepare(
            `SELECT poll_id, option_index
             FROM post_poll_votes
             WHERE voter_user_id = ? AND poll_id IN (${placeholders})`,
          )
          .all(currentUserId, ...chunk) as { poll_id: number; option_index: number }[];
        for (const v of voteRows) {
          let list = votesByPollId.get(v.poll_id);
          if (!list) {
            list = [];
            votesByPollId.set(v.poll_id, list);
          }
          list.push(Number(v.option_index));
        }
      }
    }

    const nowMs = Date.now();
    for (const row of rawPolls) {
      let options: PostPollOption[] = [];
      try {
        const parsed = JSON.parse(row.options_json);
        if (Array.isArray(parsed)) {
          options = parsed.map((o) => ({
            title: String(o.title || ""),
            votes_count: Number(o.votes_count || 0),
          }));
        }
      } catch {}

      const ownVotes = votesByPollId.get(row.id) ?? [];
      const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= nowMs);
      const postIdStr = String(row.post_id);
      pollsByPostId.set(postIdStr, {
        id: row.id,
        post_id: postIdStr,
        expires_at: row.expires_at,
        expired,
        multiple: Boolean(row.multiple),
        votes_count: Number(row.votes_count || 0),
        voters_count: Number(row.voters_count || 0),
        voted: ownVotes.length > 0,
        own_votes: ownVotes,
        options,
      });
    }
  } catch {
    return pollsByPostId;
  }

  return pollsByPostId;
}

/**
 * Preloads bookmark counts and polls for a batch of raw post rows.
 */
export function preloadPostHydrationBatch(
  db: Database.Database,
  rows: readonly { id?: number | string | null | undefined; bookmark_count?: number | undefined }[],
  currentUserId?: number,
): PostHydrationBatchContext {
  const allPostIds: string[] = [];
  const missingBookmarkPostIds: string[] = [];

  for (const row of rows) {
    if (row.id !== undefined && row.id !== null) {
      const idStr = String(row.id);
      allPostIds.push(idStr);
      if (row.bookmark_count === undefined) {
        missingBookmarkPostIds.push(idStr);
      }
    }
  }

  return {
    bookmarkCounts: batchLoadBookmarkCounts(db, missingBookmarkPostIds),
    pollsByPostId: batchLoadPostPolls(db, allPostIds, currentUserId),
  };
}
