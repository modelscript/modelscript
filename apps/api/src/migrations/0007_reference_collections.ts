// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0007: Formalize reference_collections and reference_library_items tables
 * (previously only created via inline DDL in database.ts).
 */
export const referenceCollectionsMigration: Migration = {
  id: "0007_reference_collections",
  name: "0007_reference_collections",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS reference_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        color TEXT NOT NULL DEFAULT '#1d9bf0',
        icon TEXT NOT NULL DEFAULT 'folder',
        is_public INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER REFERENCES reference_collections(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_reference_collections_user ON reference_collections(user_id);

      CREATE TABLE IF NOT EXISTS reference_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_id INTEGER NOT NULL,
        collection_id INTEGER REFERENCES reference_collections(id) ON DELETE SET NULL,
        reading_status TEXT NOT NULL DEFAULT 'to_read',
        rating INTEGER,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        custom_citation_key TEXT,
        local_pdf_url TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, work_id)
      );

      CREATE INDEX IF NOT EXISTS idx_reference_library_user ON reference_library_items(user_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS reference_library_items;
      DROP TABLE IF EXISTS reference_collections;
    `);
  },
};
