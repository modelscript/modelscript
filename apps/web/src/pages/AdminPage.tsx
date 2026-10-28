// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, CheckCircleIcon, SyncIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteAdminFederationDomainTier,
  deleteAdminPost,
  getAdminAuditLogs,
  getAdminDbStatus,
  getAdminDmcaNotices,
  getAdminFeatureFlags,
  getAdminFederationDomains,
  getAdminModerationQueue,
  patchAdminFeatureFlag,
  resolveAdminDmcaNotice,
  resolveAdminModerationReport,
  runAdminDbUpgrade,
  setAdminFederationDomainTier,
  verifyAdminDbIntegrity,
  type AdminAuditLog,
  type AdminDbStatus,
  type AdminDmcaNotice,
  type AdminFeatureFlag,
  type AdminFederationDomain,
  type AdminModerationReport,
} from "../api";
import Box from "../components/Box";
import { usePageTitle } from "../util/title";
import {
  ActionButton,
  AdminAuditLogsTab,
  AdminContainer,
  AdminDatabaseTab,
  AdminDmcaTab,
  AdminFeatureFlagsTab,
  AdminFederationTab,
  AdminMenuSidebar,
  AdminModerationTab,
  DetailColumn,
  Header,
  type AdminTab,
} from "./admin";

export const AdminPage: React.FC = () => {
  const { "*": subRoute } = useParams();
  const navigate = useNavigate();

  const activeTab: AdminTab = useMemo(() => {
    const raw = (subRoute || "").split("/")[0]?.toLowerCase();
    if (raw === "federation" || raw === "dmca" || raw === "audit" || raw === "database" || raw === "flags") {
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

  // Feature flags state
  const [featureFlags, setFeatureFlags] = useState<AdminFeatureFlag[]>([]);
  const [togglingFlagKey, setTogglingFlagKey] = useState<string | null>(null);

  // Moderation state
  const [reports, setReports] = useState<AdminModerationReport[]>([]);
  const [modFilter, setModFilter] = useState<string>("all");

  // Federation state
  const [domains, setDomains] = useState<AdminFederationDomain[]>([]);

  // DMCA state
  const [dmcaNotices, setDmcaNotices] = useState<AdminDmcaNotice[]>([]);
  const [dmcaFilter, setDmcaFilter] = useState<string>("all");

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("");

  // Database state
  const [dbStatus, setDbStatus] = useState<AdminDbStatus | null>(null);
  const [dbVerifyResult, setDbVerifyResult] = useState<{
    valid?: boolean | undefined;
    foreignKeysOk?: boolean | undefined;
    integrityOk?: boolean | undefined;
    issues?: string[] | undefined;
  } | null>(null);
  const [dbUpgradeResult, setDbUpgradeResult] = useState<any | null>(null);
  const [dbDryRun, setDbDryRun] = useState(false);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // ── Loaders ──
  const loadFeatureFlags = async () => {
    setLoading(true);
    clearMessages();
    try {
      const data = await getAdminFeatureFlags();
      setFeatureFlags(data.flags || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load feature flags");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load moderation queue");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load federation domains");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load DMCA notices");
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoading(true);
    clearMessages();
    try {
      const res = await getAdminAuditLogs(50, 0, auditActionFilter || undefined);
      setAuditLogs(res.logs || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load audit logs");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load database status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "moderation") void loadModerationQueue();
    else if (activeTab === "federation") void loadFederationDomains();
    else if (activeTab === "dmca") void loadDmcaNotices();
    else if (activeTab === "audit") void loadAuditLogs();
    else if (activeTab === "database") void loadDbStatus();
    else if (activeTab === "flags") void loadFeatureFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, modFilter, dmcaFilter, auditActionFilter]);

  // ── Action Handlers ──
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to update feature flag");
    } finally {
      setTogglingFlagKey(null);
    }
  };

  const handleResolveReport = async (
    reportId: number,
    resolution: {
      status: "resolved" | "dismissed";
      action: "none" | "delete_post" | "silence_domain" | "suspend_domain";
      resolutionNotes: string;
    },
  ) => {
    setLoading(true);
    clearMessages();
    try {
      await resolveAdminModerationReport(reportId, resolution);
      setSuccess(`Report #${reportId} marked as ${resolution.status}.`);
      void loadModerationQueue();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to resolve report");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePostDirectly = async (postId: number) => {
    if (!window.confirm(`Are you sure you want to permanently delete post #${postId}?`)) return;
    setLoading(true);
    clearMessages();
    try {
      const res = await deleteAdminPost(postId);
      setSuccess(`Post #${postId} deleted.${res.tombstonePropagated ? " Tombstone propagated to Fediverse." : ""}`);
      void loadModerationQueue();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to delete post");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDomainTier = async (domain: string, tier: "allow" | "silence" | "suspend", reason?: string) => {
    setLoading(true);
    clearMessages();
    try {
      await setAdminFederationDomainTier(domain, tier, reason);
      setSuccess(`Tier rule set for ${domain} (${tier}).`);
      void loadFederationDomains();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to set domain tier");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDomainRule = async (domain: string) => {
    if (!window.confirm(`Reset domain tier for ${domain} back to default (allow)?`)) return;
    setLoading(true);
    clearMessages();
    try {
      await deleteAdminFederationDomainTier(domain);
      setSuccess(`Domain rule for ${domain} removed.`);
      void loadFederationDomains();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to remove domain rule");
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDmca = async (noticeId: number, actionTaken: string) => {
    setLoading(true);
    clearMessages();
    try {
      await resolveAdminDmcaNotice(noticeId, actionTaken);
      setSuccess(`DMCA notice #${noticeId} resolved.`);
      void loadDmcaNotices();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to resolve DMCA notice");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to verify database");
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
    } catch (err: any) {
      setError(err.response?.data?.error || "Database upgrade failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCurrentTab = () => {
    if (activeTab === "moderation") void loadModerationQueue();
    else if (activeTab === "federation") void loadFederationDomains();
    else if (activeTab === "dmca") void loadDmcaNotices();
    else if (activeTab === "audit") void loadAuditLogs();
    else if (activeTab === "database") void loadDbStatus();
    else if (activeTab === "flags") void loadFeatureFlags();
  };

  return (
    <AdminContainer>
      <AdminMenuSidebar activeTab={activeTab} onSelectTab={setActiveTab} />

      <DetailColumn $hideOnMobile={false}>
        <Header>
          <span>
            {activeTab === "moderation" && "Moderation Queue"}
            {activeTab === "federation" && "Federation Domain Management"}
            {activeTab === "dmca" && "DMCA Takedown Notices"}
            {activeTab === "audit" && "System Audit Log"}
            {activeTab === "database" && "Database Status & Migrations"}
            {activeTab === "flags" && "Feature Flags Switchboard"}
          </span>
          <Box ml="auto">
            <ActionButton $variant="secondary" onClick={handleRefreshCurrentTab} disabled={loading}>
              <SyncIcon size={14} />
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
              onDeletePost={handleDeletePostDirectly}
              loading={loading}
            />
          )}

          {activeTab === "federation" && (
            <AdminFederationTab
              domains={domains}
              onSaveDomainTier={handleSaveDomainTier}
              onDeleteDomainRule={handleDeleteDomainRule}
              loading={loading}
            />
          )}

          {activeTab === "dmca" && (
            <AdminDmcaTab
              dmcaNotices={dmcaNotices}
              dmcaFilter={dmcaFilter}
              setDmcaFilter={setDmcaFilter}
              onResolveDmca={handleResolveDmca}
              loading={loading}
            />
          )}

          {activeTab === "audit" && (
            <AdminAuditLogsTab
              auditLogs={auditLogs}
              auditActionFilter={auditActionFilter}
              setAuditActionFilter={setAuditActionFilter}
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
              loading={loading}
            />
          )}

          {activeTab === "flags" && (
            <AdminFeatureFlagsTab
              featureFlags={featureFlags}
              togglingFlagKey={togglingFlagKey}
              onToggleFlag={handleToggleFlag}
            />
          )}
        </Box>
      </DetailColumn>
    </AdminContainer>
  );
};

export default AdminPage;
