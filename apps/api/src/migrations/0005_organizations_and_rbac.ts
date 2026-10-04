// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0005: Migration = {
  id: "0005_organizations_and_rbac",
  name: "0005_organizations_and_rbac",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        slug            TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        description     TEXT,
        avatar_url      TEXT,
        created_by      INTEGER NOT NULL REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

      CREATE TABLE IF NOT EXISTS organization_members (
        org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK(role IN ('owner', 'maintainer', 'contributor')),
        created_at      TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (org_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

      CREATE TABLE IF NOT EXISTS package_collaborators (
        library_name    TEXT NOT NULL,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission      TEXT NOT NULL CHECK(permission IN ('admin', 'write', 'read')),
        created_at      TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (library_name, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pkg_collab_user ON package_collaborators(user_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS package_collaborators;
      DROP TABLE IF EXISTS organization_members;
      DROP TABLE IF EXISTS organizations;
    `);
  },
};
