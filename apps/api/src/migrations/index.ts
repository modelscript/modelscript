// SPDX-License-Identifier: AGPL-3.0-or-later

import { baselineMigration } from "./0001_baseline.js";
import { featureFlagsMigration } from "./0002_feature_flags.js";
import type { Migration } from "./types.js";

export * from "./runner.js";
export * from "./types.js";

export const allMigrations: Migration[] = [baselineMigration, featureFlagsMigration];
