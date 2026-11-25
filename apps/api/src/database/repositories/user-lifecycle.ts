// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import webpush from "web-push";
import { PERSONA_SEED_TOPICS } from "../../util/extract-topics.js";
import { sanitizeRemoteHtml } from "../../util/html-sanitizer.js";
import type { PostVisibility, ProfileField, RemoteActorProfile, UserFederationInfo, UserRow } from "../types.js";
import { BaseRepository } from "./base.js";

export function generateRSAKeys(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function generateEd25519Keys(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export class UserLifecycleRepository extends BaseRepository {
  #userTopicsDerivedAt = new Map<number, number>();

  clearUserTopicsCache(): void {
    this.#userTopicsDerivedAt.clear();
  }

  // ── User Topics ─────────────────────────────────────────────────

  getUserTopics(userId: number): { concept: string; is_active: boolean }[] {
    return this.db.prepare(`SELECT concept, is_active FROM user_topics WHERE user_id = ?`).all(userId) as {
      concept: string;
      is_active: boolean;
    }[];
  }

  updateUserTopic(userId: number, concept: string, isActive: boolean): void {
    const cleanConcept = concept.replace(/^#/, "").trim().toLowerCase();
    if (!cleanConcept) return;
    this.db
      .prepare(
        `INSERT INTO user_topics (user_id, concept, is_active) VALUES (?, ?, ?) ON CONFLICT(user_id, concept) DO UPDATE SET is_active = excluded.is_active`,
      )
      .run(userId, cleanConcept, isActive ? 1 : 0);
  }

  deriveUserTopics(userId: number, force: boolean = false): void {
    if (!userId || userId <= 0) return;
    const now = Date.now();
    const lastDerived = this.#userTopicsDerivedAt.get(userId) ?? 0;
    if (!force && now - lastDerived < 5 * 60 * 1000) {
      return;
    }
    if (this.#userTopicsDerivedAt.size >= 5_000) {
      const oldestKey = this.#userTopicsDerivedAt.keys().next().value;
      if (oldestKey !== undefined) this.#userTopicsDerivedAt.delete(oldestKey);
    }
    this.#userTopicsDerivedAt.set(userId, now);

    // Derive topics from liked, bookmarked, and authored/reposted posts (if not explicitly inactive)
    this.db
      .prepare(
        `
      INSERT INTO user_topics (user_id, concept, is_active)
      SELECT DISTINCT ?, LOWER(t.concept), 1
      FROM (
        SELECT post_id FROM likes WHERE user_id = ?
        UNION
        SELECT post_id FROM bookmarks WHERE user_id = ?
        UNION
        SELECT id AS post_id FROM posts WHERE author_id = ?
        UNION
        SELECT repost_of_id AS post_id FROM posts WHERE author_id = ? AND repost_of_id IS NOT NULL
      ) engaged
      JOIN post_topics pt ON engaged.post_id = pt.post_id
      JOIN trending_topics t ON pt.topic_id = t.id
      ON CONFLICT(user_id, concept) DO NOTHING
    `,
      )
      .run(userId, userId, userId, userId, userId);

    // Seed from user's selected onboarding engineering_persona if present
    try {
      const userRow = this.db.prepare(`SELECT engineering_persona FROM users WHERE id = ?`).get(userId) as
        { engineering_persona?: string | null } | undefined;
      const persona = userRow?.engineering_persona?.trim();
      if (persona && PERSONA_SEED_TOPICS[persona]) {
        const insertStmt = this.db.prepare(
          `INSERT INTO user_topics (user_id, concept, is_active) VALUES (?, ?, 1) ON CONFLICT(user_id, concept) DO NOTHING`,
        );
        for (const t of PERSONA_SEED_TOPICS[persona]) {
          insertStmt.run(userId, t.concept.toLowerCase());
        }
      }
    } catch {
      // Optional user export/topic/Intl fallback ignored
    }
  }

  // ── Remote Actor & Federation Accounts ──────────────────────────

  getOrCreateRemoteUser(actorUrl: string, profileData?: RemoteActorProfile): { id: number } {
    const existing = this.db.prepare(`SELECT id FROM users WHERE actor_url = ?`).get(actorUrl) as
      { id: number } | undefined;
    if (existing) {
      if (profileData) {
        this.updateRemoteActorProfile(actorUrl, profileData);
      }
      return existing;
    }

    // Use preferredUsername or fallback
    const username = profileData?.preferredUsername || actorUrl.split("/").pop();
    const domain = new URL(actorUrl).hostname;
    // Create a unique username for remote to avoid collision with local
    const remoteUsername = `${username}@${domain}`;

    const rawPublicKey = profileData?.["publicKey"];
    const remotePublicKey =
      typeof rawPublicKey === "string"
        ? rawPublicKey
        : (rawPublicKey as { publicKeyPem?: string } | undefined)?.publicKeyPem || null;
    const sharedInbox =
      profileData?.endpoints?.sharedInbox || profileData?.sharedInbox || profileData?.endpoints?.shared_inbox || null;

    const discoverable = profileData?.["discoverable"] === false ? 0 : 1;
    const indexable = profileData?.["indexable"] === false ? 0 : 1;
    const locked = profileData?.["manuallyApprovesFollowers"] === true ? 1 : 0;
    const alsoKnownAs = Array.isArray(profileData?.["alsoKnownAs"]) ? JSON.stringify(profileData["alsoKnownAs"]) : "[]";
    const movedTo = typeof profileData?.["movedTo"] === "string" ? profileData["movedTo"] : null;
    const rawAttachments = Array.isArray(profileData?.["attachment"]) ? profileData["attachment"] : [];
    const profileFields: ProfileField[] = rawAttachments
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object" && a["type"] === "PropertyValue"))
      .map((a) => ({
        name: String(a["name"] || ""),
        value: String(a["value"] || ""),
        verified_at: typeof a["verified_at"] === "string" ? a["verified_at"] : null,
      }))
      .slice(0, 8);

    const displayName = sanitizeRemoteHtml(profileData?.name || username);
    const bio = sanitizeRemoteHtml(profileData?.summary || "");

    const result = this.db
      .prepare(
        `INSERT INTO users (username, email, account_type, display_name, bio, avatar_url, rsa_private_key, rsa_public_key, ed25519_private_key, ed25519_public_key, actor_url, inbox_url, outbox_url, remote_domain, shared_inbox_url, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        remoteUsername,
        `remote-${crypto.randomUUID()}@${domain}`, // fake email for unique constraint
        "remote",
        displayName,
        bio,
        profileData?.icon?.url || "",
        null,
        remotePublicKey,
        null,
        null,
        actorUrl,
        profileData?.inbox || `${actorUrl}/inbox`,
        profileData?.outbox || `${actorUrl}/outbox`,
        domain,
        sharedInbox,
        discoverable,
        indexable,
        locked,
        alsoKnownAs,
        movedTo,
        JSON.stringify(profileFields),
      );
    return { id: Number(result.lastInsertRowid) };
  }

  updateRemoteActorProfile(actorUrl: string, profileData: RemoteActorProfile): boolean {
    const existing = this.db
      .prepare(`SELECT id FROM users WHERE actor_url = ? AND (account_type = 'remote' OR remote_domain IS NOT NULL)`)
      .get(actorUrl) as { id: number } | undefined;
    if (!existing) return false;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (typeof profileData.name === "string") {
      updates.push("display_name = ?");
      params.push(sanitizeRemoteHtml(profileData.name));
    }
    if (typeof profileData.summary === "string") {
      updates.push("bio = ?");
      params.push(sanitizeRemoteHtml(profileData.summary));
    }
    if (profileData.icon?.url) {
      updates.push("avatar_url = ?");
      params.push(profileData.icon.url);
    }
    const imageObj = profileData["image"] as { url?: string } | undefined;
    if (imageObj?.url) {
      updates.push("banner_url = ?");
      params.push(imageObj.url);
    }
    if (typeof profileData.inbox === "string") {
      updates.push("inbox_url = ?");
      params.push(profileData.inbox);
    }
    const sharedInbox =
      profileData.endpoints?.sharedInbox || profileData.sharedInbox || profileData.endpoints?.shared_inbox;
    if (typeof sharedInbox === "string") {
      updates.push("shared_inbox_url = ?");
      params.push(sharedInbox);
    }
    if (typeof profileData["discoverable"] === "boolean") {
      updates.push("discoverable = ?");
      params.push(profileData["discoverable"] ? 1 : 0);
    }
    if (typeof profileData["indexable"] === "boolean") {
      updates.push("indexable = ?");
      params.push(profileData["indexable"] ? 1 : 0);
    }
    if (typeof profileData["manuallyApprovesFollowers"] === "boolean") {
      updates.push("locked = ?");
      params.push(profileData["manuallyApprovesFollowers"] ? 1 : 0);
    }
    if (Array.isArray(profileData["alsoKnownAs"])) {
      updates.push("also_known_as = ?");
      params.push(JSON.stringify(profileData["alsoKnownAs"].map(String)));
    }
    if (typeof profileData["movedTo"] === "string") {
      updates.push("moved_to_actor_url = ?");
      params.push(profileData["movedTo"]);
    }
    if (Array.isArray(profileData["attachment"])) {
      const profileFields: ProfileField[] = profileData["attachment"]
        .filter((a): a is Record<string, unknown> =>
          Boolean(a && typeof a === "object" && a["type"] === "PropertyValue"),
        )
        .map((a) => ({
          name: String(a["name"] || ""),
          value: String(a["value"] || ""),
          verified_at: typeof a["verified_at"] === "string" ? a["verified_at"] : null,
        }))
        .slice(0, 8);
      updates.push("profile_fields = ?");
      params.push(JSON.stringify(profileFields));
    }
    const pubKeyObj = profileData["publicKey"] as { publicKeyPem?: string } | undefined;
    if (typeof pubKeyObj?.publicKeyPem === "string") {
      updates.push("rsa_public_key = ?");
      params.push(pubKeyObj.publicKeyPem);
    }

    if (updates.length === 0) return false;
    params.push(existing.id);
    const res = this.db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return res.changes > 0;
  }

  // ── Instance & User Cryptographic Keys ──────────────────────────

  getInstanceKeys(): { publicKey: string; privateKey: string } {
    const existing = this.db.prepare(`SELECT value FROM settings WHERE key = 'instance_keys'`).get() as
      { value: string } | undefined;
    if (existing) {
      return JSON.parse(existing.value) as { publicKey: string; privateKey: string };
    }
    const keys = generateRSAKeys();
    this.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run("instance_keys", JSON.stringify(keys));
    return keys;
  }

  getInstanceEd25519Keys(): { publicKey: string; privateKey: string } {
    const existing = this.db.prepare(`SELECT value FROM settings WHERE key = 'instance_ed25519_keys'`).get() as
      { value: string } | undefined;
    if (existing) {
      return JSON.parse(existing.value) as { publicKey: string; privateKey: string };
    }
    const keys = generateEd25519Keys();
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`)
      .run("instance_ed25519_keys", JSON.stringify(keys));
    return keys;
  }

  getInstanceVapidKeys(): { publicKey: string; privateKey: string } {
    if (process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"]) {
      return {
        publicKey: process.env["VAPID_PUBLIC_KEY"],
        privateKey: process.env["VAPID_PRIVATE_KEY"],
      };
    }
    const existing = this.db.prepare(`SELECT value FROM settings WHERE key = 'instance_vapid_keys'`).get() as
      { value: string } | undefined;
    if (existing) {
      return JSON.parse(existing.value) as { publicKey: string; privateKey: string };
    }
    const keys = webpush.generateVAPIDKeys();
    this.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run("instance_vapid_keys", JSON.stringify(keys));
    return keys;
  }

  ensureUserRSAKeys(userId: number): { publicKey: string; privateKey: string } {
    const user = this.db.prepare(`SELECT rsa_private_key, rsa_public_key FROM users WHERE id = ?`).get(userId) as
      { rsa_private_key?: string | null | undefined; rsa_public_key?: string | null | undefined } | undefined;
    if (user?.rsa_private_key && user?.rsa_public_key) {
      return { privateKey: user.rsa_private_key, publicKey: user.rsa_public_key };
    }
    const keys = generateRSAKeys();
    this.db
      .prepare(`UPDATE users SET rsa_private_key = ?, rsa_public_key = ? WHERE id = ?`)
      .run(keys.privateKey, keys.publicKey, userId);
    return keys;
  }

  getUserFederationInfo(userId: number): UserFederationInfo | undefined {
    const row = this.db
      .prepare(
        `SELECT id, actor_url, inbox_url, outbox_url, remote_domain, rsa_public_key, rsa_private_key, ed25519_public_key, ed25519_private_key, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility, signing_verified, signing_policy_strict FROM users WHERE id = ?`,
      )
      .get(userId) as UserFederationInfo | undefined;
    if (!row) return undefined;
    if (!row.rsa_private_key || !row.rsa_public_key) {
      const keys = this.ensureUserRSAKeys(userId);
      row.rsa_private_key = keys.privateKey;
      row.rsa_public_key = keys.publicKey;
    }
    return row;
  }

  getRemoteFollowersInboxes(authorId: number): {
    inbox_url: string;
    shared_inbox_url?: string | null | undefined;
    remote_domain?: string | null | undefined;
  }[] {
    return this.db
      .prepare(
        `SELECT u.inbox_url, u.shared_inbox_url, u.remote_domain FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ? AND u.remote_domain IS NOT NULL AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(authorId) as {
      inbox_url: string;
      shared_inbox_url?: string | null | undefined;
      remote_domain?: string | null | undefined;
    }[];
  }

  // ── Account Creation, Verification & GDPR ───────────────────────

  createUser(
    username: string,
    email: string,
    passwordHash: string | null,
    options?: {
      emailVerified?: boolean | undefined;
      initialCredits?: number | undefined;
      termsAcceptedAt?: string | undefined;
      registrationIp?: string | undefined;
      status?: string | undefined;
      accountType?: string | undefined;
    },
  ): {
    id: number;
    username: string;
    email: string;
    account_type?: string | undefined;
    email_verified?: number | undefined;
    credit_balance?: number | undefined;
    status?: string | undefined;
    token_version?: number | undefined;
  } {
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const avatarUrl = "";
    const bannerUrl = "";

    const edKeys = generateEd25519Keys();
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/users/${cleanUsername}`;
    const inboxUrl = `${actorUrl}/inbox`;
    const outboxUrl = `${actorUrl}/outbox`;

    const accountType = options?.accountType || "user";
    const emailVerified = options?.emailVerified !== undefined ? (options.emailVerified ? 1 : 0) : 1;
    const status = options?.status || (emailVerified ? "active" : "pending_verification");
    const termsAcceptedAt = options?.termsAcceptedAt || null;
    const registrationIp = options?.registrationIp || null;
    const initialCredits = options?.initialCredits !== undefined ? options.initialCredits : emailVerified ? 100.0 : 0.0;

    const result = this.db
      .prepare(
        `INSERT INTO users (username, email, password_hash, account_type, avatar_url, banner_url, rsa_private_key, rsa_public_key, ed25519_private_key, ed25519_public_key, actor_url, inbox_url, outbox_url, credit_balance, email_verified, status, terms_accepted_at, registration_ip, token_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        cleanUsername,
        cleanEmail,
        passwordHash,
        accountType,
        avatarUrl,
        bannerUrl,
        null,
        null,
        edKeys.privateKey,
        edKeys.publicKey,
        actorUrl,
        inboxUrl,
        outboxUrl,
        initialCredits,
        emailVerified,
        status,
        termsAcceptedAt,
        registrationIp,
      );
    const userId = result.lastInsertRowid as number;
    if (initialCredits > 0) {
      try {
        this.db
          .prepare(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
             VALUES (?, NULL, ?, ?, 'initial_grant', 'Initial Welcome bonus compute credits')`,
          )
          .run(userId, initialCredits, initialCredits);
      } catch {
        // Non-fatal if table not yet initialized
      }
    }
    return {
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      account_type: accountType,
      email_verified: emailVerified,
      credit_balance: initialCredits,
      status,
      token_version: 1,
    };
  }

  verifyUserEmail(
    userId: number,
    bonusCredits = 50.0,
  ): { success: boolean; creditsGranted: number; user?: UserRow | undefined } {
    const tx = this.db.transaction(() => {
      const user = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
      if (!user) {
        return { success: false, creditsGranted: 0 };
      }

      if (user.email_verified === 1) {
        return { success: true, creditsGranted: 0, user };
      }

      const existingGrant = this.db
        .prepare(`SELECT id FROM credit_transactions WHERE user_id = ? AND type = 'initial_grant'`)
        .get(userId);

      let creditsToGrant = 0;
      let newBalance = user.credit_balance || 0;

      if (!existingGrant && bonusCredits > 0) {
        creditsToGrant = bonusCredits;
        newBalance += creditsToGrant;
      }

      const updateRes = this.db
        .prepare(
          `UPDATE users
           SET email_verified = 1,
               status = CASE WHEN status IN ('suspended', 'banned', 'frozen', 'suspended_dispute', 'deleted') THEN status ELSE 'active' END,
               credit_balance = ?
           WHERE id = ? AND COALESCE(email_verified, 0) = 0`,
        )
        .run(newBalance, userId);

      if (updateRes.changes === 0) {
        const current = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
        return { success: true, creditsGranted: 0, user: current };
      }

      if (creditsToGrant > 0) {
        try {
          this.db
            .prepare(
              `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
               VALUES (?, NULL, ?, ?, 'initial_grant', 'Free tier activation compute credits')`,
            )
            .run(userId, creditsToGrant, newBalance);
        } catch {
          // ignore
        }
      }

      const updatedUser = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
      return { success: true, creditsGranted: creditsToGrant, user: updatedUser };
    });

    return tx();
  }

  /**
   * GDPR Article 17: Right to Erasure / Account Anonymization
   * Redacts personal data, deletes session tokens and social links, and flags account as deleted.
   */
  anonymizeUser(userId: number): { success: boolean; actorUrl?: string | undefined } {
    const user = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
    if (!user) {
      return { success: false };
    }

    const actorUrl = user.actor_url ?? undefined;
    const redactedEmail = `deleted_${userId}@deleted.modelscript.local`;
    const redactedName = `Deleted User #${userId}`;
    const redactedBio = "This account has been deleted pursuant to GDPR Article 17 Right to Erasure.";

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE users 
           SET email = ?,
               username = 'deleted_' || id,
               display_name = ?,
               bio = ?,
               avatar_url = NULL,
               banner_url = NULL,
               password_hash = 'REDACTED',
               status = 'deleted',
               registration_ip = NULL,
               credit_balance = 0,
               token_version = COALESCE(token_version, 1) + 1,
               totp_secret = NULL,
               totp_enabled = 0,
               backup_codes = NULL,
               rsa_private_key = NULL,
               rsa_public_key = NULL,
               ed25519_private_key = NULL,
               ed25519_public_key = NULL
           WHERE id = ?`,
        )
        .run(redactedEmail, redactedName, redactedBio, userId);

      const safeDelete = (sql: string, ...args: unknown[]): void => {
        try {
          this.db.prepare(sql).run(...args);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("no such table") && !msg.includes("no such column")) {
            throw err;
          }
        }
      };

      safeDelete(`DELETE FROM users WHERE owner_id = ? AND account_type = 'bot'`, userId);
      safeDelete(`DELETE FROM api_tokens WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM pending_totp_secrets WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM oauth_accounts WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM user_public_keys WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM bookmarks WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM likes WHERE user_id = ?`, userId);
      safeDelete(`DELETE FROM follows WHERE follower_id = ? OR following_id = ?`, userId, userId);
      safeDelete(`DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`, userId, userId);
      safeDelete(`DELETE FROM user_mutes WHERE muter_id = ? OR muted_id = ?`, userId, userId);
      safeDelete(`DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?`, userId, userId);

      this.facade.logAudit({
        actorId: userId,
        action: "user_account_deleted_gdpr",
        resourceType: "user",
        resourceId: String(userId),
        details: { reason: "GDPR Article 17 Right to Erasure request executed" },
      });
    })();

    return { success: true, actorUrl };
  }

  /**
   * GDPR Article 20: Right to Data Portability
   * Returns a complete machine-readable bundle of all user profile, post, library, and billing data.
   */
  exportUserData(userId: number): Record<string, unknown> | null {
    const user = this.db
      .prepare(
        `SELECT id, username, email, display_name, bio, actor_url, status, credit_balance, created_at FROM users WHERE id = ?`,
      )
      .get(userId) as UserRow | undefined;
    if (!user) return null;

    let posts: Record<string, unknown>[] = [];
    try {
      posts = this.db.prepare(`SELECT id, content, created_at FROM posts WHERE author_id = ?`).all(userId) as Record<
        string,
        unknown
      >[];
    } catch {
      // Optional user export/topic/Intl fallback ignored
    }

    let libraries: Record<string, unknown>[] = [];
    try {
      libraries = this.db
        .prepare(
          `SELECT p.name, pv.version, pv.published_at as created_at
           FROM package_versions pv
           JOIN packages p ON pv.package_id = p.id
           WHERE pv.published_by = ?`,
        )
        .all(userId) as Record<string, unknown>[];
    } catch {
      // Optional user export/topic/Intl fallback ignored
    }

    let transactions: Record<string, unknown>[] = [];
    try {
      transactions = this.db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as Record<string, unknown>[];
    } catch {
      // Optional user export/topic/Intl fallback ignored
    }

    let auditHistory: Record<string, unknown>[] = [];
    try {
      auditHistory = this.db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 100`,
        )
        .all(userId) as Record<string, unknown>[];
    } catch {
      // Optional user export/topic/Intl fallback ignored
    }

    return {
      exportedAt: new Date().toISOString(),
      regulation: "GDPR Article 20 / CCPA Data Portability Export",
      profile: user,
      posts,
      libraries,
      billingHistory: transactions,
      auditHistory,
    };
  }

  getAllUsers(): {
    id: number;
    username: string;
    email: string;
    display_name?: string | undefined;
    account_type: string;
    status: string;
    created_at: string;
    branch_tip_oid?: string | null | undefined;
  }[] {
    return this.db
      .prepare(
        `SELECT id, username, email, display_name, account_type, status, created_at, branch_tip_oid FROM users WHERE status != 'deleted' ORDER BY id ASC`,
      )
      .all() as {
      id: number;
      username: string;
      email: string;
      display_name?: string | undefined;
      account_type: string;
      status: string;
      created_at: string;
      branch_tip_oid?: string | null | undefined;
    }[];
  }

  getTotalPostsCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM posts`).get() as { count: number };
    return row?.count ?? 0;
  }

  // ── Profiles, Username History & Account Locations ──────────────

  getFullProfileByUsername(username: string): UserRow | undefined {
    return this.db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url, u.location, u.website, u.created_at, u.account_type, u.owner_id,
        u.actor_url, u.remote_domain,
        COALESCE(u.discoverable, 1) as discoverable,
        COALESCE(u.indexable, 1) as indexable,
        COALESCE(u.locked, 0) as locked,
        COALESCE(u.also_known_as, '[]') as also_known_as,
        u.moved_to_actor_url,
        COALESCE(u.profile_fields, '[]') as profile_fields,
        COALESCE(u.default_post_visibility, 'public') as default_post_visibility,
        COALESCE(u.signing_verified, 0) as signing_verified,
        COALESCE(u.signing_policy_strict, 0) as signing_policy_strict,
        (SELECT username FROM users WHERE id = u.owner_id) as owner_username,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id AND (state = 'accepted' OR state IS NULL)) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id AND (state = 'accepted' OR state IS NULL)) as following_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
      FROM users u WHERE u.username = ?
    `,
      )
      .get(username) as UserRow | undefined;
  }

  updateProfile(
    userId: number,
    profile: {
      display_name?: string | undefined;
      bio?: string | undefined;
      location?: string | undefined;
      website?: string | undefined;
      avatar_url?: string | undefined;
      banner_url?: string | undefined;
      discoverable?: boolean | number | undefined;
      indexable?: boolean | number | undefined;
      locked?: boolean | number | undefined;
      also_known_as?: string | string[] | undefined;
      moved_to_actor_url?: string | null | undefined;
      profile_fields?: string | ProfileField[] | undefined;
      default_post_visibility?: PostVisibility | string | undefined;
    },
  ): void {
    const ALLOWED_PROFILE_COLUMNS = new Set([
      "display_name",
      "bio",
      "location",
      "website",
      "avatar_url",
      "banner_url",
      "discoverable",
      "indexable",
      "locked",
      "also_known_as",
      "moved_to_actor_url",
      "profile_fields",
      "default_post_visibility",
    ]);
    const fields = Object.entries(profile).filter(([k, v]) => ALLOWED_PROFILE_COLUMNS.has(k) && v !== undefined);
    if (fields.length === 0) return;
    const setClause = fields.map(([k]) => `${k} = ?`).join(", ");
    const values = fields.map(([k, v]) => {
      if (k === "discoverable" || k === "indexable" || k === "locked") {
        return v ? 1 : 0;
      }
      if ((k === "also_known_as" || k === "profile_fields") && typeof v !== "string") {
        return JSON.stringify(v);
      }
      return v;
    });
    this.db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, userId);
  }

  updateAccount(
    userId: number,
    usernameOrUpdates: string | { username?: string; email?: string },
    maybeEmail?: string,
  ): void {
    let username: string | undefined;
    let email: string | undefined;
    if (typeof usernameOrUpdates === "object" && usernameOrUpdates !== null) {
      username = usernameOrUpdates.username;
      email = usernameOrUpdates.email;
    } else {
      username = usernameOrUpdates;
      email = maybeEmail;
    }
    const existing = this.db.prepare(`SELECT username, email FROM users WHERE id = ?`).get(userId) as
      { username: string; email: string } | undefined;
    if (!existing) return;

    const trimmedUsername = (username !== undefined ? username : existing.username).trim();
    const trimmedEmail = (email !== undefined ? email : existing.email).trim().toLowerCase();

    if (existing.username && existing.username !== trimmedUsername) {
      this.recordUsernameChange(userId, existing.username, trimmedUsername);
    }
    this.db.prepare(`UPDATE users SET username = ?, email = ? WHERE id = ?`).run(trimmedUsername, trimmedEmail, userId);
  }

  recordUsernameChange(userId: number, oldUsername: string, newUsername: string): void {
    if (!userId || !oldUsername || !newUsername || oldUsername === newUsername) return;
    try {
      this.db
        .prepare(
          `INSERT INTO username_history (user_id, old_username, new_username, changed_at) VALUES (?, ?, ?, datetime('now'))`,
        )
        .run(userId, oldUsername.trim(), newUsername.trim());
    } catch (err) {
      console.error("Failed to record username change:", err);
    }
  }

  getUsernameChanges(userId: number): {
    count: number;
    lastChangedAt: string | null;
    history: { oldUsername: string; newUsername: string; changedAt: string }[];
  } {
    try {
      const rows = this.db
        .prepare(
          `SELECT old_username, new_username, changed_at FROM username_history WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as { old_username: string; new_username: string; changed_at: string }[];

      return {
        count: rows.length,
        lastChangedAt: rows.length > 0 ? rows[0]!.changed_at : null,
        history: rows.map((r) => ({
          oldUsername: r.old_username,
          old_username: r.old_username,
          newUsername: r.new_username,
          new_username: r.new_username,
          changedAt: r.changed_at,
          changed_at: r.changed_at,
        })),
      };
    } catch {
      return { count: 0, lastChangedAt: null, history: [] };
    }
  }

  recordUserLocationRequest(
    userId: number,
    countryCode: string,
    regionCode?: string | null,
    thresholdN: number = 5,
  ): { changed: boolean; confirmedCountry: string | null; confirmedCountryCode: string | null } {
    if (!userId || !countryCode || countryCode.length !== 2) {
      return { changed: false, confirmedCountry: null, confirmedCountryCode: null };
    }
    const cleanCountry = countryCode.trim().toUpperCase();
    if (cleanCountry === "XX" || cleanCountry === "T1") {
      return { changed: false, confirmedCountry: null, confirmedCountryCode: null };
    }

    const now = new Date().toISOString();
    interface UserLocationRecord {
      confirmed_country_code?: string | null;
      confirmed_region_code?: string | null;
      candidate_country_code?: string | null;
      candidate_region_code?: string | null;
      candidate_streak?: number;
    }
    const row = this.db.prepare(`SELECT * FROM user_account_locations WHERE user_id = ?`).get(userId) as
      UserLocationRecord | undefined;

    if (!row) {
      this.db
        .prepare(
          `INSERT INTO user_account_locations (
            user_id, confirmed_country_code, confirmed_region_code,
            candidate_country_code, candidate_region_code, candidate_streak,
            candidate_first_seen_at, candidate_last_seen_at,
            total_requests, last_request_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, 0, NULL, NULL, 1, ?, ?)`,
        )
        .run(userId, cleanCountry, regionCode || null, now, now);
      return { changed: true, confirmedCountry: cleanCountry, confirmedCountryCode: cleanCountry };
    }

    const confirmed = row.confirmed_country_code;

    if (!confirmed) {
      this.db
        .prepare(
          `UPDATE user_account_locations SET
            confirmed_country_code = ?,
            confirmed_region_code = ?,
            candidate_country_code = NULL,
            candidate_region_code = NULL,
            candidate_streak = 0,
            total_requests = total_requests + 1,
            last_request_at = ?,
            updated_at = ?
          WHERE user_id = ?`,
        )
        .run(cleanCountry, regionCode || null, now, now, userId);
      return { changed: true, confirmedCountry: cleanCountry, confirmedCountryCode: cleanCountry };
    }

    if (cleanCountry === confirmed) {
      this.db
        .prepare(
          `UPDATE user_account_locations SET
            candidate_country_code = NULL,
            candidate_region_code = NULL,
            candidate_streak = 0,
            candidate_first_seen_at = NULL,
            candidate_last_seen_at = NULL,
            total_requests = total_requests + 1,
            last_request_at = ?
          WHERE user_id = ?`,
        )
        .run(now, userId);
      return { changed: false, confirmedCountry: confirmed, confirmedCountryCode: confirmed };
    }

    const candidateCountry = row.candidate_country_code;
    let candidateStreak = Number(row.candidate_streak || 0);

    if (candidateCountry === cleanCountry) {
      candidateStreak += 1;
      if (candidateStreak >= thresholdN) {
        this.db
          .prepare(
            `UPDATE user_account_locations SET
              confirmed_country_code = ?,
              confirmed_region_code = ?,
              candidate_country_code = NULL,
              candidate_region_code = NULL,
              candidate_streak = 0,
              candidate_first_seen_at = NULL,
              candidate_last_seen_at = NULL,
              total_requests = total_requests + 1,
              last_request_at = ?,
              updated_at = ?
            WHERE user_id = ?`,
          )
          .run(cleanCountry, regionCode || null, now, now, userId);
        return { changed: true, confirmedCountry: cleanCountry, confirmedCountryCode: cleanCountry };
      } else {
        this.db
          .prepare(
            `UPDATE user_account_locations SET
              candidate_streak = ?,
              candidate_last_seen_at = ?,
              total_requests = total_requests + 1,
              last_request_at = ?
            WHERE user_id = ?`,
          )
          .run(candidateStreak, now, now, userId);
        return { changed: false, confirmedCountry: confirmed, confirmedCountryCode: confirmed };
      }
    } else {
      this.db
        .prepare(
          `UPDATE user_account_locations SET
            candidate_country_code = ?,
            candidate_region_code = ?,
            candidate_streak = 1,
            candidate_first_seen_at = ?,
            candidate_last_seen_at = ?,
            total_requests = total_requests + 1,
            last_request_at = ?
          WHERE user_id = ?`,
        )
        .run(cleanCountry, regionCode || null, now, now, now, userId);
      return { changed: false, confirmedCountry: confirmed, confirmedCountryCode: confirmed };
    }
  }

  getUserAccountLocation(userId: number): {
    countryCode: string | null;
    countryName: string | null;
    regionCode: string | null;
    updatedAt: string | null;
  } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT confirmed_country_code, confirmed_region_code, updated_at FROM user_account_locations WHERE user_id = ?`,
        )
        .get(userId) as
        | { confirmed_country_code?: string | null; confirmed_region_code?: string | null; updated_at?: string | null }
        | undefined;
      if (!row || !row.confirmed_country_code) return null;
      let countryName = row.confirmed_country_code;
      try {
        const dn = new Intl.DisplayNames(["en"], { type: "region" });
        countryName = dn.of(row.confirmed_country_code) || row.confirmed_country_code;
      } catch {
        // Optional user export/topic/Intl fallback ignored
      }
      return {
        countryCode: row.confirmed_country_code,
        countryName,
        regionCode: row.confirmed_region_code || null,
        updatedAt: row.updated_at || null,
      };
    } catch {
      return null;
    }
  }

  // ── Social Graph, Blocks/Mutes & Suggestions ────────────────────

  followUser(followerId: number, followingId: number, state: "pending" | "accepted" = "accepted"): void {
    try {
      this.db
        .prepare(
          `INSERT INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)
           ON CONFLICT(follower_id, following_id) DO UPDATE SET state = excluded.state`,
        )
        .run(followerId, followingId, state);
    } catch {
      // ignore unique constraint
    }
  }

  unfollowUser(followerId: number, followingId: number): void {
    this.db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`).run(followerId, followingId);
  }

  isFollowing(followerId: number, followingId: number): boolean {
    const res = this.db
      .prepare(
        `SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND (state = 'accepted' OR state IS NULL)`,
      )
      .get(followerId, followingId);
    return !!res;
  }

  hasPendingFollowRequest(followerId: number, followingId: number): boolean {
    const res = this.db
      .prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND state = 'pending'`)
      .get(followerId, followingId);
    return !!res;
  }

  getUserFollowers(userId: number, currentUserId?: number): UserRow[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain, u.inbox_url,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id AND (state = 'accepted' OR state IS NULL)) as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain, u.inbox_url,
          0 as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.db.prepare(query).all(currentUserId, userId) as UserRow[])
      : (this.db.prepare(query).all(userId) as UserRow[]);
  }

  getUserFollowing(userId: number, currentUserId?: number): UserRow[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id AND (state = 'accepted' OR state IS NULL)) as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain,
          0 as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.db.prepare(query).all(currentUserId, userId) as UserRow[])
      : (this.db.prepare(query).all(userId) as UserRow[]);
  }

  getBlockedUsersDetailed(userId: number): {
    id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    remote_domain: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.remote_domain, b.created_at
         FROM user_blocks b
         JOIN users u ON b.blocked_id = u.id
         WHERE b.blocker_id = ?
         ORDER BY b.created_at DESC`,
      )
      .all(userId) as {
      id: number;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      remote_domain: string | null;
      created_at: string;
    }[];
  }

  getMutedUsersDetailed(userId: number): {
    id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    remote_domain: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.remote_domain, m.created_at
         FROM user_mutes m
         JOIN users u ON m.muted_id = u.id
         WHERE m.muter_id = ?
         ORDER BY m.created_at DESC`,
      )
      .all(userId) as {
      id: number;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      remote_domain: string | null;
      created_at: string;
    }[];
  }

  getUserSuggestions(
    userId?: number,
    limit: number = 3,
  ): (UserRow & {
    recommendation_reason?: string | null | undefined;
    mutual_followers_count?: number | undefined;
    shared_topics_count?: number | undefined;
  })[] {
    if (userId) {
      try {
        this.deriveUserTopics(userId);
      } catch {
        // Optional user export/topic/Intl fallback ignored
      }

      const rows = this.db
        .prepare(
          `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.bio,
          u.engineering_persona,
          (
            SELECT COUNT(DISTINCT f1.following_id)
            FROM follows f1
            JOIN follows f2 ON f1.following_id = f2.follower_id
            WHERE f1.follower_id = ?
              AND f2.following_id = u.id
              AND (f1.state = 'accepted' OR f1.state IS NULL)
              AND (f2.state = 'accepted' OR f2.state IS NULL)
          ) as mutual_followers_count,
          (
            SELECT u_m.username
            FROM follows f1
            JOIN follows f2 ON f1.following_id = f2.follower_id
            JOIN users u_m ON u_m.id = f1.following_id
            WHERE f1.follower_id = ?
              AND f2.following_id = u.id
              AND (f1.state = 'accepted' OR f1.state IS NULL)
              AND (f2.state = 'accepted' OR f2.state IS NULL)
            LIMIT 1
          ) as first_mutual_username,
          (
            SELECT COUNT(DISTINCT LOWER(ut.concept))
            FROM user_topics ut
            WHERE ut.user_id = ?
              AND ut.is_active = 1
              AND (
                EXISTS (
                  SELECT 1 FROM user_topics ut2
                  WHERE ut2.user_id = u.id AND ut2.is_active = 1 AND LOWER(ut2.concept) = LOWER(ut.concept)
                )
                OR EXISTS (
                  SELECT 1 FROM posts p
                  JOIN post_topics pt ON pt.post_id = p.id
                  JOIN trending_topics t ON t.id = pt.topic_id
                  WHERE p.author_id = u.id AND LOWER(t.concept) = LOWER(ut.concept)
                )
              )
          ) as shared_topics_count,
          (
            SELECT ut.concept
            FROM user_topics ut
            WHERE ut.user_id = ?
              AND ut.is_active = 1
              AND (
                EXISTS (
                  SELECT 1 FROM user_topics ut2
                  WHERE ut2.user_id = u.id AND ut2.is_active = 1 AND LOWER(ut2.concept) = LOWER(ut.concept)
                )
                OR EXISTS (
                  SELECT 1 FROM posts p
                  JOIN post_topics pt ON pt.post_id = p.id
                  JOIN trending_topics t ON t.id = pt.topic_id
                  WHERE p.author_id = u.id AND LOWER(t.concept) = LOWER(ut.concept)
                )
              )
            LIMIT 1
          ) as top_shared_topic,
          CASE
            WHEN u.engineering_persona IS NOT NULL
              AND u.engineering_persona = (SELECT engineering_persona FROM users WHERE id = ?)
            THEN 1
            ELSE 0
          END as persona_match,
          (SELECT COUNT(*) FROM follows WHERE following_id = u.id AND (state = 'accepted' OR state IS NULL)) as follower_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND reply_to_id IS NULL AND COALESCE(visibility, 'public') = 'public') as post_count
        FROM users u
        WHERE u.id != ?
          AND COALESCE(u.discoverable, 1) = 1
          AND COALESCE(u.status, 'active') = 'active'
          AND COALESCE(u.account_type, 'user') != 'rss'
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
          AND u.id NOT IN (SELECT muted_id FROM user_mutes WHERE muter_id = ?)
          AND u.id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND u.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY
          (
            mutual_followers_count * 18 +
            shared_topics_count * 10 +
            persona_match * 14 +
            MIN(follower_count, 50) * 2 +
            MIN(post_count, 20) * 1
          ) DESC,
          follower_count DESC,
          u.id ASC
        LIMIT ?
      `,
        )
        .all(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, limit) as (UserRow & {
        engineering_persona?: string | null;
        mutual_followers_count: number;
        first_mutual_username?: string | null;
        shared_topics_count: number;
        top_shared_topic?: string | null;
        persona_match: number;
        follower_count: number;
        post_count: number;
      })[];

      const personaLabels: Record<string, string> = {
        physical_systems: "Physical Systems",
        systems_engineering: "Systems Engineering",
        computational_cad: "CAD & CAE",
        scientific_research: "Scientific Computing",
      };

      return rows.map((r) => {
        let reason: string | null = null;
        if (r.mutual_followers_count > 1 && r.first_mutual_username) {
          reason = `Followed by @${r.first_mutual_username} + ${r.mutual_followers_count - 1} more`;
        } else if (r.mutual_followers_count === 1 && r.first_mutual_username) {
          reason = `Followed by @${r.first_mutual_username}`;
        } else if (r.shared_topics_count > 0 && r.top_shared_topic) {
          reason = `Active in #${r.top_shared_topic}`;
        } else if (r.persona_match && r.engineering_persona) {
          reason = `${personaLabels[r.engineering_persona] || "Engineering"} peer`;
        } else if (r.follower_count > 0) {
          reason = `${r.follower_count} ${r.follower_count === 1 ? "follower" : "followers"}`;
        }
        return {
          ...r,
          recommendation_reason: reason,
        };
      });
    } else {
      return this.db
        .prepare(
          `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.bio,
          (SELECT COUNT(*) FROM follows WHERE following_id = u.id AND (state = 'accepted' OR state IS NULL)) as follower_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND reply_to_id IS NULL AND COALESCE(visibility, 'public') = 'public') as post_count
        FROM users u
        WHERE COALESCE(u.discoverable, 1) = 1
          AND COALESCE(u.status, 'active') = 'active'
          AND COALESCE(u.account_type, 'user') != 'rss'
        ORDER BY (MIN(follower_count, 50) * 3 + MIN(post_count, 20) * 2) DESC, u.id ASC
        LIMIT ?
      `,
        )
        .all(limit) as UserRow[];
    }
  }

  // ── Public Keys ─────────────────────────────────────────────────

  getPublicKeysForUser(userId: number): {
    id: number;
    key_id_string: string;
    public_key_pem: string;
    device_name: string | null;
    created_at: string;
    is_active: number;
  }[] {
    return this.db
      .prepare(
        `SELECT id, key_id_string, public_key_pem, device_name, created_at, is_active FROM user_public_keys WHERE user_id = ? AND is_active = 1`,
      )
      .all(userId) as {
      id: number;
      key_id_string: string;
      public_key_pem: string;
      device_name: string | null;
      created_at: string;
      is_active: number;
    }[];
  }

  addPublicKeyForUser(userId: number, keyIdString: string, publicKeyPem: string, deviceName?: string): { id: number } {
    const res = this.db
      .prepare(`INSERT INTO user_public_keys (user_id, key_id_string, public_key_pem, device_name) VALUES (?, ?, ?, ?)`)
      .run(userId, keyIdString, publicKeyPem, deviceName ?? null);
    return { id: Number(res.lastInsertRowid) };
  }

  revokePublicKey(userId: number, keyId: number): void {
    this.db.prepare(`UPDATE user_public_keys SET is_active = 0 WHERE id = ? AND user_id = ?`).run(keyId, userId);
  }
}
