// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0004: Add IP and CIDR subnet allowlist restrictions to personal access tokens (api_tokens)
 */
export const tokenIpCidrRestrictionsMigration: Migration = {
  id: "0004_token_ip_cidr_restrictions",
  name: "0004_token_ip_cidr_restrictions",
  async up(ctx: MigrationContext) {
    const rawCols = await ctx.query<{ name: string }>("PRAGMA table_info(api_tokens)");
    const cols = rawCols.map((c) => c.name);
    if (!cols.includes("ip_allowlist")) {
      ctx.execute("ALTER TABLE api_tokens ADD COLUMN ip_allowlist TEXT DEFAULT NULL;");
    }
  },
};
