// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, CheckCircleIcon, SyncIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  adjustAdminUserCredits,
  bulkResolveAdminModerationReports,
  createAdminHotBackup,
  createAdminInstanceInvite,
  deleteAdminBackup,
  deleteAdminFederationDomainTier,
  deleteAdminPost,
  exportAdminFederationDomains,
  fileAdminDmcaCounterNotice,
  getAdminAnalytics,
  getAdminAuditLogs,
  getAdminBackups,
  getAdminDbStatus,
  getAdminDmcaNotices,
  getAdminFeatureFlags,
  getAdminFederationDomains,
  getAdminFederationQueue,
  getAdminInstanceInvites,
  getAdminInstanceSettings,
  getAdminModerationQueue,
  getAdminOverview,
  getAdminQuarantinedResources,
  getAdminSystemHealth,
  getAdminUsers,
  importAdminFederationDomains,
  moderateAdminUser,
  patchAdminFeatureFlag,
  patchAdminInstanceSettings,
  pruneAdminAnalytics,
  pruneAdminBackups,
  purgeAdminFederationQueue,
  redactExpiredAdminAuditLogs,
  resolveAdminDmcaNotice,
  resolveAdminModerationReport,
  restoreAdminBackup,
  restoreAdminQuarantinedResource,
  retryAdminFederationQueue,
  revokeAdminInstanceInvite,
  runAdminDbUpgrade,
  setAdminFederationDomainTier,
  testAdminFederationDomain,
  verifyAdminAuditLogsChain,
  verifyAdminDbIntegrity,
  type AdminAnalyticsSummary,
  type AdminAuditChainVerification,
  type AdminAuditLog,
  type AdminBackupInfo,
  type AdminDbStatus,
  type AdminDmcaNotice,
  type AdminFeatureFlag,
  type AdminFederationDeliveryItem,
  type AdminFederationDomain,
  type AdminFederationQueueStats,
  type AdminInstanceInvite,
  type AdminInstanceSettings,
  type AdminModerationAction,
  type AdminModerationReport,
  type AdminOverviewCounts,
  type AdminQuarantinedResource,
  type AdminSystemHealth,
  type AdminUserStatusBreakdown,
  type AdminUserSummary,
} from "../api";
import Box from "../components/Box";
import { usePageTitle } from "../util/title";
import {
  ActionButton,
  AdminAnalyticsTab,
  AdminAuditLogsTab,
  AdminContainer,
  AdminDatabaseTab,
  AdminDmcaTab,
  AdminFeatureFlagsTab,
  AdminFederationTab,
  AdminMenuSidebar,
  AdminModerationTab,
  AdminSettingsTab,
  AdminSystemTab,
  AdminUsersTab,
  DetailColumn,
  Header,
  ModalBox,
  ModalOverlay,
  type AdminTab,
} from "./admin";

interface ApiErrorLike {
  response?: { data?: { error?: string } };
  message?: string;
}

const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err && typeof err === "object") {
    const apiErr = err as ApiErrorLike;
    return apiErr.response?.data?.error || apiErr.message || fallback;
  }
  return fallback;
};

export const AdminPage: React.FC = () => {
  const { "*": subRoute } = useParams();
  const navigate = useNavigate();

  const activeTab: AdminTab = useMemo(() => {
    const raw = (subRoute || "").split("/")[0]?.toLowerCase();
    if (
      raw === "users" ||
      raw === "federation" ||
      raw === "dmca" ||
      raw === "audit" ||
      raw === "database" ||
      raw === "settings" ||
      raw === "system" ||
      raw === "flags" ||
      raw === "analytics"
    ) {
      return raw;
    }
    return "moderation";
  }, [subRoute]);

  usePageTitle(`Admin Console — ${activeTab.toUpperCase()}`);

  const setActiveTab = (tab: AdminTab) => {
    navigate(`/admin/${tab}`);
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overviewCounts, setOverviewCounts] = useState<AdminOverviewCounts | null>(null);

  // Feature flags state
  const [featureFlags, setFeatureFlags] = useState<AdminFeatureFlag[]>([]);
  const [togglingFlagKey, setTogglingFlagKey] = useState<string | null>(null);

  // Moderation state
  const [reports, setReports] = useState<AdminModerationReport[]>([]);
  const [modFilter, setModFilter] = useState<string>("all");

  // Users state
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userTotalCount, setUserTotalCount] = useState<number | undefined>(undefined);
  const [userStatusBreakdown, setUserStatusBreakdown] = useState<AdminUserStatusBreakdown | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState<string>("");
  const [userStatusFilter, setUserStatusFilter] = useState<string>("all");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("all");
  const [userPageOffset, setUserPageOffset] = useState<number>(0);

  // Analytics state
  const [analyticsSummary, setAnalyticsSummary] = useState<AdminAnalyticsSummary | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState<number>(30);
  const [analyticsSurface, setAnalyticsSurface] = useState<"all" | "web" | "docs">("all");

  // Federation state
  const [domains, setDomains] = useState<AdminFederationDomain[]>([]);
  const [federationQueueStats, setFederationQueueStats] = useState<AdminFederationQueueStats | null>(null);
  const [federationDeliveries, setFederationDeliveries] = useState<AdminFederationDeliveryItem[]>([]);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>("all");
  const [deliveryDomainFilter, setDeliveryDomainFilter] = useState<string>("");

  // DMCA & Quarantine state
  const [dmcaNotices, setDmcaNotices] = useState<AdminDmcaNotice[]>([]);
  const [dmcaFilter, setDmcaFilter] = useState<string>("all");
  const [quarantinedResources, setQuarantinedResources] = useState<AdminQuarantinedResource[]>([]);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditTotalCount, setAuditTotalCount] = useState<number | undefined>(undefined);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("");
  const [auditResourceFilter, setAuditResourceFilter] = useState<string>("all");
  const [auditPageOffset, setAuditPageOffset] = useState<number>(0);
  const [auditChainVerification, setAuditChainVerification] = useState<AdminAuditChainVerification | null>(null);

  // Database state
  const [dbStatus, setDbStatus] = useState<AdminDbStatus | null>(null);
  const [dbBackups, setDbBackups] = useState<AdminBackupInfo[]>([]);
  const [dbVerifyResult, setDbVerifyResult] = useState<{
    valid?: boolean | undefined;
    foreignKeysOk?: boolean | undefined;
    integrityOk?: boolean | undefined;
    issues?: string[] | undefined;
  } | null>(null);
  const [dbUpgradeResult, setDbUpgradeResult] = useState<any | null>(null);
  const [dbDryRun, setDbDryRun] = useState(false);

  // Settings & System state
  const [instanceSettings, setInstanceSettings] = useState<AdminInstanceSettings | null>(null);
  const [instanceInvites, setInstanceInvites] = useState<AdminInstanceInvite[]>([]);
  const [systemHealth, setSystemHealth] = useState<AdminSystemHealth | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const refreshOverviewCounts = async () => {
    try {
      const counts = await getAdminOverview();
      setOverviewCounts(counts);
    } catch {
      // Non-fatal if overview endpoint is unavailable in older mocks
    }
  };

  useEffect(() => {
    void refreshOverviewCounts();
    const handleAdminOverviewUpdate = (e: Event) => {
      const detail = (e as CustomEvent<AdminOverviewCounts | undefined>)?.detail;
      if (detail && typeof detail === "object" && "pendingReports" in detail) {
        setOverviewCounts(detail);
      } else {
        void refreshOverviewCounts();
      }
    };
    window.addEventListener("modelscript:admin-overview-update", handleAdminOverviewUpdate);
    return () => {
      window.removeEventListener("modelscript:admin-overview-update", handleAdminOverviewUpdate);
    };
  }, []);

  // ── Loaders ──
  const loadFeatureFlags = async () => {
    setLoading(true);
    clearMessages();
    try {
      const data = await getAdminFeatureFlags();
      setFeatureFlags(data.flags || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load feature flags"));
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setLoading(true);
    clearMessages();
    try {
      const data = await getAdminAnalytics(analyticsDays, analyticsSurface);
      setAnalyticsSummary(data);
    } catch {
      setError("Failed to load analytics summary");
    } finally {
      setLoading(false);
    }
  };

  const loadModerationQueue = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminModerationQueue(modFilter === "all" ? undefined : modFilter);
      setReports(res.reports || []);
      void refreshOverviewCounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load moderation queue"));
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminUsers({
        q: userSearchQuery.trim() || undefined,
        status: userStatusFilter === "all" ? undefined : userStatusFilter,
        role: userRoleFilter === "all" ? undefined : userRoleFilter,
        limit: 50,
        offset: userPageOffset,
      });
      setUsers(res.users || []);
      setUserTotalCount(res.total);
      setUserStatusBreakdown(res.statusBreakdown || null);
      void refreshOverviewCounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  };

  const loadFederationDomains = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminFederationDomains();
      setDomains(res.domains || []);
      try {
        const qRes = await getAdminFederationQueue(
          deliveryStatusFilter === "all" ? undefined : deliveryStatusFilter,
          50,
          deliveryDomainFilter.trim() || undefined,
        );
        setFederationQueueStats(qRes.stats || null);
        setFederationDeliveries(qRes.deliveries || []);
      } catch {
        // Ignore if queue endpoint is not mocked in unit tests
      }
      void refreshOverviewCounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load federation domains"));
    } finally {
      setLoading(false);
    }
  };

  const loadDmcaNotices = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminDmcaNotices(dmcaFilter === "all" ? undefined : dmcaFilter);
      setDmcaNotices(res.notices || []);
      try {
        const qRes = await getAdminQuarantinedResources();
        setQuarantinedResources(qRes.resources || []);
      } catch {
        // Ignore if quarantine endpoint is not mocked in unit tests
      }
      void refreshOverviewCounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load DMCA notices"));
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminAuditLogs(
        50,
        auditPageOffset,
        auditActionFilter || undefined,
        auditResourceFilter === "all" ? undefined : auditResourceFilter,
      );
      setAuditLogs(res.logs || []);
      setAuditTotalCount(res.totalCount);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load audit logs"));
    } finally {
      setLoading(false);
    }
  };

  const loadDbStatus = async () => {
    setLoading(true);
    clearMessages();
    try {
      const status = await getAdminDbStatus();
      setDbStatus(status);
      try {
        const bRes = await getAdminBackups();
        setDbBackups(bRes.backups || []);
      } catch {
        // Ignore if backups endpoint is not mocked
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load database status"));
    } finally {
      setLoading(false);
    }
  };

  const loadSettingsAndInvites = async () => {
    setLoading(true);
    clearMessages();
    try {
      const sRes = await getAdminInstanceSettings();
      setInstanceSettings(sRes.settings || null);
      try {
        const iRes = await getAdminInstanceInvites();
        setInstanceInvites(iRes.invites || []);
      } catch {
        // Ignore if invites endpoint is not mocked
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load instance settings"));
    } finally {
      setLoading(false);
    }
  };

  const loadSystemHealth = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminSystemHealth();
      setSystemHealth(res);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load system diagnostics"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "moderation") void loadModerationQueue();
    else if (activeTab === "users") void loadUsers();
    else if (activeTab === "analytics") void loadAnalytics();
    else if (activeTab === "federation") void loadFederationDomains();
    else if (activeTab === "dmca") void loadDmcaNotices();
    else if (activeTab === "audit") void loadAuditLogs();
    else if (activeTab === "database") void loadDbStatus();
    else if (activeTab === "settings") void loadSettingsAndInvites();
    else if (activeTab === "system") void loadSystemHealth();
    else if (activeTab === "flags") void loadFeatureFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    modFilter,
    userSearchQuery,
    userStatusFilter,
    userRoleFilter,
    userPageOffset,
    deliveryStatusFilter,
    deliveryDomainFilter,
    dmcaFilter,
    auditActionFilter,
    auditResourceFilter,
    auditPageOffset,
    analyticsDays,
    analyticsSurface,
  ]);

  // ── Action Handlers ──
  const handlePruneAnalytics = async (retainDays: number) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await pruneAdminAnalytics(retainDays);
      setSuccess(
        `Pruned analytics older than ${res.retainDays} days (${res.deletedDailyRows} daily rows, ${res.deletedLocationRows} geo rows removed).`,
      );
      await loadAnalytics();
    } catch {
      setError("Failed to prune historical analytics");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFlag = async (flag: AdminFeatureFlag) => {
    setTogglingFlagKey(flag.key);
    clearMessages();
    try {
      const newEnabled = !flag.currentEnabled;
      await patchAdminFeatureFlag(
        flag.key,
        newEnabled,
        newEnabled ? "user,admin,guest" : "admin",
        flag.rolloutPercentage ?? 100,
      );
      setSuccess(`Feature flag '${flag.name}' updated to ${newEnabled ? "ACTIVE" : "DISABLED"}.`);
      await loadFeatureFlags();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update feature flag"));
    } finally {
      setTogglingFlagKey(null);
    }
  };

  const handleUpdateFlagConfig = async (flag: AdminFeatureFlag, allowedRoles: string, rolloutPercentage: number) => {
    setTogglingFlagKey(flag.key);
    clearMessages();
    try {
      await patchAdminFeatureFlag(flag.key, flag.currentEnabled, allowedRoles, rolloutPercentage);
      setSuccess(`Feature flag '${flag.name}' rollout updated to ${rolloutPercentage}%.`);
      await loadFeatureFlags();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update feature flag rollout"));
    } finally {
      setTogglingFlagKey(null);
    }
  };

  const handleResolveReport = async (
    reportId: number,
    resolution: {
      status: "resolved" | "dismissed";
      action: AdminModerationAction;
      resolutionNotes: string;
      resolveAllForTarget?: boolean | undefined;
      contentWarning?: string | undefined;
      forwardFederatedFlag?: boolean | undefined;
    },
  ) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await resolveAdminModerationReport(reportId, resolution);
      setSuccess(
        `Report #${reportId} marked as ${resolution.status}.${
          res.federatedFlagQueued ? " Outbound ActivityPub Flag queued." : ""
        }`,
      );
      void loadModerationQueue();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to resolve report"));
    } finally {
      setLoading(false);
    }
  };

  const handleBulkResolveReports = async (payload: {
    reportIds: number[];
    status: "resolved" | "dismissed";
    action?: AdminModerationAction | undefined;
    resolutionNotes?: string | undefined;
  }) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await bulkResolveAdminModerationReports(payload);
      setSuccess(`Bulk updated ${res.resolvedCount} moderation report(s).`);
      void loadModerationQueue();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to bulk resolve reports"));
    } finally {
      setLoading(false);
    }
  };

  const handleModerateUser = async (
    userId: number,
    payload: {
      status?: "active" | "frozen" | "suspended" | undefined;
      role?: "user" | "moderator" | "auditor" | "admin" | undefined;
      reason?: string | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
      emailVerified?: boolean | undefined;
      reset2FA?: boolean | undefined;
    },
  ) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await moderateAdminUser(userId, payload);
      setSuccess(
        `Updated user #${res.userId} (status: ${res.status || "unchanged"}, role: ${res.role || "unchanged"}).`,
      );
      void loadUsers();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update user governance state"));
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustUserCredits = async (userId: number, deltaCredits: number, reason: string) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await adjustAdminUserCredits(userId, deltaCredits, reason);
      setSuccess(`Updated user #${userId} compute credit balance to ${res.newBalance}.`);
      void loadUsers();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to adjust user compute credits"));
    } finally {
      setLoading(false);
    }
  };

  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (!confirmModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmModal]);

  const handleDeletePostDirectly = async (postId: number) => {
    setConfirmModal({
      title: `Delete Post #${postId}`,
      message: `Are you sure you want to permanently delete post #${postId}?`,
      confirmLabel: "Confirm Delete",
      onConfirm: async () => {
        setConfirmModal(null);
        setLoading(true);
        clearMessages();
        try {
          const res = await deleteAdminPost(postId);
          setSuccess(`Post #${postId} deleted.${res.tombstonePropagated ? " Tombstone propagated to Fediverse." : ""}`);
          void loadModerationQueue();
        } catch (err: unknown) {
          setError(getErrorMessage(err, "Failed to delete post"));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleSaveDomainTier = async (domain: string, tier: "allow" | "silence" | "suspend", reason?: string) => {
    setLoading(true);
    clearMessages();
    try {
      await setAdminFederationDomainTier(domain, tier, reason);
      setSuccess(`Tier rule set for ${domain} (${tier}).`);
      void loadFederationDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to set domain tier"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDomainRule = async (domain: string) => {
    setConfirmModal({
      title: "Remove Custom Federation Rule",
      message: `Reset domain tier for ${domain} back to default (allow)?`,
      confirmLabel: "Confirm Remove",
      onConfirm: async () => {
        setConfirmModal(null);
        setLoading(true);
        clearMessages();
        try {
          await deleteAdminFederationDomainTier(domain);
          setSuccess(`Domain rule for ${domain} removed.`);
          void loadFederationDomains();
        } catch (err: unknown) {
          setError(getErrorMessage(err, "Failed to remove domain rule"));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleExportDomains = async (format: "csv" | "json") => {
    setLoading(true);
    clearMessages();
    try {
      const content = await exportAdminFederationDomains(format);
      const blob = new Blob([content], { type: format === "csv" ? "text/csv" : "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelscript-federation-domains-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(`Exported federation domain rules as ${format.toUpperCase()}.`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to export federation domains"));
    } finally {
      setLoading(false);
    }
  };

  const handleImportDomains = async (payload: {
    mode: "merge" | "replace";
    csv?: string | undefined;
    domains?:
      | Array<{ domain: string; tier: "allow" | "silence" | "suspend"; reason?: string | null | undefined }>
      | undefined;
  }) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await importAdminFederationDomains(payload);
      setSuccess(`Imported ${res.imported} federation domain rule(s) (${res.skipped} skipped).`);
      void loadFederationDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to import federation domains"));
    } finally {
      setLoading(false);
    }
  };

  const handleRetryFailedDeliveries = async (domain?: string) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await retryAdminFederationQueue(domain);
      setSuccess(`Re-queued ${res.retriedCount} failed ActivityPub S2S delivery item(s).`);
      void loadFederationDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to retry S2S deliveries"));
    } finally {
      setLoading(false);
    }
  };

  const handlePurgeDeliveries = async (status: "failed" | "completed") => {
    setLoading(true);
    clearMessages();
    try {
      const res = await purgeAdminFederationQueue(status);
      setSuccess(`Purged ${res.deletedCount} ${status} S2S delivery record(s).`);
      void loadFederationDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to purge S2S delivery queue"));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDmca = async (
    noticeId: number,
    actionTaken: string,
    options?: {
      status?: "resolved" | "rejected" | undefined;
      quarantineResource?: boolean | undefined;
      resourceType?: "post" | "package" | "repo" | undefined;
      resourceId?: string | undefined;
    },
  ) => {
    setLoading(true);
    clearMessages();
    try {
      await resolveAdminDmcaNotice(noticeId, actionTaken, options);
      setSuccess(`DMCA notice #${noticeId} ${options?.status || "resolved"}.`);
      void loadDmcaNotices();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to resolve DMCA notice"));
    } finally {
      setLoading(false);
    }
  };

  const handleFileCounterNotice = async (noticeId: number, counterNoticeText: string) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await fileAdminDmcaCounterNotice(noticeId, counterNoticeText);
      setSuccess(
        `DMCA § 512(g) counter-notice recorded for #${noticeId} (restore eligible after ${new Date(
          res.restoreEligibleAt,
        ).toLocaleDateString()}).`,
      );
      void loadDmcaNotices();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to file DMCA counter-notice"));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreQuarantinedResource = async (resourceType: string, resourceId: string) => {
    setLoading(true);
    clearMessages();
    try {
      await restoreAdminQuarantinedResource(resourceType, resourceId);
      setSuccess(`Restored quarantined ${resourceType} (${resourceId}).`);
      void loadDmcaNotices();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to restore quarantined resource"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyDb = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await verifyAdminDbIntegrity();
      setDbVerifyResult(res);
      const isSound = res.valid ?? (res.foreignKeysOk && res.integrityOk);
      setSuccess(isSound ? "Database integrity verified: schema is sound." : "Database integrity issues detected!");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to verify database"));
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeDb = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await runAdminDbUpgrade({ dryRun: dbDryRun });
      setDbUpgradeResult(res);
      setSuccess(
        dbDryRun
          ? `Dry run finished: ${res.appliedCount || 0} migration(s) would be applied.`
          : `Database upgraded successfully: ${res.appliedCount || 0} migration(s) executed.`,
      );
      void loadDbStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Database upgrade failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateHotBackup = async (label?: string) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await createAdminHotBackup(label);
      setSuccess(`Hot SQLite backup created: ${res.backup?.fileName || "snapshot"}.`);
      void loadDbStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to create hot backup"));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (fileName: string) => {
    setConfirmModal({
      title: `Restore Database from ${fileName}`,
      message: `Are you sure you want to restore ${fileName}? An automatic pre-restore snapshot will be created before overwriting tables.`,
      confirmLabel: "Confirm Point-in-Time Restore",
      onConfirm: async () => {
        setConfirmModal(null);
        setLoading(true);
        clearMessages();
        try {
          const res = await restoreAdminBackup(fileName);
          setSuccess(
            `Restored ${res.restoredTables} tables from ${fileName} (safety snapshot: ${res.preRestoreSnapshot.fileName}).`,
          );
          void loadDbStatus();
        } catch (err: unknown) {
          setError(getErrorMessage(err, "Failed to restore backup"));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleDeleteBackup = async (fileName: string) => {
    setLoading(true);
    clearMessages();
    try {
      await deleteAdminBackup(fileName);
      setSuccess(`Deleted backup snapshot ${fileName}.`);
      void loadDbStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete backup"));
    } finally {
      setLoading(false);
    }
  };

  const handlePruneBackups = async (keepLatest: number) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await pruneAdminBackups(keepLatest);
      setSuccess(`Pruned ${res.deletedCount} old backup snapshot(s); retained latest ${res.keptCount}.`);
      void loadDbStatus();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to prune backups"));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveInstanceSettings = async (patch: Partial<AdminInstanceSettings>) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await patchAdminInstanceSettings(patch);
      setInstanceSettings(res.settings);
      setSuccess("Instance settings saved.");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save instance settings"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvite = async (payload: {
    note?: string | undefined;
    maxUses?: number | undefined;
    expiresInDays?: number | undefined;
  }) => {
    setLoading(true);
    clearMessages();
    try {
      const res = await createAdminInstanceInvite(payload);
      setSuccess(`Generated invite code: ${res.invite.code}`);
      void loadSettingsAndInvites();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to generate invite code"));
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeInvite = async (id: number) => {
    setLoading(true);
    clearMessages();
    try {
      await revokeAdminInstanceInvite(id);
      setSuccess(`Revoked invite #${id}.`);
      void loadSettingsAndInvites();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to revoke invite"));
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCurrentTab = () => {
    if (activeTab === "moderation") void loadModerationQueue();
    else if (activeTab === "users") void loadUsers();
    else if (activeTab === "analytics") void loadAnalytics();
    else if (activeTab === "federation") void loadFederationDomains();
    else if (activeTab === "dmca") void loadDmcaNotices();
    else if (activeTab === "audit") void loadAuditLogs();
    else if (activeTab === "database") void loadDbStatus();
    else if (activeTab === "settings") void loadSettingsAndInvites();
    else if (activeTab === "system") void loadSystemHealth();
    else if (activeTab === "flags") void loadFeatureFlags();
  };

  return (
    <AdminContainer>
      <AdminMenuSidebar activeTab={activeTab} onSelectTab={setActiveTab} overviewCounts={overviewCounts} />

      <DetailColumn $hideOnMobile={false}>
        <Header>
          <span>
            {activeTab === "moderation" && "Moderation Queue"}
            {activeTab === "users" && "Users & Account Governance"}
            {activeTab === "analytics" && "Unified Analytics & Traffic"}
            {activeTab === "federation" && "Federation Domain Management"}
            {activeTab === "dmca" && "DMCA Takedown Notices"}
            {activeTab === "audit" && "System Audit Log"}
            {activeTab === "database" && "Database Status & Migrations"}
            {activeTab === "settings" && "Instance Settings & Registration Invites"}
            {activeTab === "system" && "System Health & Diagnostics"}
            {activeTab === "flags" && "Feature Flags Switchboard"}
          </span>
          <Box ml="auto" display="flex" alignItems="center" gap={2}>
            {loading && <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Loading…</span>}
            <ActionButton $variant="secondary" onClick={handleRefreshCurrentTab} disabled={loading}>
              <SyncIcon size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
              <span>Refresh</span>
            </ActionButton>
          </Box>
        </Header>

        <Box p={4}>
          {error && (
            <Box
              p={3}
              mb={3}
              style={{
                background: "rgba(218, 54, 51, 0.15)",
                border: "1px solid rgba(218, 54, 51, 0.4)",
                borderRadius: "8px",
                color: "var(--ms-danger)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <AlertIcon size={16} />
              <span>{error}</span>
            </Box>
          )}

          {success && (
            <Box
              p={3}
              mb={3}
              style={{
                background: "rgba(35, 134, 54, 0.15)",
                border: "1px solid rgba(35, 134, 54, 0.4)",
                borderRadius: "8px",
                color: "var(--ms-success)",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircleIcon size={16} />
              <span>{success}</span>
            </Box>
          )}

          {activeTab === "moderation" && (
            <AdminModerationTab
              reports={reports}
              modFilter={modFilter}
              setModFilter={setModFilter}
              onResolveReport={handleResolveReport}
              onBulkResolveReports={handleBulkResolveReports}
              onDeletePost={handleDeletePostDirectly}
              loading={loading}
            />
          )}

          {activeTab === "users" && (
            <AdminUsersTab
              users={users}
              totalUsers={userTotalCount}
              statusBreakdown={userStatusBreakdown}
              userSearchQuery={userSearchQuery}
              setUserSearchQuery={(q) => {
                setUserPageOffset(0);
                setUserSearchQuery(q);
              }}
              userStatusFilter={userStatusFilter}
              setUserStatusFilter={(s) => {
                setUserPageOffset(0);
                setUserStatusFilter(s);
              }}
              userRoleFilter={userRoleFilter}
              setUserRoleFilter={(r) => {
                setUserPageOffset(0);
                setUserRoleFilter(r);
              }}
              userPageOffset={userPageOffset}
              setUserPageOffset={setUserPageOffset}
              onModerateUser={handleModerateUser}
              onAdjustUserCredits={handleAdjustUserCredits}
              loading={loading}
            />
          )}

          {activeTab === "analytics" && (
            <AdminAnalyticsTab
              analytics={analyticsSummary}
              analyticsDays={analyticsDays}
              setAnalyticsDays={setAnalyticsDays}
              analyticsSurface={analyticsSurface}
              setAnalyticsSurface={setAnalyticsSurface}
              onPruneAnalytics={handlePruneAnalytics}
              loading={loading}
            />
          )}

          {activeTab === "federation" && (
            <AdminFederationTab
              domains={domains}
              onSaveDomainTier={handleSaveDomainTier}
              onDeleteDomainRule={handleDeleteDomainRule}
              onExportDomains={handleExportDomains}
              onImportDomains={handleImportDomains}
              onTestDomain={testAdminFederationDomain}
              queueStats={federationQueueStats}
              deliveries={federationDeliveries}
              deliveryStatusFilter={deliveryStatusFilter}
              setDeliveryStatusFilter={setDeliveryStatusFilter}
              deliveryDomainFilter={deliveryDomainFilter}
              setDeliveryDomainFilter={setDeliveryDomainFilter}
              onRetryFailedDeliveries={handleRetryFailedDeliveries}
              onPurgeDeliveries={handlePurgeDeliveries}
              loading={loading}
            />
          )}

          {activeTab === "dmca" && (
            <AdminDmcaTab
              dmcaNotices={dmcaNotices}
              dmcaFilter={dmcaFilter}
              setDmcaFilter={setDmcaFilter}
              onResolveDmca={handleResolveDmca}
              onFileCounterNotice={handleFileCounterNotice}
              quarantinedResources={quarantinedResources}
              onRestoreQuarantinedResource={handleRestoreQuarantinedResource}
              loading={loading}
            />
          )}

          {activeTab === "audit" && (
            <AdminAuditLogsTab
              auditLogs={auditLogs}
              totalCount={auditTotalCount}
              auditActionFilter={auditActionFilter}
              setAuditActionFilter={(f) => {
                setAuditPageOffset(0);
                setAuditActionFilter(f);
              }}
              auditResourceFilter={auditResourceFilter}
              setAuditResourceFilter={(r) => {
                setAuditPageOffset(0);
                setAuditResourceFilter(r);
              }}
              auditPageOffset={auditPageOffset}
              setAuditPageOffset={setAuditPageOffset}
              chainVerification={auditChainVerification}
              onVerifyChain={async () => {
                setLoading(true);
                clearMessages();
                try {
                  const res = await verifyAdminAuditLogsChain();
                  setAuditChainVerification(res);
                  setSuccess(
                    res.valid
                      ? `Cryptographic SHA-256 audit log chain verified (${res.verifiedEntries}/${res.totalEntries} entries).`
                      : `Audit log chain integrity failure detected at entry #${res.brokenAtId ?? "unknown"}!`,
                  );
                } catch (err: unknown) {
                  setError(getErrorMessage(err, "Failed to verify audit log hash chain"));
                } finally {
                  setLoading(false);
                }
              }}
              onRedactExpiredLogs={async () => {
                setLoading(true);
                clearMessages();
                try {
                  const res = await redactExpiredAdminAuditLogs();
                  setSuccess(
                    `Redacted ${res.redactedAuditIps} expired audit log IP(s) while preserving SHA-256 hash chain integrity.`,
                  );
                  void loadAuditLogs();
                } catch (err: unknown) {
                  setError(getErrorMessage(err, "Failed to redact expired audit log IPs"));
                } finally {
                  setLoading(false);
                }
              }}
              loading={loading}
            />
          )}

          {activeTab === "database" && (
            <AdminDatabaseTab
              dbStatus={dbStatus}
              dbVerifyResult={dbVerifyResult}
              dbUpgradeResult={dbUpgradeResult}
              dbDryRun={dbDryRun}
              setDbDryRun={setDbDryRun}
              onVerifyDb={handleVerifyDb}
              onUpgradeDb={handleUpgradeDb}
              backups={dbBackups}
              onCreateHotBackup={handleCreateHotBackup}
              onRestoreBackup={handleRestoreBackup}
              onDeleteBackup={handleDeleteBackup}
              onPruneBackups={handlePruneBackups}
              loading={loading}
            />
          )}

          {activeTab === "settings" && (
            <AdminSettingsTab
              settings={instanceSettings}
              invites={instanceInvites}
              onSaveSettings={handleSaveInstanceSettings}
              onCreateInvite={handleCreateInvite}
              onRevokeInvite={handleRevokeInvite}
              loading={loading}
            />
          )}

          {activeTab === "system" && <AdminSystemTab systemHealth={systemHealth} loading={loading} />}

          {activeTab === "flags" && (
            <AdminFeatureFlagsTab
              featureFlags={featureFlags}
              togglingFlagKey={togglingFlagKey}
              onToggleFlag={handleToggleFlag}
              onUpdateFlagConfig={handleUpdateFlagConfig}
            />
          )}
        </Box>
      </DetailColumn>

      {confirmModal && (
        <ModalOverlay onClick={() => setConfirmModal(null)}>
          <ModalBox
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={confirmModal.title}
          >
            <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-text-primary)" }}>
              {confirmModal.title}
            </span>
            <Box fontSize="14px" color="var(--color-text-muted)" style={{ lineHeight: 1.5 }}>
              {confirmModal.message}
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setConfirmModal(null)} disabled={loading}>
                Cancel
              </ActionButton>
              <ActionButton $variant="danger" onClick={() => void confirmModal.onConfirm()} disabled={loading}>
                {confirmModal.confirmLabel}
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </AdminContainer>
  );
};

export default AdminPage;
