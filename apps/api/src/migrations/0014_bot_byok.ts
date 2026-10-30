// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0014: Migration = {
  id: "0014_bot_byok",
  name: "0014_bot_byok",
  up(ctx: MigrationContext) {
    try {
      ctx.execute("ALTER TABLE users ADD COLUMN bot_api_key TEXT;");
    } catch {}
    try {
      ctx.execute("ALTER TABLE users ADD COLUMN bot_endpoint_url TEXT;");
    } catch {}
  },
  down(_ctx: MigrationContext) {
    // Down migration optional for added columns in SQLite
  },
};
