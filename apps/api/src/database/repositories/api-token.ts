// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiTokenRecord } from "../../database.js";
import type { SolutionReleaseRow, SolutionRow } from "../../database/types.js";
import { BaseRepository } from "./base.js";
export class ApiTokenRepository extends BaseRepository {
  // ── Granular API Tokens ──────────────────────────────────────────

  storeApiTokenRow(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.facade.users.storeApiTokenRow(params);
  }

  insertApiTokenRecord(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.facade.users.insertApiTokenRecord(params);
  }

  createApiKey(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.facade.users.createApiKey(params);
  }

  createApiToken(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.facade.users.createApiToken(params);
  }

  getApiTokenByHash(tokenHash: string): ApiTokenRecord | null {
    return this.facade.users.getApiTokenByHash(tokenHash);
  }

  listApiTokens(userId: number): Omit<ApiTokenRecord, "token_hash">[] {
    return this.facade.users.listApiTokens(userId);
  }

  deleteApiToken(tokenId: number, userId: number): boolean {
    return this.facade.users.deleteApiToken(tokenId, userId);
  }

  touchApiToken(tokenId: number, ip?: string): void {
    this.facade.users.touchApiToken(tokenId, ip);
  }

  getUserSolutions(username: string): SolutionRow[] {
    const user = this.facade.getUserByUsername(username);
    if (!user) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            (SELECT version FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as latest_version,
            (SELECT bundle_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as bundle_url,
            (SELECT tauri_windows_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_windows_url,
            (SELECT tauri_linux_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_linux_url,
            (SELECT tauri_darwin_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_darwin_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.user_id = ? AND s.is_public = 1
          ORDER BY s.updated_at DESC`,
        )
        .all(user.id) as (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null })[];

      return rows.map((r) => ({
        ...r,
        supported_formats: JSON.parse(r.supported_formats || "[]") as string[],
      }));
    } catch {
      return [];
    }
  }

  getAllPublicSolutions(): SolutionRow[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            (SELECT version FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as latest_version,
            (SELECT bundle_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as bundle_url,
            (SELECT tauri_windows_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_windows_url,
            (SELECT tauri_linux_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_linux_url,
            (SELECT tauri_darwin_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_darwin_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.is_public = 1
          ORDER BY s.updated_at DESC
          LIMIT 50`,
        )
        .all() as (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null })[];

      return rows.map((r) => ({
        ...r,
        supported_formats: JSON.parse(r.supported_formats || "[]") as string[],
      }));
    } catch {
      return [];
    }
  }

  getSolution(
    authorUsername: string,
    slug: string,
  ): {
    solution: SolutionRow;
    release: SolutionReleaseRow | null;
  } | null {
    const user = this.facade.getUserByUsername(authorUsername);
    if (!user) return null;
    try {
      const solution = this.db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.user_id = ? AND s.slug = ?`,
        )
        .get(user.id, slug) as
        (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null }) | undefined;

      if (!solution) return null;

      const latestRelease = this.db
        .prepare(`SELECT * FROM solution_releases WHERE solution_id = ? ORDER BY id DESC LIMIT 1`)
        .get(solution.id) as SolutionReleaseRow | undefined;

      return {
        solution: {
          ...solution,
          supported_formats: JSON.parse(solution.supported_formats || "[]") as string[],
        },
        release: latestRelease
          ? {
              ...latestRelease,
              manifest: latestRelease.manifest_json
                ? (JSON.parse(latestRelease.manifest_json) as Record<string, unknown>)
                : null,
            }
          : null,
      };
    } catch {
      return null;
    }
  }

  getSolutionReleases(authorUsername: string, slug: string): SolutionReleaseRow[] {
    const user = this.facade.getUserByUsername(authorUsername);
    if (!user) return [];
    try {
      const solution = this.db.prepare(`SELECT id FROM solutions WHERE user_id = ? AND slug = ?`).get(user.id, slug) as
        { id: number } | undefined;
      if (!solution) return [];

      return this.db
        .prepare(`SELECT * FROM solution_releases WHERE solution_id = ? ORDER BY id DESC`)
        .all(solution.id) as SolutionReleaseRow[];
    } catch {
      return [];
    }
  }

  createOrUpdateSolution(
    userId: number,
    data: {
      slug: string;
      name: string;
      description?: string | undefined;
      category?: string | undefined;
      icon?: string | undefined;
      supported_formats?: string[] | undefined;
      repo_id?: number | undefined;
    },
  ): number {
    const existing = this.db
      .prepare(`SELECT id FROM solutions WHERE user_id = ? AND slug = ?`)
      .get(userId, data.slug) as { id: number } | undefined;

    const formatsJson = JSON.stringify(data.supported_formats || []);

    if (existing) {
      this.db
        .prepare(
          `UPDATE solutions SET
            name = ?,
            description = ?,
            category = ?,
            icon = ?,
            supported_formats = ?,
            repo_id = COALESCE(?, repo_id),
            updated_at = datetime('now')
          WHERE id = ?`,
        )
        .run(
          data.name,
          data.description ?? null,
          data.category ?? "Engineering Application",
          data.icon ?? "cpu",
          formatsJson,
          data.repo_id ?? null,
          existing.id,
        );
      return existing.id;
    } else {
      const res = this.db
        .prepare(
          `INSERT INTO solutions (user_id, repo_id, slug, name, description, category, icon, supported_formats)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          data.repo_id ?? null,
          data.slug,
          data.name,
          data.description ?? null,
          data.category ?? "Engineering Application",
          data.icon ?? "cpu",
          formatsJson,
        );
      return res.lastInsertRowid as number;
    }
  }

  createSolutionRelease(
    solutionId: number,
    data: {
      version: string;
      changelog?: string | undefined;
      bundle_url: string;
      tauri_windows_url?: string | undefined;
      tauri_linux_url?: string | undefined;
      tauri_darwin_url?: string | undefined;
      manifest_json?: string | undefined;
    },
  ): number {
    const existing = this.db
      .prepare(`SELECT id FROM solution_releases WHERE solution_id = ? AND version = ?`)
      .get(solutionId, data.version) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE solution_releases SET
            changelog = ?,
            bundle_url = ?,
            tauri_windows_url = ?,
            tauri_linux_url = ?,
            tauri_darwin_url = ?,
            manifest_json = ?
          WHERE id = ?`,
        )
        .run(
          data.changelog ?? null,
          data.bundle_url,
          data.tauri_windows_url ?? null,
          data.tauri_linux_url ?? null,
          data.tauri_darwin_url ?? null,
          data.manifest_json ?? null,
          existing.id,
        );
      return existing.id;
    } else {
      const res = this.db
        .prepare(
          `INSERT INTO solution_releases (solution_id, version, changelog, bundle_url, tauri_windows_url, tauri_linux_url, tauri_darwin_url, manifest_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          solutionId,
          data.version,
          data.changelog ?? null,
          data.bundle_url,
          data.tauri_windows_url ?? null,
          data.tauri_linux_url ?? null,
          data.tauri_darwin_url ?? null,
          data.manifest_json ?? null,
        );
      return res.lastInsertRowid as number;
    }
  }
}
