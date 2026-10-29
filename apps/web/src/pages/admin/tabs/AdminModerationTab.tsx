// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, ShieldLockIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, FilterPill, Input, ModalBox, ModalOverlay, Select, Textarea } from "../styles";
import type { AdminModerationAction, AdminModerationReport } from "../types";

export interface AdminModerationTabProps {
  reports: AdminModerationReport[];
  modFilter: string;
  setModFilter: (filter: string) => void;
  onResolveReport: (
    reportId: number,
    resolution: {
      status: "resolved" | "dismissed";
      action: AdminModerationAction;
      resolutionNotes: string;
      resolveAllForTarget?: boolean | undefined;
      contentWarning?: string | undefined;
      forwardFederatedFlag?: boolean | undefined;
    },
  ) => Promise<void>;
  onBulkResolveReports?:
    | ((payload: {
        reportIds: number[];
        status: "resolved" | "dismissed";
        action?: AdminModerationAction | undefined;
        resolutionNotes?: string | undefined;
      }) => Promise<void>)
    | undefined;
  onDeletePost: (postId: number) => Promise<void>;
  loading: boolean;
}

const CANNED_RESOLUTION_TEMPLATES = [
  {
    label: "Spam / Automated abuse",
    notes: "Confirmed spam or automated abuse violation. Content removed and account restricted.",
  },
  {
    label: "Harassment / Code of Conduct",
    notes: "Confirmed violation of community Code of Conduct regarding harassment or abusive behavior.",
  },
  {
    label: "Malicious model / payload",
    notes: "Removed due to unsafe or malicious simulation artifact payload.",
  },
  {
    label: "No violation found (Dismiss)",
    notes: "Reviewed reported content against community guidelines; no policy violation found.",
  },
];

export const AdminModerationTab: React.FC<AdminModerationTabProps> = ({
  reports,
  modFilter,
  setModFilter,
  onResolveReport,
  onBulkResolveReports,
  onDeletePost,
  loading,
}) => {
  const [activeReportToResolve, setActiveReportToResolve] = useState<AdminModerationReport | null>(null);
  const [modResolutionAction, setModResolutionAction] = useState<AdminModerationAction>("none");
  const [modResolutionStatus, setModResolutionStatus] = useState<"resolved" | "dismissed">("resolved");
  const [modResolutionNotes, setModResolutionNotes] = useState("");
  const [modContentWarning, setModContentWarning] = useState("");
  const [resolveAllForTarget, setResolveAllForTarget] = useState(true);
  const [forwardFederatedFlag, setForwardFederatedFlag] = useState(false);

  const [targetTypeFilter, setTargetTypeFilter] = useState<"all" | "post" | "user" | "appeal" | "package" | "repo">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (targetTypeFilter !== "all" && (r.target_type || "post") !== targetTypeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = [
          r.reason,
          r.details,
          r.post_content,
          r.reporter_username,
          r.author_username,
          r.target_username,
          r.author_domain,
          r.target_resource_id,
          `#${r.id}`,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, targetTypeFilter, searchQuery]);

  const inspectedReport = useMemo(() => {
    if (filteredReports.length === 0) return null;
    if (selectedReportId !== null) {
      const found = filteredReports.find((r) => r.id === selectedReportId);
      if (found) return found;
    }
    return filteredReports[0] ?? null;
  }, [filteredReports, selectedReportId]);

  // Keyboard j/k navigation for fast queue triage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || activeReportToResolve) {
        return;
      }
      if (filteredReports.length === 0) return;
      const currentIdx = inspectedReport ? filteredReports.findIndex((r) => r.id === inspectedReport.id) : 0;
      if (e.key === "j") {
        const next = filteredReports[Math.min(filteredReports.length - 1, currentIdx + 1)];
        if (next) setSelectedReportId(next.id);
      } else if (e.key === "k") {
        const prev = filteredReports[Math.max(0, currentIdx - 1)];
        if (prev) setSelectedReportId(prev.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredReports, inspectedReport, activeReportToResolve]);

  const handleConfirmResolve = async () => {
    if (!activeReportToResolve) return;
    await onResolveReport(activeReportToResolve.id, {
      status: modResolutionStatus,
      action: modResolutionAction,
      resolutionNotes: modResolutionNotes,
      resolveAllForTarget,
      ...(modResolutionAction === "mark_sensitive" && modContentWarning.trim()
        ? { contentWarning: modContentWarning.trim() }
        : {}),
      ...(forwardFederatedFlag ? { forwardFederatedFlag: true } : {}),
    });
    setActiveReportToResolve(null);
    setModResolutionNotes("");
    setModContentWarning("");
    setForwardFederatedFlag(false);
  };

  const toggleBatchSelect = (reportId: number) => {
    setSelectedBatchIds((prev) =>
      prev.includes(reportId) ? prev.filter((id) => id !== reportId) : [...prev, reportId],
    );
  };

  const pendingFilteredIds = useMemo(
    () => filteredReports.filter((r) => r.status === "pending").map((r) => r.id),
    [filteredReports],
  );

  const handleSelectAllPending = () => {
    if (selectedBatchIds.length === pendingFilteredIds.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(pendingFilteredIds);
    }
  };

  const handleBulkAction = async (status: "resolved" | "dismissed", action: AdminModerationAction) => {
    if (!onBulkResolveReports || selectedBatchIds.length === 0) return;
    await onBulkResolveReports({
      reportIds: selectedBatchIds,
      status,
      action,
      resolutionNotes:
        status === "dismissed" ? "Bulk dismissed by moderator." : `Bulk resolved (${action}) by moderator.`,
    });
    setSelectedBatchIds([]);
  };

  return (
    <div>
      {/* ── TOP FILTER & SEARCH BAR ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
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

          <span style={{ color: "var(--color-border)", margin: "0 4px" }}>|</span>

          <FilterPill $active={targetTypeFilter === "all"} onClick={() => setTargetTypeFilter("all")}>
            All Targets
          </FilterPill>
          <FilterPill $active={targetTypeFilter === "post"} onClick={() => setTargetTypeFilter("post")}>
            Posts
          </FilterPill>
          <FilterPill $active={targetTypeFilter === "user"} onClick={() => setTargetTypeFilter("user")}>
            Accounts
          </FilterPill>
          <FilterPill $active={targetTypeFilter === "appeal"} onClick={() => setTargetTypeFilter("appeal")}>
            Appeals
          </FilterPill>
          <FilterPill $active={targetTypeFilter === "package"} onClick={() => setTargetTypeFilter("package")}>
            Packages
          </FilterPill>
        </Box>

        <Input
          style={{ width: "260px" }}
          placeholder="Search reason, @user, domain..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Box>

      {/* ── BULK TRIAGE TOOLBAR ── */}
      {onBulkResolveReports && pendingFilteredIds.length > 0 && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={2}
          p={2}
          mb={3}
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
          }}
        >
          <Box display="flex" alignItems="center" gap={2}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                cursor: "pointer",
                color: "var(--color-text-muted)",
              }}
            >
              <input
                type="checkbox"
                checked={pendingFilteredIds.length > 0 && selectedBatchIds.length === pendingFilteredIds.length}
                onChange={handleSelectAllPending}
              />
              Select All Pending ({pendingFilteredIds.length})
            </label>
            {selectedBatchIds.length > 0 && <Badge $variant="warning">{selectedBatchIds.length} selected</Badge>}
          </Box>

          {selectedBatchIds.length > 0 && (
            <Box display="flex" alignItems="center" gap={2}>
              <ActionButton
                $variant="primary"
                disabled={loading}
                onClick={() => void handleBulkAction("resolved", "delete_post")}
              >
                <CheckIcon size={13} />
                <span>Bulk Resolve &amp; Delete Posts</span>
              </ActionButton>
              <ActionButton
                $variant="secondary"
                disabled={loading}
                onClick={() => void handleBulkAction("dismissed", "none")}
              >
                <XIcon size={13} />
                <span>Bulk Dismiss</span>
              </ActionButton>
            </Box>
          )}
        </Box>
      )}

      {filteredReports.length === 0 ? (
        <Card>
          <Box color="var(--color-text-muted)" textAlign="center" py={4}>
            No moderation reports found for this filter.
          </Box>
        </Card>
      ) : (
        <Box
          display="grid"
          style={{
            gridTemplateColumns: inspectedReport ? "minmax(0, 1.35fr) minmax(300px, 1fr)" : "1fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* ── LEFT PANE: REPORT CARDS ── */}
          <div>
            {filteredReports.map((report) => {
              const isSelected = inspectedReport?.id === report.id;
              const targetUsername = report.author_username || report.target_username;
              return (
                <Card
                  key={report.id}
                  onClick={() => setSelectedReportId(report.id)}
                  style={{
                    cursor: "pointer",
                    borderColor: isSelected ? "var(--color-accent-purple)" : undefined,
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                      {onBulkResolveReports && report.status === "pending" && (
                        <input
                          type="checkbox"
                          checked={selectedBatchIds.includes(report.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleBatchSelect(report.id)}
                          aria-label={`Select report #${report.id}`}
                        />
                      )}
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
                      <Badge $variant="neutral">{report.target_type || (report.post_id ? "post" : "user")}</Badge>
                      {report.target_report_count && report.target_report_count > 1 && (
                        <Badge $variant="danger">{report.target_report_count}x reports</Badge>
                      )}
                      {report.author_prior_violations && report.author_prior_violations > 0 ? (
                        <Badge $variant="warning">
                          {report.author_prior_violations} prior violation
                          {report.author_prior_violations > 1 ? "s" : ""}
                        </Badge>
                      ) : null}
                    </Box>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      {new Date(report.created_at).toLocaleString()}
                    </span>
                  </Box>

                  <Box fontSize="13px" color="var(--color-text-primary)">
                    <strong>Reason:</strong> {report.reason}
                  </Box>

                  {report.details && (
                    <Box fontSize="12px" color="var(--color-text-muted)">
                      <strong>Details:</strong> {report.details}
                    </Box>
                  )}

                  <Box display="flex" gap={3} flexWrap="wrap" fontSize="12px" color="var(--color-text-muted)">
                    {report.reporter_username && (
                      <span>
                        Reported by: <strong>@{report.reporter_username}</strong>
                      </span>
                    )}
                    {targetUsername && (
                      <span>
                        Target Account: <strong>@{targetUsername}</strong>
                        {report.author_domain ? ` (${report.author_domain})` : ""}
                      </span>
                    )}
                    {report.action_taken && report.action_taken !== "none" && (
                      <span>
                        Action Enforced: <strong>{report.action_taken}</strong>
                      </span>
                    )}
                  </Box>

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
                        Target Post #{report.post_id || "deleted"} (by @{report.author_username || "author"}):
                      </span>
                      {report.post_content}
                    </Box>
                  )}

                  {report.resolution_notes && (
                    <Box fontSize="12px" color="var(--color-text-muted)">
                      <strong>Resolution Notes:</strong> {report.resolution_notes}
                    </Box>
                  )}

                  <Box display="flex" gap={2} mt={2} alignItems="center" onClick={(e) => e.stopPropagation()}>
                    {report.status === "pending" ? (
                      <>
                        <ActionButton
                          $variant="primary"
                          onClick={() => {
                            setActiveReportToResolve(report);
                            setModResolutionStatus("resolved");
                            setModResolutionAction(
                              report.post_id ? "delete_post" : report.target_type === "user" ? "freeze_user" : "none",
                            );
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
                      </>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        Status: <strong style={{ textTransform: "capitalize" }}>{report.status}</strong>
                      </span>
                    )}
                    {report.post_id && (
                      <ActionButton $variant="danger" onClick={() => onDeletePost(report.post_id!)} disabled={loading}>
                        <TrashIcon size={14} />
                        <span>Delete Post</span>
                      </ActionButton>
                    )}
                  </Box>
                </Card>
              );
            })}
          </div>

          {/* ── RIGHT PANE: FORENSIC INSPECTOR DOSSIER ── */}
          {inspectedReport && (
            <Card style={{ position: "sticky", top: "76px" }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={2}>
                  <ShieldLockIcon size={16} fill="var(--color-accent-purple)" />
                  <span style={{ fontWeight: 800, fontSize: "14px" }}>
                    Forensic Dossier — Report #{inspectedReport.id}
                  </span>
                </Box>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>j / k to navigate</span>
              </Box>

              <Box
                p={2}
                style={{
                  background: "var(--color-bg-primary)",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-subtle)",
                  fontSize: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div>
                  <strong>Target Type:</strong>{" "}
                  {(inspectedReport.target_type || (inspectedReport.post_id ? "post" : "user")).toUpperCase()}
                </div>
                <div>
                  <strong>Target Subject:</strong>{" "}
                  {inspectedReport.author_username || inspectedReport.target_username
                    ? `@${inspectedReport.author_username || inspectedReport.target_username}`
                    : inspectedReport.post_id
                      ? `Post #${inspectedReport.post_id}`
                      : `User #${inspectedReport.target_user_id || "unknown"}`}
                </div>
                <div>
                  <strong>Origin Instance:</strong> {inspectedReport.author_domain || "Local Instance"}
                </div>
                <div>
                  <strong>Target Report Volume:</strong> {inspectedReport.target_report_count ?? 1} total report(s)
                </div>
                <div>
                  <strong>Prior Resolved Violations:</strong> {inspectedReport.author_prior_violations ?? 0}
                </div>
              </Box>

              {inspectedReport.post_content && (
                <Box display="flex" flexDirection="column" gap={1}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
                    PRESERVED CONTENT SNAPSHOT
                  </span>
                  <Box
                    p={2}
                    style={{
                      background: "var(--color-bg-primary)",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-subtle)",
                      fontSize: "12px",
                      whiteSpace: "pre-wrap",
                      maxHeight: "180px",
                      overflowY: "auto",
                    }}
                  >
                    {inspectedReport.post_content}
                  </Box>
                </Box>
              )}

              {inspectedReport.status === "pending" && (
                <Box display="flex" flexDirection="column" gap={2} mt={1}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
                    ONE-CLICK GRADUATED ENFORCEMENT
                  </span>
                  <Box display="flex" flexWrap="wrap" gap={2}>
                    {inspectedReport.post_id && (
                      <>
                        <ActionButton
                          $variant="secondary"
                          disabled={loading}
                          onClick={() =>
                            void onResolveReport(inspectedReport.id, {
                              status: "resolved",
                              action: "mark_sensitive",
                              resolutionNotes: "Content warning (CW) applied to post.",
                              resolveAllForTarget: true,
                            })
                          }
                        >
                          Mark Sensitive (CW)
                        </ActionButton>
                        <ActionButton
                          $variant="secondary"
                          disabled={loading}
                          onClick={() =>
                            void onResolveReport(inspectedReport.id, {
                              status: "resolved",
                              action: "silence_post",
                              resolutionNotes: "Post unlisted from public timelines.",
                              resolveAllForTarget: true,
                            })
                          }
                        >
                          Unlist / Silence Post
                        </ActionButton>
                      </>
                    )}
                    {inspectedReport.target_type === "appeal" && inspectedReport.target_user_id && (
                      <ActionButton
                        $variant="primary"
                        disabled={loading}
                        onClick={() =>
                          void onResolveReport(inspectedReport.id, {
                            status: "resolved",
                            action: "restore_user",
                            resolutionNotes: "Moderation appeal approved; account restored to active status.",
                            resolveAllForTarget: true,
                          })
                        }
                      >
                        Approve Appeal &amp; Restore User
                      </ActionButton>
                    )}
                    {(inspectedReport.target_user_id || inspectedReport.post_id) && (
                      <>
                        <ActionButton
                          $variant="secondary"
                          disabled={loading}
                          onClick={() =>
                            void onResolveReport(inspectedReport.id, {
                              status: "resolved",
                              action: "freeze_user",
                              resolutionNotes: "Account frozen (read-only) pending investigation.",
                              resolveAllForTarget: true,
                            })
                          }
                        >
                          Freeze Author
                        </ActionButton>
                        <ActionButton
                          $variant="danger"
                          disabled={loading}
                          onClick={() =>
                            void onResolveReport(inspectedReport.id, {
                              status: "resolved",
                              action: "suspend_user",
                              resolutionNotes: "Account suspended and spam content purged.",
                              resolveAllForTarget: true,
                            })
                          }
                        >
                          Suspend Author
                        </ActionButton>
                      </>
                    )}
                  </Box>
                </Box>
              )}
            </Card>
          )}
        </Box>
      )}

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
              <Select
                value={modResolutionStatus}
                onChange={(e) => setModResolutionStatus(e.target.value as "resolved" | "dismissed")}
              >
                <option value="resolved">Resolved (Violation Confirmed)</option>
                <option value="dismissed">Dismissed (No Action Required)</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Action to Enforce</label>
              <Select
                value={modResolutionAction}
                onChange={(e) => setModResolutionAction(e.target.value as AdminModerationAction)}
              >
                <option value="none">None (Keep content intact)</option>
                {activeReportToResolve.post_id && (
                  <>
                    <option value="mark_sensitive">Apply Content Warning (CW) / Sensitive Blur</option>
                    <option value="silence_post">Unlist / Silence Post (Hide from public feeds)</option>
                    <option value="delete_post">Delete Post &amp; Broadcast ActivityPub Tombstone</option>
                  </>
                )}
                <option value="freeze_user">Freeze Target User Account (Read-Only)</option>
                <option value="suspend_user">Suspend Target User Account &amp; Purge Posts</option>
                <option value="restore_user">Approve Appeal &amp; Restore User Account</option>
                <option value="silence_domain">Silence Remote Domain</option>
                <option value="suspend_domain">Suspend Remote Domain</option>
              </Select>
            </Box>

            {modResolutionAction === "mark_sensitive" && (
              <Box display="flex" flexDirection="column" gap={1}>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Content Warning Banner Text</label>
                <Input
                  placeholder="e.g. Graphic simulation output or sensitive engineering content"
                  value={modContentWarning}
                  onChange={(e) => setModContentWarning(e.target.value)}
                />
              </Box>
            )}

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Canned Policy Templates</label>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {CANNED_RESOLUTION_TEMPLATES.map((tpl) => (
                  <FilterPill
                    key={tpl.label}
                    $active={modResolutionNotes === tpl.notes}
                    type="button"
                    onClick={() => setModResolutionNotes(tpl.notes)}
                  >
                    {tpl.label}
                  </FilterPill>
                ))}
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Resolution Notes</label>
              <Textarea
                placeholder="Explain the moderation decision for the immutable audit trail..."
                value={modResolutionNotes}
                onChange={(e) => setModResolutionNotes(e.target.value)}
              />
            </Box>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={resolveAllForTarget}
                onChange={(e) => setResolveAllForTarget(e.target.checked)}
              />
              Resolve all open duplicate reports targeting this same post/user
            </label>

            {activeReportToResolve.author_domain && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={forwardFederatedFlag}
                  onChange={(e) => setForwardFederatedFlag(e.target.checked)}
                />
                Forward ActivityPub Flag activity to remote instance ({activeReportToResolve.author_domain})
              </label>
            )}

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setActiveReportToResolve(null)}>
                Cancel
              </ActionButton>
              <ActionButton $variant="primary" onClick={handleConfirmResolve} disabled={loading}>
                Confirm Resolution
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};
