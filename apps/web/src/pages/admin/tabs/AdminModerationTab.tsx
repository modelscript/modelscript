// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
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
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const pageSize = 20;

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

  const paginatedReports = useMemo(
    () => filteredReports.slice(page * pageSize, (page + 1) * pageSize),
    [filteredReports, page],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        activeReportToResolve
      ) {
        return;
      }
      if (paginatedReports.length === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(paginatedReports.length - 1, prev + 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "x") {
        e.preventDefault();
        const item = paginatedReports[focusedIndex];
        if (item && item.status === "pending") {
          setSelectedBatchIds((prev) =>
            prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
          );
        }
      } else if (e.key === "r") {
        e.preventDefault();
        const item = paginatedReports[focusedIndex];
        if (item && item.status === "pending") {
          setActiveReportToResolve(item);
          setModResolutionStatus("resolved");
          setModResolutionAction("delete_post");
        }
      } else if (e.key === "d") {
        e.preventDefault();
        const item = paginatedReports[focusedIndex];
        if (item && item.status === "pending") {
          void onResolveReport(item.id, {
            status: "dismissed",
            action: "none",
            resolutionNotes: "Dismissed via keyboard triage.",
          });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paginatedReports, focusedIndex, activeReportToResolve, onResolveReport]);

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

  const showBulkToolbar = Boolean(
    onBulkResolveReports && (selectedBatchIds.length > 0 || pendingFilteredIds.length > 1),
  );

  return (
    <div>
      {/* ── TOP FILTER & SEARCH BAR ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <FilterPill $active={modFilter === "all"} onClick={() => setModFilter("all")}>
            All
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
          <Badge $variant="neutral" title="Keyboard triage shortcuts">
            Keys: j/k navigate • x select • r resolve • d dismiss
          </Badge>
        </Box>

        <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
          <Select
            aria-label="Filter by target type"
            value={targetTypeFilter}
            onChange={(e) => {
              setTargetTypeFilter(e.target.value as typeof targetTypeFilter);
              setPage(0);
            }}
            style={{ padding: "6px 10px", fontSize: "12px" }}
          >
            <option value="all">All Targets</option>
            <option value="post">Posts</option>
            <option value="user">Accounts</option>
            <option value="appeal">Appeals</option>
            <option value="package">Packages</option>
          </Select>

          <Input
            style={{ width: "240px", padding: "6px 12px", fontSize: "12px" }}
            placeholder="Search reason, @user, domain..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
          />
        </Box>
      </Box>

      {/* ── BULK TRIAGE TOOLBAR ── */}
      {showBulkToolbar && (
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

      {paginatedReports.length === 0 ? (
        <Card>
          <Box color="var(--color-text-muted)" textAlign="center" py={4}>
            No moderation reports found for this filter.
          </Box>
        </Card>
      ) : (
        <div>
          {paginatedReports.map((report, idx) => {
            const targetUsername = report.author_username || report.target_username;
            const targetKind = report.target_type || (report.post_id ? "post" : "user");
            const isFocused = idx === focusedIndex;
            return (
              <Card
                key={report.id}
                style={
                  isFocused
                    ? { borderColor: "var(--color-accent-primary)", boxShadow: "0 0 0 1px var(--color-accent-primary)" }
                    : undefined
                }
                onClick={() => setFocusedIndex(idx)}
              >
                {/* ── HEADER ROW ── */}
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                    {onBulkResolveReports && report.status === "pending" && (
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.includes(report.id)}
                        onChange={() => toggleBatchSelect(report.id)}
                        aria-label={`Select report #${report.id}`}
                      />
                    )}
                    <span style={{ fontWeight: 700, fontSize: "14px" }}>Report #{report.id}</span>
                    <Badge
                      $variant={
                        report.status === "resolved" ? "success" : report.status === "dismissed" ? "neutral" : "warning"
                      }
                    >
                      {report.status}
                    </Badge>
                    <Badge $variant="neutral">{targetKind}</Badge>
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

                {/* ── REASON & DETAILS ── */}
                <Box display="flex" flexDirection="column" gap={1}>
                  <Box fontSize="14px" color="var(--color-text-primary)" style={{ fontWeight: 600 }}>
                    {report.reason}
                  </Box>
                  {report.details && (
                    <Box fontSize="13px" color="var(--color-text-muted)">
                      {report.details}
                    </Box>
                  )}
                </Box>

                {/* ── REPORTED POST SNAPSHOT ── */}
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
                      Post #{report.post_id || "deleted"} (by @{report.author_username || "author"}):
                    </span>
                    {report.post_content}
                  </Box>
                )}

                {report.resolution_notes && (
                  <Box fontSize="12px" color="var(--color-text-muted)">
                    <strong>Resolution Notes:</strong> {report.resolution_notes}
                  </Box>
                )}

                {/* ── FOOTER: PARTICIPANTS & ACTIONS ── */}
                <Box
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={2}
                  pt={2}
                  style={{ borderTop: "1px solid var(--color-border-subtle)" }}
                >
                  <Box display="flex" gap={3} flexWrap="wrap" fontSize="12px" color="var(--color-text-muted)">
                    {targetUsername && (
                      <span>
                        Target: <strong style={{ color: "var(--color-text-primary)" }}>@{targetUsername}</strong>
                        {report.author_domain ? ` (${report.author_domain})` : ""}
                      </span>
                    )}
                    {report.reporter_username && (
                      <span>
                        Reported by: <strong>@{report.reporter_username}</strong>
                      </span>
                    )}
                    {report.action_taken && report.action_taken !== "none" && (
                      <span>
                        Action: <strong>{report.action_taken}</strong>
                      </span>
                    )}
                  </Box>

                  <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                    {report.status === "pending" && (
                      <>
                        {report.target_type === "appeal" && report.target_user_id && (
                          <ActionButton
                            $variant="secondary"
                            disabled={loading}
                            onClick={() =>
                              void onResolveReport(report.id, {
                                status: "resolved",
                                action: "restore_user",
                                resolutionNotes: "Moderation appeal approved; account restored to active status.",
                                resolveAllForTarget: true,
                              })
                            }
                          >
                            Approve Appeal
                          </ActionButton>
                        )}
                        <ActionButton
                          $variant="primary"
                          onClick={() => {
                            setActiveReportToResolve(report);
                            setModResolutionStatus("resolved");
                            setModResolutionAction(
                              report.post_id
                                ? "delete_post"
                                : report.target_type === "appeal"
                                  ? "restore_user"
                                  : report.target_type === "user"
                                    ? "freeze_user"
                                    : "none",
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
                    )}
                    {report.post_id && (
                      <ActionButton $variant="danger" onClick={() => onDeletePost(report.post_id!)} disabled={loading}>
                        <TrashIcon size={14} />
                        <span>Delete Post</span>
                      </ActionButton>
                    )}
                  </Box>
                </Box>
              </Card>
            );
          })}

          {filteredReports.length > pageSize && (
            <Box display="flex" justifyContent="space-between" alignItems="center" mt={3}>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredReports.length)} of{" "}
                {filteredReports.length} reports
              </span>
              <Box display="flex" gap={2}>
                <ActionButton
                  $variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  disabled={(page + 1) * pageSize >= filteredReports.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </ActionButton>
              </Box>
            </Box>
          )}
        </div>
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
