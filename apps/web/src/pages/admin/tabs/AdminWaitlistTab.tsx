// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, ClockIcon, GlobeIcon, MortarBoardIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import type { AdminWaitlistEntry } from "../../../api";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { ActionButton, Badge, Card, FilterPill, ModalBox, ModalOverlay, Table, Textarea } from "../styles";

export interface AdminWaitlistTabProps {
  entries: AdminWaitlistEntry[];
  loading: boolean;
  onRefresh: () => void;
  onApprove: (id: number) => Promise<{ inviteCode: string }>;
  onReject: (id: number, reason?: string) => Promise<void>;
}

export const AdminWaitlistTab: React.FC<AdminWaitlistTabProps> = ({
  entries,
  loading,
  onRefresh,
  onApprove,
  onReject,
}) => {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState<number | null>(null);

  // Reject modal state
  const [rejectModalEntry, setRejectModalEntry] = useState<AdminWaitlistEntry | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const rejectModalRef = useRef<HTMLDivElement | null>(null);

  // Approval modal state (to show generated invite code)
  const [approvedResult, setApprovedResult] = useState<{ email: string; inviteCode: string } | null>(null);
  const approvedModalRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(rejectModalRef, Boolean(rejectModalEntry), {
    onEscape: () => setRejectModalEntry(null),
  });
  useFocusTrap(approvedModalRef, Boolean(approvedResult), {
    onEscape: () => setApprovedResult(null),
  });

  useEffect(() => {
    if (!rejectModalEntry && !approvedResult) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRejectModalEntry(null);
        setApprovedResult(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rejectModalEntry, approvedResult]);

  const filteredEntries = entries.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchEmail = (e.email || "").toLowerCase().includes(q);
      const matchName = (e.name || "").toLowerCase().includes(q);
      const matchOrg = (e.organization || "").toLowerCase().includes(q);
      const matchDiscipline = (e.engineeringDiscipline || "").toLowerCase().includes(q);
      return matchEmail || matchName || matchOrg || matchDiscipline;
    }
    return true;
  });

  const handleApprove = async (entry: AdminWaitlistEntry) => {
    try {
      setProcessingId(entry.id);
      const res = await onApprove(entry.id);
      setApprovedResult({ email: entry.email, inviteCode: res.inviteCode });
      toast.show(`Application for ${entry.email} approved!`, { type: "success" });
      onRefresh();
    } catch {
      toast.show("Failed to approve application", { type: "error" });
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectModalEntry) return;
    try {
      setProcessingId(rejectModalEntry.id);
      await onReject(rejectModalEntry.id, rejectReason.trim() || undefined);
      toast.show(`Application for ${rejectModalEntry.email} rejected`, { type: "info" });
      setRejectModalEntry(null);
      setRejectReason("");
      onRefresh();
    } catch {
      toast.show("Failed to reject application", { type: "error" });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      {/* Top Filter and Search Bar */}
      <Box display="flex" justifyContent="space-between" alignItems="center" gap={3} mb={3} flexWrap="wrap">
        <Box display="flex" gap={2} flexWrap="wrap">
          <FilterPill $active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            All ({entries.length})
          </FilterPill>
          <FilterPill $active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>
            Pending ({entries.filter((e) => e.status === "pending").length})
          </FilterPill>
          <FilterPill $active={statusFilter === "approved"} onClick={() => setStatusFilter("approved")}>
            Approved ({entries.filter((e) => e.status === "approved").length})
          </FilterPill>
          <FilterPill $active={statusFilter === "rejected"} onClick={() => setStatusFilter("rejected")}>
            Rejected ({entries.filter((e) => e.status === "rejected").length})
          </FilterPill>
        </Box>

        <Box display="flex" alignItems="center" position="relative" width="280px" style={{ maxWidth: "100%" }}>
          <SearchIcon
            size={14}
            style={{
              position: "absolute",
              left: "12px",
              color: "var(--color-text-muted, #94a3b8)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="Search email, name, org..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px 8px 34px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--color-border-default, rgba(255, 255, 255, 0.1))",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </Box>
      </Box>

      {/* Main List */}
      {filteredEntries.length === 0 ? (
        <Card>
          <Box color="var(--color-text-muted)" textAlign="center" py={5}>
            {loading ? "Loading waitlist applications..." : "No waitlist applications found for this filter."}
          </Box>
        </Card>
      ) : (
        <Card style={{ overflowX: "auto" }}>
          <Table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Discipline &amp; Org</th>
                <th>Statement / Intended Use</th>
                <th>Applied</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "#fff" }}>{entry.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted, #94a3b8)" }}>{entry.email}</div>
                    {entry.isAcademic && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#38bdf8",
                          marginTop: "2px",
                        }}
                      >
                        <MortarBoardIcon size={12} /> Academic Verified
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ color: "#e2e8f0" }}>{entry.engineeringDiscipline || "General Engineering"}</div>
                    {entry.organization && (
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted, #94a3b8)" }}>
                        {entry.organization}
                      </div>
                    )}
                  </td>
                  <td style={{ maxWidth: "300px" }}>
                    <div
                      style={{
                        fontSize: "13px",
                        color: "var(--color-text-secondary, #cbd5e1)",
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                        maxHeight: "80px",
                        overflowY: "auto",
                      }}
                    >
                      {entry.intendedUse || (
                        <span style={{ color: "rgba(255,255,255,0.3)" }}>No statement provided</span>
                      )}
                    </div>
                    {entry.portfolioUrl && (
                      <a
                        href={entry.portfolioUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "11px",
                          color: "var(--color-accent-purple, #a855f7)",
                          marginTop: "4px",
                          textDecoration: "none",
                        }}
                      >
                        <GlobeIcon size={12} /> Portfolio / Repo
                      </a>
                    )}
                  </td>
                  <td style={{ fontSize: "12px", color: "var(--color-text-muted, #94a3b8)", whiteSpace: "nowrap" }}>
                    {new Date(entry.appliedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    {entry.status === "approved" && <Badge $variant="success">Approved</Badge>}
                    {entry.status === "rejected" && <Badge $variant="danger">Rejected</Badge>}
                    {entry.status === "pending" && (
                      <Badge $variant="warning" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <ClockIcon size={12} /> Pending
                      </Badge>
                    )}
                    {entry.rejectionReason && (
                      <div style={{ fontSize: "11px", color: "#f87171", marginTop: "2px" }}>
                        {entry.rejectionReason}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {entry.status === "pending" ? (
                      <Box display="inline-flex" gap={1}>
                        <ActionButton
                          $variant="primary"
                          onClick={() => handleApprove(entry)}
                          disabled={processingId === entry.id}
                          title="Approve applicant and generate invite code"
                        >
                          <CheckIcon size={13} style={{ marginRight: "4px" }} />
                          Approve
                        </ActionButton>
                        <ActionButton
                          $variant="danger"
                          onClick={() => {
                            setRejectModalEntry(entry);
                            setRejectReason("");
                          }}
                          disabled={processingId === entry.id}
                          title="Reject waitlist submission"
                        >
                          <XIcon size={13} style={{ marginRight: "4px" }} />
                          Reject
                        </ActionButton>
                      </Box>
                    ) : (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted, #64748b)" }}>
                        {entry.status === "approved" ? "Invite dispatched" : "Reviewed"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Reject Confirmation Modal */}
      {rejectModalEntry && (
        <ModalOverlay onClick={() => setRejectModalEntry(null)}>
          <ModalBox
            ref={rejectModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Reject Waitlist Application"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "450px" }}
          >
            <h3 style={{ margin: "0 0 12px 0", color: "#fff" }}>Reject Waitlist Application</h3>
            <p style={{ color: "var(--color-text-secondary, #94a3b8)", fontSize: "14px", lineHeight: "1.4" }}>
              Are you sure you want to reject the application for <strong>{rejectModalEntry.name}</strong> (
              {rejectModalEntry.email})?
            </p>
            <div style={{ marginTop: "12px" }}>
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-muted, #94a3b8)",
                  display: "block",
                  marginBottom: "4px",
                }}
              >
                Optional rejection note / internal feedback
              </label>
              <Textarea
                placeholder="Reason for rejection (e.g. invalid organization, duplicate profile)"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
              <ActionButton $variant="secondary" onClick={() => setRejectModalEntry(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="danger"
                onClick={handleConfirmReject}
                disabled={processingId === rejectModalEntry.id}
              >
                Confirm Rejection
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* Approved Success Details Modal */}
      {approvedResult && (
        <ModalOverlay onClick={() => setApprovedResult(null)}>
          <ModalBox
            ref={approvedModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Waitlist Approved"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "480px" }}
          >
            <Box display="flex" alignItems="center" gap={2} mb={2}>
              <CheckIcon size={24} fill="#22c55e" />
              <h3 style={{ margin: 0, color: "#fff" }}>Waitlist Approved!</h3>
            </Box>
            <p style={{ color: "var(--color-text-secondary, #94a3b8)", fontSize: "14px", lineHeight: "1.4" }}>
              Instant access has been granted for <strong>{approvedResult.email}</strong>. An invitation email with this
              activation code has been queued.
            </p>
            <Box
              mt={3}
              p={3}
              style={{
                background: "rgba(168, 85, 247, 0.1)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
                borderRadius: "8px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "12px", color: "var(--color-accent-purple, #c084fc)", fontWeight: 600 }}>
                Generated Access Key
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "#fff",
                  marginTop: "6px",
                  userSelect: "all",
                }}
              >
                {approvedResult.inviteCode}
              </div>
            </Box>
            <Box display="flex" justifyContent="flex-end" mt={3}>
              <ActionButton $variant="primary" onClick={() => setApprovedResult(null)}>
                Done
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};
