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
  visible?: boolean;
}

export const ComposeVisibilityMenu: React.FC<ComposeVisibilityMenuProps> = ({
  replyVisibility,
  setReplyVisibility,
  showVisibilityMenu,
  setShowVisibilityMenu,
  visible = true,
}) => {
  const isVisible = visible || showVisibilityMenu;

  return (
    <Box
      style={{
        position: "relative",
        width: "fit-content",
        pointerEvents: isVisible ? "auto" : "none",
      }}
      aria-hidden={!isVisible}
      onMouseDown={(e) => {
        // Prevent blurring the compose textarea when interacting with visibility controls
        e.preventDefault();
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateRows: isVisible ? "1fr" : "0fr",
          maxHeight: isVisible ? "40px" : "0px",
          opacity: isVisible ? 1 : 0,
          overflow: "hidden",
          transition:
            "grid-template-rows 0.2s cubic-bezier(0.2, 0, 0, 1), max-height 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.18s ease",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <Box
            mt={2}
            mb={2}
            display="flex"
            alignItems="center"
            gap={2}
            style={{
              cursor: "pointer",
              width: "fit-content",
              transform: isVisible ? "translateY(0)" : "translateY(-4px)",
              transition: "transform 0.2s cubic-bezier(0.2, 0, 0, 1)",
            }}
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
          >
            {replyVisibility === "everyone" && (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <GlobeIcon size={16} />
              </span>
            )}
            {replyVisibility === "following" && (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <PersonIcon size={16} />
              </span>
            )}
            {replyVisibility === "mentioned" && (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <MentionIcon size={16} />
              </span>
            )}
            <span style={{ color: "var(--color-accent-cyan)", fontWeight: "bold", fontSize: "14px" }}>
              {replyVisibility === "everyone" && "Everyone can reply"}
              {replyVisibility === "following" && "Accounts you follow can reply"}
              {replyVisibility === "mentioned" && "Only accounts you mention can reply"}
            </span>
          </Box>
        </div>
      </div>
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
            <Box px={3} style={{ paddingBottom: "8px" }} borderBottom="1px solid var(--color-border)" mb={2}>
              <Text style={{ fontWeight: "bold", fontSize: "15px" }}>Who can reply?</Text>
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
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
              <Text style={{ flex: 1, fontWeight: "bold", fontSize: "15px" }}>Everyone</Text>
              {replyVisibility === "everyone" ? (
                <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                  <CheckCircleIcon size={20} />
                </span>
              ) : (
                <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                  <CircleIcon size={20} />
                </span>
              )}
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
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
              <Text style={{ flex: 1, fontWeight: "bold", fontSize: "15px" }}>Accounts you follow</Text>
              {replyVisibility === "following" ? (
                <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                  <CheckCircleIcon size={20} />
                </span>
              ) : (
                <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                  <CircleIcon size={20} />
                </span>
              )}
            </Box>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              px={3}
              py={2}
              style={{ cursor: "pointer" }}
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
              <Text style={{ flex: 1, fontWeight: "bold", fontSize: "15px" }}>Only accounts you mention</Text>
              {replyVisibility === "mentioned" ? (
                <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                  <CheckCircleIcon size={20} />
                </span>
              ) : (
                <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                  <CircleIcon size={20} />
                </span>
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};
