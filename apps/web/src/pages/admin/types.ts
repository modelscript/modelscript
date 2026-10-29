// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AdminAnalyticsSummary,
  AdminAuditLog,
  AdminBackupInfo,
  AdminDbStatus,
  AdminDmcaNotice,
  AdminFeatureFlag,
  AdminFederationDeliveryItem,
  AdminFederationDomain,
  AdminFederationQueueStats,
  AdminModerationAction,
  AdminModerationReport,
  AdminOverviewCounts,
  AdminUserSummary,
} from "../../api";

export type {
  AdminAnalyticsSummary,
  AdminAuditLog,
  AdminBackupInfo,
  AdminDbStatus,
  AdminDmcaNotice,
  AdminFeatureFlag,
  AdminFederationDeliveryItem,
  AdminFederationDomain,
  AdminFederationQueueStats,
  AdminModerationAction,
  AdminModerationReport,
  AdminOverviewCounts,
  AdminUserSummary,
};

export type AdminTab = "moderation" | "users" | "federation" | "dmca" | "audit" | "database" | "flags" | "analytics";
