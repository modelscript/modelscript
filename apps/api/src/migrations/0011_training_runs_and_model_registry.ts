// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0011: Model Registry Entries, Live Training Runs, and Step-Level Telemetry Metrics.
 *
 * Supports:
 *   - Certified Model Registry (`model-core`, `lora-adapter`, `projection-head`) with formal eval reports,
 *     zonotope certificates, Ed25519 promotion attestations, and content-addressed chunked weight storage
 *   - Multi-backend training run tracking (`webgpu`, `pytorch`, `slurm`) with checkpoint & eval linkage
 *   - Ordered step-level Dynamic-m generator lifecycle and formal gate telemetry (`training_run_metrics`)
 */
export const trainingRunsAndModelRegistryMigration: Migration = {
  id: "0011_training_runs_and_model_registry",
  name: "0011_training_runs_and_model_registry",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS model_registry_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('model-core', 'lora-adapter', 'projection-head')),
        base_model_ref TEXT,
        recipe_name TEXT,
        recipe_version TEXT,
        promotion_stage TEXT NOT NULL DEFAULT 'draft' CHECK (promotion_stage IN ('draft', 'staging', 'production', 'deprecated')),
        parameter_scale TEXT,
        lora_rank INTEGER,
        projection_layer_index INTEGER,
        retriever_embedding_dim INTEGER,
        memory_contract_json TEXT,
        eval_report_json TEXT,
        zonotope_cert_json TEXT,
        ed25519_proof_json TEXT,
        weight_sha256 TEXT,
        weight_bytes INTEGER NOT NULL DEFAULT 0,
        storage_key TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, version)
      );

      CREATE INDEX IF NOT EXISTS idx_model_registry_name_stage
        ON model_registry_entries(name, promotion_stage);
      CREATE INDEX IF NOT EXISTS idx_model_registry_kind_stage
        ON model_registry_entries(kind, promotion_stage);
      CREATE INDEX IF NOT EXISTS idx_model_registry_base_ref
        ON model_registry_entries(base_model_ref);

      CREATE TABLE IF NOT EXISTS training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_uid TEXT NOT NULL UNIQUE,
        recipe_name TEXT NOT NULL,
        recipe_version TEXT NOT NULL DEFAULT '0.1.0',
        model_name TEXT,
        backend TEXT NOT NULL CHECK (backend IN ('webgpu', 'pytorch', 'slurm')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        hyperparams_json TEXT NOT NULL DEFAULT '{}',
        shard_ids_json TEXT NOT NULL DEFAULT '[]',
        slurm_job_id TEXT,
        latest_checkpoint_key TEXT,
        eval_report_json TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_training_runs_status
        ON training_runs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_training_runs_recipe
        ON training_runs(recipe_name, recipe_version);
      CREATE INDEX IF NOT EXISTS idx_training_runs_backend
        ON training_runs(backend);

      CREATE TABLE IF NOT EXISTS training_run_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        epoch REAL,
        center_loss REAL,
        worst_case_loss REAL,
        m_active INTEGER,
        max_spread_delta_t REAL,
        pruned_count INTEGER NOT NULL DEFAULT 0,
        merged_count INTEGER NOT NULL DEFAULT 0,
        expanded_count INTEGER NOT NULL DEFAULT 0,
        girard_cap_count INTEGER NOT NULL DEFAULT 0,
        gate1_to_4_pass_rate REAL,
        ece REAL,
        wq_recall_at_k REAL,
        extra_json TEXT NOT NULL DEFAULT '{}',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_training_run_metrics_run_step
        ON training_run_metrics(run_id, step, id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS training_run_metrics;
      DROP TABLE IF EXISTS training_runs;
      DROP TABLE IF EXISTS model_registry_entries;
    `);
  },
};
