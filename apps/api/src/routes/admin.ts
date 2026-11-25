// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { type Router } from "express";
import type { LibraryDatabase } from "../database.js";
import type { FeatureFlagService } from "../services/feature-flag-service.js";
import type { FederationWorker } from "../services/federation-worker.js";
import { SETUP_TIER_PRESETS, resolveTierPreset, type SetupTierPreset } from "../util/tier-presets.js";
import { createAdminSudoVerifier, type AdminRouteContext } from "./admin/admin-helpers.js";
import { createAnalyticsAndAuditRouter } from "./admin/analytics-and-audit.js";
import { createDatabaseAndBackupsRouter } from "./admin/database-and-backups.js";
import { createDmcaAndQuarantineRouter } from "./admin/dmca-and-quarantine.js";
import { createEmailAndOutboxRouter } from "./admin/email-and-outbox.js";
import { createFederationAndRelaysRouter } from "./admin/federation-and-relays.js";
import { createInstanceAndSetupRouter } from "./admin/instance-and-setup.js";
import { createInvitesAndWaitlistRouter } from "./admin/invites-and-waitlist.js";
import { createModerationRouter } from "./admin/moderation.js";
import { createSettingsAndSystemRouter } from "./admin/settings-and-system.js";
import { createUsersAndGovernanceRouter } from "./admin/users-and-governance.js";

export { SETUP_TIER_PRESETS, resolveTierPreset, type SetupTierPreset };

export function adminRouter(
  database: LibraryDatabase,
  worker?: FederationWorker,
  featureFlagService?: FeatureFlagService,
): Router {
  const router = express.Router();
  const ctx: AdminRouteContext = {
    database,
    worker,
    featureFlagService,
    verifyAdminSudo: createAdminSudoVerifier(database),
  };

  router.use(createInstanceAndSetupRouter(ctx));
  router.use(createModerationRouter(ctx));
  router.use(createUsersAndGovernanceRouter(ctx));
  router.use(createFederationAndRelaysRouter(ctx));
  router.use(createAnalyticsAndAuditRouter(ctx));
  router.use(createDmcaAndQuarantineRouter(ctx));
  router.use(createDatabaseAndBackupsRouter(ctx));
  router.use(createSettingsAndSystemRouter(ctx));
  router.use(createInvitesAndWaitlistRouter(ctx));
  router.use(createEmailAndOutboxRouter(ctx));

  return router;
}
