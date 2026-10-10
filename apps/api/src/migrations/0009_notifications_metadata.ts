// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0009: Migration = {
  id: "0009_notifications_metadata",
  name: "0009_notifications_metadata",
  up(ctx: MigrationContext) {
    try {
      ctx.execute("ALTER TABLE notifications ADD COLUMN metadata TEXT;");
    } catch {
      // Column may already exist
    }

    try {
      ctx.execute("CREATE INDEX IF NOT EXISTS idx_notifs_type_user ON notifications(user_id, type, read);");
    } catch {
      // Index may already exist
    }
  },
  down(_ctx: MigrationContext) {
    // SQLite prior to 3.35.0 does not support ALTER TABLE DROP COLUMN.
    // Retaining columns preserves backward compatibility.
  },
};
