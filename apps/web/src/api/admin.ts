// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export interface AdminModerationReport {
  id: number;
  reporter_id: number | null;
  reporter_username?: string | undefined;
  target_type: "post" | "user" | "comment" | string;
  target_id?: number | string | undefined;
  post_id?: number | undefined;
  post_content?: string | undefined;
  author_username?: string | undefined;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
  resolution_notes?: string | undefined;
  created_at: string;
  resolved_at?: string | undefined;
}

export interface AdminFederationDomain {
  domain: string;
  tier: "allow" | "silence" | "suspend";
  reason?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
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
  created_at: string;
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

export const getAdminModerationQueue = async (
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ reports: AdminModerationReport[]; count: number }> => {
  const { data } = await api.get("/admin/moderation/queue", { params: { status, limit, offset } });
  return data;
};

export const resolveAdminModerationReport = async (
  id: number,
  data: {
    status: "resolved" | "dismissed";
    resolutionNotes?: string | undefined;
    action?: "none" | "delete_post" | "silence_domain" | "suspend_domain" | undefined;
  },
): Promise<{ success: boolean; reportId: number; status: string; actionExecuted: string }> => {
  const res = await api.post(`/admin/moderation/reports/${id}/resolve`, data);
  return res.data;
};

export const deleteAdminPost = async (
  postId: number,
): Promise<{ success: boolean; postId: number; tombstonePropagated: boolean }> => {
  const { data } = await api.delete(`/admin/posts/${postId}`);
  return data;
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

export const getAdminDmcaNotices = async (status?: string): Promise<{ notices: AdminDmcaNotice[]; count: number }> => {
  const { data } = await api.get("/admin/dmca/notices", { params: { status } });
  return data;
};

export const resolveAdminDmcaNotice = async (
  id: number,
  actionTaken: string,
): Promise<{ success: boolean; noticeId: number; actionTaken: string }> => {
  const { data } = await api.post(`/admin/dmca/notices/${id}/resolve`, { actionTaken });
  return data;
};

export const getAdminAuditLogs = async (
  limit = 50,
  offset = 0,
  action?: string,
): Promise<{ logs: AdminAuditLog[]; count: number }> => {
  const { data } = await api.get("/admin/audit-logs", { params: { limit, offset, action } });
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
