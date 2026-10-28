// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0017: Migration = {
  id: "0017_commercial_hardening",
  name: "0017_commercial_hardening",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS credit_escrow_holds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount          REAL NOT NULL,
        status          TEXT DEFAULT 'held',
        description     TEXT NOT NULL,
        metadata        TEXT DEFAULT '{}',
        created_at      TEXT DEFAULT (datetime('now')),
        settled_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_credit_escrow_user ON credit_escrow_holds(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_credit_escrow_job ON credit_escrow_holds(job_id);

      CREATE TABLE IF NOT EXISTS stripe_processed_events (
        event_id          TEXT PRIMARY KEY,
        payment_intent_id TEXT UNIQUE,
        user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount_credits    REAL NOT NULL DEFAULT 0,
        processed_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_processed_pi ON stripe_processed_events(payment_intent_id);

      CREATE TABLE IF NOT EXISTS morsel_snippets (
        id           TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        dialect      TEXT NOT NULL DEFAULT 'modelica',
        title        TEXT,
        creator_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_morsel_snippets_created ON morsel_snippets(created_at);
    `);
    try {
      ctx.execute(`ALTER TABLE organizations ADD COLUMN credit_balance REAL NOT NULL DEFAULT 0.0`);
    } catch {}
    try {
      ctx.execute(`ALTER TABLE organizations ADD COLUMN total_spent REAL NOT NULL DEFAULT 0.0`);
    } catch {}
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS morsel_snippets;
      DROP TABLE IF EXISTS stripe_processed_events;
    `);
  },
};
