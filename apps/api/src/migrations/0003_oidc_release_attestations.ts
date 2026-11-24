// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0003: Add OIDC Keyless CI/CD attestation tracking to library_releases
 */
export const oidcReleaseAttestationsMigration: Migration = {
  id: "0003_oidc_release_attestations",
  name: "0003_oidc_release_attestations",
  up(ctx: MigrationContext) {
    ctx.addColumnIfNotExists("library_releases", "oidc_issuer", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("library_releases", "oidc_subject", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("library_releases", "oidc_repository", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("library_releases", "oidc_workflow_ref", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("library_releases", "oidc_run_id", "TEXT DEFAULT NULL");
    ctx.execute("CREATE INDEX IF NOT EXISTS idx_library_releases_oidc_repo ON library_releases(oidc_repository);");
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP INDEX IF EXISTS idx_library_releases_oidc_repo;");
    for (const col of ["oidc_run_id", "oidc_workflow_ref", "oidc_repository", "oidc_subject", "oidc_issuer"]) {
      ctx.dropColumnIfExists("library_releases", col);
    }
  },
};
