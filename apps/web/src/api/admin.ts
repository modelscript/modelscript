// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export type AdminModerationAction =
  | "none"
  | "delete_post"
  | "quarantine_resource"
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

export interface AdminUsersStatusBreakdown {
  active: number;
  frozen: number;
  suspended: number;
  admins: number;
  moderators: number;
  auditors: number;
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
  payload?: string | undefined;
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

export interface AdminQuarantinedResource {
  id: number;
  resource_type: string;
  resource_id: string;
  reason: string;
  dmca_notice_id: number | null;
  quarantined_by: number | null;
  status: string;
  counter_notice: string | null;
  restore_after: string | null;
  created_at: string;
  restored_at: string | null;
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
  backupPath?: string | undefined;
  sizeBytes: number;
  createdAt: string;
  sha256?: string | undefined;
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

export interface AdminPreflightCheckItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  remediation?: string | undefined;
}

export interface AdminPreflightResult {
  readyForProduction: boolean;
  checks: AdminPreflightCheckItem[];
}

export interface AdminInstanceSettings {
  instanceName: string;
  instanceBadge?: string | undefined;
  instanceTagline?: string | undefined;
  instanceDescription: string;
  contactEmail: string;
  brandLogoUrl?: string | undefined;
  brandLogoDarkUrl?: string | undefined;
  brandFaviconUrl?: string | undefined;
  brandAccentColor?: string | undefined;
  docsBaseUrl?: string | undefined;
  showPoweredBy?: boolean | undefined;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  allowedEmailDomains: string[];
  federationMode: "open" | "allowlist" | "disabled";
  maintenanceMode: boolean;
  maintenanceLevel?: "off" | "scheduled" | "read_only" | "lockdown" | undefined;
  maintenanceEta?: string | undefined;
  maintenanceStartedAt?: string | undefined;
  announcementBanner: string;
  announcementLevel: "info" | "warning" | "critical";
  autoQuarantineReportThreshold: number;
  backupRetentionCount: number;
  autoBackupIntervalHours?: number | undefined;
  autoFilterKeywords?: string[] | undefined;
  autoFilterAction?: "cw" | "silence" | "quarantine" | undefined;
  customTermsMarkdown?: string | undefined;
  customPrivacyMarkdown?: string | undefined;
  lockedByEnv: string[];
}

export interface AdminInstanceInvite {
  id: number;
  code: string;
  created_by: number | null;
  creator_username: string | null;
  max_uses: number;
  used_count: number;
  initial_credits: number;
  assigned_role: string;
  note: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AdminSystemDiagnosticsResponse {
  edition: "ce" | "ee";
  uptimeSeconds: number;
  nodeVersion: string;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  geoipReady: boolean;
  mailerConfigured: boolean;
  mailerDriver?: string | undefined;
  airgapMode: boolean;
  auditChainValid: boolean;
  auditVerifiedEntries: number;
  schemaVersion: string | null;
  pendingMigrations: number;
  preflight?: AdminPreflightResult | undefined;
  diagnostics: {
    dbSizeBytes: number;
    walSizeBytes: number;
    counts: {
      users: number;
      posts: number;
      packages: number;
      repositories: number;
      jobs: number;
      auditLogs: number;
      pendingReports: number;
      quarantinedResources: number;
    };
    backups: {
      count: number;
      totalBytes: number;
      latestAt: string | null;
    };
    jobQueue: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
  };
  settings: AdminInstanceSettings;
}

export const getTotalAdminBadgeCount = (counts?: AdminOverviewCounts | null): number => {
  if (!counts) return 0;
  return (
    (Number(counts.pendingReports) || 0) +
    (Number(counts.restrictedUsers) || 0) +
    (Number(counts.failedDeliveries) || 0) +
    (Number(counts.pendingDmca) || 0)
  );
};

const notifyAdminOverviewUpdated = (detail?: AdminOverviewCounts) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("modelscript:admin-overview-update", detail ? { detail } : undefined));
  }
};

export const getAdminOverview = async (): Promise<AdminOverviewCounts> => {
  const { data } = await api.get("/admin/overview");
  notifyAdminOverviewUpdated(data);
  return data;
};

export const getAdminModerationQueue = async (
  status?: string,
  limit = 50,
  offset = 0,
  targetType?: string,
  q?: string,
): Promise<{
  reports: AdminModerationReport[];
  count: number;
  total?: number | undefined;
  pendingCount?: number | undefined;
}> => {
  const params: Record<string, unknown> = { status, limit, offset };
  if (targetType !== undefined) {
    params.targetType = targetType;
  }
  if (q !== undefined) {
    params.q = q;
  }
  const { data } = await api.get("/admin/moderation/queue", {
    params,
  });
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
  notifyAdminOverviewUpdated();
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
  notifyAdminOverviewUpdated();
  return res.data;
};

export const deleteAdminPost = async (
  postId: number,
): Promise<{ success: boolean; postId: number; tombstonePropagated: boolean }> => {
  const { data } = await api.delete(`/admin/posts/${postId}`);
  notifyAdminOverviewUpdated();
  return data;
};

export const getAdminUsers = async (options?: {
  q?: string | undefined;
  status?: string | undefined;
  role?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{
  users: AdminUserSummary[];
  total: number;
  count: number;
  statusBreakdown?: AdminUsersStatusBreakdown | undefined;
}> => {
  const { data } = await api.get("/admin/users", { params: options });
  return data;
};

export const moderateAdminUser = async (
  userId: number,
  data: {
    status?: "active" | "frozen" | "suspended" | "pending_verification" | undefined;
    role?: "user" | "moderator" | "auditor" | "admin" | undefined;
    revokeSessions?: boolean | undefined;
    purgePosts?: boolean | undefined;
    emailVerified?: boolean | undefined;
    reset2FA?: boolean | undefined;
    reason?: string | undefined;
  },
): Promise<{
  success: boolean;
  userId: number;
  status?: string | undefined;
  role?: string | undefined;
  emailVerified?: boolean | undefined;
  reset2FA?: boolean | undefined;
  sessionsRevoked: boolean;
  purgedPostCount: number;
}> => {
  const res = await api.patch(`/admin/users/${userId}`, data);
  notifyAdminOverviewUpdated();
  return res.data;
};

export const adjustAdminUserCredits = async (
  userId: number,
  amount: number,
  reason: string,
): Promise<{
  success: boolean;
  userId: number;
  delta: number;
  newBalance: number;
  reason: string;
}> => {
  const { data } = await api.post(`/admin/users/${userId}/credits`, { amount, reason });
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
  notifyAdminOverviewUpdated();
  return data;
};

export const deleteAdminFederationDomainTier = async (
  domain: string,
): Promise<{ success: boolean; domain: string }> => {
  const { data } = await api.delete(`/admin/federation/domains/${encodeURIComponent(domain)}`);
  notifyAdminOverviewUpdated();
  return data;
};

export const exportAdminFederationDomains = async (
  format: "csv" | "json" = "csv",
): Promise<{ format: "csv" | "json"; count: number; content: string }> => {
  const { data } = await api.get("/admin/federation/domains/export", { params: { format } });
  return data;
};

export const importAdminFederationDomains = async (payload: {
  content?: string | undefined;
  format?: "csv" | "json" | undefined;
  mode?: "merge" | "replace" | undefined;
}): Promise<{ success: boolean; importedCount: number; mode: string }> => {
  const { data } = await api.post("/admin/federation/domains/import", payload);
  notifyAdminOverviewUpdated();
  return data;
};

export const testAdminFederationDomain = async (
  domain: string,
): Promise<{
  domain: string;
  validSyntax: boolean;
  currentTier: string;
  reason: string | null;
  federationMode: string;
  exportControlStatus: string;
  allowedByPolicy: boolean;
  nodeInfoUrl: string;
  actorInboxUrl: string;
  ready: boolean;
}> => {
  const { data } = await api.post("/admin/federation/test-domain", { domain });
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
  notifyAdminOverviewUpdated();
  return data;
};

export const purgeAdminFederationQueue = async (
  status = "failed",
  domain?: string,
): Promise<{ success: boolean; deletedCount: number }> => {
  const { data } = await api.delete("/admin/federation/queue", { params: { status, domain } });
  notifyAdminOverviewUpdated();
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
  notifyAdminOverviewUpdated();
  return data;
};

export const fileAdminDmcaCounterNotice = async (
  id: number,
  counterNoticeText: string,
): Promise<{ success: boolean; noticeId: number; restoreAfter: string }> => {
  const { data } = await api.post(`/admin/dmca/notices/${id}/counter-notice`, { counterNoticeText });
  return data;
};

export const getAdminQuarantinedResources = async (
  status?: string,
): Promise<{ items: AdminQuarantinedResource[]; count: number }> => {
  const { data } = await api.get("/admin/quarantine", { params: { status } });
  return data;
};

export const restoreAdminQuarantinedResource = async (
  resourceType: string,
  resourceId: string,
): Promise<{ success: boolean; resourceType: string; resourceId: string }> => {
  const { data } = await api.post("/admin/quarantine/restore", { resourceType, resourceId });
  return data;
};

export const getAdminAuditLogs = async (
  limit = 50,
  offset = 0,
  action?: string,
  resourceType?: string,
): Promise<{ logs: AdminAuditLog[]; count: number; total?: number | undefined }> => {
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

export const redactExpiredAdminAuditLogs = async (
  retentionDays = 30,
): Promise<{
  success: boolean;
  retentionDays: number;
  redactedCount: number;
  chainValid: boolean;
}> => {
  const { data } = await api.post("/admin/audit-logs/redact-expired", { retentionDays });
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

export const deleteAdminBackup = async (fileName: string): Promise<{ success: boolean; fileName: string }> => {
  const { data } = await api.delete(`/admin/backups/${encodeURIComponent(fileName)}`);
  return data;
};

export const pruneAdminBackups = async (
  keepCount = 7,
): Promise<{ success: boolean; keepCount: number; deletedCount: number; deletedFiles: string[] }> => {
  const { data } = await api.post("/admin/backups/prune", { keepCount });
  return data;
};

export const restoreAdminBackup = async (
  fileName: string,
): Promise<{
  success: boolean;
  restoredFrom: string;
  preRestoreBackup: string;
  tablesRestored: number;
}> => {
  const { data } = await api.post(`/admin/backups/${encodeURIComponent(fileName)}/restore`, {});
  return data;
};

export const getAdminBackupDownloadUrl = (fileName: string): string => {
  return `/api/v1/admin/backups/${encodeURIComponent(fileName)}/download`;
};

export const getAdminInstanceSettings = async (): Promise<{ settings: AdminInstanceSettings }> => {
  const { data } = await api.get("/admin/settings");
  return data;
};

export const patchAdminInstanceSettings = async (
  patch: Partial<AdminInstanceSettings>,
): Promise<{ success: boolean; settings: AdminInstanceSettings }> => {
  const { data } = await api.patch("/admin/settings", patch);
  return data;
};

export const getAdminInvites = async (): Promise<{ invites: AdminInstanceInvite[]; count: number }> => {
  const { data } = await api.get("/admin/invites");
  return data;
};

export const createAdminInvite = async (payload: {
  code?: string | undefined;
  maxUses?: number | undefined;
  initialCredits?: number | undefined;
  assignedRole?: string | undefined;
  note?: string | undefined;
  expiresInDays?: number | undefined;
}): Promise<{ success: boolean; invite: AdminInstanceInvite }> => {
  const { data } = await api.post("/admin/invites", payload);
  return data;
};

export const revokeAdminInvite = async (id: number): Promise<{ success: boolean; id: number }> => {
  const { data } = await api.delete(`/admin/invites/${id}`);
  return data;
};

export const getAdminInstanceInvites = getAdminInvites;
export const createAdminInstanceInvite = createAdminInvite;
export const revokeAdminInstanceInvite = revokeAdminInvite;

export const getAdminSystemHealth = async (): Promise<AdminSystemDiagnosticsResponse> => {
  const { data } = await api.get("/admin/system");
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

export interface AdminUserForensics {
  user: {
    id: number;
    username: string;
    email: string | null;
    display_name: string | null;
    account_type: string;
    status: string;
    credit_balance: number;
    total_spent: number;
    remote_domain: string | null;
    email_verified: number;
    totp_enabled: number;
    created_at: string;
  };
  recentPosts: {
    id: number;
    content: string;
    content_warning: string | null;
    visibility: string;
    created_at: string;
  }[];
  publishedPackages: {
    name: string;
    description: string | null;
    created_at: string;
  }[];
  recentTransactions: {
    id: number;
    amount: number;
    balance_after: number;
    type: string;
    description: string | null;
    created_at: string;
  }[];
  recentAuditLogs: {
    id: number;
    action: string;
    resource_type: string;
    resource_id: string | null;
    ip_address: string | null;
    created_at: string;
  }[];
  reportsAgainstUser: {
    id: number;
    reason: string;
    status: string;
    target_type: string | null;
    created_at: string;
  }[];
}

export const getAdminUserForensics = async (userId: number): Promise<AdminUserForensics> => {
  const { data } = await api.get(`/admin/users/${userId}/forensics`);
  return data;
};

export interface AdminInstanceBundle {
  formatVersion: number;
  exportedAt: string;
  snapshot: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
  };
  settings: AdminInstanceSettings;
  federationDomains: FederationDomainRule[];
  quarantinedResources: QuarantinedResourceItem[];
  featureFlags: AdminFeatureFlag[];
  packageCount: number;
  userCount: number;
  bundleSha256: string;
}

export const exportAdminInstanceBundle = async (): Promise<AdminInstanceBundle> => {
  const { data } = await api.get("/admin/bundle/export");
  return data;
};

export const importAdminInstanceBundle = async (
  bundle: Record<string, unknown>,
): Promise<{
  success: boolean;
  settingsUpdated: boolean;
  importedDomains: number;
  importedFlags: number;
  importedQuarantines: number;
}> => {
  const { data } = await api.post("/admin/bundle/import", bundle);
  return data;
};

export const broadcastAdminActivityPubMove = async (payload: {
  sourceActorUri: string;
  targetActorUri: string;
  alsoKnownAs?: string[];
}): Promise<{
  success: boolean;
  activityId: string;
  actor: string;
  target: string;
  queuedDeliveries: number;
}> => {
  const { data } = await api.post("/admin/federation/move", payload);
  return data;
};

export interface PublicInstanceBannerResponse {
  instanceName: string;
  instanceBadge?: string;
  instanceTagline?: string;
  instanceDescription?: string;
  contactEmail?: string;
  brandLogoUrl?: string;
  brandLogoDarkUrl?: string;
  brandFaviconUrl?: string;
  brandAccentColor?: string;
  docsBaseUrl?: string;
  showPoweredBy?: boolean;
  maintenanceMode: boolean;
  maintenanceLevel?: "off" | "scheduled" | "read_only" | "lockdown";
  maintenanceEta?: string;
  maintenanceStartedAt?: string;
  announcementBanner: string;
  announcementLevel: "info" | "warning" | "critical";
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode?: "open" | "allowlist" | "disabled";
  waitlistEnabled?: boolean;
  userInvitesEnabled?: boolean;
  academicFastTrackEnabled?: boolean;
  academicDomainPatterns?: string[];
  onboardingWizardEnabled?: boolean;
  customTermsMarkdown?: string;
  customPrivacyMarkdown?: string;
  needsSetup?: boolean;
  setupCompleted?: boolean;
  subsystems?: {
    coreApi: "operational" | "read_only" | "maintenance";
    packageRegistry: "operational" | "read_only" | "maintenance";
    cloudSolvers: "operational" | "paused";
    federationQueue: "operational" | "paused" | "disabled";
    wasmSandbox: "operational";
  };
}

export const getPublicInstanceBanner = async (): Promise<PublicInstanceBannerResponse> => {
  const { data } = await api.get("/instance/banner");
  return data;
};

export interface SetupTierPreset {
  id: "tier0_local_dev" | "tier1_federated" | "tier2_corporate" | "tier3_flagship";
  label: string;
  description: string;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode: "open" | "allowlist" | "disabled";
  autoQuarantineReportThreshold: number;
  backupRetentionCount: number;
  defaultInstanceName?: string | undefined;
  defaultInstanceBadge?: string | undefined;
  defaultDocsBaseUrl?: string | undefined;
  defaultShowPoweredBy?: boolean | undefined;
  waitlistEnabled?: boolean | undefined;
  userInvitesEnabled?: boolean | undefined;
  onboardingWizardEnabled?: boolean | undefined;
  academicFastTrackEnabled?: boolean | undefined;
}

export interface WaitlistApplyPayload {
  email: string;
  fullName?: string;
  organization?: string;
  discipline?: string;
  portfolioUrl?: string;
  statement?: string;
}

export const applyToWaitlist = async (payload: WaitlistApplyPayload) => {
  const { data } = await api.post("/waitlist/apply", payload);
  return data as { success: boolean; message: string; submission: { id: number; email: string; status: string } };
};

export interface WaitlistSubmissionItem {
  id: number;
  email: string;
  full_name: string | null;
  organization: string | null;
  discipline: string | null;
  portfolio_url: string | null;
  statement: string | null;
  status: "pending" | "approved" | "rejected";
  invite_code?: string | null;
  approved_by?: number | null;
  created_at: string;
  reviewed_at?: string | null;
}

export const getAdminWaitlist = async (params?: { status?: string; limit?: number; offset?: number }) => {
  const { data } = await api.get("/admin/waitlist", { params });
  return data as { submissions: WaitlistSubmissionItem[]; count: number };
};

export const approveWaitlistSubmission = async (id: number) => {
  const { data } = await api.post(`/admin/waitlist/${id}/approve`);
  return data as { success: boolean; submission: WaitlistSubmissionItem; inviteCode: string };
};

export const rejectWaitlistSubmission = async (id: number) => {
  const { data } = await api.post(`/admin/waitlist/${id}/reject`);
  return data as { success: boolean; id: number };
};

export interface UserOnboardingStatus {
  completed: boolean;
  persona: string | null;
  invitesRemaining: number;
  completedAt?: string | null;
}

export const getUserOnboardingStatus = async () => {
  const { data } = await api.get("/users/me/onboarding");
  return data as UserOnboardingStatus;
};

export const completeUserOnboarding = async (persona: string) => {
  const { data } = await api.post("/users/me/onboarding/complete", { persona });
  return data as { success: boolean; status: UserOnboardingStatus };
};

export const getUserInvites = async () => {
  const { data } = await api.get("/users/me/invites");
  return data as {
    invitesEnabled: boolean;
    invitesRemaining: number;
    invites: Array<{
      id: number;
      code: string;
      created_at: string;
      max_uses: number;
      uses_count: number;
      initial_credits: number;
      note: string | null;
    }>;
    referrals: Array<{
      id: number;
      referee_username: string;
      reward_granted: boolean;
      reward_amount: number;
      created_at: string;
    }>;
  };
};

export const generateUserInvite = async (note?: string, initialCredits?: number) => {
  const { data } = await api.post("/users/me/invites/generate", { note, initialCredits });
  return data as { success: boolean; invite: { id: number; code: string }; invitesRemaining: number };
};

export interface InstanceSetupStatus {
  needsSetup: boolean;
  hasAdmin: boolean;
  setupCompleted: boolean;
  reopened?: boolean | undefined;
  userCount: number;
  edition: "ce" | "ee";
  airgapEnforced: boolean;
  settings: AdminInstanceSettings;
  preflight?: AdminPreflightResult | undefined;
  presets: Record<"tier1_federated" | "tier2_corporate" | "tier3_flagship", SetupTierPreset>;
}

export const getInstanceSetupStatus = async (): Promise<InstanceSetupStatus> => {
  const { data } = await api.get("/setup/status");
  return data;
};

export const resetInstanceSetupWizard = async (): Promise<InstanceSetupStatus & { success: boolean }> => {
  const { data } = await api.post("/setup/reset", {});
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("modelscript:setup-reset", { detail: data }));
  }
  return data;
};

export const completeInstanceSetup = async (payload: {
  profileTier?: "tier1_federated" | "tier2_corporate" | "tier3_flagship";
  admin?: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  };
  settings?: Partial<AdminInstanceSettings>;
  initialInvitesCount?: number;
  initialInviteMaxUses?: number;
  initialInviteCredits?: number;
  initialInviteRole?: "user" | "moderator" | "auditor";
  createInitialBackup?: boolean;
  migrationBundle?: Record<string, unknown> | null;
}): Promise<{
  success: boolean;
  setupCompleted: boolean;
  token: string;
  user: {
    id: number;
    username: string;
    email: string;
    display_name: string | null;
    account_type: string;
    status: string;
    credit_balance: number;
  };
  settings: AdminInstanceSettings;
  invites: AdminInstanceInvite[];
  backupSnapshot: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
  } | null;
  importedBundle: {
    success: boolean;
    settingsUpdated: boolean;
    importedDomains: number;
    importedFlags: number;
    importedQuarantines: number;
  } | null;
}> => {
  const { data } = await api.post("/setup/complete", payload);
  return data;
};

export const uploadAdminBackup = async (payload: {
  fileBase64: string;
  label?: string | undefined;
  restoreImmediately?: boolean | undefined;
}): Promise<{
  success: boolean;
  backup: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
  };
  restored?: {
    restoredFrom: string;
    preRestoreBackup: string;
    tablesRestored: number;
  } | null;
}> => {
  const { data } = await api.post("/admin/backups/upload", payload);
  return data;
};

export const exportInstanceEnvConfig = async (): Promise<{
  envSnippet: string;
  dockerComposeSnippet: string;
  settings: AdminInstanceSettings;
}> => {
  const { data } = await api.get("/admin/settings/export-env");
  return data;
};

export const verifyAdminSudo = async (
  password: string,
): Promise<{
  success: boolean;
  verifiedAt: string;
  expiresAt: string;
  sudoToken: string;
}> => {
  const { data } = await api.post("/admin/sudo/verify", { password });
  return data;
};

export const sendAdminTestEmail = async (
  recipientEmail?: string,
  templateId?: string,
): Promise<{
  success: boolean;
  recipient: string;
  driver: string;
  templateId?: string | undefined;
  sentAt: string;
}> => {
  const payload: Record<string, string> = {};
  if (recipientEmail) payload["recipientEmail"] = recipientEmail;
  if (templateId) payload["templateId"] = templateId;
  const { data } = await api.post("/admin/system/test-email", payload);
  return data;
};

export type AdminEmailTemplateId =
  | "verification"
  | "password_reset"
  | "invite"
  | "security_alert"
  | "social_notification"
  | "digest";

export interface AdminEmailTemplateDefinition {
  id: AdminEmailTemplateId;
  name: string;
  description: string;
  availableVariables: string[];
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  enabled: boolean;
}

export interface AdminEmailTemplateOverride {
  subject?: string | undefined;
  heading?: string | undefined;
  body?: string | undefined;
  ctaLabel?: string | undefined;
  enabled?: boolean | undefined;
}

export interface AdminEmailThemeConfig {
  headerBgColor: string;
  accentColor: string;
  logoUrl: string;
  footerText: string;
}

export interface AdminEmailConfig {
  driver: "auto" | "console" | "smtp" | "sendgrid" | "resend";
  activeDriver: "console" | "smtp" | "sendgrid" | "resend";
  configuredForLiveDelivery: boolean;
  airgapEnforced: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassConfigured: boolean;
  smtpPassMasked: string;
  smtpTlsMode: "starttls" | "implicit" | "none";
  smtpTlsRejectUnauthorized: boolean;
  smtpCaCertPath: string;
  sendgridApiKeyConfigured: boolean;
  sendgridApiKeyMasked: string;
  resendApiKeyConfigured: boolean;
  resendApiKeyMasked: string;
  theme: AdminEmailThemeConfig;
  templates: Record<AdminEmailTemplateId, AdminEmailTemplateDefinition>;
  defaultTemplates: Record<AdminEmailTemplateId, AdminEmailTemplateDefinition>;
  templateOverrides: Partial<Record<AdminEmailTemplateId, AdminEmailTemplateOverride>>;
  lockedByEnv: string[];
}

export interface AdminEmailOutboxItem {
  id: string;
  to: string;
  from?: string | undefined;
  replyTo?: string | undefined;
  subject: string;
  text: string;
  html?: string | undefined;
  templateId?: AdminEmailTemplateId | "custom" | "test" | undefined;
  timestamp: string;
  status: "sent" | "failed";
  driver: "console" | "smtp" | "sendgrid" | "resend";
  latencyMs: number;
  error?: string | undefined;
}

export interface AdminEmailConnectionStep {
  step: "dns" | "tcp" | "ehlo" | "starttls" | "auth" | "provider_api" | "airgap";
  label: string;
  status: "ok" | "warning" | "error" | "skipped";
  latencyMs: number;
  detail: string;
}

export interface AdminEmailConnectionDiagnostic {
  success: boolean;
  driver: "console" | "smtp" | "sendgrid" | "resend";
  host?: string | undefined;
  port?: number | undefined;
  tlsMode?: "starttls" | "implicit" | "none" | undefined;
  totalLatencyMs: number;
  steps: AdminEmailConnectionStep[];
  testedAt: string;
}

export const getAdminEmailConfig = async (): Promise<{
  config: AdminEmailConfig;
  outbox: AdminEmailOutboxItem[];
  outboxCount: number;
}> => {
  const { data } = await api.get("/admin/email/config");
  return data;
};

export const updateAdminEmailConfig = async (
  patch: Record<string, unknown>,
  sudoToken?: string,
): Promise<{
  success: boolean;
  config: AdminEmailConfig;
}> => {
  const headers = sudoToken ? { "x-admin-sudo-token": sudoToken } : undefined;
  const { data } = await api.put("/admin/email/config", patch, headers ? { headers } : undefined);
  return data;
};

export const testAdminEmailConnection = async (
  overrideConfig?: Record<string, unknown>,
): Promise<AdminEmailConnectionDiagnostic> => {
  const { data } = await api.post("/admin/email/test-connection", overrideConfig || {});
  return data;
};

export const previewAdminEmailTemplate = async (payload: {
  templateId: AdminEmailTemplateId;
  templateOverride?: AdminEmailTemplateOverride | undefined;
  themeOverride?: Partial<AdminEmailThemeConfig> | undefined;
  variables?: Record<string, string> | undefined;
}): Promise<{
  templateId: AdminEmailTemplateId;
  subject: string;
  text: string;
  html: string;
  sampleVariables: Record<string, string>;
}> => {
  const { data } = await api.post("/admin/email/preview", payload);
  return data;
};

export const getAdminEmailOutbox = async (): Promise<{
  items: AdminEmailOutboxItem[];
  count: number;
}> => {
  const { data } = await api.get("/admin/email/outbox");
  return data;
};

export const retryAdminEmailOutboxItem = async (
  id: string,
): Promise<{
  success: boolean;
  originalId: string;
  messageId?: string | undefined;
  outbox: AdminEmailOutboxItem[];
}> => {
  const { data } = await api.post(`/admin/email/outbox/${encodeURIComponent(id)}/retry`, {});
  return data;
};

export const dispatchAdminEmailDigests = async (
  frequency?: "daily" | "weekly",
): Promise<{
  success: boolean;
  dispatchedUsers: number;
  totalItemsCompiled: number;
  results: { userId: number; username: string; email: string; frequency: "daily" | "weekly"; itemCount: number }[];
}> => {
  const { data } = await api.post("/admin/email/dispatch-digests", frequency ? { frequency } : {});
  return data;
};

export const downloadAdminSupportBundle = async (): Promise<Record<string, unknown>> => {
  const { data } = await api.get("/admin/system/support-bundle");
  return data;
};

export const fetchAdminPrometheusMetrics = async (): Promise<string> => {
  const { data } = await api.get("/admin/metrics", { responseType: "text" as any });
  return typeof data === "string" ? data : JSON.stringify(data);
};

export interface AdminFederationDomainHealthEntry {
  domain: string;
  tier: "allow" | "silence" | "suspend";
  reason: string | null;
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  lastError: string | null;
  lastUpdatedAt: string | null;
}

export const getAdminFederationDomainHealth = async (): Promise<{
  domains: AdminFederationDomainHealthEntry[];
  count: number;
}> => {
  const { data } = await api.get("/admin/federation/health");
  return data;
};

export const circuitBreakAdminFederationDomain = async (payload: {
  domain: string;
  tier?: "silence" | "suspend" | undefined;
  reason?: string | undefined;
}): Promise<{
  success: boolean;
  domain: string;
  tier: "silence" | "suspend";
  purgedDeliveries: number;
}> => {
  const { data } = await api.post("/admin/federation/circuit-break", payload);
  notifyAdminOverviewUpdated();
  return data;
};
