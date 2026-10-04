// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  AlertIcon,
  CheckCircleIcon,
  DatabaseIcon,
  GlobeIcon,
  HistoryIcon,
  LawIcon,
  PlusIcon,
  ReportIcon,
  ShieldLockIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import {
  deleteAdminFederationDomainTier,
  deleteAdminPost,
  getAdminAuditLogs,
  getAdminDbStatus,
  getAdminDmcaNotices,
  getAdminFederationDomains,
  getAdminModerationQueue,
  resolveAdminDmcaNotice,
  resolveAdminModerationReport,
  runAdminDbUpgrade,
  setAdminFederationDomainTier,
  verifyAdminDbIntegrity,
  type AdminAuditLog,
  type AdminDbStatus,
  type AdminDmcaNotice,
  type AdminFederationDomain,
  type AdminModerationReport,
} from "../api";
import Box from "../components/Box";

type AdminTab = "moderation" | "federation" | "dmca" | "audit" | "database";

const AdminContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - var(--dev-header-height, 0px));
`;

const MenuColumn = styled.div<{ $hideOnMobile?: boolean }>`
  flex: 0 0 320px;
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    flex: 1;
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
    border-right: none;
  }
`;

const DetailColumn = styled.div<{ $hideOnMobile?: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;

  @media (max-width: 900px) {
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
  }
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const Header = styled.div`
  padding: 16px 20px;
  font-size: 20px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: 0;
  background-color: var(--surface-hud, rgba(13, 17, 23, 0.8));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border-default);
  z-index: 10;
`;

const TabButton = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.12)" : "transparent")};
  border: none;
  border-right: ${(props) => (props.$active ? "3px solid var(--color-accent-purple)" : "3px solid transparent")};
  cursor: pointer;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-secondary)")};

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
  }

  span {
    font-size: 14px;
    font-weight: ${(props) => (props.$active ? "600" : "500")};
  }
`;

const Card = styled.div`
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Badge = styled.span<{ $variant?: "success" | "warning" | "danger" | "neutral" }>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: ${(props) => {
    switch (props.$variant) {
      case "success":
        return "rgba(35, 134, 54, 0.2)";
      case "warning":
        return "rgba(210, 153, 34, 0.2)";
      case "danger":
        return "rgba(218, 54, 51, 0.2)";
      default:
        return "rgba(255, 255, 255, 0.08)";
    }
  }};
  color: ${(props) => {
    switch (props.$variant) {
      case "success":
        return "#3fb950";
      case "warning":
        return "#d29922";
      case "danger":
        return "#f85149";
      default:
        return "var(--color-text-muted)";
    }
  }};
`;

const ActionButton = styled.button<{ $variant?: "primary" | "danger" | "secondary" }>`
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid
    ${(props) =>
      props.$variant === "danger"
        ? "rgba(218, 54, 51, 0.5)"
        : props.$variant === "primary"
          ? "rgba(139, 92, 246, 0.5)"
          : "var(--color-border-default)"};
  background: ${(props) =>
    props.$variant === "danger"
      ? "rgba(218, 54, 51, 0.15)"
      : props.$variant === "primary"
        ? "var(--gradient-cta)"
        : "rgba(255, 255, 255, 0.05)"};
  color: ${(props) => (props.$variant === "danger" ? "#f85149" : "var(--color-text-primary)")};
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    opacity: 0.95;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const FilterPill = styled.button<{ $active?: boolean }>`
  background: ${(props) => (props.$active ? "var(--color-accent-purple)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--color-text-muted)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "var(--color-border-default)")};
  border-radius: 16px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const Input = styled.input`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

const Select = styled.select`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

const Textarea = styled.textarea`
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  min-height: 70px;
  resize: vertical;

  &:focus {
    border-color: var(--color-accent-purple);
  }
`;

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
`;

const ModalBox = styled.div`
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  width: 100%;
  max-width: 520px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 10px 12px;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-default);
    font-weight: 600;
  }

  td {
    padding: 12px;
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
    vertical-align: top;
  }

  tr:hover td {
    background-color: var(--color-canvas-subtle);
  }
`;

export const AdminPage: React.FC = () => {
  const { "*": subRoute } = useParams();
  const navigate = useNavigate();

  const activeTab: AdminTab = useMemo(() => {
    const raw = (subRoute || "").split("/")[0]?.toLowerCase();
    if (raw === "federation" || raw === "dmca" || raw === "audit" || raw === "database") {
      return raw;
    }
    return "moderation";
  }, [subRoute]);

  const setActiveTab = (tab: AdminTab) => {
    navigate(`/admin/${tab}`);
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Moderation state
  const [reports, setReports] = useState<AdminModerationReport[]>([]);
  const [modFilter, setModFilter] = useState<string>("all");
  const [activeReportToResolve, setActiveReportToResolve] = useState<AdminModerationReport | null>(null);
  const [modResolutionAction, setModResolutionAction] = useState<
    "none" | "delete_post" | "silence_domain" | "suspend_domain"
  >("none");
  const [modResolutionStatus, setModResolutionStatus] = useState<"resolved" | "dismissed">("resolved");
  const [modResolutionNotes, setModResolutionNotes] = useState("");

  // Federation state
  const [domains, setDomains] = useState<AdminFederationDomain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainTier, setNewDomainTier] = useState<"allow" | "silence" | "suspend">("silence");
  const [newDomainReason, setNewDomainReason] = useState("");
  const [domainFilterQuery, setDomainFilterQuery] = useState("");

  // DMCA state
  const [dmcaNotices, setDmcaNotices] = useState<AdminDmcaNotice[]>([]);
  const [dmcaFilter, setDmcaFilter] = useState<string>("all");
  const [activeDmcaToResolve, setActiveDmcaToResolve] = useState<AdminDmcaNotice | null>(null);
  const [dmcaActionTaken, setDmcaActionTaken] = useState("");

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("");

  // Database state
  const [dbStatus, setDbStatus] = useState<AdminDbStatus | null>(null);
  const [dbVerifyResult, setDbVerifyResult] = useState<{ valid: boolean; issues?: string[] } | null>(null);
  const [dbUpgradeResult, setDbUpgradeResult] = useState<any | null>(null);
  const [dbDryRun, setDbDryRun] = useState(false);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  // ── Loaders ──
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
  }, [activeTab, modFilter, dmcaFilter, auditActionFilter]);

  // ── Moderation Handlers ──
  const handleResolveReport = async () => {
    if (!activeReportToResolve) return;
    setLoading(true);
    clearMessages();
    try {
      await resolveAdminModerationReport(activeReportToResolve.id, {
        status: modResolutionStatus,
        action: modResolutionAction,
        resolutionNotes: modResolutionNotes,
      });
      setSuccess(`Report #${activeReportToResolve.id} marked as ${modResolutionStatus}.`);
      setActiveReportToResolve(null);
      setModResolutionNotes("");
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

  // ── Federation Handlers ──
  const handleSaveDomainTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;
    setLoading(true);
    clearMessages();
    try {
      await setAdminFederationDomainTier(newDomain.trim(), newDomainTier, newDomainReason.trim() || undefined);
      setSuccess(`Tier rule set for ${newDomain.trim()} (${newDomainTier}).`);
      setNewDomain("");
      setNewDomainReason("");
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

  // ── DMCA Handlers ──
  const handleResolveDmca = async () => {
    if (!activeDmcaToResolve || !dmcaActionTaken.trim()) return;
    setLoading(true);
    clearMessages();
    try {
      await resolveAdminDmcaNotice(activeDmcaToResolve.id, dmcaActionTaken.trim());
      setSuccess(`DMCA notice #${activeDmcaToResolve.id} resolved.`);
      setActiveDmcaToResolve(null);
      setDmcaActionTaken("");
      void loadDmcaNotices();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to resolve DMCA notice");
    } finally {
      setLoading(false);
    }
  };

  // ── Database Handlers ──
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

  const filteredDomains = domains.filter((d) =>
    domainFilterQuery.trim() ? d.domain.toLowerCase().includes(domainFilterQuery.toLowerCase().trim()) : true,
  );

  return (
    <AdminContainer>
      <MenuColumn $hideOnMobile={false}>
        <Header>
          <ShieldLockIcon size={20} fill="var(--color-accent-purple)" />
          <span>Instance Admin</span>
        </Header>

        <Box display="flex" flexDirection="column" py={2}>
          <TabButton $active={activeTab === "moderation"} onClick={() => setActiveTab("moderation")}>
            <ReportIcon size={16} />
            <span>Moderation Queue</span>
          </TabButton>
          <TabButton $active={activeTab === "federation"} onClick={() => setActiveTab("federation")}>
            <GlobeIcon size={16} />
            <span>Federation Domains</span>
          </TabButton>
          <TabButton $active={activeTab === "dmca"} onClick={() => setActiveTab("dmca")}>
            <LawIcon size={16} />
            <span>DMCA Notices</span>
          </TabButton>
          <TabButton $active={activeTab === "audit"} onClick={() => setActiveTab("audit")}>
            <HistoryIcon size={16} />
            <span>Security & Audit Logs</span>
          </TabButton>
          <TabButton $active={activeTab === "database"} onClick={() => setActiveTab("database")}>
            <DatabaseIcon size={16} />
            <span>Database & Migrations</span>
          </TabButton>
        </Box>
      </MenuColumn>

      <DetailColumn $hideOnMobile={false}>
        <Header>
          <span>
            {activeTab === "moderation" && "Moderation Queue"}
            {activeTab === "federation" && "Federation Domain Management"}
            {activeTab === "dmca" && "DMCA Takedown Notices"}
            {activeTab === "audit" && "System Audit Log"}
            {activeTab === "database" && "Database Status & Migrations"}
          </span>
          <Box ml="auto">
            <ActionButton
              $variant="secondary"
              onClick={() => {
                if (activeTab === "moderation") void loadModerationQueue();
                else if (activeTab === "federation") void loadFederationDomains();
                else if (activeTab === "dmca") void loadDmcaNotices();
                else if (activeTab === "audit") void loadAuditLogs();
                else if (activeTab === "database") void loadDbStatus();
              }}
              disabled={loading}
            >
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
                color: "#f85149",
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
                color: "#3fb950",
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

          {/* ── MODERATION QUEUE TAB ── */}
          {activeTab === "moderation" && (
            <div>
              <Box display="flex" gap={2} mb={3}>
                <FilterPill $active={modFilter === "all"} onClick={() => setModFilter("all")}>
                  All Reports
                </FilterPill>
                <FilterPill $active={modFilter === "pending"} onClick={() => setModFilter("pending")}>
                  Pending
                </FilterPill>
                <FilterPill $active={modFilter === "resolved"} onClick={() => setModFilter("resolved")}>
                  Resolved
                </FilterPill>
                <FilterPill $active={modFilter === "dismissed"} onClick={() => setModFilter("dismissed")}>
                  Dismissed
                </FilterPill>
              </Box>

              {reports.length === 0 ? (
                <Card>
                  <Box color="var(--color-text-muted)" textAlign="center" py={4}>
                    No moderation reports found for this filter.
                  </Box>
                </Card>
              ) : (
                reports.map((report) => (
                  <Card key={report.id}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box display="flex" alignItems="center" gap={2}>
                        <span style={{ fontWeight: 700 }}>Report #{report.id}</span>
                        <Badge
                          $variant={
                            report.status === "resolved"
                              ? "success"
                              : report.status === "dismissed"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {report.status}
                        </Badge>
                        <Badge $variant="neutral">{report.target_type}</Badge>
                      </Box>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        {new Date(report.created_at).toLocaleString()}
                      </span>
                    </Box>

                    <Box fontSize="13px" color="var(--color-text-primary)">
                      <strong>Reason:</strong> {report.reason}
                    </Box>

                    {report.reporter_username && (
                      <Box fontSize="12px" color="var(--color-text-muted)">
                        Reported by: <strong>@{report.reporter_username}</strong>
                      </Box>
                    )}

                    {report.post_content && (
                      <Box
                        p={3}
                        style={{
                          background: "var(--color-bg-primary)",
                          borderRadius: "6px",
                          border: "1px solid var(--color-border-subtle)",
                          fontSize: "13px",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--color-text-muted)",
                            fontSize: "11px",
                            display: "block",
                            marginBottom: "4px",
                          }}
                        >
                          Target Post #{report.post_id} (by @{report.author_username || "author"}):
                        </span>
                        {report.post_content}
                      </Box>
                    )}

                    {report.resolution_notes && (
                      <Box fontSize="12px" color="var(--color-text-muted)">
                        <strong>Resolution Notes:</strong> {report.resolution_notes}
                      </Box>
                    )}

                    <Box display="flex" gap={2} mt={2}>
                      <ActionButton
                        $variant="primary"
                        onClick={() => {
                          setActiveReportToResolve(report);
                          setModResolutionStatus("resolved");
                          setModResolutionAction(report.post_id ? "delete_post" : "none");
                        }}
                      >
                        Resolve / Action...
                      </ActionButton>
                      <ActionButton
                        $variant="secondary"
                        onClick={() => {
                          setActiveReportToResolve(report);
                          setModResolutionStatus("dismissed");
                          setModResolutionAction("none");
                        }}
                      >
                        Dismiss
                      </ActionButton>
                      {report.post_id && (
                        <ActionButton
                          $variant="danger"
                          onClick={() => handleDeletePostDirectly(report.post_id!)}
                          disabled={loading}
                        >
                          <TrashIcon size={14} />
                          <span>Delete Post</span>
                        </ActionButton>
                      )}
                    </Box>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* ── FEDERATION TAB ── */}
          {activeTab === "federation" && (
            <div>
              <Card>
                <span style={{ fontWeight: 700, fontSize: "14px" }}>Configure Federation Domain Rule</span>
                <form
                  onSubmit={handleSaveDomainTier}
                  style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}
                >
                  <Box display="flex" gap={2}>
                    <Input
                      style={{ flex: 2 }}
                      placeholder="e.g. spam-node.world"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      required
                    />
                    <Select
                      style={{ flex: 1 }}
                      value={newDomainTier}
                      onChange={(e) => setNewDomainTier(e.target.value as any)}
                    >
                      <option value="allow">allow (Default)</option>
                      <option value="silence">silence (Hide from public timelines)</option>
                      <option value="suspend">suspend (Block all S2S traffic)</option>
                    </Select>
                  </Box>
                  <Input
                    placeholder="Justification reason (optional, logged in audit trail)"
                    value={newDomainReason}
                    onChange={(e) => setNewDomainReason(e.target.value)}
                  />
                  <Box display="flex" justifyContent="flex-end">
                    <ActionButton $variant="primary" type="submit" disabled={loading}>
                      <PlusIcon size={14} />
                      <span>Save Domain Tier</span>
                    </ActionButton>
                  </Box>
                </form>
              </Card>

              <Box display="flex" alignItems="center" gap={2} mb={3}>
                <Input
                  style={{ width: "100%", maxWidth: "350px" }}
                  placeholder="Filter configured domains..."
                  value={domainFilterQuery}
                  onChange={(e) => setDomainFilterQuery(e.target.value)}
                />
              </Box>

              <Table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Tier</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDomains.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}
                      >
                        No domain tier overrides found. All domains follow default allow policies.
                      </td>
                    </tr>
                  ) : (
                    filteredDomains.map((d) => (
                      <tr key={d.domain}>
                        <td>
                          <strong>{d.domain}</strong>
                        </td>
                        <td>
                          <Badge
                            $variant={d.tier === "allow" ? "success" : d.tier === "silence" ? "warning" : "danger"}
                          >
                            {d.tier}
                          </Badge>
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>{d.reason || "—"}</td>
                        <td>
                          <ActionButton
                            $variant="danger"
                            onClick={() => handleDeleteDomainRule(d.domain)}
                            disabled={loading}
                          >
                            <TrashIcon size={13} />
                            <span>Reset</span>
                          </ActionButton>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
          )}

          {/* ── DMCA TAB ── */}
          {activeTab === "dmca" && (
            <div>
              <Box display="flex" gap={2} mb={3}>
                <FilterPill $active={dmcaFilter === "all"} onClick={() => setDmcaFilter("all")}>
                  All Notices
                </FilterPill>
                <FilterPill $active={dmcaFilter === "pending"} onClick={() => setDmcaFilter("pending")}>
                  Pending
                </FilterPill>
                <FilterPill $active={dmcaFilter === "resolved"} onClick={() => setDmcaFilter("resolved")}>
                  Resolved
                </FilterPill>
              </Box>

              {dmcaNotices.length === 0 ? (
                <Card>
                  <Box color="var(--color-text-muted)" textAlign="center" py={4}>
                    No DMCA notices found.
                  </Box>
                </Card>
              ) : (
                dmcaNotices.map((n) => (
                  <Card key={n.id}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box display="flex" alignItems="center" gap={2}>
                        <span style={{ fontWeight: 700 }}>Notice #{n.id}</span>
                        <Badge $variant={n.status === "resolved" ? "success" : "warning"}>{n.status}</Badge>
                      </Box>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </Box>

                    <Box fontSize="13px">
                      <strong>Claimant:</strong> {n.claimant_name} ({n.claimant_email}) &bull; <strong>Owner:</strong>{" "}
                      {n.copyright_owner}
                    </Box>

                    <Box fontSize="13px">
                      <strong>Infringing URL:</strong>{" "}
                      <a
                        href={n.infringing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--color-accent-purple)" }}
                      >
                        {n.infringing_url}
                      </a>
                    </Box>

                    <Box fontSize="13px" color="var(--color-text-muted)">
                      <strong>Work Description:</strong> {n.work_description}
                    </Box>

                    {n.action_taken && (
                      <Box fontSize="13px" color="#3fb950">
                        <strong>Action Taken:</strong> {n.action_taken}
                      </Box>
                    )}

                    {n.status === "pending" && (
                      <Box mt={2}>
                        <ActionButton
                          $variant="primary"
                          onClick={() => {
                            setActiveDmcaToResolve(n);
                            setDmcaActionTaken("Takedown executed per statutory requirements.");
                          }}
                        >
                          Resolve Notice...
                        </ActionButton>
                      </Box>
                    )}
                  </Card>
                ))
              )}
            </div>
          )}

          {/* ── AUDIT LOGS TAB ── */}
          {activeTab === "audit" && (
            <div>
              <Box display="flex" gap={2} mb={3}>
                <Input
                  style={{ width: "100%", maxWidth: "320px" }}
                  placeholder="Filter by action (e.g. report_resolved)..."
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                />
              </Box>

              <Table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Actor ID</th>
                    <th>Resource</th>
                    <th>IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}
                      >
                        No audit records found.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "var(--color-text-muted)" }}>
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td>
                          <Badge $variant="neutral">{log.action}</Badge>
                        </td>
                        <td>{log.actor_id ? `#${log.actor_id}` : "System / Anonymous"}</td>
                        <td>{log.resource_type ? `${log.resource_type}:${log.resource_id || ""}` : "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{log.ip_address || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
          )}

          {/* ── DATABASE OPERATIONS TAB ── */}
          {activeTab === "database" &&
            (() => {
              const appliedList = dbStatus?.applied || dbStatus?.appliedMigrations || [];
              const pendingList = dbStatus?.pending || dbStatus?.pendingMigrations || [];
              const currentVer = dbStatus?.currentVersion
                ? String(dbStatus.currentVersion)
                : appliedList.length > 0
                  ? appliedList[appliedList.length - 1].name
                  : "Baseline";
              const latestVer = pendingList.length > 0 ? pendingList[pendingList.length - 1].name : currentVer;
              const pendingCount = dbStatus?.pendingCount ?? pendingList.length;

              return (
                <div>
                  <StatGrid>
                    <Card>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Current Schema Version</span>
                      <span style={{ fontSize: "18px", fontWeight: 800, wordBreak: "break-all" }}>{currentVer}</span>
                    </Card>
                    <Card>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Latest Available Version
                      </span>
                      <span style={{ fontSize: "18px", fontWeight: 800, wordBreak: "break-all" }}>{latestVer}</span>
                    </Card>
                    <Card>
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Pending Migrations</span>
                      <span
                        style={{
                          fontSize: "24px",
                          fontWeight: 800,
                          color: pendingCount > 0 ? "#d29922" : "#3fb950",
                        }}
                      >
                        {pendingCount}
                      </span>
                    </Card>
                  </StatGrid>

                  <Card>
                    <span style={{ fontWeight: 700, fontSize: "14px" }}>Maintenance Operations</span>
                    <Box display="flex" alignItems="center" gap={3} mt={2} flexWrap="wrap">
                      <ActionButton $variant="secondary" onClick={handleVerifyDb} disabled={loading}>
                        <CheckCircleIcon size={14} />
                        <span>Verify Schema Integrity</span>
                      </ActionButton>

                      <Box display="flex" alignItems="center" gap={2}>
                        <label
                          style={{
                            fontSize: "13px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            cursor: "pointer",
                          }}
                        >
                          <input type="checkbox" checked={dbDryRun} onChange={(e) => setDbDryRun(e.target.checked)} />
                          Dry-Run Mode
                        </label>
                        <ActionButton $variant="primary" onClick={handleUpgradeDb} disabled={loading}>
                          <DatabaseIcon size={14} />
                          <span>{dbDryRun ? "Simulate Upgrade" : "Apply Pending Migrations"}</span>
                        </ActionButton>
                      </Box>
                    </Box>
                  </Card>

                  {dbVerifyResult &&
                    (() => {
                      const isSound =
                        dbVerifyResult.valid ?? (dbVerifyResult.foreignKeysOk && dbVerifyResult.integrityOk);
                      return (
                        <Card>
                          <span style={{ fontWeight: 700, fontSize: "14px" }}>Integrity Verification Report</span>
                          <Box display="flex" alignItems="center" gap={2} mt={1}>
                            <Badge $variant={isSound ? "success" : "danger"}>{isSound ? "VALID" : "INVALID"}</Badge>
                            <span style={{ fontSize: "13px" }}>
                              {isSound
                                ? "Foreign keys, indexes, and database tables are in compliance with schema definitions."
                                : "One or more integrity violations detected."}
                            </span>
                          </Box>
                          {dbVerifyResult.issues && dbVerifyResult.issues.length > 0 && (
                            <Box mt={2}>
                              <ul style={{ paddingLeft: "20px", fontSize: "13px", color: "#f85149" }}>
                                {dbVerifyResult.issues.map((iss, i) => (
                                  <li key={i}>{iss}</li>
                                ))}
                              </ul>
                            </Box>
                          )}
                        </Card>
                      );
                    })()}

                  {dbUpgradeResult && (
                    <Card>
                      <span style={{ fontWeight: 700, fontSize: "14px" }}>Migration Execution Summary</span>
                      <pre
                        style={{
                          background: "var(--color-bg-primary)",
                          padding: "12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(dbUpgradeResult, null, 2)}
                      </pre>
                    </Card>
                  )}

                  {appliedList.length > 0 && (
                    <div>
                      <Box fontWeight={700} fontSize="14px" mb={2} mt={3}>
                        Applied Migrations ({appliedList.length})
                      </Box>
                      <Table>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Migration Name</th>
                            <th>Applied At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {appliedList.map((m, idx) => (
                            <tr key={m.id || idx}>
                              <td>#{m.id || idx + 1}</td>
                              <td>
                                <strong>{m.name}</strong>
                              </td>
                              <td style={{ color: "var(--color-text-muted)" }}>
                                {m.applied_at ? new Date(m.applied_at).toLocaleString() : "Baseline"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </div>
              );
            })()}
        </Box>
      </DetailColumn>

      {/* ── RESOLUTION MODAL ── */}
      {activeReportToResolve && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>
              Resolve Moderation Report #{activeReportToResolve.id}
            </span>
            <Box fontSize="13px" color="var(--color-text-muted)">
              Reason: &ldquo;{activeReportToResolve.reason}&rdquo;
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Status</label>
              <Select value={modResolutionStatus} onChange={(e) => setModResolutionStatus(e.target.value as any)}>
                <option value="resolved">Resolved (Violation Confirmed)</option>
                <option value="dismissed">Dismissed (No Action Required)</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Action to Enforce</label>
              <Select value={modResolutionAction} onChange={(e) => setModResolutionAction(e.target.value as any)}>
                <option value="none">None (Keep content intact)</option>
                {activeReportToResolve.post_id && (
                  <option value="delete_post">Delete Post & Broadcast ActivityPub Tombstone</option>
                )}
                <option value="silence_domain">Silence Remote Domain</option>
                <option value="suspend_domain">Suspend Remote Domain</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Resolution Notes</label>
              <Textarea
                placeholder="Explain the moderation decision for the immutable audit trail..."
                value={modResolutionNotes}
                onChange={(e) => setModResolutionNotes(e.target.value)}
              />
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setActiveReportToResolve(null)}>
                Cancel
              </ActionButton>
              <ActionButton $variant="primary" onClick={handleResolveReport} disabled={loading}>
                Confirm Resolution
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* ── DMCA RESOLUTION MODAL ── */}
      {activeDmcaToResolve && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>Resolve DMCA Notice #{activeDmcaToResolve.id}</span>
            <Box fontSize="13px" color="var(--color-text-muted)">
              Infringing URL: {activeDmcaToResolve.infringing_url}
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Action Taken Record</label>
              <Textarea
                placeholder="Document the action taken pursuant to DMCA notice..."
                value={dmcaActionTaken}
                onChange={(e) => setDmcaActionTaken(e.target.value)}
                required
              />
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setActiveDmcaToResolve(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="primary"
                onClick={handleResolveDmca}
                disabled={loading || !dmcaActionTaken.trim()}
              >
                Confirm Resolution
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </AdminContainer>
  );
};

export default AdminPage;
