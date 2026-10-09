// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0007: Migration = {
  id: "0007_auth_security_hardening",
  name: "0007_auth_security_hardening",
  up(ctx: MigrationContext) {
    try {
      ctx.execute("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1;");
    } catch {
      // Column may already exist
    }
  },
  down(_ctx: MigrationContext) {
    // SQLite prior to 3.35.0 does not support ALTER TABLE DROP COLUMN.
    // Preserving token_version preserves backward compatibility.
  },
};
