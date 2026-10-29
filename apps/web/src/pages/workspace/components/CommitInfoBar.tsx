// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  GitCommitIcon,
  HistoryIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Avatar, Text } from "@primer/react";
import React, { useState } from "react";
import type { GitlabCommit } from "../../../api";
import Box from "../../../components/Box";
import { getAvatarUrl } from "../../../util/avatar";
import { getRelativeTime } from "../utils";

export interface CommitInfoBarProps {
  latestCommit: GitlabCommit | undefined;
  commits?: GitlabCommit[] | undefined;
  commitsCount: number;
  currentFile: string | null;
}

export const CommitInfoBar: React.FC<CommitInfoBarProps> = ({
  latestCommit,
  commits = [],
  commitsCount,
  currentFile,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  const handleCopySha = (sha: string) => {
    navigator.clipboard?.writeText(sha).catch(() => {});
    setCopiedSha(sha);
    setTimeout(() => {
      setCopiedSha((prev) => (prev === sha ? null : prev));
    }, 1500);
  };

  const commitList = commits.length > 0 ? commits : latestCommit ? [latestCommit] : [];

  return (
    <Box>
      <Box
        bg="var(--color-canvas-subtle)"
        p={3}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
        style={{
          borderTopLeftRadius: "6px",
          borderTopRightRadius: "6px",
          borderBottom: showHistory ? "1px solid var(--color-border-default)" : undefined,
        }}
      >
        {latestCommit ? (
          <Box display="flex" alignItems="center" gap={2} style={{ overflow: "hidden", minWidth: 0, flex: 1 }}>
            <Avatar src={getAvatarUrl(undefined, latestCommit.author_name || "user")} size={24} />
            <Text style={{ fontWeight: "bold", fontSize: "14px", flexShrink: 0 }}>{latestCommit.author_name}</Text>
            <span
              style={{
                color: "var(--color-fg-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "460px",
                fontSize: "14px",
              }}
              title={latestCommit.message || latestCommit.title}
            >
              {latestCommit.title}
            </span>
            {latestCommit.status && (
              <Box
                color={latestCommit.status === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)"}
                ml={1}
                display="inline-flex"
                alignItems="center"
                title={`CI status: ${latestCommit.status}`}
              >
                {latestCommit.status === "success" ? <CheckCircleFillIcon size={14} /> : <XCircleFillIcon size={14} />}
              </Box>
            )}
          </Box>
        ) : (
          <Text>No commits found</Text>
        )}

        {latestCommit && (
          <Box
            display="flex"
            alignItems="center"
            gap={2}
            color="var(--color-fg-muted)"
            fontSize={1}
            style={{ whiteSpace: "nowrap" }}
          >
            <button
              type="button"
              onClick={() => handleCopySha(latestCommit.id || latestCommit.short_id)}
              title="Copy commit SHA"
              style={{
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                borderRadius: "6px",
                padding: "2px 7px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color:
                  copiedSha === (latestCommit.id || latestCommit.short_id)
                    ? "var(--color-success-fg)"
                    : "var(--color-fg-muted)",
              }}
            >
              <code
                style={{
                  fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace",
                  fontSize: "12px",
                }}
              >
                {latestCommit.short_id}
              </code>
              {copiedSha === (latestCommit.id || latestCommit.short_id) ? (
                <CheckIcon size={12} />
              ) : (
                <CopyIcon size={12} />
              )}
            </button>

            <span>·</span>
            <span>{getRelativeTime(latestCommit.created_at)}</span>

            {!currentFile && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                title={showHistory ? "Hide commit history" : "Show recent commits"}
                style={{
                  border: "none",
                  background: showHistory ? "rgba(15, 118, 110, 0.12)" : "transparent",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  marginLeft: "4px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  color: "var(--color-fg-default)",
                  fontSize: "13px",
                }}
              >
                <HistoryIcon size={14} />
                <span style={{ fontWeight: "bold" }}>{commitsCount}</span>
                <span>{commitsCount === 1 ? "Commit" : "Commits"}</span>
                {showHistory ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
              </button>
            )}
          </Box>
        )}
      </Box>

      {showHistory && commitList.length > 0 && (
        <Box
          bg="var(--color-canvas-default)"
          style={{
            borderBottom: "1px solid var(--color-border-default)",
            maxHeight: "280px",
            overflowY: "auto",
          }}
        >
          {commitList.map((c, idx) => (
            <Box
              key={c.id || idx}
              px={3}
              py={2}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
              style={{
                borderTop: idx > 0 ? "1px solid var(--color-border-muted)" : undefined,
                fontSize: "13px",
              }}
            >
              <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
                <GitCommitIcon size={14} fill="var(--color-fg-muted)" />
                <Avatar src={getAvatarUrl(undefined, c.author_name || "user")} size={20} />
                <Text style={{ fontWeight: 600, color: "var(--color-fg-default)", flexShrink: 0 }}>
                  {c.author_name}
                </Text>
                <span
                  style={{
                    color: "var(--color-fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                </span>
              </Box>
              <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
                <Text style={{ color: "var(--color-fg-muted)", fontSize: "12px" }}>
                  {getRelativeTime(c.created_at)}
                </Text>
                <button
                  type="button"
                  onClick={() => handleCopySha(c.id || c.short_id)}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    borderRadius: "6px",
                    padding: "2px 6px",
                    cursor: "pointer",
                    fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace",
                    fontSize: "11.5px",
                    color: "var(--color-fg-default)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                  title="Copy commit SHA"
                >
                  {c.short_id}
                  {copiedSha === (c.id || c.short_id) ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                </button>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default CommitInfoBar;
