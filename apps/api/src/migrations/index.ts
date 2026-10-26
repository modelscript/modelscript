// SPDX-License-Identifier: AGPL-3.0-or-later

import { baselineMigration } from "./0001_baseline.js";
import { featureFlagsMigration } from "./0002_feature_flags.js";
import { packageLifecycleMigration } from "./0003_package_lifecycle.js";
import { packageAnalyticsMigration } from "./0004_package_analytics.js";
import { migration0005 } from "./0005_organizations_and_rbac.js";
import { migration0006 } from "./0006_repo_webhooks.js";
import { migration0007 } from "./0007_auth_security_hardening.js";
import { migration0008 } from "./0008_auth_totp_and_audit.js";
import { migration0009 } from "./0009_notifications_metadata.js";
import { migration0010 } from "./0010_thread_governance.js";
import { migration0011 } from "./0011_concurrent_engineering.js";
import { migration0012 } from "./0012_granular_api_tokens.js";
import { migration0013 } from "./0013_social_llm_bots.js";
import { migration0014 } from "./0014_bot_byok.js";
import { migration0015 } from "./0015_repo_bot_reviews.js";
import { migration0016 } from "./0016_solutions.js";
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
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
];
