// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0008: Migration = {
  id: "0008_auth_totp_and_audit",
  name: "0008_auth_totp_and_audit",
  up(ctx: MigrationContext) {
    try {
      ctx.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT;");
    } catch {
      // Column may already exist
    }

    try {
      ctx.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;");
    } catch {
      // Column may already exist
    }

    try {
      ctx.execute("ALTER TABLE users ADD COLUMN backup_codes TEXT DEFAULT '[]';");
    } catch {
      // Column may already exist
    }

    // Ensure audit_logs index on created_at exists for compliance range filtering
    try {
      ctx.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);");
    } catch {
      // Index may already exist
    }
  },
  down(_ctx: MigrationContext) {
    // SQLite prior to 3.35.0 does not support ALTER TABLE DROP COLUMN.
    // Preserving columns preserves backward compatibility.
  },
};
