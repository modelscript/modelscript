// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0003: Add OIDC Keyless CI/CD attestation tracking to library_releases
 */
export const oidcReleaseAttestationsMigration: Migration = {
  id: "0003_oidc_release_attestations",
  name: "0003_oidc_release_attestations",
  up(ctx: MigrationContext) {
    const rawCols = ctx.query<{ name: string }>("PRAGMA table_info(library_releases)");
    const cols = Array.isArray(rawCols) ? rawCols.map((c) => c.name) : [];
    if (!cols.includes("oidc_issuer")) {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN oidc_issuer TEXT DEFAULT NULL;");
    }
    if (!cols.includes("oidc_subject")) {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN oidc_subject TEXT DEFAULT NULL;");
    }
    if (!cols.includes("oidc_repository")) {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN oidc_repository TEXT DEFAULT NULL;");
    }
    if (!cols.includes("oidc_workflow_ref")) {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN oidc_workflow_ref TEXT DEFAULT NULL;");
    }
    if (!cols.includes("oidc_run_id")) {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN oidc_run_id TEXT DEFAULT NULL;");
    }
    ctx.execute("CREATE INDEX IF NOT EXISTS idx_library_releases_oidc_repo ON library_releases(oidc_repository);");
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP INDEX IF EXISTS idx_library_releases_oidc_repo;");
    const rawCols = ctx.query<{ name: string }>("PRAGMA table_info(library_releases)");
    const cols = Array.isArray(rawCols) ? rawCols.map((c) => c.name) : [];
    for (const col of ["oidc_run_id", "oidc_workflow_ref", "oidc_repository", "oidc_subject", "oidc_issuer"]) {
      if (cols.includes(col)) {
        ctx.execute(`ALTER TABLE library_releases DROP COLUMN ${col};`);
      }
    }
  },
};
