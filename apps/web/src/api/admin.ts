// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export type AdminModerationAction =
  | "none"
  | "delete_post"
  | "silence_post"
  | "mark_sensitive"
  | "silence_domain"
  | "suspend_domain"
  | "freeze_user"
  | "suspend_user"
  | "restore_user";

export interface AdminModerationReport {
  id: number;
  reporter_id: number | null;
  reporter_username?: string | undefined;
  target_type: "post" | "user" | "package" | "repo" | "appeal" | "comment" | string;
  target_resource_id?: string | null | undefined;
  target_id?: number | string | undefined;
  target_user_id?: number | null | undefined;
  target_username?: string | undefined;
  post_id?: number | null | undefined;
  post_content?: string | undefined;
  post_author_id?: number | null | undefined;
  author_username?: string | undefined;
  author_domain?: string | null | undefined;
  reason: string;
  details?: string | null | undefined;
  status: "pending" | "resolved" | "dismissed";
  resolution_notes?: string | undefined;
  action_taken?: string | null | undefined;
  content_snapshot?: string | null | undefined;
  target_report_count?: number | undefined;
  author_prior_violations?: number | undefined;
  created_at: string;
  resolved_at?: string | undefined;
}

export interface AdminOverviewCounts {
  pendingReports: number;
  pendingDmca: number;
  failedDeliveries: number;
  suspendedDomains: number;
  restrictedUsers: number;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  account_type: string;
  status: string;
  email_verified: number;
  totp_enabled: number;
  credit_balance: number;
  remote_domain: string | null;
  created_at: string;
  post_count: number;
  report_count: number;
  resolved_violation_count: number;
}

export interface AdminFederationDomain {
  domain: string;
  tier: "allow" | "silence" | "suspend";
  reason?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface AdminFederationQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export interface AdminFederationDeliveryItem {
  id: number;
  activity_type: string;
  activity_id: string;
  target_inbox_url: string;
  target_domain: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AdminDmcaNotice {
  id: number;
  claimant_name: string;
  claimant_email: string;
  copyright_owner: string;
  work_description: string;
  infringing_url: string;
  resource_type?: string | undefined;
  resource_id?: string | undefined;
  status: "pending" | "resolved" | "rejected";
  action_taken?: string | undefined;
  created_at: string;
  resolved_at?: string | undefined;
}

export interface AdminAuditLog {
  id: number;
  actor_id: number | null;
  actor_username?: string | undefined;
  action: string;
  resource_type?: string | undefined;
  resource_id?: string | undefined;
  ip_address?: string | undefined;
  details?: any;
  prev_hash?: string | null | undefined;
  entry_hash?: string | null | undefined;
  created_at: string;
}

export interface AdminAuditChainVerification {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  headHash: string | null;
  brokenAtId?: number | undefined;
}

export interface AdminBackupInfo {
  fileName: string;
  filePath?: string | undefined;
  sizeBytes: number;
  createdAt: string;
}

export interface AdminDbStatus {
  currentVersion: string | number | null;
  latestVersion?: string | number | null | undefined;
  pendingCount?: number | undefined;
  applied?:
    | {
        id: number;
        name: string;
        applied_at?: string | undefined;
        checksum?: string | undefined;
        execution_ms?: number | undefined;
      }[]
    | undefined;
  pending?: { id?: number | undefined; name: string }[] | undefined;
  pendingMigrations?: { id: number; name: string }[] | undefined;
  appliedMigrations?: { id: number; name: string; applied_at?: string | undefined }[] | undefined;
}

export const getAdminOverview = async (): Promise<AdminOverviewCounts> => {
  const { data } = await api.get("/admin/overview");
  return data;
};

export const getAdminModerationQueue = async (
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ reports: AdminModerationReport[]; count: number; pendingCount?: number | undefined }> => {
  const { data } = await api.get("/admin/moderation/queue", { params: { status, limit, offset } });
  return data;
};

export const resolveAdminModerationReport = async (
  id: number,
  data: {
    status: "resolved" | "dismissed";
    resolutionNotes?: string | undefined;
    action?: AdminModerationAction | undefined;
    domain?: string | undefined;
    resolveAllForTarget?: boolean | undefined;
    contentWarning?: string | undefined;
    forwardFederatedFlag?: boolean | undefined;
  },
): Promise<{
  success: boolean;
  reportId: number;
  status: string;
  actionExecuted: string;
  federatedFlagQueued?: boolean | undefined;
}> => {
  const res = await api.post(`/admin/moderation/reports/${id}/resolve`, data);
  return res.data;
};

export const bulkResolveAdminModerationReports = async (data: {
  reportIds: number[];
  status: "resolved" | "dismissed";
  resolutionNotes?: string | undefined;
  action?: AdminModerationAction | undefined;
  contentWarning?: string | undefined;
}): Promise<{ success: boolean; resolvedCount: number; status: string }> => {
  const res = await api.post("/admin/moderation/bulk-resolve", data);
  return res.data;
};

export const deleteAdminPost = async (
  postId: number,
): Promise<{ success: boolean; postId: number; tombstonePropagated: boolean }> => {
  const { data } = await api.delete(`/admin/posts/${postId}`);
  return data;
};

export const getAdminUsers = async (options?: {
  q?: string | undefined;
  status?: string | undefined;
  role?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ users: AdminUserSummary[]; total: number; count: number }> => {
  const { data } = await api.get("/admin/users", { params: options });
  return data;
};

export const moderateAdminUser = async (
  userId: number,
  data: {
    status?: "active" | "frozen" | "suspended" | "pending_verification" | undefined;
    role?: "user" | "admin" | undefined;
    revokeSessions?: boolean | undefined;
    purgePosts?: boolean | undefined;
    reason?: string | undefined;
  },
): Promise<{
  success: boolean;
  userId: number;
  status?: string | undefined;
  role?: string | undefined;
  sessionsRevoked: boolean;
  purgedPostCount: number;
}> => {
  const res = await api.patch(`/admin/users/${userId}`, data);
  return res.data;
};

export const getAdminFederationDomains = async (): Promise<{ domains: AdminFederationDomain[]; count: number }> => {
  const { data } = await api.get("/admin/federation/domains");
  return data;
};

export const setAdminFederationDomainTier = async (
  domain: string,
  tier: "allow" | "silence" | "suspend",
  reason?: string,
): Promise<{ success: boolean; domain: string; tier: string; reason?: string | undefined }> => {
  const { data } = await api.post("/admin/federation/domains", { domain, tier, reason });
  return data;
};

export const deleteAdminFederationDomainTier = async (
  domain: string,
): Promise<{ success: boolean; domain: string }> => {
  const { data } = await api.delete(`/admin/federation/domains/${encodeURIComponent(domain)}`);
  return data;
};

export const getAdminFederationQueue = async (
  status?: string,
  domain?: string,
  limit = 50,
): Promise<{
  stats: AdminFederationQueueStats;
  deliveries: AdminFederationDeliveryItem[];
  count: number;
}> => {
  const { data } = await api.get("/admin/federation/queue", { params: { status, domain, limit } });
  return data;
};

export const retryAdminFederationQueue = async (
  domain?: string,
): Promise<{ success: boolean; retriedCount: number }> => {
  const { data } = await api.post("/admin/federation/queue/retry", domain ? { domain } : {});
  return data;
};

export const purgeAdminFederationQueue = async (
  status = "failed",
  domain?: string,
): Promise<{ success: boolean; deletedCount: number }> => {
  const { data } = await api.delete("/admin/federation/queue", { params: { status, domain } });
  return data;
};

export const getAdminDmcaNotices = async (status?: string): Promise<{ notices: AdminDmcaNotice[]; count: number }> => {
  const { data } = await api.get("/admin/dmca/notices", { params: { status } });
  return data;
};

export const resolveAdminDmcaNotice = async (
  id: number,
  actionTaken: string,
  options?: {
    status?: "resolved" | "rejected" | undefined;
    quarantineResource?: boolean | undefined;
  },
): Promise<{ success: boolean; noticeId: number; status?: string | undefined; actionTaken: string }> => {
  const payload = options ? { actionTaken, ...options } : { actionTaken };
  const { data } = await api.post(`/admin/dmca/notices/${id}/resolve`, payload);
  return data;
};

export const getAdminAuditLogs = async (
  limit = 50,
  offset = 0,
  action?: string,
  resourceType?: string,
): Promise<{ logs: AdminAuditLog[]; count: number }> => {
  const params: Record<string, any> = { limit, offset, action };
  if (resourceType !== undefined) {
    params.resourceType = resourceType;
  }
  const { data } = await api.get("/admin/audit-logs", { params });
  return data;
};

export const verifyAdminAuditLogsChain = async (): Promise<AdminAuditChainVerification> => {
  const { data } = await api.get("/admin/audit-logs/verify");
  return data;
};

export const getAdminDbStatus = async (): Promise<AdminDbStatus> => {
  const { data } = await api.get("/admin/db/status");
  return data;
};

export const runAdminDbUpgrade = async (options?: {
  dryRun?: boolean | undefined;
  skipBackup?: boolean | undefined;
}): Promise<{
  success: boolean;
  appliedCount?: number | undefined;
  dryRun?: boolean | undefined;
  error?: string | undefined;
}> => {
  const { data } = await api.post("/admin/db/upgrade", options || {});
  return data;
};

export const verifyAdminDbIntegrity = async (): Promise<{
  valid?: boolean | undefined;
  foreignKeysOk?: boolean | undefined;
  integrityOk?: boolean | undefined;
  issues?: string[] | undefined;
}> => {
  const { data } = await api.get("/admin/db/verify");
  return data;
};

export const getAdminBackups = async (): Promise<{ backups: AdminBackupInfo[]; count: number }> => {
  const { data } = await api.get("/admin/backups");
  return data;
};

export const createAdminHotBackup = async (label?: string): Promise<{ success: boolean; backup: AdminBackupInfo }> => {
  const { data } = await api.post("/admin/backup", label ? { label } : {});
  return data;
};

export interface AdminFeatureFlag {
  key: string;
  name: string;
  description: string;
  defaultValue: boolean;
  category: string;
  maturity: string;
  allowedRoles?: string[] | undefined;
  currentEnabled: boolean;
  rolloutPercentage: number;
  dbAllowedRoles: string[];
}

export const getAdminFeatureFlags = async (): Promise<{ flags: AdminFeatureFlag[] }> => {
  const { data } = await api.get("/admin/flags");
  return data;
};

export const patchAdminFeatureFlag = async (
  key: string,
  isEnabled: boolean,
  allowedRoles?: string,
  rolloutPercentage?: number,
): Promise<{ success: boolean; key: string; isEnabled: boolean }> => {
  const { data } = await api.patch(`/admin/flags/${key}`, { isEnabled, allowedRoles, rolloutPercentage });
  return data;
};

export interface AdminAnalyticsSummary {
  days: number;
  surface: "all" | "web" | "docs";
  totals: {
    totalViews: number;
    uniqueViews: number;
    webViews: number;
    docsViews: number;
    totalPostViews: number;
    totalPackageDownloads: number;
  };
  dailySeries: {
    day: string;
    views: number;
    uniqueViews: number;
  }[];
  topPages: {
    path: string;
    surface: string;
    views: number;
    uniqueViews: number;
  }[];
  countryBreakdown: {
    countryCode: string;
    views: number;
  }[];
  regionBreakdown: {
    countryCode: string;
    region: string;
    views: number;
  }[];
  geoipConfigured?: boolean | undefined;
}

export const getAdminAnalytics = async (
  days = 30,
  surface: "all" | "web" | "docs" = "all",
): Promise<AdminAnalyticsSummary> => {
  const { data } = await api.get("/admin/analytics", { params: { days, surface } });
  return data;
};

export const pruneAdminAnalytics = async (
  retainDays = 90,
): Promise<{
  success: boolean;
  retainDays: number;
  deletedDailyRows: number;
  deletedLocationRows: number;
}> => {
  const { data } = await api.post("/admin/analytics/prune", { retainDays });
  return data;
};

export const recordPageViewBeacon = (path: string, surface: "web" | "docs" = "web"): void => {
  const cleanPath = (path || "/").split(/[?#]/)[0] || "/";
  const payload = JSON.stringify({ path: cleanPath, surface });

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/v1/analytics/pageview", blob);
      return;
    }
  } catch {
    // Fall back to api.post below
  }

  api.post("/analytics/pageview", { path: cleanPath, surface }).catch(() => {});
};
