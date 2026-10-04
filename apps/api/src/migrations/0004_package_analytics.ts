// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const packageAnalyticsMigration: Migration = {
  id: "0004_package_analytics",
  name: "0004_package_analytics",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS package_downloads_daily (
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        download_date   TEXT NOT NULL,
        downloads_count INTEGER DEFAULT 0,
        PRIMARY KEY (library_name, library_version, download_date)
      );
      CREATE INDEX IF NOT EXISTS idx_pkg_dl_lookup ON package_downloads_daily(library_name, download_date);
    `);
  },
};
