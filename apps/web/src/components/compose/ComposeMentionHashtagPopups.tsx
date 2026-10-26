// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { getAvatarUrl } from "../../util/avatar";
import Box from "../Box";

export interface ComposeMentionHashtagPopupsProps {
  mentionQuery: { query: string; index: number } | null;
  mentionSuggestions: any[];
  onSelectMention: (username: string) => void;
  hashtagQuery: { query: string; index: number } | null;
  hashtagSuggestions: any[];
  onSelectHashtag: (tag: string) => void;
}

export const ComposeMentionHashtagPopups: React.FC<ComposeMentionHashtagPopupsProps> = ({
  mentionQuery,
  mentionSuggestions,
  onSelectMention,
  hashtagQuery,
  hashtagSuggestions,
  onSelectHashtag,
}) => {
  return (
    <>
      {mentionQuery && mentionSuggestions.length > 0 && (
        <Box
          position="absolute"
          bg="var(--surface-overlay)"
          border="1px solid var(--color-border)"
          borderRadius="12px"
          boxShadow="0 8px 24px rgba(0,0,0,0.5)"
          style={{ backdropFilter: "blur(12px)" }}
          zIndex={100}
          top="100%"
          left={0}
          mt={2}
          maxHeight="300px"
          overflow="auto"
          width="300px"
        >
          {mentionSuggestions.map((u) => (
            <Box
              key={u.username}
              display="flex"
              alignItems="center"
              p={2}
              sx={{ cursor: "pointer", "&:hover": { bg: "rgba(255, 255, 255, 0.06)" } }}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectMention(u.username);
              }}
            >
              <img
                src={getAvatarUrl(u.username, u.avatar_url)}
                alt=""
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  marginRight: "12px",
                  objectFit: "cover",
                }}
              />
              <Box>
                <div style={{ fontWeight: "bold", fontSize: "14px", color: "var(--color-fg-default)" }}>
                  {u.display_name || u.username}
                </div>
                <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>@{u.username}</div>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {hashtagQuery && hashtagSuggestions.length > 0 && (
        <Box
          position="absolute"
          bg="var(--surface-overlay)"
          border="1px solid var(--color-border)"
          borderRadius="12px"
          boxShadow="0 8px 24px rgba(0,0,0,0.5)"
          style={{ backdropFilter: "blur(12px)" }}
          zIndex={100}
          top="100%"
          left={0}
          mt={2}
          maxHeight="300px"
          overflow="auto"
          width="280px"
        >
          <Box px={3} py={2} borderBottom="1px solid var(--color-border)">
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>TRENDING TOPICS</span>
          </Box>
          {hashtagSuggestions.map((t) => {
            const tag = t.displayName || t.concept;
            return (
              <Box
                key={t.concept}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                p={2}
                px={3}
                sx={{ cursor: "pointer", "&:hover": { bg: "rgba(255, 255, 255, 0.06)" } }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectHashtag(tag);
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: "bold" }}>#</span>
                  <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-fg-default)" }}>{tag}</span>
                </Box>
                {t.score !== undefined && (
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    {Math.round(t.score)} posts
                  </span>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </>
  );
};
