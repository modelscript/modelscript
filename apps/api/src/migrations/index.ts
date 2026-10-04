// SPDX-License-Identifier: AGPL-3.0-or-later

import { baselineMigration } from "./0001_baseline.js";
import { featureFlagsMigration } from "./0002_feature_flags.js";
import { packageLifecycleMigration } from "./0003_package_lifecycle.js";
import { packageAnalyticsMigration } from "./0004_package_analytics.js";
import { migration0005 } from "./0005_organizations_and_rbac.js";
import { migration0006 } from "./0006_repo_webhooks.js";
import type { Migration } from "./types.js";

export * from "./runner.js";
export * from "./types.js";

export const allMigrations: Migration[] = [
  baselineMigration,
  featureFlagsMigration,
  packageLifecycleMigration,
  packageAnalyticsMigration,
  migration0005,
  migration0006,
];
