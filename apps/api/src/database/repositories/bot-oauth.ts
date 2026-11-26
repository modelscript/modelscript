// SPDX-License-Identifier: AGPL-3.0-or-later

import { decryptSecretAtRest, encryptSecretAtRest } from "../../util/totp.js";
import { BaseRepository } from "./base.js";
import { generateRSAKeys } from "./user-lifecycle.js";

export class BotOAuthRepository extends BaseRepository {
  // ── Bots & Bot Mention Queue ────────────────────────────────────

  createBot(
    ownerId: number,
    username: string,
    displayName: string,
    bio: string,
    avatarUrl: string,
    tokenHash: string,
    scopes: string = "social:read,social:write",
    systemPrompt: string = "",
    model: string = "gemini-1.5-flash",
    apiKey: string = "",
    endpointUrl: string = "",
  ): {
    id: number;
    username: string;
    display_name: string;
    bio: string;
    avatar_url: string;
    bot_model: string;
    bot_endpoint_url: string;
    bot_system_prompt: string;
    bot_scopes: string;
    has_api_key: boolean;
    has_bot_api_key: boolean;
    bot_last_used_at: string | null;
    created_at: string;
  } {
    const email = `${username}@bots.modelscript.org`; // dummy email for bots
    const resolvedAvatarUrl =
      avatarUrl ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || username)}&background=random&color=fff`;
    const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

    const keys = generateRSAKeys();
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/users/${username}`;
    const inboxUrl = `${actorUrl}/inbox`;
    const outboxUrl = `${actorUrl}/outbox`;

    const result = this.db
      .prepare(
        `INSERT INTO users (username, email, display_name, bio, avatar_url, banner_url, account_type, owner_id, bot_token_hash, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, rsa_private_key, rsa_public_key, actor_url, inbox_url, outbox_url) VALUES (?, ?, ?, ?, ?, ?, 'bot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        username,
        email,
        displayName,
        bio,
        resolvedAvatarUrl,
        bannerUrl,
        ownerId,
        tokenHash,
        scopes,
        systemPrompt,
        model,
        apiKey ? encryptSecretAtRest(apiKey) : null,
        endpointUrl,
        keys.privateKey,
        keys.publicKey,
        actorUrl,
        inboxUrl,
        outboxUrl,
      );
    const id = Number(result.lastInsertRowid);
    const createdRow = this.db.prepare(`SELECT created_at FROM users WHERE id = ?`).get(id) as
      { created_at: string } | undefined;
    const hasApiKey = Boolean(apiKey);

    return {
      id,
      username,
      display_name: displayName,
      bio,
      avatar_url: resolvedAvatarUrl,
      bot_model: model,
      bot_endpoint_url: endpointUrl,
      bot_system_prompt: systemPrompt,
      bot_scopes: scopes,
      has_api_key: hasApiKey,
      has_bot_api_key: hasApiKey,
      bot_last_used_at: null,
      created_at: createdRow?.created_at ?? new Date().toISOString(),
    };
  }

  getUserBots(ownerId: number): {
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes?: string | undefined;
    bot_system_prompt?: string | undefined;
    bot_model?: string | undefined;
    bot_api_key?: string | undefined;
    bot_endpoint_url?: string | undefined;
    bot_last_used_at?: string | undefined;
    created_at: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT id, username, display_name, avatar_url, bio, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, bot_last_used_at, created_at FROM users WHERE owner_id = ? AND account_type = 'bot' ORDER BY created_at DESC`,
      )
      .all(ownerId) as {
      id: number;
      username: string;
      display_name: string;
      avatar_url: string;
      bio: string;
      bot_scopes?: string | undefined;
      bot_system_prompt?: string | undefined;
      bot_model?: string | undefined;
      bot_api_key?: string | undefined;
      bot_endpoint_url?: string | undefined;
      bot_last_used_at?: string | undefined;
      created_at: string;
    }[];
    return rows.map((r) => ({
      ...r,
      bot_api_key: r.bot_api_key ? decryptSecretAtRest(r.bot_api_key) : undefined,
    }));
  }

  getBotById(botId: number): {
    id: number;
    owner_id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes: string;
    bot_system_prompt: string;
    bot_model: string;
    bot_api_key: string | null;
    bot_endpoint_url: string | null;
    bot_last_used_at: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, owner_id, username, display_name, avatar_url, bio, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, bot_last_used_at FROM users WHERE id = ? AND account_type = 'bot'`,
      )
      .get(botId) as
      | {
          id: number;
          owner_id: number;
          username: string;
          display_name: string;
          avatar_url: string;
          bio: string;
          bot_scopes: string;
          bot_system_prompt: string;
          bot_model: string;
          bot_api_key: string | null;
          bot_endpoint_url: string | null;
          bot_last_used_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      ...row,
      bot_api_key: row.bot_api_key ? decryptSecretAtRest(row.bot_api_key) : null,
    };
  }

  updateBotSettings(
    ownerId: number,
    botId: number,
    updates: {
      displayName?: string | undefined;
      bio?: string | undefined;
      avatarUrl?: string | undefined;
      scopes?: string | undefined;
      systemPrompt?: string | undefined;
      model?: string | undefined;
      apiKey?: string | undefined;
      endpointUrl?: string | undefined;
    },
  ): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    if (updates.displayName !== undefined) {
      fields.push("display_name = ?");
      values.push(updates.displayName);
    }
    if (updates.bio !== undefined) {
      fields.push("bio = ?");
      values.push(updates.bio);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(updates.avatarUrl);
    }
    if (updates.scopes !== undefined) {
      fields.push("bot_scopes = ?");
      values.push(updates.scopes);
    }
    if (updates.systemPrompt !== undefined) {
      fields.push("bot_system_prompt = ?");
      values.push(updates.systemPrompt);
    }
    if (updates.model !== undefined) {
      fields.push("bot_model = ?");
      values.push(updates.model);
    }
    if (updates.apiKey !== undefined) {
      fields.push("bot_api_key = ?");
      values.push(updates.apiKey ? encryptSecretAtRest(updates.apiKey) : null);
    }
    if (updates.endpointUrl !== undefined) {
      fields.push("bot_endpoint_url = ?");
      values.push(updates.endpointUrl);
    }
    if (fields.length === 0) return;
    values.push(botId, ownerId);
    this.db
      .prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND owner_id = ? AND account_type = 'bot'`)
      .run(...values);
  }

  touchBotLastUsed(botId: number): void {
    this.db
      .prepare(`UPDATE users SET bot_last_used_at = datetime('now') WHERE id = ? AND account_type = 'bot'`)
      .run(botId);
  }

  deleteBot(ownerId: number, botId: number): void {
    this.db.prepare(`DELETE FROM users WHERE id = ? AND owner_id = ? AND account_type = 'bot'`).run(botId, ownerId);
  }

  rotateBotToken(ownerId: number, botId: number, tokenHash: string): boolean {
    const res = this.db
      .prepare(`UPDATE users SET bot_token_hash = ? WHERE id = ? AND owner_id = ? AND account_type = 'bot'`)
      .run(tokenHash, botId, ownerId);
    return res.changes > 0;
  }

  getUserByBotTokenHash(tokenHash: string): {
    id: number;
    owner_id: number;
    username: string;
    email: string;
    account_type: string;
    bot_scopes: string;
    status?: string | undefined;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, owner_id, username, email, account_type, bot_scopes, status FROM users WHERE bot_token_hash = ? AND account_type = 'bot'`,
      )
      .get(tokenHash) as
      | {
          id: number;
          owner_id: number;
          username: string;
          email: string;
          account_type: string;
          bot_scopes: string;
          status?: string | undefined;
        }
      | undefined;
    return row || null;
  }

  enqueueBotMention(botId: number, postId: number, authorId: number): number {
    const result = this.db
      .prepare(`INSERT INTO bot_mention_queue (bot_id, post_id, author_id, status) VALUES (?, ?, ?, 'pending')`)
      .run(botId, postId, authorId);
    return result.lastInsertRowid as number;
  }

  getPendingBotMentions(limit: number = 10): {
    id: number;
    bot_id: number;
    post_id: number;
    author_id: number;
    status: string;
    attempts: number;
    error: string | null;
    created_at: string;
  }[] {
    return this.db
      .prepare(
        `SELECT id, bot_id, post_id, author_id, status, attempts, error, created_at FROM bot_mention_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      bot_id: number;
      post_id: number;
      author_id: number;
      status: string;
      attempts: number;
      error: string | null;
      created_at: string;
    }[];
  }

  updateBotMentionStatus(
    queueId: number,
    status: "processing" | "completed" | "failed",
    options?: { error?: string | undefined; responsePostId?: number | undefined },
  ): void {
    if (status === "processing") {
      this.db
        .prepare(
          `UPDATE bot_mention_queue SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(queueId);
    } else if (status === "completed") {
      this.db
        .prepare(
          `UPDATE bot_mention_queue SET status = 'completed', response_post_id = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(options?.responsePostId ?? null, queueId);
    } else if (status === "failed") {
      this.db
        .prepare(`UPDATE bot_mention_queue SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(options?.error ?? "Unknown error", queueId);
    }
  }

  // ── Federated & OAuth Accounts ──────────────────────────────────

  registerFederatedUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
    options?: {
      accountType?: string | undefined;
      displayName?: string | undefined;
      avatarUrl?: string | undefined;
      bio?: string | undefined;
      remoteDomain?: string | undefined;
      actorUrl?: string | undefined;
    },
  ): { id: number; username: string; email: string } {
    const transaction = this.db.transaction(() => {
      const avatarUrl =
        options?.avatarUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
      const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

      const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
      const actorUrl = options?.actorUrl || `${publicUrl}/users/${username}`;
      const inboxUrl = `${actorUrl}/inbox`;
      const outboxUrl = `${actorUrl}/outbox`;
      const accountType = options?.accountType || (provider === "fediverse" ? "community_federated" : "user");
      const displayName = options?.displayName || username;
      const bio = options?.bio || "";
      const remoteDomain = options?.remoteDomain || null;

      const userResult = this.db
        .prepare(
          `INSERT INTO users (username, email, account_type, display_name, bio, avatar_url, banner_url, rsa_private_key, rsa_public_key, actor_url, inbox_url, outbox_url, remote_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          username,
          email,
          accountType,
          displayName,
          bio,
          avatarUrl,
          bannerUrl,
          null,
          null,
          actorUrl,
          inboxUrl,
          outboxUrl,
          remoteDomain,
        );
      const userId = Number(userResult.lastInsertRowid);

      this.db
        .prepare(`INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`)
        .run(userId, provider, providerUserId);

      return { id: userId, username, email };
    });

    return transaction();
  }

  createOAuthUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    return this.registerFederatedUser(username, email, provider, providerUserId);
  }

  getOAuthAccount(
    provider: string,
    providerUserId: string,
  ):
    | {
        user_id: number;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
      )
      .get(provider, providerUserId) as
      | {
          user_id: number;
          access_token?: string | undefined;
          refresh_token?: string | undefined;
          expires_at?: string | undefined;
        }
      | undefined;
  }

  getOAuthAccountByUserId(
    userId: number,
    provider: string,
  ):
    | {
        provider_user_id: string;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT provider_user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE user_id = ? AND provider = ?`,
      )
      .get(userId, provider) as
      | {
          provider_user_id: string;
          access_token?: string | undefined;
          refresh_token?: string | undefined;
          expires_at?: string | undefined;
        }
      | undefined;
  }

  getPublicOAuthAccounts(userId: number): { provider: string; provider_user_id: string }[] {
    return this.db.prepare(`SELECT provider, provider_user_id FROM oauth_accounts WHERE user_id = ?`).all(userId) as {
      provider: string;
      provider_user_id: string;
    }[];
  }

  updateOAuthTokens(
    userId: number,
    provider: string,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE oauth_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = COALESCE(?, expires_at) WHERE user_id = ? AND provider = ?`,
      )
      .run(accessToken, refreshToken ?? null, expiresAt ?? null, userId, provider);
  }

  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    accessToken?: string | null,
    refreshToken?: string | null,
    expiresAt?: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, provider, providerUserId, accessToken ?? null, refreshToken ?? null, expiresAt ?? null);
  }

  unlinkOAuthAccount(userId: number, provider: string): void {
    this.db.prepare(`DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?`).run(userId, provider);
  }

  getFederatedOAuthClient(
    domain: string,
  ): { domain: string; client_id: string; client_secret: string; registered_at: string } | undefined {
    return this.db
      .prepare(`SELECT domain, client_id, client_secret, registered_at FROM federated_oauth_clients WHERE domain = ?`)
      .get(domain.toLowerCase().trim()) as
      { domain: string; client_id: string; client_secret: string; registered_at: string } | undefined;
  }

  saveFederatedOAuthClient(domain: string, clientId: string, clientSecret: string): void {
    this.db
      .prepare(
        `INSERT INTO federated_oauth_clients (domain, client_id, client_secret, registered_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           registered_at = excluded.registered_at`,
      )
      .run(domain.toLowerCase().trim(), clientId, clientSecret);
  }
}
