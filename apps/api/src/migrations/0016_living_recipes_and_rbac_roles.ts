// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0016: Living Recipe Triggers, Domain Steward RBAC & Multi-Target Model Exports.
 *
 * Adds:
 *   - `living_recipe_triggers`: automated continuous post-training triggers when RLHF
 *     campaigns complete or verified chat-harvested DPO pairs hit threshold.
 *   - `domain_steward_roles`: scoped RBAC (`reviewer`, `steward`, `release_manager`) for
 *     RLHF adjudication, campaign management, and post-train release signing.
 *   - Columns on `model_registry_entries`: `artifact_exports_json`, `shadow_traffic_pct`,
 *     `revocation_status`.
 */
export const livingRecipesAndRbacRolesMigration: Migration = {
  id: "0016_living_recipes_and_rbac_roles",
  name: "0016_living_recipes_and_rbac_roles",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS living_recipe_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_name TEXT NOT NULL,
        dialect TEXT NOT NULL DEFAULT 'polyglot',
        trigger_kind TEXT NOT NULL DEFAULT 'verified_pair_threshold'
          CHECK (trigger_kind IN ('campaign_complete', 'verified_pair_threshold', 'manual')),
        threshold_count INTEGER NOT NULL DEFAULT 25,
        target_base_model TEXT NOT NULL DEFAULT 'Qwen/Qwen2.5-Coder-1.5B',
        target_backend TEXT NOT NULL DEFAULT 'pytorch'
          CHECK (target_backend IN ('webgpu', 'pytorch', 'slurm')),
        auto_promote_staging INTEGER NOT NULL DEFAULT 1,
        last_run_uid TEXT DEFAULT NULL,
        last_triggered_at TEXT DEFAULT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(recipe_name, dialect, trigger_kind)
      );

      CREATE INDEX IF NOT EXISTS idx_living_triggers_enabled
        ON living_recipe_triggers(enabled, dialect);

      CREATE TABLE IF NOT EXISTS domain_steward_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain TEXT NOT NULL DEFAULT '*',
        role TEXT NOT NULL
          CHECK (role IN ('reviewer', 'steward', 'release_manager')),
        granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, domain, role)
      );

      CREATE INDEX IF NOT EXISTS idx_steward_roles_domain
        ON domain_steward_roles(domain, role);
    `);

    const modelColumns: [string, string][] = [
      ["artifact_exports_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["shadow_traffic_pct", "REAL NOT NULL DEFAULT 0.0"],
      ["revocation_status", "TEXT NOT NULL DEFAULT 'active'"],
    ];

    if (ctx.dialect === "sqlite") {
      const existingRows = ctx.query<{ name: string }>("PRAGMA table_info(model_registry_entries)") as {
        name: string;
      }[];
      const existingCols = new Set(existingRows.map((row) => row.name));
      for (const [col, definition] of modelColumns) {
        if (!existingCols.has(col)) {
          ctx.execute(`ALTER TABLE model_registry_entries ADD COLUMN ${col} ${definition};`);
        }
      }
    } else {
      for (const [col, definition] of modelColumns) {
        ctx.addColumnIfNotExists("model_registry_entries", col, definition);
      }
    }
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP INDEX IF EXISTS idx_steward_roles_domain;
      DROP TABLE IF EXISTS domain_steward_roles;
      DROP INDEX IF EXISTS idx_living_triggers_enabled;
      DROP TABLE IF EXISTS living_recipe_triggers;
    `);
    for (const col of ["revocation_status", "shadow_traffic_pct", "artifact_exports_json"]) {
      ctx.dropColumnIfExists("model_registry_entries", col);
    }
  },
};
