// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0005: Add case-insensitive expression indexes on users(LOWER(username))
 * and users(LOWER(email)) so login, registration, and profile lookups avoid full-table scans.
 * Compatible with both SQLite and PostgreSQL.
 */
export const lowercaseUserIndexesMigration: Migration = {
  id: "0005_lowercase_user_indexes",
  name: "0005_lowercase_user_indexes",
  up(ctx: MigrationContext) {
    ctx.execute("CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));");
    ctx.execute("CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));");
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP INDEX IF EXISTS idx_users_username_lower;");
    ctx.execute("DROP INDEX IF EXISTS idx_users_email_lower;");
  },
};
