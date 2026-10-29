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

export interface AdminInstanceSettings {
  instanceName: string;
  instanceDescription: string;
  contactEmail: string;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  allowedEmailDomains: string[];
  federationMode: "open" | "allowlist" | "disabled";
  maintenanceMode: boolean;
  announcementBanner: string;
  announcementLevel: "info" | "warning" | "critical";
  autoQuarantineReportThreshold: number;
  backupRetentionCount: number;
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
  airgapMode: boolean;
  auditChainValid: boolean;
  auditVerifiedEntries: number;
  schemaVersion: string | null;
  pendingMigrations: number;
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
  const { data } = await api.get("/admin/moderation/queue", {
    params: { status, limit, offset, targetType, q },
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

export const getPublicInstanceBanner = async (): Promise<{
  instanceName: string;
  instanceDescription?: string;
  maintenanceMode: boolean;
  announcementBanner: string;
  announcementLevel: "info" | "warning" | "critical";
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode?: "open" | "allowlist" | "disabled";
  needsSetup?: boolean;
  setupCompleted?: boolean;
}> => {
  const { data } = await api.get("/instance/banner");
  return data;
};

export interface SetupTierPreset {
  id: "tier1_federated" | "tier2_corporate" | "tier3_flagship";
  label: string;
  description: string;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode: "open" | "allowlist" | "disabled";
  autoQuarantineReportThreshold: number;
  backupRetentionCount: number;
}

export interface InstanceSetupStatus {
  needsSetup: boolean;
  hasAdmin: boolean;
  setupCompleted: boolean;
  userCount: number;
  edition: "ce" | "ee";
  airgapEnforced: boolean;
  settings: AdminInstanceSettings;
  presets: Record<"tier1_federated" | "tier2_corporate" | "tier3_flagship", SetupTierPreset>;
}

export const getInstanceSetupStatus = async (): Promise<InstanceSetupStatus> => {
  const { data } = await api.get("/setup/status");
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
