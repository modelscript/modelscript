// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, GitPullRequestIcon, HistoryIcon, SyncIcon, VerifiedIcon, XIcon } from "@primer/octicons-react";
import { Button, Dialog, Label, SegmentedControl, Spinner, Text } from "@primer/react";
import React from "react";
import type { ThreadAuditLogDto, ThreadProposalDto } from "../../../api";
import Box from "../../Box";

export interface ThreadGovernanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  governanceTab: "proposals" | "audit";
  onTabChange: (tab: "proposals" | "audit") => void;
  proposals: ThreadProposalDto[];
  auditLogs: ThreadAuditLogDto[];
  auditVerification: { valid: boolean; totalEntries: number } | null;
  isLoadingGovernance: boolean;
  onRefresh: () => void;
  onOpenReview: (
    proposal: ThreadProposalDto,
    action: "approved" | "rejected" | "applied",
    defaultComment: string,
  ) => void;
}

export const ThreadGovernanceModal: React.FC<ThreadGovernanceModalProps> = ({
  isOpen,
  onClose,
  governanceTab,
  onTabChange,
  proposals,
  auditLogs,
  auditVerification,
  isLoadingGovernance,
  onRefresh,
  onOpenReview,
}) => {
  if (!isOpen) return null;

  return (
    <Dialog
      title="Digital Twin Governance & Regulatory Audit Trail"
      onClose={onClose}
      style={{
        width: "95vw",
        maxWidth: 960,
        maxHeight: "85vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box display="flex" flexDirection="column" gap={3} sx={{ height: "100%", overflowY: "auto", pr: 1 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <SegmentedControl aria-label="Governance Views">
            <SegmentedControl.Button
              leadingIcon={GitPullRequestIcon}
              selected={governanceTab === "proposals"}
              onClick={() => onTabChange("proposals")}
            >
              {`Merge Proposals (${proposals.length})`}
            </SegmentedControl.Button>
            <SegmentedControl.Button
              leadingIcon={HistoryIcon}
              selected={governanceTab === "audit"}
              onClick={() => onTabChange("audit")}
            >
              {`Cryptographic Audit Trail (${auditLogs.length})`}
            </SegmentedControl.Button>
          </SegmentedControl>

          <Button size="small" onClick={onRefresh} disabled={isLoadingGovernance}>
            <SyncIcon size={12} /> Refresh
          </Button>
        </Box>

        {isLoadingGovernance && (
          <Box display="flex" justifyContent="center" alignItems="center" p={4} gap={2}>
            <Spinner size="medium" />
            <Text sx={{ fontSize: 13, color: "var(--color-fg-muted)" }}>Loading governance records...</Text>
          </Box>
        )}

        {/* ── Tab: Proposals ── */}
        {governanceTab === "proposals" && !isLoadingGovernance && (
          <Box display="flex" flexDirection="column" gap={3}>
            {proposals.length === 0 ? (
              <Box p={4} textAlign="center" color="var(--color-fg-muted)">
                No merge proposals recorded. Use "Propose Resolution" on any twin to create one.
              </Box>
            ) : (
              proposals.map((prop) => (
                <Box
                  key={prop.id}
                  p={3}
                  bg="var(--color-canvas-subtle)"
                  borderRadius={8}
                  border="1px solid var(--color-border-default)"
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                    <Box display="flex" alignItems="center" gap={2}>
                      <GitPullRequestIcon
                        size={16}
                        style={{
                          color:
                            prop.status === "approved" || prop.status === "applied"
                              ? "var(--ms-success)"
                              : prop.status === "rejected"
                                ? "var(--ms-danger)"
                                : "#d29922",
                        }}
                      />
                      <Text sx={{ fontWeight: 600, fontSize: 14 }}>{prop.title}</Text>
                      <Label
                        variant={
                          prop.status === "applied"
                            ? "accent"
                            : prop.status === "approved"
                              ? "success"
                              : prop.status === "rejected"
                                ? "danger"
                                : "attention"
                        }
                      >
                        {prop.status.toUpperCase()}
                      </Label>
                    </Box>

                    <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                      Proposed by <strong>{prop.proposed_by}</strong> • {new Date(prop.created_at).toLocaleString()}
                    </Text>
                  </Box>

                  {prop.description && (
                    <Text sx={{ fontSize: 13, color: "var(--color-fg-default)" }}>{prop.description}</Text>
                  )}

                  {prop.review_comment && (
                    <Box
                      p={2}
                      bg="rgba(110, 118, 129, 0.1)"
                      borderRadius={6}
                      borderLeft="3px solid var(--color-accent-emphasis)"
                    >
                      <Text sx={{ fontSize: 12, fontStyle: "italic" }}>
                        Reviewer ({prop.resolved_by}): "{prop.review_comment}"
                      </Text>
                    </Box>
                  )}

                  {prop.status === "open" && (
                    <Box display="flex" gap={2} mt={1}>
                      <Button
                        size="small"
                        variant="primary"
                        leadingVisual={CheckIcon}
                        onClick={() => onOpenReview(prop, "approved", "Approved after functional safety review.")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="default"
                        onClick={() =>
                          onOpenReview(prop, "applied", "Applied resolution into digital thread baseline.")
                        }
                      >
                        Apply to Baseline
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        leadingVisual={XIcon}
                        onClick={() =>
                          onOpenReview(prop, "rejected", "Rejected due to parameter constraint violation.")
                        }
                      >
                        Reject
                      </Button>
                    </Box>
                  )}
                </Box>
              ))
            )}
          </Box>
        )}

        {/* ── Tab: Regulatory Audit Trail ── */}
        {governanceTab === "audit" && !isLoadingGovernance && (
          <Box display="flex" flexDirection="column" gap={3}>
            {auditVerification && !auditVerification.valid ? (
              <Box
                p={3}
                bg="rgba(248, 81, 73, 0.12)"
                border="1px solid rgba(248, 81, 73, 0.4)"
                borderRadius={8}
                display="flex"
                alignItems="center"
                gap={2}
              >
                <XIcon size={18} fill="var(--color-danger-fg, #f85149)" />
                <div>
                  <Text
                    sx={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: "var(--color-danger-fg, #f85149)",
                      display: "block",
                    }}
                  >
                    Cryptographic Hash Chain Verification Failed ({auditVerification.totalEntries} block
                    {auditVerification.totalEntries === 1 ? "" : "s"}, SHA-256)
                  </Text>
                  <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                    Tampering or checksum discontinuity detected in the regulatory audit trail. Re-verify baseline
                    integrity before qualification sign-off.
                  </Text>
                </div>
              </Box>
            ) : (
              <Box
                p={3}
                bg="rgba(46, 160, 67, 0.1)"
                border="1px solid rgba(46, 160, 67, 0.3)"
                borderRadius={8}
                display="flex"
                alignItems="center"
                gap={2}
              >
                <VerifiedIcon size={18} fill="var(--ms-success)" />
                <div>
                  <Text
                    sx={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: auditVerification?.valid ? "var(--ms-success)" : "#d29922",
                      display: "block",
                    }}
                  >
                    {auditVerification?.valid
                      ? `Cryptographic Hash Chain Verified (${auditVerification.totalEntries} block${auditVerification.totalEntries === 1 ? "" : "s"}, SHA-256)`
                      : "Cryptographic Hash Chain Active (SHA-256)"}
                  </Text>
                  <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                    Every mutation in this digital thread is anchored in a 256-bit cryptographic Merkle chain in
                    compliance with ISO 26262 Part 8 and DO-178C qualification standards.
                  </Text>
                </div>
              </Box>
            )}

            <div style={{ overflowX: "auto", width: "100%" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  background: "var(--color-canvas-subtle)",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr style={{ background: "rgba(110, 118, 129, 0.15)", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Timestamp</th>
                    <th style={{ padding: "8px 12px" }}>Action</th>
                    <th style={{ padding: "8px 12px" }}>Actor</th>
                    <th style={{ padding: "8px 12px" }}>Standard</th>
                    <th style={{ padding: "8px 12px" }}>SHA256 Checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <Label variant="secondary">{log.action}</Label>
                      </td>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{log.actor}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <Label variant="accent">{log.safety_standard || "ISO-26262"}</Label>
                      </td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
                        {log.checksum.slice(0, 16)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Box>
        )}
      </Box>
    </Dialog>
  );
};
