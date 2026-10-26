// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, CircleIcon, GlobeIcon, MentionIcon, PersonIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

export interface ComposeVisibilityMenuProps {
  replyVisibility: "everyone" | "following" | "mentioned";
  setReplyVisibility: (v: "everyone" | "following" | "mentioned") => void;
  showVisibilityMenu: boolean;
  setShowVisibilityMenu: (show: boolean) => void;
}

export const ComposeVisibilityMenu: React.FC<ComposeVisibilityMenuProps> = ({
  replyVisibility,
  setReplyVisibility,
  showVisibilityMenu,
  setShowVisibilityMenu,
}) => {
  return (
    <Box style={{ position: "relative", width: "fit-content" }}>
      <Box
        mt={2}
        mb={2}
        display="flex"
        alignItems="center"
        gap={2}
        style={{ cursor: "pointer", width: "fit-content" }}
        onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
      >
        {replyVisibility === "everyone" && <GlobeIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />}
        {replyVisibility === "following" && <PersonIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />}
        {replyVisibility === "mentioned" && <MentionIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />}
        <span style={{ color: "var(--color-accent-cyan)", fontWeight: "bold", fontSize: "14px" }}>
          {replyVisibility === "everyone" && "Everyone can reply"}
          {replyVisibility === "following" && "Accounts you follow can reply"}
          {replyVisibility === "mentioned" && "Only accounts you mention can reply"}
        </span>
      </Box>
      {showVisibilityMenu && (
        <>
          <div
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
            onClick={(e) => {
              e.stopPropagation();
              setShowVisibilityMenu(false);
            }}
          />
          <Box
            position="absolute"
            top="100%"
            left={0}
            bg="var(--surface-overlay)"
            border="1px solid var(--color-border)"
            borderRadius="16px"
            boxShadow="0 8px 24px rgba(0,0,0,0.5)"
            style={{ backdropFilter: "blur(12px)" }}
            zIndex={100}
            width="280px"
            py={2}
          >
            <Box px={3} pb={2} borderBottom="1px solid var(--color-border)" mb={2}>
              <Text style={{ fontWeight: "bold", fontSize: "15px" }}>Who can reply?</Text>
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
              sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
              onClick={() => {
                setReplyVisibility("everyone");
                setShowVisibilityMenu(false);
              }}
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                width="36px"
                height="36px"
                borderRadius="50%"
                bg="var(--color-accent-cyan)"
                color="#06080f"
              >
                <GlobeIcon size={20} />
              </Box>
              <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                Everyone
              </Text>
              {replyVisibility === "everyone" ? (
                <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
              ) : (
                <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
              )}
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
              sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
              onClick={() => {
                setReplyVisibility("following");
                setShowVisibilityMenu(false);
              }}
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                width="36px"
                height="36px"
                borderRadius="50%"
                bg="var(--color-accent-cyan)"
                color="#06080f"
              >
                <PersonIcon size={20} />
              </Box>
              <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                Accounts you follow
              </Text>
              {replyVisibility === "following" ? (
                <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
              ) : (
                <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
              )}
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
              sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
              onClick={() => {
                setReplyVisibility("mentioned");
                setShowVisibilityMenu(false);
              }}
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                width="36px"
                height="36px"
                borderRadius="50%"
                bg="var(--color-accent-cyan)"
                color="#06080f"
              >
                <MentionIcon size={20} />
              </Box>
              <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                Only accounts you mention
              </Text>
              {replyVisibility === "mentioned" ? (
                <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
              ) : (
                <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};
