// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0016: Migration = {
  id: "0016_solutions",
  name: "0016_solutions",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS solutions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repo_id           INTEGER REFERENCES linked_repos(id) ON DELETE SET NULL,
        slug              TEXT NOT NULL,
        name              TEXT NOT NULL,
        description       TEXT,
        category          TEXT DEFAULT 'Engineering Application',
        icon              TEXT DEFAULT 'cpu',
        supported_formats TEXT DEFAULT '[]', -- JSON array of file extensions (e.g. [".slx", ".mo"])
        is_public         INTEGER DEFAULT 1,
        created_at        TEXT DEFAULT (datetime('now')),
        updated_at        TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_solutions_user ON solutions(user_id);
      CREATE INDEX IF NOT EXISTS idx_solutions_slug ON solutions(slug);

      CREATE TABLE IF NOT EXISTS solution_releases (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        solution_id        INTEGER NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
        version            TEXT NOT NULL,
        changelog          TEXT,
        bundle_url         TEXT NOT NULL, -- Static bundle or sandbox URL
        tauri_windows_url  TEXT,          -- Pre-compiled signed .exe / .msi
        tauri_linux_url    TEXT,          -- Pre-compiled AppImage
        tauri_darwin_url   TEXT,          -- Pre-compiled .dmg
        manifest_json      TEXT,          -- Copy of modelscript.app.json
        created_at         TEXT DEFAULT (datetime('now')),
        UNIQUE(solution_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_solution_releases_sol ON solution_releases(solution_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS solution_releases;
      DROP TABLE IF EXISTS solutions;
    `);
  },
};
