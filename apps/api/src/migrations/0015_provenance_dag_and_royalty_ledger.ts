// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0015: Merkle-SLSA Provenance DAG, Attribution Weights & Creator Royalty Ledger.
 *
 * Adds:
 *   - `provenance_nodes`: content-addressed CID DAG connecting source commits, social posts,
 *     verified fixes, RLHF annotations, shards, training runs, and model weights.
 *   - `attribution_weights`: normalized contributor weight vectors (structural, retrieval Δ_t,
 *     LoRA DataInf/TRAK influence sketches, and RLHF trust-weighted votes).
 *   - `attribution_royalty_ledger`: double-entry creator payout ledger linked to credit_transactions.
 */
export const provenanceDagAndRoyaltyLedgerMigration: Migration = {
  id: "0015_provenance_dag_and_royalty_ledger",
  name: "0015_provenance_dag_and_royalty_ledger",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS provenance_nodes (
        cid TEXT PRIMARY KEY,
        node_kind TEXT NOT NULL
          CHECK (node_kind IN (
            'source-commit', 'package-release', 'social-post', 'verified-fix',
            'rlhf-annotation', 'overlay-patch', 'dataset-shard', 'memory-shard',
            'training-run', 'model-weights', 'eval-attestation', 'wam-fmu'
          )),
        ref_id TEXT NOT NULL,
        parent_cids_json TEXT NOT NULL DEFAULT '[]',
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        org_id INTEGER DEFAULT NULL,
        governance_json TEXT NOT NULL DEFAULT '{}',
        ed25519_sig TEXT NOT NULL DEFAULT '',
        signer_pubkey TEXT NOT NULL DEFAULT '',
        revoked_at TEXT DEFAULT NULL,
        revocation_reason TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_prov_nodes_kind_ref ON provenance_nodes(node_kind, ref_id);
      CREATE INDEX IF NOT EXISTS idx_prov_nodes_author ON provenance_nodes(author_user_id);
      CREATE INDEX IF NOT EXISTS idx_prov_nodes_revoked ON provenance_nodes(revoked_at);

      CREATE TABLE IF NOT EXISTS attribution_weights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_cid TEXT NOT NULL REFERENCES provenance_nodes(cid) ON DELETE CASCADE,
        contributor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_cid TEXT DEFAULT NULL,
        method TEXT NOT NULL DEFAULT 'structural'
          CHECK (method IN ('structural', 'retrieval_delta', 'lora_datainf', 'rlhf_trust')),
        weight REAL NOT NULL DEFAULT 0.0,
        computed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(artifact_cid, contributor_user_id, source_cid, method)
      );

      CREATE INDEX IF NOT EXISTS idx_attr_weights_artifact ON attribution_weights(artifact_cid);
      CREATE INDEX IF NOT EXISTS idx_attr_weights_contributor ON attribution_weights(contributor_user_id);

      CREATE TABLE IF NOT EXISTS attribution_royalty_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_credit_tx_id INTEGER DEFAULT NULL,
        recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        artifact_cid TEXT DEFAULT NULL,
        reason TEXT NOT NULL
          CHECK (reason IN (
            'retrieval_receipt', 'shard_royalty', 'campaign_bounty',
            'fix_it_bounty', 'recipe_royalty', 'model_royalty'
          )),
        amount_credits REAL NOT NULL DEFAULT 0.0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        settled_tx_id INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_royalty_recipient ON attribution_royalty_ledger(recipient_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_royalty_artifact ON attribution_royalty_ledger(artifact_cid);
      CREATE INDEX IF NOT EXISTS idx_royalty_settled ON attribution_royalty_ledger(settled_tx_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP INDEX IF EXISTS idx_royalty_settled;
      DROP INDEX IF EXISTS idx_royalty_artifact;
      DROP INDEX IF EXISTS idx_royalty_recipient;
      DROP TABLE IF EXISTS attribution_royalty_ledger;
      DROP INDEX IF EXISTS idx_attr_weights_contributor;
      DROP INDEX IF EXISTS idx_attr_weights_artifact;
      DROP TABLE IF EXISTS attribution_weights;
      DROP INDEX IF EXISTS idx_prov_nodes_revoked;
      DROP INDEX IF EXISTS idx_prov_nodes_author;
      DROP INDEX IF EXISTS idx_prov_nodes_kind_ref;
      DROP TABLE IF EXISTS provenance_nodes;
    `);
  },
};
