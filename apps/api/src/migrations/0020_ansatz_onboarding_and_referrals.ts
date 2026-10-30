// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0020: Migration = {
  id: "0020_ansatz_onboarding_and_referrals",
  name: "0020_ansatz_onboarding_and_referrals",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS user_referrals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referee_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        invite_id       INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        reward_granted  INTEGER NOT NULL DEFAULT 0,
        reward_amount   REAL NOT NULL DEFAULT 0.0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referrer ON user_referrals(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referee ON user_referrals(referee_id);

      CREATE TABLE IF NOT EXISTS waitlist_submissions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        email           TEXT NOT NULL UNIQUE,
        full_name       TEXT,
        organization    TEXT,
        discipline      TEXT,
        portfolio_url   TEXT,
        statement       TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        invite_code_id  INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        ip_address      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_submissions(email);
    `);

    try {
      ctx.execute("ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0;");
    } catch {
      // Column may already exist
    }

    try {
      ctx.execute("ALTER TABLE users ADD COLUMN engineering_persona TEXT;");
    } catch {
      // Column may already exist
    }

    try {
      ctx.execute("ALTER TABLE users ADD COLUMN invites_remaining INTEGER DEFAULT 5;");
    } catch {
      // Column may already exist
    }
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS waitlist_submissions;
      DROP TABLE IF EXISTS user_referrals;
    `);
  },
};
