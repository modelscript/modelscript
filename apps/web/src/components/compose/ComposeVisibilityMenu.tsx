// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  EyeClosedIcon,
  GlobeIcon,
  MailIcon,
  MentionIcon,
  PeopleIcon,
  PersonIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import Box from "../Box";
import { CommandPill } from "./styles";

export interface ComposeVisibilityMenuProps {
  replyVisibility: "everyone" | "following" | "mentioned";
  setReplyVisibility: (v: "everyone" | "following" | "mentioned") => void;
  postVisibility?: "public" | "unlisted" | "followers" | "direct" | undefined;
  setPostVisibility?: ((v: "public" | "unlisted" | "followers" | "direct") => void) | undefined;
  showVisibilityMenu: boolean;
  setShowVisibilityMenu: (show: boolean) => void;
  visible?: boolean;
  isNotebookMode?: boolean | undefined;
  handleToggleNotebookMode?: (() => void) | undefined;
  onOpenDrafts?: (() => void) | undefined;
}

export const ComposeVisibilityMenu: React.FC<ComposeVisibilityMenuProps> = ({
  replyVisibility,
  setReplyVisibility,
  postVisibility = "public",
  setPostVisibility,
  showVisibilityMenu,
  setShowVisibilityMenu,
  visible = true,
  isNotebookMode,
  handleToggleNotebookMode,
  onOpenDrafts,
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
              gap={1}
              role="button"
              tabIndex={isVisible ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={showVisibilityMenu}
              style={{
                cursor: "pointer",
                width: "fit-content",
                padding: "4px 10px 4px 8px",
                marginLeft: "-8px",
                borderRadius: "999px",
                backgroundColor: showVisibilityMenu ? "var(--ms-brand-soft)" : "transparent",
                transition: "background-color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!showVisibilityMenu) {
                  e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)";
                }
              }}
              onMouseLeave={(e) => {
                if (!showVisibilityMenu) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
              onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setShowVisibilityMenu(!showVisibilityMenu);
                }
              }}
            >
              {postVisibility === "unlisted" ? (
                <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                  <EyeClosedIcon size={15} />
                </span>
              ) : postVisibility === "followers" ? (
                <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                  <PeopleIcon size={15} />
                </span>
              ) : postVisibility === "direct" ? (
                <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                  <MailIcon size={15} />
                </span>
              ) : (
                <>
                  {replyVisibility === "everyone" && (
                    <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                      <GlobeIcon size={15} />
                    </span>
                  )}
                  {replyVisibility === "following" && (
                    <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                      <PersonIcon size={15} />
                    </span>
                  )}
                  {replyVisibility === "mentioned" && (
                    <span style={{ color: "var(--ms-brand, var(--color-accent-cyan))", display: "inline-flex" }}>
                      <MentionIcon size={15} />
                    </span>
                  )}
                </>
              )}
              <span
                style={{
                  color: "var(--ms-brand, var(--color-accent-cyan))",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  marginLeft: "2px",
                }}
              >
                {postVisibility === "unlisted" && "Unlisted · "}
                {postVisibility === "followers" && "Followers · "}
                {postVisibility === "direct" && "Direct · "}
                {replyVisibility === "everyone" && "Everyone can reply"}
                {replyVisibility === "following" && "Accounts you follow can reply"}
                {replyVisibility === "mentioned" && "Only accounts you mention can reply"}
              </span>
              <span
                style={{
                  color: "var(--ms-brand, var(--color-accent-cyan))",
                  display: "inline-flex",
                  opacity: 0.75,
                }}
              >
                <ChevronDownIcon size={13} />
              </span>
            </Box>

            <Box display="flex" alignItems="center" gap={1}>
              {onOpenDrafts && (
                <CommandPill
                  type="button"
                  onClick={() => {
                    setShowVisibilityMenu(false);
                    onOpenDrafts();
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  data-testid="composer-drafts-btn"
                  title="Open saved post drafts"
                >
                  <span>Drafts</span>
                </CommandPill>
              )}

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
          style={{ backdropFilter: "blur(12px)", maxHeight: "420px", overflowY: "auto" }}
          zIndex={100}
          width="300px"
          py={2}
        >
          {setPostVisibility && (
            <>
              <Box px={3} style={{ paddingBottom: "6px" }} borderBottom="1px solid var(--color-border)" mb={1}>
                <Text style={{ fontWeight: "bold", fontSize: "13.5px", color: "var(--ms-text-1)" }}>
                  Post visibility
                </Text>
              </Box>
              {(
                [
                  {
                    id: "public" as const,
                    label: "Public",
                    desc: "Visible to anyone on federated feeds",
                    icon: GlobeIcon,
                  },
                  {
                    id: "unlisted" as const,
                    label: "Unlisted",
                    desc: "Visible to all, but omitted from discovery feeds",
                    icon: EyeClosedIcon,
                  },
                  {
                    id: "followers" as const,
                    label: "Followers only",
                    desc: "Only visible to your followers",
                    icon: PeopleIcon,
                  },
                  {
                    id: "direct" as const,
                    label: "Direct message",
                    desc: "Visible only to mentioned accounts",
                    icon: MailIcon,
                  },
                ] as const
              ).map((pv) => {
                const PvIcon = pv.icon;
                const isSelected = postVisibility === pv.id;
                return (
                  <Box
                    key={pv.id}
                    display="flex"
                    alignItems="center"
                    gap={2.5}
                    px={3}
                    py={1.5}
                    style={{
                      cursor: "pointer",
                      borderRadius: "8px",
                      margin: "1px 4px",
                      transition: "background-color 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    onClick={() => {
                      setPostVisibility(pv.id);
                      if (pv.id === "followers" && replyVisibility === "everyone") {
                        setReplyVisibility("following");
                      } else if (pv.id === "direct") {
                        setReplyVisibility("mentioned");
                      }
                      setShowVisibilityMenu(false);
                    }}
                  >
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      width="28px"
                      height="28px"
                      borderRadius="50%"
                      bg={isSelected ? "var(--color-accent-cyan)" : "var(--ms-surface-hover)"}
                      color={isSelected ? "#06080f" : "var(--ms-text-2)"}
                      flexShrink={0}
                    >
                      <PvIcon size={14} />
                    </Box>
                    <Box flex={1} display="flex" flexDirection="column">
                      <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--ms-text-1)" }}>{pv.label}</span>
                      <span style={{ fontSize: "11px", color: "var(--ms-text-3)", lineHeight: "1.25" }}>{pv.desc}</span>
                    </Box>
                    {isSelected && (
                      <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                        <CheckCircleIcon size={16} />
                      </span>
                    )}
                  </Box>
                );
              })}
              <Box my={1.5} borderBottom="1px solid var(--color-border)" />
            </>
          )}

          <Box px={3} style={{ paddingBottom: "6px" }} borderBottom="1px solid var(--color-border)" mb={1}>
            <Text style={{ fontWeight: "bold", fontSize: "13.5px", color: "var(--ms-text-1)" }}>Who can reply?</Text>
          </Box>
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            px={3}
            py={2}
            style={{ cursor: "pointer", borderRadius: "8px", margin: "1px 4px" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            onClick={() => {
              setReplyVisibility("everyone");
              setShowVisibilityMenu(false);
            }}
          >
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="32px"
              height="32px"
              borderRadius="50%"
              bg="var(--color-accent-cyan)"
              color="#06080f"
            >
              <GlobeIcon size={18} />
            </Box>
            <Text style={{ flex: 1, fontWeight: "bold", fontSize: "14px" }}>Everyone</Text>
            {replyVisibility === "everyone" ? (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <CheckCircleIcon size={18} />
              </span>
            ) : (
              <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                <CircleIcon size={18} />
              </span>
            )}
          </Box>
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            px={3}
            py={2}
            style={{ cursor: "pointer", borderRadius: "8px", margin: "1px 4px" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            onClick={() => {
              setReplyVisibility("following");
              setShowVisibilityMenu(false);
            }}
          >
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="32px"
              height="32px"
              borderRadius="50%"
              bg="var(--color-accent-cyan)"
              color="#06080f"
            >
              <PersonIcon size={18} />
            </Box>
            <Text style={{ flex: 1, fontWeight: "bold", fontSize: "14px" }}>Accounts you follow</Text>
            {replyVisibility === "following" ? (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <CheckCircleIcon size={18} />
              </span>
            ) : (
              <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                <CircleIcon size={18} />
              </span>
            )}
          </Box>
          <Box
            display="flex"
            alignItems="center"
            gap={3}
            px={3}
            py={2}
            style={{ cursor: "pointer", borderRadius: "8px", margin: "1px 4px" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--ms-surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            onClick={() => {
              setReplyVisibility("mentioned");
              setShowVisibilityMenu(false);
            }}
          >
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="32px"
              height="32px"
              borderRadius="50%"
              bg="var(--color-accent-cyan)"
              color="#06080f"
            >
              <MentionIcon size={18} />
            </Box>
            <Text style={{ flex: 1, fontWeight: "bold", fontSize: "14px" }}>Only accounts you mention</Text>
            {replyVisibility === "mentioned" ? (
              <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
                <CheckCircleIcon size={18} />
              </span>
            ) : (
              <span style={{ color: "var(--color-text-muted)", display: "inline-flex" }}>
                <CircleIcon size={18} />
              </span>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
