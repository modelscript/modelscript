// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DiffIcon,
  HistoryIcon,
  KeyIcon,
  ShieldCheckIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { getPostRevisions } from "../../api/social";
import Box from "../Box";
import { computeSimpleLineDiff } from "./diff";

export interface PostRevisionHistoryModalProps {
  postId: string | number;
  displayPost: {
    id?: number | string;
    username: string;
    display_name?: string | null;
    content?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    content_warning?: string | null;
    artifact_view_id?: string | number | null;
    [key: string]: any;
  };
  onClose: () => void;
}

export { computeSimpleLineDiff, type DiffLine } from "./diff";

export const PostRevisionHistoryModal: React.FC<PostRevisionHistoryModalProps> = ({ postId, displayPost, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRevIndex, setSelectedRevIndex] = useState(0);
  const [showDiff, setShowDiff] = useState(true);
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    let active = true;
    async function fetchRevisions() {
      setLoading(true);
      setError(null);
      try {
        const revs = await getPostRevisions(postId);
        if (!active) return;
        if (Array.isArray(revs) && revs.length > 0) {
          // Sort descending by rev (newest first)
          const sorted = [...revs].sort((a, b) => Number(b.rev || 0) - Number(a.rev || 0));
          setRevisions(sorted);
        } else {
          // Synthesize current post revision if no prior evidence records exist
          setRevisions([
            {
              rev: 1,
              post_id: postId,
              content: displayPost.content,
              content_warning: displayPost.content_warning,
              artifact_view_id: displayPost.artifact_view_id,
              created_at: displayPost.updated_at || displayPost.created_at,
              isCurrentPublished: true,
            },
          ]);
        }
      } catch (err: unknown) {
        if (!active) return;
        console.error("Failed to load revisions:", err);
        setError("Failed to load revision history.");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchRevisions();
    return () => {
      active = false;
    };
  }, [
    postId,
    displayPost.content,
    displayPost.content_warning,
    displayPost.artifact_view_id,
    displayPost.created_at,
    displayPost.updated_at,
  ]);

  const currentRev = revisions[selectedRevIndex] || revisions[0] || null;
  const previousRev = selectedRevIndex < revisions.length - 1 ? revisions[selectedRevIndex + 1] : null;

  const diffLines = useMemo(() => {
    if (!currentRev || !previousRev) return [];
    return computeSimpleLineDiff(previousRev.content || "", currentRev.content || "");
  }, [currentRev, previousRev]);

  const handleCopy = () => {
    if (!currentRev?.content) return;
    navigator.clipboard.writeText(currentRev.content);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      aria-label="Post Revision History"
      sx={{
        width: ["95vw", "85vw", "760px"],
        maxWidth: "760px",
        maxHeight: "88vh",
        backgroundColor: "var(--color-canvas-default, #0d1117)",
        color: "var(--color-fg-default, #c9d1d9)",
        borderRadius: "12px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        p: 0,
      }}
    >
      {/* Header */}
      <Box
        p={3}
        borderBottom="1px solid var(--color-border-default, #30363d)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{
          background: "var(--ms-brand-soft, var(--color-canvas-subtle, #161b22))",
        }}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <HistoryIcon size={18} fill="var(--ms-brand, #0e7490)" />
          <Text style={{ fontWeight: 700, fontSize: "16px" }}>Post Revision History</Text>
          <span
            style={{
              fontSize: "11px",
              padding: "1px 6px",
              borderRadius: "10px",
              background: "rgba(14, 116, 144, 0.15)",
              color: "var(--ms-brand, #0e7490)",
              fontWeight: 600,
            }}
          >
            Post #{postId}
          </span>
        </Box>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
            padding: "4px",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <XIcon size={16} />
        </button>
      </Box>

      {/* Main Body */}
      <Box
        display="flex"
        flexDirection={["column", "row"]}
        style={{ minHeight: "360px", maxHeight: "calc(88vh - 120px)", overflow: "hidden" }}
      >
        {/* Revision Sidebar / List */}
        <Box
          width={["100%", "240px"]}
          borderRight={["none", "1px solid var(--color-border-default, #30363d)"]}
          borderBottom={["1px solid var(--color-border-default, #30363d)", "none"]}
          p={2}
          style={{
            backgroundColor: "var(--color-canvas-subtle, #161b22)",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Text
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--color-fg-muted)",
              padding: "4px 8px",
              display: "block",
            }}
          >
            Revisions ({revisions.length})
          </Text>

          {loading && (
            <Box p={3} textAlign="center">
              <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>Loading history…</Text>
            </Box>
          )}

          {error && (
            <Box p={2}>
              <Text style={{ fontSize: "12px", color: "var(--color-danger-fg, #f85149)" }}>{error}</Text>
            </Box>
          )}

          {!loading &&
            revisions.map((rev, index) => {
              const isSelected = index === selectedRevIndex;
              const isLatest = index === 0;
              const timestamp = rev.created_at ? new Date(rev.created_at).toLocaleString() : "Unknown date";
              return (
                <button
                  key={rev.rev ?? index}
                  type="button"
                  onClick={() => setSelectedRevIndex(index)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: isSelected ? "1px solid var(--ms-brand, #0e7490)" : "1px solid transparent",
                    background: isSelected ? "rgba(14, 116, 144, 0.15)" : "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    marginBottom: "4px",
                    transition: "all 0.12s ease",
                  }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Text
                      style={{
                        fontWeight: isSelected ? 700 : 600,
                        fontSize: "12.5px",
                        color: isSelected ? "var(--ms-brand, #0e7490)" : "inherit",
                      }}
                    >
                      Revision {rev.rev ?? revisions.length - index}
                    </Text>
                    {isLatest && (
                      <span
                        style={{
                          fontSize: "9.5px",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          background: "rgba(16, 185, 129, 0.2)",
                          color: "#10b981",
                          fontWeight: 700,
                        }}
                      >
                        Current
                      </span>
                    )}
                  </Box>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={1}
                    style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}
                  >
                    <ClockIcon size={11} />
                    <span>{timestamp}</span>
                  </Box>
                  {rev.key_id && (
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={1}
                      mt={1}
                      style={{ fontSize: "10px", color: "var(--color-fg-subtle)" }}
                    >
                      <KeyIcon size={10} />
                      <span style={{ fontFamily: "monospace" }}>{String(rev.key_id).slice(0, 14)}…</span>
                    </Box>
                  )}
                </button>
              );
            })}
        </Box>

        {/* Revision Details & Diff Panel */}
        <Box flex={1} p={3} style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          {currentRev ? (
            <>
              {/* Revision Header Details */}
              <Box
                p={2.5}
                borderRadius="8px"
                style={{
                  backgroundColor: "var(--color-canvas-subtle, #161b22)",
                  border: "1px solid var(--color-border-default, #30363d)",
                }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Text style={{ fontWeight: 700, fontSize: "14px" }}>
                      Revision {currentRev.rev ?? revisions.length - selectedRevIndex}
                    </Text>
                    {currentRev.key_id ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "6px",
                          background: "rgba(16, 185, 129, 0.15)",
                          color: "#10b981",
                          fontWeight: 600,
                        }}
                      >
                        <ShieldCheckIcon size={12} />
                        Signed Evidence Verified
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "6px",
                          background: "rgba(148, 163, 184, 0.15)",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        Snapshot
                      </span>
                    )}
                  </Box>

                  <Box display="flex" alignItems="center" gap={2}>
                    {previousRev && (
                      <Button size="small" leadingVisual={DiffIcon} onClick={() => setShowDiff((d) => !d)}>
                        {showDiff ? "View Plain Text" : "View Diff vs Previous"}
                      </Button>
                    )}
                    <Button size="small" leadingVisual={copiedText ? CheckIcon : CopyIcon} onClick={handleCopy}>
                      {copiedText ? "Copied" : "Copy Content"}
                    </Button>
                  </Box>
                </Box>

                <Box
                  display="flex"
                  gap={3}
                  mt={2}
                  flexWrap="wrap"
                  style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}
                >
                  <span>
                    <strong>Author:</strong> @{displayPost.username}
                  </span>
                  {currentRev.created_at && (
                    <span>
                      <strong>Timestamp:</strong> {new Date(currentRev.created_at).toLocaleString()}
                    </span>
                  )}
                  {currentRev.artifact_view_id && (
                    <span>
                      <strong>Attached Morsel:</strong> #{currentRev.artifact_view_id}
                    </span>
                  )}
                </Box>

                {currentRev.content_warning && (
                  <Box
                    mt={2}
                    p={1.5}
                    borderRadius="6px"
                    style={{
                      background: "rgba(245, 158, 11, 0.12)",
                      border: "1px solid rgba(245, 158, 11, 0.3)",
                      fontSize: "12px",
                      color: "#f59e0b",
                    }}
                  >
                    ⚠️ <strong>Content Warning:</strong> {currentRev.content_warning}
                  </Box>
                )}
              </Box>

              {/* Content / Diff View */}
              <Box flex={1}>
                {showDiff && previousRev ? (
                  <Box
                    as="div"
                    style={{
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-default, #30363d)",
                      backgroundColor: "var(--color-canvas-default, #0d1117)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "12px",
                      lineHeight: "20px",
                      overflowX: "auto",
                      padding: "8px 0",
                    }}
                  >
                    <Box px={3} pb={1} borderBottom="1px solid var(--color-border-default, #30363d)" mb={1}>
                      <Text style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                        Comparing Revision {currentRev.rev} against Revision {previousRev.rev}
                      </Text>
                    </Box>
                    {diffLines.map((line, idx) => {
                      const bg =
                        line.type === "added"
                          ? "rgba(46, 160, 67, 0.18)"
                          : line.type === "removed"
                            ? "rgba(248, 81, 73, 0.18)"
                            : "transparent";
                      const color =
                        line.type === "added"
                          ? "#3fb950"
                          : line.type === "removed"
                            ? "#f85149"
                            : "var(--color-fg-default)";
                      const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
                      return (
                        <div
                          key={idx}
                          style={{
                            backgroundColor: bg,
                            color,
                            padding: "1px 12px",
                            display: "flex",
                            gap: "8px",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          <span style={{ userSelect: "none", opacity: 0.6, width: "12px" }}>{prefix}</span>
                          <span>{line.text || " "}</span>
                        </div>
                      );
                    })}
                  </Box>
                ) : (
                  <Box
                    as="pre"
                    p={3}
                    style={{
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-default, #30363d)",
                      backgroundColor: "var(--color-canvas-default, #0d1117)",
                      color: "var(--color-fg-default, #c9d1d9)",
                      fontSize: "13px",
                      lineHeight: "1.6",
                      fontFamily: "inherit",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: 0,
                    }}
                  >
                    {currentRev.content || "(Empty post content)"}
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <Box p={4} textAlign="center">
              <Text style={{ color: "var(--color-fg-muted)" }}>No revision selected.</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box
        p={2.5}
        borderTop="1px solid var(--color-border-default, #30363d)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        style={{
          background: "var(--color-canvas-subtle, #161b22)",
        }}
      >
        <Text style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
          Signed post evidence is immutable and verifiable via <code>msx verify</code>.
        </Text>
        <Button onClick={onClose}>Close</Button>
      </Box>
    </Dialog>
  );
};
