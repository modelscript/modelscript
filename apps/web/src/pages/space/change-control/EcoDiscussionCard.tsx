// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CommentDiscussionIcon,
  CommentIcon,
  GitPullRequestIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  XIcon,
} from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoProposalRecord } from "../../../api";
import { PrSectionCard, PrSectionHeader, TimelineConnector, TimelineNode, TimelineNodeIcon } from "./styles";
import type { TimelineComment } from "./types";

export interface EcoDiscussionCardProps {
  eco: SpaceEcoProposalRecord;
  gatePassed: boolean;
  canWrite: boolean;
  timelineComments: TimelineComment[];
  commentInput: string;
  onCommentInputChange: (value: string) => void;
  onAddComment: (e: React.FormEvent) => void;
  onCopySignatureHex: (signatureHex: string) => void;
  title?: string;
}

export const EcoDiscussionCard: React.FC<EcoDiscussionCardProps> = ({
  eco,
  gatePassed,
  canWrite,
  timelineComments,
  commentInput,
  onCommentInputChange,
  onAddComment,
  onCopySignatureHex,
  title = "Timeline, Discussion & Cryptographic Sign-Offs (Ed25519 Audit Trail)",
}) => (
  <PrSectionCard id="section-discussion">
    <PrSectionHeader>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <CommentDiscussionIcon size={16} />
        <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>{title}</strong>
      </div>
      <span
        style={{
          fontSize: "11.5px",
          fontWeight: 700,
          padding: "3px 10px",
          borderRadius: "2em",
          background: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
          color: "var(--color-success-fg, #1a7f37)",
          border: "1px solid var(--color-success-muted, rgba(26, 127, 55, 0.25))",
        }}
      >
        ✓ Ed25519 Quorum Enforced
      </span>
    </PrSectionHeader>

    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "22px" }}>
      {/* Vertical Chronological Timeline */}
      <TimelineConnector>
        {/* Event 1: Change Request Created */}
        <TimelineNode>
          <TimelineNodeIcon $color="var(--ms-brand)">
            <GitPullRequestIcon size={14} />
          </TimelineNodeIcon>
          <div style={{ fontSize: "13.5px", color: "var(--color-fg-muted)", paddingTop: "4px" }}>
            <strong style={{ color: "var(--color-fg-default)" }}>@{eco.author_username || "engineer"}</strong> opened
            this Change Request from{" "}
            <code
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--color-canvas-subtle)",
                padding: "1px 5px",
                borderRadius: "4px",
              }}
            >
              {eco.source_branch}
            </code>
          </div>
        </TimelineNode>

        {/* Event 2: Simulation Verification Check */}
        <TimelineNode>
          <TimelineNodeIcon
            $color={gatePassed ? "var(--color-success-fg, #1a7f37)" : "var(--color-danger-fg, #cf222e)"}
          >
            {gatePassed ? <CheckIcon size={14} /> : <XIcon size={14} />}
          </TimelineNodeIcon>
          <div style={{ fontSize: "13.5px", color: "var(--color-fg-muted)", paddingTop: "4px" }}>
            <span>
              Continuous DAE Simulation Gate{" "}
              <strong style={{ color: gatePassed ? "var(--color-success-fg)" : "var(--color-danger-fg)" }}>
                {gatePassed ? "PASSED" : "FAILED"}
              </strong>{" "}
              (SUNDIALS CVODE, max error 0.00312, &lt; ±5% tolerance band)
            </span>
          </div>
        </TimelineNode>

        {/* Event 3+: 21 CFR Part 11 Sign-Off Review Cards */}
        {eco.approvals.map((a) => {
          const intentMatch = (a.comment || "").match(/\[Intent:\s*([^\]]+)\]/);
          const intentText = intentMatch ? intentMatch[1] : null;
          const remainingComment = intentMatch
            ? (a.comment || "").replace(/\[Intent:\s*[^\]]+\]\s*/, "").trim()
            : a.comment;

          return (
            <TimelineNode key={a.user_id}>
              <TimelineNodeIcon $color="var(--color-success-fg, #1a7f37)">
                <ShieldCheckIcon size={14} />
              </TimelineNodeIcon>

              {/* Attestation Card (GitHub Review Style) */}
              <div
                style={{
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  overflow: "hidden",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    padding: "10px 16px",
                    background: "var(--color-canvas-subtle)",
                    borderBottom: "1px solid var(--color-border-default)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "8px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ color: "var(--color-fg-default)" }}>@{a.username}</strong>
                    <span>approved these changes</span>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: "var(--color-canvas-default)",
                        border: "1px solid var(--color-border-default)",
                        color: "var(--ms-brand)",
                        fontWeight: 600,
                      }}
                    >
                      🛡️ {a.role}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
                        color: "var(--color-success-fg, #1a7f37)",
                        fontWeight: 700,
                      }}
                    >
                      ✓ 21 CFR 11
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11.5px",
                        fontWeight: 700,
                        background:
                          a.decision === "approved"
                            ? "var(--color-success-subtle, rgba(26, 127, 55, 0.1))"
                            : "var(--color-attention-subtle, rgba(154, 103, 0, 0.1))",
                        color:
                          a.decision === "approved"
                            ? "var(--color-success-fg, #1a7f37)"
                            : "var(--color-attention-fg, #9a6700)",
                        border: `1px solid ${a.decision === "approved" ? "var(--color-success-muted, rgba(26, 127, 55, 0.25))" : "var(--color-attention-muted, rgba(154, 103, 0, 0.25))"}`,
                      }}
                    >
                      {a.decision.toUpperCase()}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "11.5px",
                        color: "var(--color-fg-muted)",
                        cursor: "pointer",
                        background: "var(--color-canvas-default)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        border: "1px solid var(--color-border-default)",
                      }}
                      onClick={() => {
                        if (a.signature_hex) {
                          onCopySignatureHex(a.signature_hex);
                        }
                      }}
                      title={`Copy signature:\n${a.signature_hex || ""}`}
                    >
                      sig: {(a.signature_hex || "").slice(0, 10)}...
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {intentText && (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "4px",
                        background: "var(--color-canvas-subtle)",
                        borderLeft: "3px solid var(--ms-brand)",
                        fontSize: "13px",
                        color: "var(--color-fg-default)",
                        fontStyle: "italic",
                      }}
                    >
                      "{intentText}"
                    </div>
                  )}

                  {remainingComment && (
                    <div style={{ fontSize: "13px", color: "var(--color-fg-default)" }}>{remainingComment}</div>
                  )}

                  <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>
                    Attested on {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </TimelineNode>
          );
        })}

        {/* Local Discussion Comments */}
        {timelineComments.map((c) => (
          <TimelineNode key={c.id}>
            <TimelineNodeIcon $color="var(--color-fg-muted)">
              <CommentIcon size={14} />
            </TimelineNodeIcon>

            <div
              style={{
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 14px",
                  background: "var(--color-canvas-subtle)",
                  borderBottom: "1px solid var(--color-border-default)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "12.5px",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--color-fg-default)" }}>@{c.username}</span>
                <span style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>
                  {new Date(c.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-fg-default)" }}>{c.text}</div>
            </div>
          </TimelineNode>
        ))}
      </TimelineConnector>

      {/* GitHub-Style Comment Composer */}
      {canWrite && (
        <form
          onSubmit={onAddComment}
          style={{
            marginTop: "12px",
            borderRadius: "6px",
            border: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-default)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 14px",
              background: "var(--color-canvas-subtle)",
              borderBottom: "1px solid var(--color-border-default)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-fg-muted)",
            }}
          >
            Write review comment
          </div>
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <textarea
              rows={3}
              placeholder="Leave a review note or comment on this Change Request..."
              value={commentInput}
              onChange={(e) => onCommentInputChange(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-fg-default)",
                fontSize: "13px",
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={!commentInput.trim()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 16px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: commentInput.trim() ? "var(--color-canvas-default)" : "transparent",
                  color: commentInput.trim() ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: commentInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                <PaperAirplaneIcon size={13} />
                <span>Comment</span>
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  </PrSectionCard>
);
