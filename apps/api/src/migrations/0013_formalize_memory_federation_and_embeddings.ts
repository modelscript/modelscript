// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0013: Formalize Memory Shard Manifests, Federated Attestations & Peers,
 * DiskANN Embedding/Hygiene Columns, and Persistent Instance Signing Keys.
 *
 * Promotes previously lazy-created tables into versioned migrations and adds:
 *   - `memory_shard_manifests`
 *   - `federated_verification_attestations`
 *   - `federated_memory_peers`
 *   - `persistent_signing_keys` (Ed25519 key persistence across restarts)
 *   - `memory_chunks` hygiene & multi-modal metadata columns (`embedding_model_id`,
 *     `content_sha256`, `is_quarantined`, `tombstoned_at`, `author_user_id`,
 *     `qudv_units_json`, `modality_kind`, `geom_descriptor_blob`, `independent_reproductions`)
 */
export const formalizeMemoryFederationAndEmbeddingsMigration: Migration = {
  id: "0013_formalize_memory_federation_and_embeddings",
  name: "0013_formalize_memory_federation_and_embeddings",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS memory_shard_manifests (
        shard_id TEXT PRIMARY KEY,
        recipe_name TEXT NOT NULL,
        recipe_version TEXT NOT NULL DEFAULT '0.1.0',
        dataset_kind TEXT NOT NULL DEFAULT 'memory-shard',
        dialect TEXT NOT NULL DEFAULT 'polyglot',
        origin_node TEXT NOT NULL DEFAULT 'local',
        signer_pubkey TEXT NOT NULL DEFAULT '',
        memory_contract_json TEXT NOT NULL,
        ai_governance_json TEXT NOT NULL,
        example_count INTEGER NOT NULL DEFAULT 0,
        byte_size INTEGER NOT NULL DEFAULT 0,
        tenant_scope TEXT NOT NULL DEFAULT 'public',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_shard_manifests_name
        ON memory_shard_manifests(recipe_name, recipe_version);

      CREATE TABLE IF NOT EXISTS federated_verification_attestations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_release_id TEXT NOT NULL,
        manifest_cid TEXT NOT NULL,
        verifier_node TEXT NOT NULL,
        verifier_pubkey TEXT NOT NULL,
        gate1 INTEGER NOT NULL DEFAULT 0,
        gate2 INTEGER NOT NULL DEFAULT 0,
        gate3 INTEGER NOT NULL DEFAULT 0,
        gate4 INTEGER NOT NULL DEFAULT 0,
        all_gates_passed INTEGER NOT NULL DEFAULT 0,
        verified_at_iso TEXT NOT NULL,
        proof_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(target_release_id, verifier_node, verifier_pubkey)
      );

      CREATE INDEX IF NOT EXISTS idx_fed_attest_release
        ON federated_verification_attestations(target_release_id);
      CREATE INDEX IF NOT EXISTS idx_fed_attest_cid
        ON federated_verification_attestations(manifest_cid);

      CREATE TABLE IF NOT EXISTS federated_memory_peers (
        peer_url TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        public_key_multibase TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT,
        last_latency_ms REAL
      );

      CREATE TABLE IF NOT EXISTS persistent_signing_keys (
        key_purpose TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL DEFAULT 'ed25519',
        private_key_pem TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        public_key_multibase TEXT NOT NULL,
        fingerprint_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        rotated_at TEXT
      );
    `);

    const memoryChunkColumns: [string, string][] = [
      ["embedding_model_id", "TEXT NOT NULL DEFAULT 'deterministic-fnv1a-256'"],
      ["content_sha256", "TEXT DEFAULT NULL"],
      ["is_quarantined", "INTEGER NOT NULL DEFAULT 0"],
      ["tombstoned_at", "TEXT DEFAULT NULL"],
      ["author_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
      ["qudv_units_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["modality_kind", "TEXT NOT NULL DEFAULT 'code'"],
      ["geom_descriptor_blob", "BLOB DEFAULT NULL"],
      ["independent_reproductions", "INTEGER NOT NULL DEFAULT 0"],
    ];

    if (ctx.dialect === "sqlite") {
      const existingRows = ctx.query<{ name: string }>("PRAGMA table_info(memory_chunks)") as {
        name: string;
      }[];
      const existingCols = new Set(existingRows.map((row) => row.name));
      for (const [col, definition] of memoryChunkColumns) {
        if (!existingCols.has(col)) {
          ctx.execute(`ALTER TABLE memory_chunks ADD COLUMN ${col} ${definition};`);
        }
      }
    } else {
      for (const [col, definition] of memoryChunkColumns) {
        ctx.addColumnIfNotExists("memory_chunks", col, definition);
      }
    }

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding_model
        ON memory_chunks(embedding_model_id);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_quarantine
        ON memory_chunks(is_quarantined, tombstoned_at);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_content_sha256
        ON memory_chunks(content_sha256);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_modality
        ON memory_chunks(modality_kind, dialect);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP INDEX IF EXISTS idx_memory_chunks_modality;
      DROP INDEX IF EXISTS idx_memory_chunks_content_sha256;
      DROP INDEX IF EXISTS idx_memory_chunks_quarantine;
      DROP INDEX IF EXISTS idx_memory_chunks_embedding_model;
      DROP TABLE IF EXISTS persistent_signing_keys;
      DROP TABLE IF EXISTS federated_memory_peers;
      DROP TABLE IF EXISTS federated_verification_attestations;
      DROP TABLE IF EXISTS memory_shard_manifests;
    `);
    for (const col of [
      "independent_reproductions",
      "geom_descriptor_blob",
      "modality_kind",
      "qudv_units_json",
      "author_user_id",
      "tombstoned_at",
      "is_quarantined",
      "content_sha256",
      "embedding_model_id",
    ]) {
      ctx.dropColumnIfExists("memory_chunks", col);
    }
  },
};
