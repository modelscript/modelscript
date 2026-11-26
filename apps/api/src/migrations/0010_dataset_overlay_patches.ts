// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0010: Immutable Dataset Overlay Patches (`dataset_overlay_patches`).
 *
 * Stores append-only quarantine, source-patch, and Relational Hypergraph token override
 * patches applied on top of compiled dataset recipes without mutating upstream source packages.
 */
export const datasetOverlayPatchesMigration: Migration = {
  id: "0010_dataset_overlay_patches",
  name: "0010_dataset_overlay_patches",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS dataset_overlay_patches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_name TEXT NOT NULL,
        example_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('quarantine', 'patch_source', 'hypergraph_override')),
        reason TEXT NOT NULL DEFAULT '',
        patched_source TEXT,
        overrides_json TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_dataset_overlay_patches_recipe_example
        ON dataset_overlay_patches(recipe_name, example_id);
      CREATE INDEX IF NOT EXISTS idx_dataset_overlay_patches_example
        ON dataset_overlay_patches(example_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS dataset_overlay_patches;
    `);
  },
};
