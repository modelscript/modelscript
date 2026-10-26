// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CheckCircleFillIcon, HistoryIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Avatar, Link as PrimerLink, Text } from "@primer/react";
import React from "react";
import type { GitlabCommit } from "../../../api";
import Box from "../../../components/Box";
import { getRelativeTime } from "../utils";

export interface CommitInfoBarProps {
  latestCommit: GitlabCommit | undefined;
  commitsCount: number;
  currentFile: string | null;
}

export const CommitInfoBar: React.FC<CommitInfoBarProps> = ({ latestCommit, commitsCount, currentFile }) => {
  return (
    <Box
      bg="var(--color-canvas-subtle)"
      p={3}
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      style={{ borderTopLeftRadius: "6px", borderTopRightRadius: "6px" }}
    >
      {latestCommit ? (
        <Box display="flex" alignItems="center" gap={2} style={{ overflow: "hidden" }}>
          <Avatar src={`https://github.com/identicons/${latestCommit.author_email}.png`} size={24} />
          <Text style={{ fontWeight: "bold", fontSize: "14px" }}>{latestCommit.author_name}</Text>
          <PrimerLink
            href="#"
            muted
            style={{
              textDecoration: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "400px",
            }}
          >
            {latestCommit.title}
          </PrimerLink>
          {(latestCommit as any).status && (
            <Box
              color={(latestCommit as any).status === "success" ? "var(--color-success-fg)" : "var(--color-danger-fg)"}
              ml={1}
              display="inline-flex"
              alignItems="center"
            >
              {(latestCommit as any).status === "success" ? (
                <CheckCircleFillIcon size={14} />
              ) : (
                <XCircleFillIcon size={14} />
              )}
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
          gap={3}
          color="var(--color-fg-muted)"
          fontSize={1}
          style={{ whiteSpace: "nowrap" }}
        >
          <PrimerLink href="#" muted sx={{ "&:hover": { color: "var(--color-accent-fg)", textDecoration: "none" } }}>
            <code
              style={{
                fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace",
                fontSize: "12px",
              }}
            >
              {latestCommit.short_id}
            </code>
          </PrimerLink>
          <span>·</span>
          <span>{getRelativeTime(latestCommit.created_at)}</span>
          {!currentFile && (
            <Box display="flex" alignItems="center" gap={1} ml={2}>
              <HistoryIcon />
              <span style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>{commitsCount}</span>{" "}
              <span sx={{ display: ["none", "none", "inline"] }}>Commits</span>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default CommitInfoBar;
