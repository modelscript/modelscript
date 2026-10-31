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
  AdminSystemHealth,
  AdminUsersStatusBreakdown,
  AdminUserSummary,
  AdminWaitlistEntry,
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
  AdminSystemHealth,
  AdminUsersStatusBreakdown,
  AdminUserSummary,
  AdminWaitlistEntry,
};

export type AdminTab =
  | "moderation"
  | "users"
  | "waitlist"
  | "federation"
  | "dmca"
  | "audit"
  | "database"
  | "flags"
  | "analytics"
  | "settings"
  | "system";
