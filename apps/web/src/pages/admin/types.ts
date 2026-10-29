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
  AdminInstanceInvite,
  AdminInstanceSettings,
  AdminModerationAction,
  AdminModerationReport,
  AdminOverviewCounts,
  AdminQuarantinedResource,
  AdminSystemDiagnosticsResponse,
  AdminUsersStatusBreakdown,
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
  AdminInstanceInvite,
  AdminInstanceSettings,
  AdminModerationAction,
  AdminModerationReport,
  AdminOverviewCounts,
  AdminQuarantinedResource,
  AdminSystemDiagnosticsResponse,
  AdminUsersStatusBreakdown,
  AdminUserSummary,
};

export type AdminTab =
  | "moderation"
  | "users"
  | "federation"
  | "dmca"
  | "audit"
  | "database"
  | "flags"
  | "analytics"
  | "settings"
  | "system";
