// SPDX-License-Identifier: AGPL-3.0-or-later

import { TrashIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, FilterPill, ModalBox, ModalOverlay, Select, Textarea } from "../styles";
import type { AdminModerationReport } from "../types";

export interface AdminModerationTabProps {
  reports: AdminModerationReport[];
  modFilter: string;
  setModFilter: (filter: string) => void;
  onResolveReport: (
    reportId: number,
    resolution: {
      status: "resolved" | "dismissed";
      action: "none" | "delete_post" | "silence_domain" | "suspend_domain";
      resolutionNotes: string;
    },
  ) => Promise<void>;
  onDeletePost: (postId: number) => Promise<void>;
  loading: boolean;
}

export const AdminModerationTab: React.FC<AdminModerationTabProps> = ({
  reports,
  modFilter,
  setModFilter,
  onResolveReport,
  onDeletePost,
  loading,
}) => {
  const [activeReportToResolve, setActiveReportToResolve] = useState<AdminModerationReport | null>(null);
  const [modResolutionAction, setModResolutionAction] = useState<
    "none" | "delete_post" | "silence_domain" | "suspend_domain"
  >("none");
  const [modResolutionStatus, setModResolutionStatus] = useState<"resolved" | "dismissed">("resolved");
  const [modResolutionNotes, setModResolutionNotes] = useState("");

  const handleConfirmResolve = async () => {
    if (!activeReportToResolve) return;
    await onResolveReport(activeReportToResolve.id, {
      status: modResolutionStatus,
      action: modResolutionAction,
      resolutionNotes: modResolutionNotes,
    });
    setActiveReportToResolve(null);
    setModResolutionNotes("");
  };

  return (
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
                    report.status === "resolved" ? "success" : report.status === "dismissed" ? "neutral" : "warning"
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
                <ActionButton $variant="danger" onClick={() => onDeletePost(report.post_id!)} disabled={loading}>
                  <TrashIcon size={14} />
                  <span>Delete Post</span>
                </ActionButton>
              )}
            </Box>
          </Card>
        ))
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
                onChange={(e) =>
                  setModResolutionAction(e.target.value as "none" | "delete_post" | "silence_domain" | "suspend_domain")
                }
              >
                <option value="none">None (Keep content intact)</option>
                {activeReportToResolve.post_id && (
                  <option value="delete_post">Delete Post &amp; Broadcast ActivityPub Tombstone</option>
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
