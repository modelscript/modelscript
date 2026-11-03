// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, CheckCircleIcon, CircleIcon, GlobeIcon, MentionIcon, PersonIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import Box from "../Box";
import { CommandPill } from "./styles";

export interface ComposeVisibilityMenuProps {
  replyVisibility: "everyone" | "following" | "mentioned";
  setReplyVisibility: (v: "everyone" | "following" | "mentioned") => void;
  showVisibilityMenu: boolean;
  setShowVisibilityMenu: (show: boolean) => void;
  visible?: boolean;
  isNotebookMode?: boolean | undefined;
  handleToggleNotebookMode?: (() => void) | undefined;
}

export const ComposeVisibilityMenu: React.FC<ComposeVisibilityMenuProps> = ({
  replyVisibility,
  setReplyVisibility,
  showVisibilityMenu,
  setShowVisibilityMenu,
  visible = true,
  isNotebookMode,
  handleToggleNotebookMode,
}) => {
  const isVisible = visible || showVisibilityMenu;
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuContainerRef, () => setShowVisibilityMenu(false), showVisibilityMenu);

  return (
    <Box
      ref={menuContainerRef}
      style={{
        position: "relative",
        width: "100%",
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
          maxHeight: isVisible ? "44px" : "0px",
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
            justifyContent="space-between"
            gap={2}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              transform: isVisible ? "translateY(0)" : "translateY(-4px)",
              transition: "transform 0.2s cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            <Box
              display="flex"
              alignItems="center"
              gap={2}
              style={{
                cursor: "pointer",
                width: "fit-content",
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

            {handleToggleNotebookMode && (
              <CommandPill
                type="button"
                onClick={() => {
                  setShowVisibilityMenu(false);
                  handleToggleNotebookMode();
                }}
                onMouseDown={(e) => e.preventDefault()}
                aria-pressed={Boolean(isNotebookMode)}
                data-testid="composer-article-mode-btn"
                title="Toggle long-form Article Mode with interspersed Markdown & interactive Artifacts"
              >
                <span className="pill-icon">
                  <BookIcon size={12} />
                </span>
                <span>Article mode</span>
              </CommandPill>
            )}
          </Box>
        </div>
      </div>
      {showVisibilityMenu && (
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
      )}
    </Box>
  );
};
