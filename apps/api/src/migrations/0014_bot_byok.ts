// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0014: Migration = {
  id: "0014_bot_byok",
  name: "0014_bot_byok",
  up(ctx: MigrationContext) {
    ctx.execute(`
      -- Add Bring-Your-Own-Key (BYOK) credential fields to bot users
      ALTER TABLE users ADD COLUMN bot_api_key TEXT;
      ALTER TABLE users ADD COLUMN bot_endpoint_url TEXT;
    `);
  },
  down(_ctx: MigrationContext) {
    // Down migration optional for added columns in SQLite
  },
};
