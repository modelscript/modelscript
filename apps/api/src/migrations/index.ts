// SPDX-License-Identifier: AGPL-3.0-or-later

import { baselineMigration } from "./0001_baseline.js";
import { spaceIssuesExternalMigration } from "./0002_space_issues_external.js";
import { oidcReleaseAttestationsMigration } from "./0003_oidc_release_attestations.js";
import { tokenIpCidrRestrictionsMigration } from "./0004_token_ip_cidr_restrictions.js";
import { lowercaseUserIndexesMigration } from "./0005_lowercase_user_indexes.js";
import { sysml2ProjectOwnersMigration } from "./0006_sysml2_project_owners.js";
import type { Migration } from "./types.js";

export * from "./runner.js";
export * from "./types.js";

export const allMigrations: Migration[] = [
  baselineMigration,
  spaceIssuesExternalMigration,
  oidcReleaseAttestationsMigration,
  tokenIpCidrRestrictionsMigration,
  lowercaseUserIndexesMigration,
  sysml2ProjectOwnersMigration,
];
