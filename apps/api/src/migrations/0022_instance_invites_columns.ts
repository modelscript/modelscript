// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0022: Migration = {
  id: "0022",
  name: "0022_instance_invites_columns",
  up(ctx: MigrationContext) {
    try {
      ctx.execute(`ALTER TABLE instance_invites ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0;`);
    } catch {}
    try {
      ctx.execute(`ALTER TABLE instance_invites ADD COLUMN uses_count INTEGER NOT NULL DEFAULT 0;`);
    } catch {}
    try {
      ctx.execute(`ALTER TABLE instance_invites ADD COLUMN revoked_at TEXT;`);
    } catch {}
    try {
      ctx.execute(`
        UPDATE instance_invites SET used_count = uses_count WHERE used_count = 0 AND uses_count > 0;
        UPDATE instance_invites SET uses_count = used_count WHERE uses_count = 0 AND used_count > 0;
      `);
    } catch {}
  },
  down() {
    // SQLite doesn't support dropping columns safely in older versions; no-op
  },
};
