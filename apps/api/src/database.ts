/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_DIR = "data";

export interface ClassRow {
  id: number;
  library_name: string;
  library_version: string;
  class_name: string;
  class_kind: string;
  description: string | null;
  documentation: string | null;
}

export interface ExtendsRow {
  id: number;
  class_id: number;
  base_class: string;
}

export interface ComponentRow {
  id: number;
  class_id: number;
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
}

export interface ModifierRow {
  id: number;
  component_id: number;
  modifier_name: string;
  modifier_value: string | null;
}

export interface ClassMetadata {
  className: string;
  classKind: string;
  description: string | null;
  documentation: string | null;
  baseClasses: string[];
  components: ComponentMetadata[];
}

export interface ComponentMetadata {
  name: string;
  typeName: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { name: string; value: string | null }[];
}

export interface TrendingTopicRow {
  id: number;
  concept: string;
  display_name: string;
  current_score: number;
  last_updated_at: string;
}

/**
 * SQLite-backed storage for Modelica class metadata.
 */
export class LibraryDatabase {
  readonly #db: Database.Database;

  constructor(dbDir?: string) {
    const dir = dbDir ?? DEFAULT_DB_DIR;
    const dbPath = path.join(dir, "modelscript.db");

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#initialize();
  }

  get db(): Database.Database {
    return this.#db;
  }

  resetDevData() {
    const tables = [
      "classes",
      "extends",
      "components",
      "modifiers",
      "users",
      "oauth_accounts",
      "follows",
      "rss_feeds",
      "user_rss_subscriptions",
      "artifact_views",
      "posts",
      "likes",
      "bookmarks",
      "notifications",
      "linked_repos",
      "user_topics",
      "trending_topics",
      "post_topics",
      "packages",
      "package_versions",
      "dist_tags",
      "artifacts",
    ];
    this.#db.exec("PRAGMA foreign_keys = OFF;");
    this.#db.transaction(() => {
      for (const table of tables) {
        this.#db.exec(`DROP TABLE IF EXISTS ${table};`);
      }
    })();
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#initialize();
  }

  #initialize(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS classes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        class_name      TEXT NOT NULL,
        class_kind      TEXT NOT NULL,
        description     TEXT,
        documentation   TEXT,
        UNIQUE(library_name, library_version, class_name)
      );

      CREATE TABLE IF NOT EXISTS extends (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        base_class      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS components (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        component_name  TEXT NOT NULL,
        type_name       TEXT NOT NULL,
        description     TEXT,
        causality       TEXT,
        variability     TEXT
      );

      CREATE TABLE IF NOT EXISTS modifiers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id    INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
        modifier_name   TEXT NOT NULL,
        modifier_value  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_classes_library ON classes(library_name, library_version);
      CREATE INDEX IF NOT EXISTS idx_extends_class ON extends(class_id);
      CREATE INDEX IF NOT EXISTS idx_components_class ON components(class_id);
      CREATE INDEX IF NOT EXISTS idx_modifiers_component ON modifiers(component_id);

      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        display_name  TEXT,
        bio           TEXT,
        avatar_url    TEXT DEFAULT 'https://ui-avatars.com/api/?name=User&background=random&color=fff',
        banner_url    TEXT DEFAULT 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80',
        location      TEXT,
        website       TEXT,
        notification_settings TEXT DEFAULT '{}',
        account_type  TEXT DEFAULT 'user',
        created_at    TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider          TEXT NOT NULL,
        provider_user_id  TEXT NOT NULL,
        UNIQUE(provider, provider_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

      CREATE TABLE IF NOT EXISTS follows (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(follower_id, following_id)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

      CREATE TABLE IF NOT EXISTS rss_feeds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        url             TEXT NOT NULL UNIQUE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT,
        description     TEXT,
        site_url        TEXT,
        last_fetched_at TEXT,
        last_guid       TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_rss_subscriptions (
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rss_feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
        created_at  TEXT DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, rss_feed_id)
      );

      CREATE TABLE IF NOT EXISTS artifact_views (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id      INTEGER NOT NULL REFERENCES users(id),
        view_type       TEXT NOT NULL,
        source_type     TEXT NOT NULL,
        source_ref      TEXT,
        title           TEXT,
        view_config     TEXT NOT NULL,
        thumbnail_url   TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT,
        artifact_view_id INTEGER REFERENCES artifact_views(id),
        reply_to_id      INTEGER REFERENCES posts(id),
        quote_post_id    INTEGER REFERENCES posts(id),
        repost_of_id     INTEGER REFERENCES posts(id),
        view_count       INTEGER DEFAULT 0,
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
      CREATE INDEX IF NOT EXISTS idx_posts_reply ON posts(reply_to_id);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

      CREATE TABLE IF NOT EXISTS likes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
      CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);

      CREATE TABLE IF NOT EXISTS bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id    INTEGER NOT NULL REFERENCES users(id),
        type        TEXT NOT NULL,
        post_id     INTEGER REFERENCES posts(id),
        read        INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read);

      CREATE TABLE IF NOT EXISTS linked_repos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider    TEXT NOT NULL,
        namespace   TEXT NOT NULL,
        project     TEXT NOT NULL,
        external_id TEXT,
        description TEXT,
        avatar_url  TEXT,
        pinned      INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, namespace, project)
      );
      CREATE INDEX IF NOT EXISTS idx_linked_repos_user ON linked_repos(user_id);

      CREATE TABLE IF NOT EXISTS user_topics (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        UNIQUE(user_id, concept)
      );

      CREATE TABLE IF NOT EXISTS trending_topics (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        concept         TEXT NOT NULL,
        location        TEXT,
        display_name    TEXT NOT NULL,
        current_score   REAL DEFAULT 0.0,
        last_updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(concept, location)
      );
      CREATE INDEX IF NOT EXISTS idx_trending_score ON trending_topics(current_score DESC);

      CREATE TABLE IF NOT EXISTS post_topics (
        post_id  INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        topic_id INTEGER REFERENCES trending_topics(id) ON DELETE CASCADE,
        UNIQUE(post_id, topic_id)
      );

      CREATE TABLE IF NOT EXISTS post_location_stats (
        post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        country_code TEXT NOT NULL,
        region_code  TEXT,
        view_count   INTEGER DEFAULT 1,
        UNIQUE(post_id, country_code, COALESCE(region_code, ''))
      );

      -- ── npm registry tables ──────────────────────────────────────

      CREATE TABLE IF NOT EXISTS packages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL UNIQUE,
        description     TEXT,
        readme          TEXT,
        readme_filename TEXT,
        license         TEXT,
        homepage        TEXT,
        repository_type TEXT,
        repository_url  TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        modified_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS package_versions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version         TEXT NOT NULL,
        tarball_path    TEXT NOT NULL,
        tarball_shasum  TEXT NOT NULL,
        tarball_integrity TEXT,
        tarball_size    INTEGER NOT NULL,
        manifest        TEXT NOT NULL,
        modelscript_meta TEXT,
        published_by    INTEGER REFERENCES users(id),
        published_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(package_id, version)
      );

      CREATE TABLE IF NOT EXISTS dist_tags (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        tag             TEXT NOT NULL,
        version         TEXT NOT NULL,
        UNIQUE(package_id, tag)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id      INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        path            TEXT NOT NULL,
        metadata        TEXT,
        UNIQUE(version_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
      CREATE INDEX IF NOT EXISTS idx_package_versions_pkg ON package_versions(package_id);
      CREATE INDEX IF NOT EXISTS idx_dist_tags_pkg ON dist_tags(package_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_version ON artifacts(version_id);
    `);

    // Migrations
    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN notification_settings TEXT DEFAULT '{}'`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'user'`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`
        UPDATE users 
        SET avatar_url = 'https://ui-avatars.com/api/?name=' || username || '&background=random&color=fff' 
        WHERE avatar_url IS NULL;
        
        UPDATE users 
        SET banner_url = 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80' 
        WHERE banner_url IS NULL;
      `);
    } catch (e) {
      // Ignore migration errors
    }

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0`);
    } catch (e) {
      // Column already exists
    }
  }

  // ── User management ─────────────────────────────────────────────

  getUserTopics(userId: number): { concept: string; is_active: boolean }[] {
    return this.#db.prepare(`SELECT concept, is_active FROM user_topics WHERE user_id = ?`).all(userId) as any[];
  }

  updateUserTopic(userId: number, concept: string, isActive: boolean) {
    this.#db
      .prepare(
        `INSERT INTO user_topics (user_id, concept, is_active) VALUES (?, ?, ?) ON CONFLICT(user_id, concept) DO UPDATE SET is_active = excluded.is_active`,
      )
      .run(userId, concept, isActive ? 1 : 0);
  }

  deriveUserTopics(userId: number): void {
    // Derive topics from liked/bookmarked posts and insert as active (if not explicitly inactive)
    this.#db
      .prepare(
        `
      INSERT INTO user_topics (user_id, concept, is_active)
      SELECT DISTINCT ?, t.concept, 1
      FROM likes l
      JOIN post_topics pt ON l.post_id = pt.post_id
      JOIN trending_topics t ON pt.topic_id = t.id
      WHERE l.user_id = ?
      ON CONFLICT(user_id, concept) DO NOTHING
    `,
      )
      .run(userId, userId);
  }

  // ── User management ─────────────────────────────────────────────

  createUser(
    username: string,
    email: string,
    passwordHash: string | null,
  ): { id: number; username: string; email: string } {
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
    const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

    const result = this.#db
      .prepare(`INSERT INTO users (username, email, password_hash, avatar_url, banner_url) VALUES (?, ?, ?, ?, ?)`)
      .run(username, email, passwordHash, avatarUrl, bannerUrl);
    return { id: Number(result.lastInsertRowid), username, email };
  }

  createOAuthUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    const transaction = this.#db.transaction(() => {
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
      const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

      const userResult = this.#db
        .prepare(`INSERT INTO users (username, email, avatar_url, banner_url) VALUES (?, ?, ?, ?)`)
        .run(username, email, avatarUrl, bannerUrl);
      const userId = Number(userResult.lastInsertRowid);

      this.#db
        .prepare(`INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`)
        .run(userId, provider, providerUserId);

      return { id: userId, username, email };
    });

    return transaction();
  }

  getOAuthAccount(provider: string, providerUserId: string): { user_id: number } | undefined {
    return this.#db
      .prepare(`SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`)
      .get(provider, providerUserId) as { user_id: number } | undefined;
  }

  getUserByEmail(
    email: string,
  ):
    | {
        id: number;
        username: string;
        email: string;
        password_hash: string;
        avatar_url: string;
        display_name: string;
        bio: string;
      }
    | undefined {
    return this.#db
      .prepare(`SELECT id, username, email, password_hash, avatar_url, display_name, bio FROM users WHERE email = ?`)
      .get(email) as any;
  }

  getUserByUsername(username: string): { id: number; username: string; email: string } | undefined {
    return this.#db.prepare(`SELECT id, username, email FROM users WHERE username = ?`).get(username) as
      | { id: number; username: string; email: string }
      | undefined;
  }

  getUserById(
    id: number,
  ):
    | { id: number; username: string; email: string; avatar_url: string; display_name: string; bio: string }
    | undefined {
    return this.#db
      .prepare(`SELECT id, username, email, avatar_url, display_name, bio FROM users WHERE id = ?`)
      .get(id) as any;
  }

  getFullProfileByUsername(username: string): any {
    return this.#db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url, u.location, u.website, u.created_at, u.account_type,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
      FROM users u WHERE u.username = ?
    `,
      )
      .get(username);
  }

  updateProfile(
    userId: number,
    profile: {
      display_name?: string;
      bio?: string;
      location?: string;
      website?: string;
      avatar_url?: string;
      banner_url?: string;
    },
  ) {
    const fields = Object.entries(profile).filter(([_, v]) => v !== undefined);
    if (fields.length === 0) return;
    const setClause = fields.map(([k, _]) => `${k} = ?`).join(", ");
    const values = fields.map(([_, v]) => v);
    this.#db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, userId);
  }

  updateAccount(userId: number, username: string, email: string) {
    this.#db.prepare(`UPDATE users SET username = ?, email = ? WHERE id = ?`).run(username, email, userId);
  }

  updatePassword(userId: number, passwordHash: string) {
    this.#db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
  }

  getPasswordHash(userId: number): string | undefined {
    const res = this.#db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as
      | { password_hash: string }
      | undefined;
    return res?.password_hash;
  }

  getNotificationSettings(userId: number): string | undefined {
    const res = this.#db.prepare(`SELECT notification_settings FROM users WHERE id = ?`).get(userId) as
      | { notification_settings: string }
      | undefined;
    return res?.notification_settings;
  }

  updateNotificationSettings(userId: number, settings: string) {
    this.#db.prepare(`UPDATE users SET notification_settings = ? WHERE id = ?`).run(settings, userId);
  }

  followUser(followerId: number, followingId: number) {
    try {
      this.#db.prepare(`INSERT INTO follows (follower_id, following_id) VALUES (?, ?)`).run(followerId, followingId);
    } catch (err) {
      // ignore unique constraint
    }
  }

  unfollowUser(followerId: number, followingId: number) {
    this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`).run(followerId, followingId);
  }

  isFollowing(followerId: number, followingId: number): boolean {
    const res = this.#db
      .prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`)
      .get(followerId, followingId);
    return !!res;
  }

  getUserFollowers(userId: number, currentUserId?: number): any[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          0 as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as any[])
      : (this.#db.prepare(query).all(userId) as any[]);
  }

  getUserFollowing(userId: number, currentUserId?: number): any[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          0 as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as any[])
      : (this.#db.prepare(query).all(userId) as any[]);
  }

  getUserSuggestions(userId?: number, limit: number = 3): any[] {
    if (userId) {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        WHERE u.id != ? AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(userId, userId, limit) as any[];
    } else {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(limit) as any[];
    }
  }

  // ── Social & Posts ──────────────────────────────────────────────

  createPost(
    authorId: number,
    content: string | null,
    artifactViewId?: number,
    replyToId?: number,
    quotePostId?: number,
    repostOfId?: number,
  ): { id: number } {
    const res = this.#db
      .prepare(
        `
      INSERT INTO posts (author_id, content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(authorId, content, artifactViewId ?? null, replyToId ?? null, quotePostId ?? null, repostOfId ?? null);
    return { id: Number(res.lastInsertRowid) };
  }

  updatePostArtifactViewId(postId: number, artifactViewId: number) {
    this.#db.prepare(`UPDATE posts SET artifact_view_id = ? WHERE id = ?`).run(artifactViewId, postId);
  }

  incrementPostView(postId: number, countryCode?: string, regionCode?: string) {
    this.#db.prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`).run(postId);

    if (countryCode) {
      this.#db
        .prepare(
          `
        INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(post_id, country_code, COALESCE(region_code, '')) DO UPDATE SET view_count = post_location_stats.view_count + 1
      `,
        )
        .run(postId, countryCode, regionCode || null);
    }
  }

  getPostLocationStats(postId: number): { country: string; views: number }[] {
    return this.#db
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

  private hydratePost(p: any, currentUserId?: number): any {
    if (!p) return null;
    if (p.repost_of_id) {
      p.repost_post = this.getPost(p.repost_of_id, currentUserId);
    }
    if (p.quote_post_id) {
      p.quote_post = this.getPost(p.quote_post_id, currentUserId);
    }
    return p;
  }

  getPost(id: number, currentUserId?: number): any {
    const p = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `,
      )
      .get(id);
    return this.hydratePost(p, currentUserId);
  }

  getReplies(postId: number, currentUserId?: number, limit: number = 50): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.reply_to_id = ?
      ORDER BY p.created_at ASC
      LIMIT ?
    `,
      )
      .all(postId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getPostParents(postId: number, currentUserId?: number, depth: number = 5): any[] {
    const parents: any[] = [];
    let currentId = postId;
    let currentDepth = 0;

    while (currentDepth < depth) {
      const p = this.#db.prepare(`SELECT reply_to_id FROM posts WHERE id = ?`).get(currentId) as any;
      if (!p || !p.reply_to_id) break;

      const parentPost = this.getPost(p.reply_to_id, currentUserId);
      if (parentPost) {
        parents.unshift(parentPost); // Add to beginning (oldest first)
        currentId = p.reply_to_id;
      } else {
        break;
      }
      currentDepth++;
    }
    return parents;
  }

  getHomeTimeline(userId: number, limit: number = 20): any[] {
    // Derive topics dynamically before fetching the feed
    try {
      this.deriveUserTopics(userId);
    } catch (e) {
      console.error("Failed to derive user topics", e);
    }

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          SELECT COALESCE(SUM(CASE WHEN ut.is_active = 1 THEN 20 ELSE -100 END), 0)
          FROM post_topics pt 
          JOIN trending_topics t ON pt.topic_id = t.id
          JOIN user_topics ut ON ut.concept = t.concept AND ut.user_id = ?
          WHERE pt.post_id = p.id
        ) + 
        (
          (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) * 3
        ) +
        (
          (SELECT COUNT(*) FROM likes l JOIN follows f ON l.user_id = f.following_id WHERE l.post_id = p.id AND f.follower_id = ?) * 3
        ) as total_score
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE 
        p.author_id = ? OR 
        p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR
        EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN trending_topics t ON pt.topic_id = t.id
          JOIN user_topics ut ON ut.concept = t.concept AND ut.user_id = ? AND ut.is_active = 1
          WHERE pt.post_id = p.id
        )
      ORDER BY total_score DESC, p.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, userId, userId, userId, userId, userId, userId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }

  getFollowingTimeline(userId: number, limit: number = 20, sort: string = "recent"): any[] {
    const orderBy = sort === "popular" ? "like_count DESC, diversity_score DESC" : "diversity_score DESC";
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          strftime('%s', p.created_at) - 
          (
            SELECT COUNT(*) FROM posts p2 
            WHERE p2.author_id = p.author_id 
              AND p2.id > p.id 
              AND p2.created_at > datetime(p.created_at, '-24 hours')
          ) * 14400 -- 4 hours penalty for each newer post in the same 24h window
        ) as diversity_score
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.author_id = ? OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
      ORDER BY ${orderBy}
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, userId, userId, userId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }
  getExploreTimeline(currentUserId?: number, limit: number = 20): any[] {
    const uid = currentUserId || -1;
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          p.view_count * 1 +
          (SELECT COUNT(*) FROM likes WHERE post_id = p.id) * 10 +
          (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) * 15 +
          (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) * 20
        ) as engagement_score
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.reply_to_id IS NULL
      ORDER BY (engagement_score / (CAST((julianday('now') - julianday(p.created_at)) * 24 as REAL) + 2)) DESC, p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, limit) as any[];

    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getUserTimeline(username: string, currentUserId?: number, limit: number = 20): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE u.username = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(username, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  toggleLike(userId: number, postId: number): boolean {
    const existing = this.#db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`).get(userId, postId);
    if (existing) {
      this.#db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
      return false; // unliked
    } else {
      this.#db.prepare(`INSERT INTO likes (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as any;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "like", postId);
      }
      return true; // liked
    }
  }

  toggleBookmark(userId: number, postId: number): boolean {
    const existing = this.#db.prepare(`SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?`).get(userId, postId);
    if (existing) {
      this.#db.prepare(`DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?`).run(userId, postId);
      return false;
    } else {
      this.#db.prepare(`INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
      return true;
    }
  }

  toggleRepost(userId: number, postId: number): boolean {
    const existing = this.#db
      .prepare(`SELECT id FROM posts WHERE author_id = ? AND repost_of_id = ?`)
      .get(userId, postId) as { id: number } | undefined;
    if (existing) {
      this.#db.prepare(`DELETE FROM posts WHERE id = ?`).run(existing.id);
      return false; // un-reposted
    } else {
      this.createPost(userId, null, undefined, undefined, undefined, postId);
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as any;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "repost", postId);
      }
      return true; // reposted
    }
  }

  getBookmarks(userId: number, limit: number = 20): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        1 as bookmarked
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.author_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }

  createNotification(userId: number, actorId: number, type: string, postId?: number): void {
    if (userId === actorId) return;
    this.#db
      .prepare(
        `
      INSERT INTO notifications (user_id, actor_id, type, post_id)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(userId, actorId, type, postId ?? null);
  }

  getNotifications(userId: number, limit: number = 20): any[] {
    return this.#db
      .prepare(
        `
      SELECT n.*, 
             u.username as actor_username, 
             u.display_name as actor_display_name, 
             u.avatar_url as actor_avatar_url,
             p.content as post_content,
             a.view_config as post_artifact_config,
             a.view_type as post_artifact_type
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, limit) as any[];
  }

  markNotificationsRead(userId: number): void {
    this.#db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(userId);
  }

  getUnreadNotificationCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0`)
      .get(userId) as any;
    return row.count;
  }

  // ── RSS Feeds ───────────────────────────────────────────────────

  createRssProfile(url: string, title: string, description: string, siteUrl: string, avatarUrl: string): number {
    const transaction = this.#db.transaction(() => {
      // Create user profile for the RSS feed
      let domain = "rss";
      try {
        domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, "_");
      } catch (e) {
        // Ignore parsing error
      }
      const uniqueSuffix = Math.floor(Math.random() * 1000000);
      const username = `rss_${domain}_${uniqueSuffix}`;

      const userResult = this.#db
        .prepare(
          `INSERT INTO users (username, email, display_name, bio, avatar_url, account_type) VALUES (?, ?, ?, ?, ?, 'rss')`,
        )
        .run(username, `${username}@rss.modelscript.local`, title, description, avatarUrl);
      const userId = Number(userResult.lastInsertRowid);

      const feedResult = this.#db
        .prepare(`INSERT INTO rss_feeds (url, user_id, title, description, site_url) VALUES (?, ?, ?, ?, ?)`)
        .run(url, userId, title, description, siteUrl);

      return Number(feedResult.lastInsertRowid);
    });

    return transaction();
  }

  getRssFeedByUrl(url: string): any {
    return this.#db.prepare(`SELECT * FROM rss_feeds WHERE url = ?`).get(url);
  }

  subscribeToRssFeed(userId: number, rssFeedId: number): void {
    // Check limit first
    const subCount = (
      this.#db.prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE user_id = ?`).get(userId) as any
    ).count;

    // Check if already subscribed to avoid double-counting limit
    const existing = this.#db
      .prepare(`SELECT 1 FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
      .get(userId, rssFeedId);
    if (!existing && subCount >= 10) {
      throw new Error("Maximum of 10 RSS feed subscriptions reached.");
    }

    try {
      this.#db
        .prepare(`INSERT INTO user_rss_subscriptions (user_id, rss_feed_id) VALUES (?, ?)`)
        .run(userId, rssFeedId);
    } catch (e) {
      // Ignore unique constraint violation (already subscribed)
    }
  }

  unsubscribeFromRssFeed(userId: number, rssFeedId: number): void {
    this.#db.prepare(`DELETE FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`).run(userId, rssFeedId);
  }

  getUserRssSubscriptions(userId: number): any[] {
    return this.#db
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
      .all(userId) as any[];
  }

  getAllRssFeeds(): any[] {
    return this.#db.prepare(`SELECT * FROM rss_feeds`).all() as any[];
  }

  updateRssFeedStatus(rssFeedId: number, lastFetchedAt: string, lastGuid: string): void {
    this.#db
      .prepare(`UPDATE rss_feeds SET last_fetched_at = ?, last_guid = ? WHERE id = ?`)
      .run(lastFetchedAt, lastGuid, rssFeedId);
  }

  getArtifactView(id: number): any {
    return this.#db.prepare(`SELECT * FROM artifact_views WHERE id = ?`).get(id);
  }

  createArtifactView(creatorId: number, type: string, source_type: string, viewConfig: string, title?: string): number {
    const res = this.#db
      .prepare(
        `
      INSERT INTO artifact_views (creator_id, view_type, source_type, view_config, title) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(creatorId, type, source_type, viewConfig, title || null);
    return Number(res.lastInsertRowid);
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
    const existing = this.#db
      .prepare(`SELECT id, current_score, last_updated_at FROM trending_topics WHERE concept = ? AND location IS ?`)
      .get(concept, location) as { id: number; current_score: number; last_updated_at: string } | undefined;

    if (!existing) {
      const res = this.#db
        .prepare(
          `
        INSERT INTO trending_topics (concept, display_name, current_score, location) VALUES (?, ?, ?, ?)
      `,
        )
        .run(concept, displayName, weight, location);
      return Number(res.lastInsertRowid);
    } else {
      const lastUpdatedMs = new Date(existing.last_updated_at.replace(" ", "T") + "Z").getTime();
      const currentMs = Date.now();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);

      const decayedScore = existing.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      const newScore = decayedScore + weight;

      this.#db
        .prepare(
          `
        UPDATE trending_topics SET current_score = ?, last_updated_at = datetime('now') WHERE id = ?
      `,
        )
        .run(newScore, existing.id);

      return existing.id;
    }
  }

  linkPostToTopic(postId: number, topicId: number): void {
    try {
      this.#db.prepare(`INSERT INTO post_topics (post_id, topic_id) VALUES (?, ?)`).run(postId, topicId);
    } catch (e) {
      // Ignore unique constraint violation
    }
  }

  /**
   * Worker function: Decays older topics and writes back to DB to prevent
   * permanent index clogging. Intended to be run periodically.
   */
  decayTrendingTopics(halfLifeHours: number = 24): void {
    const topicsToDecay = this.#db
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
    const updateStmt = this.#db.prepare(`
      UPDATE trending_topics 
      SET current_score = ?, last_updated_at = datetime('now') 
      WHERE id = ?
    `);

    // Use a transaction for fast bulk updates
    const transaction = this.#db.transaction((updates: { id: number; score: number }[]) => {
      for (const u of updates) {
        updateStmt.run(u.score, u.id);
      }
    });

    const updates = topicsToDecay.map((t) => {
      const lastUpdatedMs = new Date(t.last_updated_at.replace(" ", "T") + "Z").getTime();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);
      const newScore = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      return { id: t.id, score: newScore };
    });

    transaction(updates);
  }

  getTopTrendingTopics(
    limit: number = 10,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): (TrendingTopicRow & { real_score: number })[] {
    const query = location
      ? `SELECT * FROM trending_topics WHERE current_score > 0.001 AND location = ? ORDER BY current_score DESC LIMIT ?`
      : `SELECT * FROM trending_topics WHERE current_score > 0.001 ORDER BY current_score DESC LIMIT ?`;
    const params = location ? [location, limit * 5] : [limit * 5];

    const topics = this.#db.prepare(query).all(...params) as TrendingTopicRow[];

    const currentMs = Date.now();
    const scoredTopics = topics.map((t) => {
      const lastUpdatedMs = new Date(t.last_updated_at.replace(" ", "T") + "Z").getTime();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);
      const real_score = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      return { ...t, real_score };
    });

    scoredTopics.sort((a, b) => b.real_score - a.real_score);
    return scoredTopics.slice(0, limit);
  }

  getTopicPosts(concept: string, currentUserId?: number, limit = 20): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p 
      JOIN users u ON p.author_id = u.id
      JOIN post_topics pt ON pt.post_id = p.id
      JOIN trending_topics t ON t.id = pt.topic_id
      WHERE t.concept = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(concept, limit);

    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  // ── Linked Repositories ─────────────────────────────────────────

  getLinkedRepos(userId: number): any[] {
    return this.#db
      .prepare(`SELECT * FROM linked_repos WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as any[];
  }

  getPopularRepos(limit: number = 5): any[] {
    return this.#db
      .prepare(
        `
        SELECT r.*, u.username, u.display_name, u.avatar_url
        FROM linked_repos r
        JOIN users u ON r.user_id = u.id
        GROUP BY r.namespace, r.project
        ORDER BY RANDOM()
        LIMIT ?
      `,
      )
      .all(limit) as any[];
  }

  linkRepo(
    userId: number,
    provider: string,
    externalId: string,
    repoFullName: string,
    defaultBranch?: string,
    description?: string,
  ): void {
    const parts = repoFullName.split("/");
    const namespace = parts[0] || "";
    const project = parts.slice(1).join("/") || repoFullName;

    const existing = this.#db
      .prepare(`SELECT id FROM linked_repos WHERE user_id = ? AND provider = ? AND external_id = ?`)
      .get(userId, provider, externalId);
    if (!existing) {
      this.#db
        .prepare(
          `
        INSERT INTO linked_repos (user_id, provider, namespace, project, external_id, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(userId, provider, namespace, project, externalId, description || null);
    }
  }

  unlinkRepo(userId: number, repoId: number): void {
    this.#db.prepare(`DELETE FROM linked_repos WHERE id = ? AND user_id = ?`).run(repoId, userId);
  }

  // ── Global Search ───────────────────────────────────────────────

  globalSearch(query: string, limitPerCategory: number = 3) {
    const safeQuery = query.trim();
    if (!safeQuery) {
      return { topics: [], users: [], packages: [], repositories: [] };
    }
    const likeQuery = `%${safeQuery}%`;

    const topics = this.#db
      .prepare(
        `
      SELECT id, display_name, current_score 
      FROM trending_topics 
      WHERE display_name LIKE ? COLLATE NOCASE
      ORDER BY current_score DESC LIMIT ?
    `,
      )
      .all(likeQuery, limitPerCategory);

    const users = this.#db
      .prepare(
        `
      SELECT id, username, display_name, avatar_url, bio 
      FROM users 
      WHERE username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, limitPerCategory);

    const packages = this.#db
      .prepare(
        `
      SELECT id, name, description
      FROM packages 
      WHERE name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, limitPerCategory);

    const repositories = this.#db
      .prepare(
        `
      SELECT id, provider, namespace, project, description, avatar_url
      FROM linked_repos 
      WHERE namespace LIKE ? COLLATE NOCASE OR project LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE
      GROUP BY provider, namespace, project
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, likeQuery, limitPerCategory);

    return { topics, users, packages, repositories };
  }

  // ── Library metadata ────────────────────────────────────────────

  /**
   * Clear all metadata for a library version.
   */
  clearLibraryMetadata(libraryName: string, libraryVersion: string): void {
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
  }

  /**
   * Store all metadata for a library version inside a transaction.
   */
  /**
   * Store metadata for a single class. This should be run inside a transaction for performance.
   */
  storeClassMetadata(libraryName: string, libraryVersion: string, cls: ClassMetadata): void {
    const result = this.#db
      .prepare(
        `INSERT OR REPLACE INTO classes (library_name, library_version, class_name, class_kind, description, documentation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(libraryName, libraryVersion, cls.className, cls.classKind, cls.description, cls.documentation);

    const classId = result.lastInsertRowid;

    const insertExtends = this.#db.prepare(`INSERT OR REPLACE INTO extends (class_id, base_class) VALUES (?, ?)`);
    for (const baseClass of cls.baseClasses) {
      insertExtends.run(classId, baseClass);
    }

    const insertComponent = this.#db.prepare(
      `INSERT OR REPLACE INTO components (class_id, component_name, type_name, description, causality, variability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertModifier = this.#db.prepare(
      `INSERT OR REPLACE INTO modifiers (component_id, modifier_name, modifier_value) VALUES (?, ?, ?)`,
    );

    for (const comp of cls.components) {
      const compResult = insertComponent.run(
        classId,
        comp.name,
        comp.typeName,
        comp.description,
        comp.causality,
        comp.variability,
      );
      const componentId = compResult.lastInsertRowid;

      for (const mod of comp.modifiers) {
        insertModifier.run(componentId, mod.name, mod.value);
      }
    }
  }

  /**
   * Store all metadata for a library version inside a transaction.
   * WARNING: This clears all existing metadata for the version first.
   */
  storeLibraryMetadata(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.#db.transaction(() => {
      this.clearLibraryMetadata(libraryName, libraryVersion);
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Store a batch of class metadata without clearing existing data.
   * Use this for incremental batch inserts during library processing.
   */
  storeClassBatch(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.#db.transaction(() => {
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Query classes for a library version with optional filters.
   */
  getClasses(
    libraryName: string,
    libraryVersion: string,
    opts?: { kind?: string | undefined; q?: string | undefined },
  ): Omit<ClassRow, "id">[] {
    let sql = `SELECT class_name, class_kind, description, documentation FROM classes
               WHERE library_name = ? AND library_version = ?`;
    const params: (string | number)[] = [libraryName, libraryVersion];

    if (opts?.kind) {
      sql += ` AND class_kind = ?`;
      params.push(opts.kind);
    }

    if (opts?.q) {
      sql += ` AND class_name LIKE ?`;
      params.push(`%${opts.q}%`);
    }

    sql += ` ORDER BY class_name`;

    return this.#db.prepare(sql).all(...params) as Omit<ClassRow, "id">[];
  }

  /**
   * Get a single class with its extends and components.
   */
  getClass(
    libraryName: string,
    libraryVersion: string,
    className: string,
  ): {
    classKind: string;
    description: string | null;
    documentation: string | null;
    extends: string[];
    components: (Omit<ComponentRow, "id" | "class_id"> & { modifiers: Omit<ModifierRow, "id" | "component_id">[] })[];
  } | null {
    const cls = this.#db
      .prepare(
        `SELECT id, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? AND class_name = ?`,
      )
      .get(libraryName, libraryVersion, className) as
      | { id: number; class_kind: string; description: string | null; documentation: string | null }
      | undefined;

    if (!cls) return null;

    const extendsRows = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`).all(cls.id) as {
      base_class: string;
    }[];

    const componentRows = this.#db
      .prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? ORDER BY component_name`,
      )
      .all(cls.id) as ComponentRow[];

    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    const components = componentRows.map((comp) => {
      const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
      return {
        component_name: comp.component_name,
        type_name: comp.type_name,
        description: comp.description,
        causality: comp.causality,
        variability: comp.variability,
        modifiers: modifiers.map((m) => ({
          modifier_name: m.modifier_name,
          modifier_value: m.modifier_value,
        })),
      };
    });

    return {
      classKind: cls.class_kind,
      description: cls.description,
      documentation: cls.documentation,
      extends: extendsRows.map((r) => r.base_class),
      components,
    };
  }

  /**
   * Get all classes with full details for a library version.
   */
  getAllClasses(
    libraryName: string,
    libraryVersion: string,
  ): {
    className: string;
    classKind: string;
    description: string | null;
    documentation: string | null;
    extends: string[];
    components: {
      name: string;
      typeName: string;
      description: string | null;
      causality: string | null;
      variability: string | null;
      modifiers: { name: string; value: string | null }[];
    }[];
  }[] {
    const classRows = this.#db
      .prepare(
        `SELECT id, class_name, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? ORDER BY class_name`,
      )
      .all(libraryName, libraryVersion) as {
      id: number;
      class_name: string;
      class_kind: string;
      description: string | null;
      documentation: string | null;
    }[];

    const getExtends = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`);
    const getComponents = this.#db.prepare(
      `SELECT id, component_name, type_name, description, causality, variability
       FROM components WHERE class_id = ? ORDER BY component_name`,
    );
    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    return classRows.map((cls) => {
      const extendsRows = getExtends.all(cls.id) as { base_class: string }[];
      const componentRows = getComponents.all(cls.id) as ComponentRow[];

      const components = componentRows.map((comp) => {
        const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
        return {
          name: comp.component_name,
          typeName: comp.type_name,
          description: comp.description,
          causality: comp.causality,
          variability: comp.variability,
          modifiers: modifiers.map((m) => ({ name: m.modifier_name, value: m.modifier_value })),
        };
      });

      return {
        className: cls.class_name,
        classKind: cls.class_kind,
        description: cls.description,
        documentation: cls.documentation,
        extends: extendsRows.map((r) => r.base_class),
        components,
      };
    });
  }

  /**
   * Get all data for a library version as RDF triples ({s, p, o}).
   */
  getLibraryTriples(libraryName: string, libraryVersion: string): { s: string; p: string; o: string }[] {
    const NS = "https://modelica.org/ontology#";
    const LIB = `urn:modelica:${libraryName}:${libraryVersion}:`;
    const triples: { s: string; p: string; o: string }[] = [];

    const allClasses = this.getAllClasses(libraryName, libraryVersion);

    for (const cls of allClasses) {
      const classUri = `${LIB}${cls.className}`;
      triples.push({ s: classUri, p: `${NS}type`, o: `${NS}Class` });
      triples.push({ s: classUri, p: `${NS}className`, o: cls.className });
      triples.push({ s: classUri, p: `${NS}classKind`, o: cls.classKind });
      if (cls.description) {
        triples.push({ s: classUri, p: `${NS}description`, o: cls.description });
      }
      if (cls.documentation) {
        triples.push({ s: classUri, p: `${NS}documentation`, o: cls.documentation });
      }

      for (const base of cls.extends) {
        triples.push({ s: classUri, p: `${NS}extends`, o: `${LIB}${base}` });
      }

      for (const comp of cls.components) {
        const compUri = `${classUri}.${comp.name}`;
        triples.push({ s: classUri, p: `${NS}hasComponent`, o: compUri });
        triples.push({ s: compUri, p: `${NS}type`, o: `${NS}Component` });
        triples.push({ s: compUri, p: `${NS}componentName`, o: comp.name });
        triples.push({ s: compUri, p: `${NS}typeName`, o: comp.typeName });
        if (comp.description) {
          triples.push({ s: compUri, p: `${NS}description`, o: comp.description });
        }
        if (comp.causality) {
          triples.push({ s: compUri, p: `${NS}causality`, o: comp.causality });
        }
        if (comp.variability) {
          triples.push({ s: compUri, p: `${NS}variability`, o: comp.variability });
        }

        for (const mod of comp.modifiers) {
          const modUri = `${compUri}.${mod.name}`;
          triples.push({ s: compUri, p: `${NS}hasModifier`, o: modUri });
          triples.push({ s: modUri, p: `${NS}type`, o: `${NS}Modifier` });
          triples.push({ s: modUri, p: `${NS}modifierName`, o: mod.name });
          if (mod.value !== null) {
            triples.push({ s: modUri, p: `${NS}modifierValue`, o: mod.value });
          }
        }
      }
    }

    return triples;
  }

  /**
   * Delete all data for a library version.
   */
  deleteLibrary(libraryName: string, libraryVersion: string): void {
    // Cascade deletes handle extends, components, modifiers
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
  }

  // ── npm registry methods ────────────────────────────────────────

  /**
   * Get or create a package record by name.
   */
  getOrCreatePackage(name: string): { id: number; created: boolean } {
    const existing = this.#db.prepare(`SELECT id FROM packages WHERE name = ?`).get(name) as { id: number } | undefined;
    if (existing) {
      return { id: existing.id, created: false };
    }
    const result = this.#db.prepare(`INSERT INTO packages (name) VALUES (?)`).run(name);
    return { id: Number(result.lastInsertRowid), created: true };
  }

  /**
   * Get a package record by name.
   */
  getPackage(name: string):
    | {
        id: number;
        name: string;
        description: string | null;
        readme: string | null;
        readme_filename: string | null;
        license: string | null;
        homepage: string | null;
        repository_type: string | null;
        repository_url: string | null;
        created_at: string;
        modified_at: string;
      }
    | undefined {
    return this.#db.prepare(`SELECT * FROM packages WHERE name = ?`).get(name) as
      | {
          id: number;
          name: string;
          description: string | null;
          readme: string | null;
          readme_filename: string | null;
          license: string | null;
          homepage: string | null;
          repository_type: string | null;
          repository_url: string | null;
          created_at: string;
          modified_at: string;
        }
      | undefined;
  }

  /**
   * Update package-level metadata (hoisted from latest version).
   */
  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null;
      readme?: string | null;
      readme_filename?: string | null;
      license?: string | null;
      homepage?: string | null;
      repository_type?: string | null;
      repository_url?: string | null;
    },
  ): void {
    this.#db
      .prepare(
        `UPDATE packages SET
          description = COALESCE(?, description),
          readme = COALESCE(?, readme),
          readme_filename = COALESCE(?, readme_filename),
          license = COALESCE(?, license),
          homepage = COALESCE(?, homepage),
          repository_type = COALESCE(?, repository_type),
          repository_url = COALESCE(?, repository_url),
          modified_at = datetime('now')
        WHERE id = ?`,
      )
      .run(
        meta.description ?? null,
        meta.readme ?? null,
        meta.readme_filename ?? null,
        meta.license ?? null,
        meta.homepage ?? null,
        meta.repository_type ?? null,
        meta.repository_url ?? null,
        packageId,
      );
  }

  /**
   * Store a new package version.
   */
  storePackageVersion(
    packageId: number,
    version: string,
    tarballPath: string,
    tarballShasum: string,
    tarballIntegrity: string | null,
    tarballSize: number,
    manifest: string,
    modelscriptMeta: string | null,
    publishedBy: number | null,
  ): number {
    const result = this.#db
      .prepare(
        `INSERT INTO package_versions
          (package_id, version, tarball_path, tarball_shasum, tarball_integrity, tarball_size, manifest, modelscript_meta, published_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        packageId,
        version,
        tarballPath,
        tarballShasum,
        tarballIntegrity,
        tarballSize,
        manifest,
        modelscriptMeta,
        publishedBy,
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get a specific package version.
   */
  getPackageVersion(
    packageId: number,
    version: string,
  ):
    | {
        id: number;
        version: string;
        tarball_path: string;
        tarball_shasum: string;
        tarball_integrity: string | null;
        tarball_size: number;
        manifest: string;
        modelscript_meta: string | null;
        published_at: string;
      }
    | undefined {
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? AND version = ?`)
      .get(packageId, version) as
      | {
          id: number;
          version: string;
          tarball_path: string;
          tarball_shasum: string;
          tarball_integrity: string | null;
          tarball_size: number;
          manifest: string;
          modelscript_meta: string | null;
          published_at: string;
        }
      | undefined;
  }

  /**
   * Get all versions for a package.
   */
  getPackageVersions(packageId: number): {
    id: number;
    version: string;
    tarball_path: string;
    tarball_shasum: string;
    tarball_integrity: string | null;
    tarball_size: number;
    manifest: string;
    modelscript_meta: string | null;
    published_at: string;
  }[] {
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? ORDER BY published_at DESC`)
      .all(packageId) as {
      id: number;
      version: string;
      tarball_path: string;
      tarball_shasum: string;
      tarball_integrity: string | null;
      tarball_size: number;
      manifest: string;
      modelscript_meta: string | null;
      published_at: string;
    }[];
  }

  /**
   * Set a dist-tag for a package (e.g. "latest").
   */
  setDistTag(packageId: number, tag: string, version: string): void {
    this.#db
      .prepare(
        `INSERT INTO dist_tags (package_id, tag, version) VALUES (?, ?, ?)
        ON CONFLICT(package_id, tag) DO UPDATE SET version = excluded.version`,
      )
      .run(packageId, tag, version);
  }

  /**
   * Get all dist-tags for a package.
   */
  getDistTags(packageId: number): Record<string, string> {
    const rows = this.#db.prepare(`SELECT tag, version FROM dist_tags WHERE package_id = ?`).all(packageId) as {
      tag: string;
      version: string;
    }[];
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.tag] = row.version;
    }
    return tags;
  }

  /**
   * Store an artifact for a package version.
   */
  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    const result = this.#db
      .prepare(`INSERT OR REPLACE INTO artifacts (version_id, type, path, metadata) VALUES (?, ?, ?, ?)`)
      .run(versionId, type, artifactPath, metadata);
    return Number(result.lastInsertRowid);
  }

  /**
   * Get artifacts for a package version.
   */
  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.#db.prepare(`SELECT * FROM artifacts WHERE version_id = ?`).all(versionId) as {
      id: number;
      type: string;
      path: string;
      metadata: string | null;
    }[];
  }

  /**
   * Build the full npm packument JSON for a package.
   */
  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    const pkg = this.getPackage(name);
    if (!pkg) return null;

    const versions = this.getPackageVersions(pkg.id);
    if (versions.length === 0) return null;

    const distTags = this.getDistTags(pkg.id);
    const time: Record<string, string> = {
      created: pkg.created_at,
      modified: pkg.modified_at,
    };

    const versionsObj: Record<string, unknown> = {};
    for (const v of versions) {
      time[v.version] = v.published_at;
      const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
      // Ensure dist info is present
      manifest["dist"] = {
        shasum: v.tarball_shasum,
        integrity: v.tarball_integrity,
        tarball: `${registryUrl}/${encodeURIComponent(name)}/-/${name}-${v.version}.tgz`,
      };
      manifest["_id"] = `${name}@${v.version}`;
      versionsObj[v.version] = manifest;
    }

    const repository = pkg.repository_url ? { type: pkg.repository_type ?? "git", url: pkg.repository_url } : undefined;

    return {
      _id: name,
      _rev: `1-${Date.now().toString(16)}`,
      name,
      description: pkg.description,
      "dist-tags": distTags,
      versions: versionsObj,
      time,
      readme: pkg.readme ?? "",
      readmeFilename: pkg.readme_filename ?? "README.md",
      license: pkg.license,
      homepage: pkg.homepage,
      repository,
    };
  }

  /**
   * Search packages by query text. Returns matching packages with basic metadata.
   */
  searchPackages(
    text: string,
    size = 20,
    from = 0,
  ): {
    objects: {
      package: {
        name: string;
        version: string;
        description: string | null;
        date: string;
      };
    }[];
    total: number;
  } {
    const countSql = `SELECT COUNT(*) as total FROM packages WHERE name LIKE ? OR description LIKE ?`;
    const searchSql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
      WHERE p.name LIKE ? OR p.description LIKE ?
      ORDER BY p.modified_at DESC
      LIMIT ? OFFSET ?
    `;
    const pattern = `%${text}%`;

    const countRow = this.#db.prepare(countSql).get(pattern, pattern) as { total: number };
    const rows = this.#db.prepare(searchSql).all(pattern, pattern, size, from) as {
      name: string;
      description: string | null;
      modified_at: string;
      latest_version: string | null;
    }[];

    return {
      objects: rows.map((r) => ({
        package: {
          name: r.name,
          version: r.latest_version ?? "0.0.0",
          description: r.description,
          date: r.modified_at,
        },
      })),
      total: countRow.total,
    };
  }

  /**
   * List all packages with optional query filter. Returns basic package info.
   */
  listPackages(query?: string): {
    name: string;
    description: string | null;
    latest_version: string | null;
    modified_at: string;
  }[] {
    let sql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
    `;
    const params: string[] = [];
    if (query) {
      sql += ` WHERE p.name LIKE ? OR p.description LIKE ?`;
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }
    sql += ` ORDER BY p.modified_at DESC`;
    return this.#db.prepare(sql).all(...params) as {
      name: string;
      description: string | null;
      latest_version: string | null;
      modified_at: string;
    }[];
  }

  /**
   * Delete a package version. If no more versions remain, delete the package.
   */
  deletePackageVersion(name: string, version: string): boolean {
    const pkg = this.getPackage(name);
    if (!pkg) return false;

    const v = this.getPackageVersion(pkg.id, version);
    if (!v) return false;

    this.#db.prepare(`DELETE FROM package_versions WHERE id = ?`).run(v.id);

    // Clean up dist-tags pointing to this version
    this.#db.prepare(`DELETE FROM dist_tags WHERE package_id = ? AND version = ?`).run(pkg.id, version);

    // If no versions remain, delete the package
    const remaining = this.getPackageVersions(pkg.id);
    if (remaining.length === 0) {
      this.#db.prepare(`DELETE FROM packages WHERE id = ?`).run(pkg.id);
    } else {
      // Re-point "latest" to the newest remaining version
      if (remaining[0]) {
        this.setDistTag(pkg.id, "latest", remaining[0].version);
      }
    }

    return true;
  }

  close(): void {
    this.#db.close();
  }
}
