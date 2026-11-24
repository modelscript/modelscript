// SPDX-License-Identifier: AGPL-3.0-or-later

import semver from "semver";
import type { CollaboratorPermission, PackageCollaboratorRecord } from "../../database.js";
import type { LibraryReleaseRow, PackageTransferRow } from "../types.js";
import { BaseRepository } from "./base.js";

export interface PackageRow {
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

export interface PackageVersionRow {
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

export class PackageRepository extends BaseRepository {
  // ── Library Releases & Lifecycle ─────────────────────────────────

  /**
   * Save or update a library release record with content hash, signature, and optional OIDC CI/CD attestation.
   */
  saveLibraryRelease(release: {
    libraryName: string;
    libraryVersion: string;
    contentHash: string;
    signature?: string | null | undefined;
    publishedBy?: number | null | undefined;
    oidcIssuer?: string | null | undefined;
    oidcSubject?: string | null | undefined;
    oidcRepository?: string | null | undefined;
    oidcWorkflowRef?: string | null | undefined;
    oidcRunId?: string | null | undefined;
  }): void {
    this.run(
      `INSERT INTO library_releases (
        library_name, library_version, content_hash, signature, published_by,
        oidc_issuer, oidc_subject, oidc_repository, oidc_workflow_ref, oidc_run_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_name, library_version) DO UPDATE SET
        content_hash = excluded.content_hash,
        signature = excluded.signature,
        published_by = excluded.published_by,
        oidc_issuer = excluded.oidc_issuer,
        oidc_subject = excluded.oidc_subject,
        oidc_repository = excluded.oidc_repository,
        oidc_workflow_ref = excluded.oidc_workflow_ref,
        oidc_run_id = excluded.oidc_run_id,
        published_at = datetime('now')`,
      release.libraryName,
      release.libraryVersion,
      release.contentHash,
      release.signature ?? null,
      release.publishedBy ?? null,
      release.oidcIssuer ?? null,
      release.oidcSubject ?? null,
      release.oidcRepository ?? null,
      release.oidcWorkflowRef ?? null,
      release.oidcRunId ?? null,
    );
    this.facade.invalidateLibraryDiscoveryCache();
  }

  /**
   * Get release metadata (content hash, signature, timestamp) for a library.
   */
  getLibraryRelease(libraryName: string, libraryVersion: string): LibraryReleaseRow | null {
    return (
      this.get<LibraryReleaseRow>(
        `SELECT * FROM library_releases WHERE library_name = ? AND library_version = ?`,
        libraryName,
        libraryVersion,
      ) ?? null
    );
  }

  /**
   * Get all releases for a library name.
   */
  getLibraryReleases(libraryName: string): LibraryReleaseRow[] {
    return this.all<LibraryReleaseRow>(`SELECT * FROM library_releases WHERE library_name = ?`, libraryName);
  }

  /**
   * Mark a library release as deprecated (or clear deprecation if reason is null).
   */
  deprecateLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    const isDeprecated = reason !== null ? 1 : 0;
    const info = this.run(
      `UPDATE library_releases
       SET is_deprecated = ?, deprecation_reason = ?
       WHERE library_name = ? AND library_version = ?`,
      isDeprecated,
      reason,
      libraryName,
      libraryVersion,
    );
    if (info.changes > 0) {
      this.facade.invalidateLibraryDiscoveryCache();
    }
    return info.changes > 0;
  }

  /**
   * Yank a library release (tombstone download while preserving metadata).
   */
  yankLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    const info = this.run(
      `UPDATE library_releases
       SET is_yanked = 1, yank_reason = ?, yanked_at = datetime('now')
       WHERE library_name = ? AND library_version = ?`,
      reason,
      libraryName,
      libraryVersion,
    );
    if (info.changes > 0) {
      this.facade.invalidateLibraryDiscoveryCache();
    }
    return info.changes > 0;
  }

  /**
   * Restore/unyank a library release.
   */
  unyankLibraryRelease(libraryName: string, libraryVersion: string): boolean {
    const info = this.run(
      `UPDATE library_releases
       SET is_yanked = 0, yank_reason = NULL, yanked_at = NULL
       WHERE library_name = ? AND library_version = ?`,
      libraryName,
      libraryVersion,
    );
    if (info.changes > 0) {
      this.facade.invalidateLibraryDiscoveryCache();
    }
    return info.changes > 0;
  }

  // ── Package Permissions & Ownership Transfers ────────────────────

  /**
   * Check if a user has management permissions (owner/maintainer/admin) over a package.
   */
  canUserManagePackage(libraryName: string, userId: number): boolean {
    const user = this.facade.getUserById(userId);
    if (!user) return false;
    if (user.account_type === "admin") return true;

    // Check if user is collaborator with admin or write
    const collabPerm = this.getPackageCollaboratorPermission(libraryName, userId);
    if (collabPerm === "admin" || collabPerm === "write") {
      return true;
    }

    // If scoped package (@owner/pkg), check if user.username === owner or is org owner/maintainer
    if (libraryName.startsWith("@")) {
      const scope = libraryName.split("/")[0]!.slice(1).toLowerCase();
      if (user.username.toLowerCase() === scope) {
        return true;
      }
      const org = this.facade.getOrganizationBySlug(scope);
      if (org) {
        const role = this.facade.getOrganizationMemberRole(org.id, userId);
        if (role === "owner" || role === "maintainer") {
          return true;
        }
      }
      return false;
    }

    // For unscoped packages, check if user is the primary owner (initial publisher / transfer recipient)
    const initialRelease = this.get<{ published_by: number }>(
      `SELECT published_by FROM library_releases WHERE library_name = ? ORDER BY id ASC LIMIT 1`,
      libraryName,
    );
    return initialRelease ? initialRelease.published_by === userId : false;
  }

  /**
   * Check if a user has administrative permissions (owner/org-maintainer/admin collaborator) over a package.
   * Excludes 'write' collaborators from destructive/ownership/collaborator-management actions.
   */
  canUserAdministerPackage(libraryName: string, userId: number): boolean {
    const user = this.facade.getUserById(userId);
    if (!user) return false;
    if (user.account_type === "admin") return true;

    const collabPerm = this.getPackageCollaboratorPermission(libraryName, userId);
    if (collabPerm === "admin") {
      return true;
    }

    if (libraryName.startsWith("@")) {
      const scope = libraryName.split("/")[0]!.slice(1).toLowerCase();
      if (user.username.toLowerCase() === scope) {
        return true;
      }
      const org = this.facade.getOrganizationBySlug(scope);
      if (org) {
        const role = this.facade.getOrganizationMemberRole(org.id, userId);
        if (role === "owner" || role === "maintainer") {
          return true;
        }
      }
      return false;
    }

    const initialRelease = this.get<{ published_by: number }>(
      `SELECT published_by FROM library_releases WHERE library_name = ? ORDER BY id ASC LIMIT 1`,
      libraryName,
    );
    return initialRelease ? initialRelease.published_by === userId : false;
  }

  /**
   * Check if a user is authorized to publish a package release.
   */
  canUserPublishPackage(libraryName: string, userId: number): { allowed: boolean; reason?: string | undefined } {
    const user = this.facade.getUserById(userId);
    if (!user) return { allowed: false, reason: "User not found" };
    if (user.account_type === "admin") return { allowed: true };

    const existingReleases = this.getLibraryReleases(libraryName);
    if (existingReleases.length > 0) {
      if (this.canUserManagePackage(libraryName, userId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `You do not have permission to publish new versions of package '${libraryName}'`,
      };
    }

    // Reserved standard/core prefixes
    if (/^(?:modelica|complex|modelscript|sysml|ansatz)/i.test(libraryName)) {
      return {
        allowed: false,
        reason: `Reserved package name '${libraryName}' can only be published by system administrators.`,
      };
    }

    // New package creation
    if (libraryName.startsWith("@")) {
      const scope = libraryName.split("/")[0]!.slice(1).toLowerCase();
      if (user.username.toLowerCase() === scope) {
        return { allowed: true };
      }
      const org = this.facade.getOrganizationBySlug(scope);
      if (org) {
        const role = this.facade.getOrganizationMemberRole(org.id, userId);
        if (role === "owner" || role === "maintainer") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `You must be an owner or maintainer of organization '@${scope}' to publish packages under its namespace`,
        };
      }
      return {
        allowed: false,
        reason: `Namespace '@${scope}' does not match your username and is not a registered organization`,
      };
    }

    return { allowed: true };
  }

  /**
   * Initiate a package ownership transfer request.
   */
  createPackageTransfer(packageName: string, fromUserId: number, toUserId: number): number {
    const info = this.run(
      `INSERT INTO package_ownership_transfers (package_name, from_user_id, to_user_id, status)
       VALUES (?, ?, ?, 'pending')`,
      packageName,
      fromUserId,
      toUserId,
    );
    return Number(info.lastInsertRowid);
  }

  /**
   * Accept an ownership transfer request.
   */
  acceptPackageTransfer(transferId: number, toUserId: number): boolean {
    const transfer = this.get<{ id: number; package_name: string; to_user_id: number }>(
      `SELECT * FROM package_ownership_transfers WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
      transferId,
      toUserId,
    );

    if (!transfer) return false;

    this.immediateTransaction(() => {
      this.run(
        `UPDATE package_ownership_transfers
         SET status = 'accepted', resolved_at = datetime('now')
         WHERE id = ?`,
        transferId,
      );

      // Reassign published_by to new owner
      this.run(`UPDATE library_releases SET published_by = ? WHERE library_name = ?`, toUserId, transfer.package_name);
    });

    return true;
  }

  /**
   * Cancel an ownership transfer request.
   */
  cancelPackageTransfer(transferId: number, fromUserId: number): boolean {
    const info = this.run(
      `UPDATE package_ownership_transfers
       SET status = 'canceled', resolved_at = datetime('now')
       WHERE id = ? AND from_user_id = ? AND status = 'pending'`,
      transferId,
      fromUserId,
    );
    return info.changes > 0;
  }

  /**
   * Get pending transfers for a user (incoming and outgoing).
   */
  getPendingTransfers(userId: number): PackageTransferRow[] {
    return this.all<PackageTransferRow>(
      `SELECT t.*, u_from.username AS from_username, u_to.username AS to_username
       FROM package_ownership_transfers t
       JOIN users u_from ON t.from_user_id = u_from.id
       JOIN users u_to ON t.to_user_id = u_to.id
       WHERE (t.to_user_id = ? OR t.from_user_id = ?) AND t.status = 'pending'
       ORDER BY t.created_at DESC`,
      userId,
      userId,
    );
  }

  /**
   * Get packages that declare this package as a dependency.
   */
  getReverseDependencies(targetPackageName: string): { name: string; version: string; description: string | null }[] {
    const rows = this.all<{ name: string; description: string | null; version: string; manifest: string }>(
      `SELECT p.name, p.description, pv.version, pv.manifest
       FROM packages p
       JOIN dist_tags dt ON dt.package_id = p.id AND dt.tag = 'latest'
       JOIN package_versions pv ON pv.package_id = p.id AND pv.version = dt.version
       WHERE p.name != ?`,
      targetPackageName,
    );

    const result: { name: string; version: string; description: string | null }[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.manifest);
        const deps = { ...parsed.dependencies, ...parsed.modelscript?.dependencies };
        if (
          deps &&
          (deps[targetPackageName] !== undefined ||
            Object.keys(deps).some((k) => k.toLowerCase() === targetPackageName.toLowerCase()))
        ) {
          result.push({ name: row.name, version: row.version, description: row.description ?? null });
        }
      } catch {
        // ignore parse error
      }
    }
    return result;
  }

  // ── Package Collaborators ────────────────────────────────────────

  addPackageCollaborator(libraryName: string, userId: number, permission: CollaboratorPermission): void {
    this.run(
      `INSERT INTO package_collaborators (library_name, user_id, permission)
       VALUES (?, ?, ?)
       ON CONFLICT(library_name, user_id)
       DO UPDATE SET permission = excluded.permission`,
      libraryName,
      userId,
      permission,
    );
  }

  removePackageCollaborator(libraryName: string, userId: number): boolean {
    const info = this.run(
      `DELETE FROM package_collaborators WHERE library_name = ? AND user_id = ?`,
      libraryName,
      userId,
    );
    return info.changes > 0;
  }

  getPackageCollaborators(libraryName: string): PackageCollaboratorRecord[] {
    return this.all<PackageCollaboratorRecord>(
      `SELECT c.*, u.username
       FROM package_collaborators c
       JOIN users u ON c.user_id = u.id
       WHERE c.library_name = ?
       ORDER BY c.created_at ASC`,
      libraryName,
    );
  }

  getPackageCollaboratorPermission(libraryName: string, userId: number): CollaboratorPermission | null {
    const row = this.get<{ permission: CollaboratorPermission }>(
      `SELECT permission FROM package_collaborators WHERE library_name = ? AND user_id = ?`,
      libraryName,
      userId,
    );
    return row?.permission ?? null;
  }

  // ── Core Registry Packages, Versions, Dist-Tags & Artifacts ──────

  /**
   * Get or create a package record by name.
   */
  getOrCreatePackage(name: string): { id: number; created: boolean } {
    const existing = this.get<{ id: number }>(`SELECT id FROM packages WHERE name = ?`, name);
    if (existing) {
      return { id: existing.id, created: false };
    }
    const result = this.run(`INSERT INTO packages (name) VALUES (?)`, name);
    this.facade.invalidateLibraryDiscoveryCache();
    return { id: Number(result.lastInsertRowid), created: true };
  }

  /**
   * Get a package record by name.
   */
  getPackage(name: string): PackageRow | undefined {
    return this.get<PackageRow>(`SELECT * FROM packages WHERE name = ?`, name);
  }

  /**
   * Get a package record by ID.
   */
  getPackageById(id: number): PackageRow | undefined {
    return this.get<PackageRow>(`SELECT * FROM packages WHERE id = ?`, id);
  }

  getPackageCount(): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM packages`);
    return row?.count ?? 0;
  }

  /**
   * Update package-level metadata (hoisted from latest version).
   */
  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null | undefined;
      readme?: string | null | undefined;
      readme_filename?: string | null | undefined;
      license?: string | null | undefined;
      homepage?: string | null | undefined;
      repository_type?: string | null | undefined;
      repository_url?: string | null | undefined;
    },
  ): void {
    this.run(
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
      meta.description ?? null,
      meta.readme ?? null,
      meta.readme_filename ?? null,
      meta.license ?? null,
      meta.homepage ?? null,
      meta.repository_type ?? null,
      meta.repository_url ?? null,
      packageId,
    );
    this.facade.invalidateLibraryDiscoveryCache();
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
    const result = this.run(
      `INSERT INTO package_versions
        (package_id, version, tarball_path, tarball_shasum, tarball_integrity, tarball_size, manifest, modelscript_meta, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    this.facade.invalidateLibraryDiscoveryCache();
    return Number(result.lastInsertRowid);
  }

  /**
   * Update the manifest of a package version.
   */
  updatePackageVersionManifest(versionId: number, manifest: string): void {
    this.run(`UPDATE package_versions SET manifest = ? WHERE id = ?`, manifest, versionId);
    this.facade.invalidateLibraryDiscoveryCache();
  }

  /**
   * Get a specific package version.
   */
  getPackageVersion(packageId: number, version: string): PackageVersionRow | undefined {
    return this.get<PackageVersionRow>(
      `SELECT * FROM package_versions WHERE package_id = ? AND version = ?`,
      packageId,
      version,
    );
  }

  /**
   * Get all versions for a package.
   */
  getPackageVersions(packageId: number): PackageVersionRow[] {
    return this.all<PackageVersionRow>(
      `SELECT * FROM package_versions WHERE package_id = ? ORDER BY published_at DESC`,
      packageId,
    );
  }

  /**
   * Set a dist-tag for a package (e.g. "latest").
   */
  setDistTag(packageId: number, tag: string, version: string): void {
    this.run(
      `INSERT INTO dist_tags (package_id, tag, version) VALUES (?, ?, ?)
      ON CONFLICT(package_id, tag) DO UPDATE SET version = excluded.version`,
      packageId,
      tag,
      version,
    );
  }

  /**
   * Get all dist-tags for a package.
   */
  getDistTags(packageId: number): Record<string, string> {
    const rows = this.all<{ tag: string; version: string }>(
      `SELECT tag, version FROM dist_tags WHERE package_id = ?`,
      packageId,
    );
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.tag] = row.version;
    }
    return tags;
  }

  /**
   * Delete a dist-tag for a package.
   */
  deleteDistTag(packageId: number, tag: string): boolean {
    const info = this.run(`DELETE FROM dist_tags WHERE package_id = ? AND tag = ?`, packageId, tag);
    return info.changes > 0;
  }

  /**
   * Store an artifact for a package version.
   */
  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    const result = this.run(
      `INSERT OR REPLACE INTO artifacts (version_id, type, path, metadata) VALUES (?, ?, ?, ?)`,
      versionId,
      type,
      artifactPath,
      metadata,
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get artifacts for a package version.
   */
  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.all<{ id: number; type: string; path: string; metadata: string | null }>(
      `SELECT * FROM artifacts WHERE version_id = ?`,
      versionId,
    );
  }

  /**
   * Build the full npm packument JSON for a package.
   */
  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    const pkg = this.getPackage(name);
    if (!pkg) return null;

    const versions = this.getPackageVersions(pkg.id);
    if (versions.length === 0) return null;

    const sortedVersions = [...versions].sort((a, b) => {
      if (semver.valid(a.version) && semver.valid(b.version)) return semver.rcompare(a.version, b.version);
      return (b.published_at || "").localeCompare(a.published_at || "");
    });

    const distTags = this.getDistTags(pkg.id);
    if (!distTags["latest"] && sortedVersions.length > 0) {
      distTags["latest"] = sortedVersions[0]!.version;
    }

    const time: Record<string, string> = {
      created: pkg.created_at,
      modified: pkg.modified_at,
    };

    const versionsObj: Record<string, unknown> = {};
    for (const v of sortedVersions) {
      time[v.version] = v.published_at;
      const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
      // Ensure dist info is present
      manifest["dist"] = {
        shasum: v.tarball_shasum,
        integrity: v.tarball_integrity,
        tarball: `${registryUrl}/${encodeURIComponent(name)}/-/${name}-${v.version}.tgz`,
      };
      manifest["_id"] = `${name}@${v.version}`;
      const libRelease = this.getLibraryRelease(name, v.version);
      if (libRelease?.is_deprecated && libRelease.deprecation_reason) {
        manifest["deprecated"] = libRelease.deprecation_reason;
      }
      if (libRelease?.is_yanked) {
        manifest["yanked"] = libRelease.yank_reason || true;
        manifest["is_yanked"] = true;
        manifest["yank_reason"] = libRelease.yank_reason;
      }
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

    const countRow = this.get<{ total: number }>(countSql, pattern, pattern);
    const rows = this.all<{
      name: string;
      description: string | null;
      modified_at: string;
      latest_version: string | null;
    }>(searchSql, pattern, pattern, size, from);

    return {
      objects: rows.map((r) => ({
        package: {
          name: r.name,
          version: r.latest_version ?? "0.0.0",
          description: r.description,
          date: r.modified_at,
        },
      })),
      total: countRow?.total ?? 0,
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
    return this.all<{
      name: string;
      description: string | null;
      latest_version: string | null;
      modified_at: string;
    }>(sql, ...params);
  }

  /**
   * Delete a package version. If no more versions remain, delete the package.
   */
  deletePackageVersion(name: string, version: string): boolean {
    const pkg = this.getPackage(name);
    if (!pkg) return false;

    const v = this.getPackageVersion(pkg.id, version);
    if (!v) return false;

    this.immediateTransaction(() => {
      this.run(`DELETE FROM artifacts WHERE version_id = ?`, v.id);
      this.run(`DELETE FROM package_versions WHERE id = ?`, v.id);
      this.run(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`, name, version);
      this.run(`DELETE FROM library_releases WHERE library_name = ? AND library_version = ?`, name, version);

      // Clean up dist-tags pointing to this version
      this.run(`DELETE FROM dist_tags WHERE package_id = ? AND version = ?`, pkg.id, version);

      // If no versions remain, delete the package
      const remaining = this.getPackageVersions(pkg.id);
      if (remaining.length === 0) {
        this.run(`DELETE FROM packages WHERE id = ?`, pkg.id);
      } else {
        // Re-point "latest" to the newest remaining version by semver
        const sorted = [...remaining].sort((a, b) => {
          if (semver.valid(a.version) && semver.valid(b.version)) return semver.rcompare(a.version, b.version);
          return (b.published_at || "").localeCompare(a.published_at || "");
        });
        if (sorted[0]) {
          this.setDistTag(pkg.id, "latest", sorted[0].version);
        }
      }
    });

    this.facade.invalidateLibraryDiscoveryCache();
    return true;
  }

  recordPackageDownload(name: string, version: string, dateStr?: string): void {
    this.facade.recordPackageDownload(name, version, dateStr);
  }
}
