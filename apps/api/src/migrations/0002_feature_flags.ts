// SPDX-License-Identifier: AGPL-3.0-or-later

import { FEATURE_FLAGS } from "../feature-flags.js";
import type { Migration, MigrationContext } from "./types.js";

export const featureFlagsMigration: Migration = {
  id: "0002_feature_flags",
  name: "0002_feature_flags",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        flag_key           TEXT PRIMARY KEY,
        is_enabled         INTEGER NOT NULL,
        rollout_percentage INTEGER DEFAULT 100,
        allowed_roles      TEXT,
        updated_at         TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);
    `);

    // Seed defaults into database
    for (const flag of Object.values(FEATURE_FLAGS)) {
      const allowedRoles = flag.allowedRoles ? flag.allowedRoles.join(",") : "";
      ctx.execute(
        `INSERT OR IGNORE INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
         VALUES ('${flag.key}', ${flag.defaultValue ? 1 : 0}, 100, '${allowedRoles}', datetime('now'));`,
      );
    }
  },
};
