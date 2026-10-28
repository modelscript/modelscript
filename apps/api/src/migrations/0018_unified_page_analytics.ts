// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0018: Migration = {
  id: "0018_unified_page_analytics",
  name: "0018_unified_page_analytics",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS page_views_daily (
        view_date       TEXT NOT NULL,
        surface         TEXT NOT NULL DEFAULT 'web',
        path            TEXT NOT NULL,
        views_count     INTEGER NOT NULL DEFAULT 0,
        unique_visitors INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (view_date, surface, path)
      );
      CREATE INDEX IF NOT EXISTS idx_page_views_daily_date ON page_views_daily(view_date, surface);
      CREATE INDEX IF NOT EXISTS idx_page_views_daily_path ON page_views_daily(path);

      CREATE TABLE IF NOT EXISTS page_location_stats_daily (
        view_date    TEXT NOT NULL,
        surface      TEXT NOT NULL DEFAULT 'web',
        country_code TEXT NOT NULL,
        region_code  TEXT NOT NULL DEFAULT '',
        views_count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (view_date, surface, country_code, region_code)
      );
      CREATE INDEX IF NOT EXISTS idx_page_loc_daily_date ON page_location_stats_daily(view_date, surface);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS page_location_stats_daily;
      DROP TABLE IF EXISTS page_views_daily;
    `);
  },
};
