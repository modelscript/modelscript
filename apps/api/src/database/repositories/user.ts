// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiTokenRecord } from "../../database.js";
import { decryptTotpSecret, encryptTotpSecret } from "../../util/totp.js";
import type { UserRow } from "../types.js";
import { BaseRepository } from "./base.js";

export interface ApiTokenInsertParams {
  userId: number;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: string[];
  packagePattern?: string | undefined;
  ipAllowlist?: string | null | undefined;
  expiresAt?: string | null | undefined;
}

export class UserRepository extends BaseRepository {
  getUserByEmail(email: string): UserRow | undefined {
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    return this.get<UserRow>(
      `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE LOWER(email) = LOWER(?)`,
      cleanEmail,
    );
  }

  getUserByUsername(username: string): UserRow | undefined {
    const cleanUsername = typeof username === "string" ? username.trim() : "";
    return this.get<UserRow>(
      `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, location, website, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility, signing_verified, signing_policy_strict, branch_tip_oid FROM users WHERE LOWER(username) = LOWER(?)`,
      cleanUsername,
    );
  }

  getUserById(id: number): UserRow | undefined {
    return this.get<UserRow>(
      `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, location, website, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility, invites_remaining, signing_verified, signing_policy_strict, branch_tip_oid FROM users WHERE id = ?`,
      id,
    );
  }

  getUserByActorUrl(actorUrl: string): UserRow | undefined {
    return this.get<UserRow>(
      `SELECT id, username, email, account_type, avatar_url, banner_url, display_name, bio, status, actor_url, inbox_url, outbox_url, remote_domain, rsa_public_key, ed25519_public_key, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility, signing_verified, signing_policy_strict FROM users WHERE actor_url = ?`,
      actorUrl,
    );
  }

  setUserAccountType(userId: number, accountType: string): void {
    if (accountType === "user") {
      this.run(
        `UPDATE users SET account_type = ?, token_version = CASE WHEN COALESCE(account_type, 'user') != 'user' THEN COALESCE(token_version, 1) + 1 ELSE COALESCE(token_version, 1) END WHERE id = ?`,
        accountType,
        userId,
      );
    } else {
      this.run(`UPDATE users SET account_type = ? WHERE id = ?`, accountType, userId);
    }
  }

  hasAdminUser(): boolean {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM users WHERE account_type = 'admin'`);
    return (row?.count ?? 0) > 0;
  }

  getUserCount(): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM users`);
    return row?.count ?? 0;
  }

  getTotalUsersCount(): number {
    return this.getUserCount();
  }

  updateUserPersona(userId: number, persona: string): boolean {
    const res = this.run(`UPDATE users SET engineering_persona = ? WHERE id = ?`, persona, userId);
    return res.changes > 0;
  }

  updateUserBio(userId: number, bio: string): boolean {
    const res = this.run(`UPDATE users SET bio = ? WHERE id = ?`, bio, userId);
    return res.changes > 0;
  }

  setUserEmailVerified(userId: number, verified = true): boolean {
    const res = this.run(`UPDATE users SET email_verified = ? WHERE id = ?`, verified ? 1 : 0, userId);
    return res.changes > 0;
  }

  updateUserStatus(userId: number, status: string): boolean {
    const res = this.run(`UPDATE users SET status = ? WHERE id = ?`, status, userId);
    return res.changes > 0;
  }

  // ── Password & Session Token Version ─────────────────────────────

  updatePassword(userId: number, passwordHash: string): void {
    this.run(
      `UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`,
      passwordHash,
      userId,
    );
  }

  incrementTokenVersion(userId: number): number {
    this.run(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`, userId);
    const res = this.get<{ token_version: number }>(`SELECT token_version FROM users WHERE id = ?`, userId);
    return res?.token_version ?? 1;
  }

  getPasswordHash(userId: number): string | undefined {
    const res = this.get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, userId);
    return res?.password_hash;
  }

  // ── Two-Factor Authentication (TOTP & Backup Codes) ──────────────

  setPendingTotpSecret(userId: number, secret: string, expiresAt: number): void {
    const encrypted = encryptTotpSecret(secret);
    this.run(
      `INSERT OR REPLACE INTO pending_totp_secrets (user_id, secret, expires_at) VALUES (?, ?, ?)`,
      userId,
      encrypted,
      expiresAt,
    );
  }

  getPendingTotpSecret(userId: number): string | undefined {
    const row = this.get<{ secret: string; expires_at: number }>(
      `SELECT secret, expires_at FROM pending_totp_secrets WHERE user_id = ?`,
      userId,
    );
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.deletePendingTotpSecret(userId);
      return undefined;
    }
    try {
      return decryptTotpSecret(row.secret);
    } catch {
      return row.secret;
    }
  }

  deletePendingTotpSecret(userId: number): void {
    this.run(`DELETE FROM pending_totp_secrets WHERE user_id = ?`, userId);
  }

  enableUser2FA(userId: number, secret: string, hashedBackupCodes: string[]): void {
    const encrypted = encryptTotpSecret(secret);
    this.run(
      `UPDATE users SET totp_secret = ?, totp_enabled = 1, backup_codes = ? WHERE id = ?`,
      encrypted,
      JSON.stringify(hashedBackupCodes),
      userId,
    );
    this.deletePendingTotpSecret(userId);
  }

  disableUser2FA(userId: number): void {
    this.run(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, backup_codes = '[]' WHERE id = ?`, userId);
    this.deletePendingTotpSecret(userId);
  }

  setUserBackupCodes(userId: number, hashedBackupCodes: string[]): void {
    this.run(`UPDATE users SET backup_codes = ? WHERE id = ?`, JSON.stringify(hashedBackupCodes), userId);
  }

  getRemainingBackupCodeCount(userId: number): number {
    const state = this.getUser2FAState(userId);
    return state?.backup_codes?.length ?? 0;
  }

  getUser2FAState(userId: number):
    | {
        totp_enabled: number;
        totp_secret: string | null;
        backup_codes: string[];
      }
    | undefined {
    const row = this.get<{
      totp_enabled?: number | undefined;
      totp_secret?: string | null | undefined;
      backup_codes?: string | undefined;
    }>(`SELECT totp_enabled, totp_secret, backup_codes FROM users WHERE id = ?`, userId);
    if (!row) return undefined;
    let backupCodes: string[] = [];
    try {
      if (row.backup_codes) {
        backupCodes = JSON.parse(row.backup_codes) as string[];
      }
    } catch {
      backupCodes = [];
    }
    let plainSecret: string | null = row.totp_secret ?? null;
    if (plainSecret) {
      try {
        plainSecret = decryptTotpSecret(plainSecret);
      } catch {
        // Fallback to raw value if decryption fails
      }
    }
    return {
      totp_enabled: row.totp_enabled ?? 0,
      totp_secret: plainSecret,
      backup_codes: Array.isArray(backupCodes) ? backupCodes : [],
    };
  }

  consumeBackupCode(userId: number, codeHash: string): boolean {
    const state = this.getUser2FAState(userId);
    if (!state || !state.backup_codes.includes(codeHash)) {
      return false;
    }
    const remaining = state.backup_codes.filter((h) => h !== codeHash);
    this.run(`UPDATE users SET backup_codes = ? WHERE id = ?`, JSON.stringify(remaining), userId);
    return true;
  }

  // ── Notification Settings ────────────────────────────────────────

  getNotificationSettings(userId: number): string | undefined {
    const res = this.get<{ notification_settings: string }>(
      `SELECT notification_settings FROM users WHERE id = ?`,
      userId,
    );
    return res?.notification_settings;
  }

  updateNotificationSettings(userId: number, settings: string): void {
    this.run(`UPDATE users SET notification_settings = ? WHERE id = ?`, settings, userId);
  }

  // ── Granular API Tokens ──────────────────────────────────────────

  storeApiTokenRow(params: ApiTokenInsertParams): number {
    const scopesJson = JSON.stringify(params.scopes);
    const pattern = params.packagePattern || "*";
    const result = this.run(
      `INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scopes, package_pattern, ip_allowlist, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params.userId,
      params.name,
      params.tokenPrefix,
      params.tokenHash,
      scopesJson,
      pattern,
      params.ipAllowlist ?? null,
      params.expiresAt ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  insertApiTokenRecord(params: ApiTokenInsertParams): number {
    return this.storeApiTokenRow(params);
  }

  createApiKey(params: ApiTokenInsertParams): number {
    return this.storeApiTokenRow(params);
  }

  createApiToken(params: ApiTokenInsertParams): number {
    return this.storeApiTokenRow(params);
  }

  getApiTokenByHash(tokenHash: string): ApiTokenRecord | null {
    const row = this.get<Omit<ApiTokenRecord, "scopes"> & { scopes: string }>(
      `SELECT id, user_id, name, token_prefix, token_hash, scopes, package_pattern, ip_allowlist, expires_at, last_used_at, last_used_ip, created_at
       FROM api_tokens
       WHERE token_hash = ?`,
      tokenHash,
    );
    if (!row) return null;
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(row.scopes) as string[];
    } catch {
      scopes = [];
    }
    return {
      ...row,
      scopes,
    };
  }

  listApiTokens(userId: number): Omit<ApiTokenRecord, "token_hash">[] {
    const rows = this.all<Omit<ApiTokenRecord, "token_hash" | "scopes"> & { scopes: string }>(
      `SELECT id, user_id, name, token_prefix, scopes, package_pattern, ip_allowlist, expires_at, last_used_at, last_used_ip, created_at
       FROM api_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      userId,
    );

    return rows.map((r) => {
      let scopes: string[] = [];
      try {
        scopes = JSON.parse(r.scopes) as string[];
      } catch {
        scopes = [];
      }
      return {
        ...r,
        scopes,
      };
    });
  }

  deleteApiToken(tokenId: number, userId: number): boolean {
    const res = this.run(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, tokenId, userId);
    return res.changes > 0;
  }

  touchApiToken(tokenId: number, ip?: string): void {
    try {
      this.run(
        `UPDATE api_tokens SET last_used_at = datetime('now'), last_used_ip = ? WHERE id = ?`,
        ip ?? null,
        tokenId,
      );
    } catch {
      // non-critical
    }
  }
}
