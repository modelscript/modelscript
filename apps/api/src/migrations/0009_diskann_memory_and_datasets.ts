// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0009: DiskANN NVMe Vector Memory chunks & Compiled Dynamic-m Dataset Shards.
 *
 * Supports:
 *   - Incrementally indexed chunks from Git repos, published packages, OWL2 axioms, and verified social posts
 *   - INT8 RAM-quantized routing vectors + positional offsets into the NVMe FP32 vector store
 *   - Strict RBAC tenant isolation (`public | org | project-private`) and semver lockfile pinning
 *   - Content-addressed, `m_init`-bucketed Parquet/JSONL dataset shards with cryptographic provenance
 */
export const diskannMemoryAndDatasetsMigration: Migration = {
  id: "0009_diskann_memory_and_datasets",
  name: "0009_diskann_memory_and_datasets",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        chunk_id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('package-doc', 'package-symbol', 'owl2-axiom', 'social-post', 'rlhf-verified-fix')),
        source_uri TEXT NOT NULL,
        package_name TEXT,
        package_version TEXT,
        git_sha TEXT,
        dialect TEXT NOT NULL DEFAULT 'markdown',
        tenant_scope TEXT NOT NULL DEFAULT 'public' CHECK (tenant_scope IN ('public', 'org', 'project-private')),
        org_id INTEGER,
        formal_verified INTEGER NOT NULL DEFAULT 0,
        symbol_tags_json TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        vector_dim INTEGER NOT NULL DEFAULT 256,
        vector_slot INTEGER NOT NULL,
        int8_quant_blob BLOB NOT NULL,
        quant_scale REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_chunks_pkg ON memory_chunks(package_name, package_version);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_scope ON memory_chunks(tenant_scope, org_id, dialect);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_uri ON memory_chunks(source_uri);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_kind ON memory_chunks(source_kind, formal_verified);

      CREATE TABLE IF NOT EXISTS compiled_dataset_shards (
        shard_id TEXT PRIMARY KEY,
        recipe_name TEXT NOT NULL,
        recipe_version TEXT NOT NULL DEFAULT '0.1.0',
        dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('dataset-pretrain', 'dataset-posttrain', 'training-recipe')),
        dialect TEXT NOT NULL DEFAULT 'polyglot',
        m_min INTEGER NOT NULL DEFAULT 0,
        m_max INTEGER NOT NULL DEFAULT 0,
        example_count INTEGER NOT NULL DEFAULT 0,
        storage_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        tenant_scope TEXT NOT NULL DEFAULT 'public' CHECK (tenant_scope IN ('public', 'org', 'project-private')),
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_compiled_shards_recipe ON compiled_dataset_shards(recipe_name, recipe_version);
      CREATE INDEX IF NOT EXISTS idx_compiled_shards_m ON compiled_dataset_shards(m_min, m_max);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS compiled_dataset_shards;
      DROP TABLE IF EXISTS memory_chunks;
    `);
  },
};
