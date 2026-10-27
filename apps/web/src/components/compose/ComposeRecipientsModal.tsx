// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import { Heading, IconButton } from "@primer/react";
import React from "react";
import { getAvatarUrl } from "../../util/avatar";
import Box from "../Box";
import { TweetButton } from "./styles";

export interface ComposeRecipientsModalProps {
  replyToPost: any;
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
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99998,
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />
      <Box
        position="fixed"
        top="50%"
        left="50%"
        style={{
          transform: "translate(-50%, -50%)",
          width: "600px",
          maxWidth: "92vw",
          maxHeight: "90vh",
          overflowY: "auto",
          backdropFilter: "blur(16px)",
        }}
        bg="var(--surface-overlay)"
        border="1px solid var(--color-border-glass)"
        borderRadius="16px"
        zIndex={99999}
        boxShadow="0 20px 50px rgba(0,0,0,0.6)"
        display="flex"
        flexDirection="column"
      >
        <Box display="flex" alignItems="center" px={3} py={2} borderBottom="1px solid var(--color-border)">
          <IconButton
            icon={() => <XIcon size={20} />}
            variant="invisible"
            onClick={onClose}
            style={{ color: "var(--color-fg-default)" }}
            aria-label="Close"
          />
          <Box flex={1} ml={4}>
            <h2 style={{ fontSize: "18px", margin: 0, fontWeight: "bold" }}>Replying to</h2>
          </Box>
          <TweetButton onClick={onClose} style={{ padding: "6px 16px" }}>
            Done
          </TweetButton>
        </Box>
        <Box p={3}>
          <Box display="flex" alignItems="center" mb={3}>
            <img
              src={getAvatarUrl(replyToPost.username, replyToPost.avatar_url)}
              alt="avatar"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                flexShrink: 0,
                objectFit: "cover",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                marginRight: "12px",
              }}
            />
            <Box flex={1}>
              <div style={{ fontWeight: "bold" }}>{replyToPost.username}</div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>@{replyToPost.username}</div>
            </Box>
            <Box>
              <input type="checkbox" checked disabled style={{ width: "20px", height: "20px" }} />
            </Box>
          </Box>

          {allMentionedUsers.length > 1 && (
            <>
              <Box borderBottom="1px solid var(--color-border)" my={3} />
              <Heading as="h3" style={{ fontSize: "18px", marginBottom: "16px" }}>
                Others in this conversation
              </Heading>
              {allMentionedUsers
                .filter((u) => u !== replyToPost.username)
                .map((u) => (
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
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
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
      </Box>
    </>
  );
};
