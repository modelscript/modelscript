// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Heading } from "@primer/react";
import React from "react";
import Box from "../Box";

export interface ReplyToPostLike {
  username?: string | null | undefined;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  author_username?: string | null | undefined;
  author_display_name?: string | null | undefined;
  author?:
    | {
        username?: string | null | undefined;
        display_name?: string | null | undefined;
        displayName?: string | null | undefined;
        avatar_url?: string | null | undefined;
      }
    | null
    | undefined;
  user?:
    | {
        username?: string | null | undefined;
        avatar_url?: string | null | undefined;
      }
    | null
    | undefined;
}

export interface ComposeRecipientsModalProps {
  replyToPost: ReplyToPostLike | null | undefined;
  allMentionedUsers: string[];
  excludedUsers: Set<string>;
  setExcludedUsers: (users: Set<string>) => void;
  onClose: () => void;
}

export const ComposeRecipientsModal: React.FC<ComposeRecipientsModalProps> = ({
  replyToPost,
  allMentionedUsers,
  excludedUsers,
  setExcludedUsers,
  onClose,
}) => {
  const rawAuthor =
    replyToPost?.author?.username ||
    replyToPost?.username ||
    replyToPost?.author_username ||
    replyToPost?.user?.username ||
    "";
  const authorUsername = rawAuthor ? String(rawAuthor).replace(/^@+/, "").trim() : "";
  const avatarUrl = replyToPost?.avatar_url || replyToPost?.author?.avatar_url || replyToPost?.user?.avatar_url;
  const displayName =
    replyToPost?.display_name ||
    replyToPost?.author?.display_name ||
    replyToPost?.author?.displayName ||
    replyToPost?.author_display_name ||
    authorUsername;

  const others = allMentionedUsers.filter((u) => u !== authorUsername);

  const safeAvatarSrc = (() => {
    if (typeof avatarUrl !== "string") return undefined;
    const trimmed = avatarUrl.trim();
    const dataMatch = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,([a-zA-Z0-9+/=]+)$/i.exec(trimmed);
    if (dataMatch) {
      return `data:image/${dataMatch[1]!.toLowerCase()};base64,${dataMatch[2]!}`;
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          return parsed.href;
        }
      } catch {
        return undefined;
      }
    }
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      try {
        const origin = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
        const parsed = new URL(trimmed, origin);
        if (parsed.origin === origin) {
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  })();
  const avatarInitials =
    (authorUsername || displayName || "?")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <Dialog title="Replying to" width="medium" onClose={onClose}>
      <Box display="flex" flexDirection="column" maxHeight="70vh" overflowY="auto">
        <Box display="flex" alignItems="center" mb={3}>
          {safeAvatarSrc ? (
            <img
              src={safeAvatarSrc}
              alt="avatar"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                flexShrink: 0,
                objectFit: "cover",
                backgroundColor: "var(--ms-surface-subtle, rgba(255, 255, 255, 0.05))",
                marginRight: "12px",
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: "14px",
                backgroundColor: "var(--ms-surface-subtle, rgba(255, 255, 255, 0.08))",
                marginRight: "12px",
              }}
            >
              {avatarInitials}
            </div>
          )}
          <Box flex={1}>
            <div style={{ fontWeight: "bold" }}>{displayName || authorUsername}</div>
            {authorUsername && (
              <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>@{authorUsername}</div>
            )}
          </Box>
          <Box>
            <input type="checkbox" checked disabled style={{ width: "20px", height: "20px" }} />
          </Box>
        </Box>

        {others.length > 0 && (
          <>
            <Box borderBottom="1px solid var(--ms-border-subtle, var(--color-border))" my={3} />
            <Heading as="h3" style={{ fontSize: "16px", marginBottom: "12px" }}>
              Others in this conversation
            </Heading>
            {others.map((u) => (
              <Box
                key={u}
                display="flex"
                alignItems="center"
                mb={3}
                onClick={() => {
                  const newSet = new Set(excludedUsers);
                  if (newSet.has(u)) newSet.delete(u);
                  else newSet.add(u);
                  setExcludedUsers(newSet);
                }}
                style={{ cursor: "pointer" }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    backgroundColor: "var(--ms-surface-subtle, rgba(255, 255, 255, 0.05))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                    marginRight: "12px",
                  }}
                >
                  {u.charAt(0).toUpperCase()}
                </div>
                <Box flex={1}>
                  <div style={{ fontWeight: "bold" }}>{u}</div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>@{u}</div>
                </Box>
                <Box>
                  <input
                    type="checkbox"
                    checked={!excludedUsers.has(u)}
                    readOnly
                    style={{ width: "20px", height: "20px" }}
                  />
                </Box>
              </Box>
            ))}
          </>
        )}
      </Box>

      <Box
        display="flex"
        justifyContent="flex-end"
        pt={3}
        mt={2}
        borderTop="1px solid var(--ms-border-subtle, var(--color-border))"
      >
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </Box>
    </Dialog>
  );
};
