// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0004: Add IP and CIDR subnet allowlist restrictions to personal access tokens (api_tokens)
 */
export const tokenIpCidrRestrictionsMigration: Migration = {
  id: "0004_token_ip_cidr_restrictions",
  name: "0004_token_ip_cidr_restrictions",
  up(ctx: MigrationContext) {
    ctx.addColumnIfNotExists("api_tokens", "ip_allowlist", "TEXT DEFAULT NULL");
  },
  down(ctx: MigrationContext) {
    ctx.dropColumnIfExists("api_tokens", "ip_allowlist");
  },
};
