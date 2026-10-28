// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  DownloadIcon,
  FileIcon,
  PencilIcon,
  PulseIcon,
  RepoForkedIcon,
  SearchIcon,
  ShareIcon,
  TerminalIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, IconButton } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { useTheme } from "../../../theme";
import { getExtensionForDialect } from "../../../util/editor-routing";
import { HERO_EXAMPLES, PLAYGROUND_LANGUAGES, type HeroExample } from "../constants";
import { Badge, BrandLink, NavLeft, NavRight, NavText, PlaygroundNavbar as NavbarContainer } from "../styles";

export interface PlaygroundNavbarProps {
  fromArtifactParam: string | null;
  currentTitle: string;
  currentLang?: string;
  isDirty?: boolean;
  publishLabel?: string;
  onTitleChange?: (newTitle: string) => void;
  onSelectExample: (ex: HeroExample) => void;
  onSelectLang?: (lang: string) => void;
  onOpenInVsCode?: () => void;
  onDownloadModel: () => void;
  onCopyEmbed: () => void;
  onOpenShare: () => void;
  onPublishToFeed: () => void;
}

export const PlaygroundNavbar: React.FC<PlaygroundNavbarProps> = ({
  fromArtifactParam,
  currentTitle,
  currentLang = "modelica",
  isDirty = false,
  publishLabel,
  onTitleChange,
  onSelectExample,
  onSelectLang,
  onOpenInVsCode,
  onDownloadModel,
  onCopyEmbed,
  onOpenShare,
  onPublishToFeed,
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);

  useEffect(() => {
    setDraftTitle(currentTitle);
  }, [currentTitle]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);

  const commitTitleChange = () => {
    setIsEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== currentTitle) {
      onTitleChange?.(trimmed);
    } else {
      setDraftTitle(currentTitle);
    }
  };

  const currentLangOption = PLAYGROUND_LANGUAGES.find((l) => l.id === currentLang) || {
    id: currentLang,
    label: currentLang.toUpperCase(),
    ext: getExtensionForDialect(currentLang),
  };

  const effectivePublishLabel = publishLabel || (fromArtifactParam ? "Fork to Feed" : "Post to Feed");

  return (
    <NavbarContainer>
      <NavLeft>
        <BrandLink to={user ? "/home" : "/explore"}>
          <img
            src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
            alt="ModelScript"
            width="24"
            height="24"
          />
          <span className="nav-hide-sm">ModelScript</span>
        </BrandLink>
        <Badge>
          <PulseIcon size={12} /> Playground
        </Badge>

        {fromArtifactParam && (
          <Link
            to={`/playground?fromArtifact=${fromArtifactParam}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "11px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "2px 8px",
              borderRadius: "999px",
              background: "rgba(245, 158, 11, 0.15)",
              color: "#f59e0b",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              textDecoration: "none",
              fontWeight: 600,
            }}
            title={`Forked from Artifact #${fromArtifactParam}`}
          >
            <RepoForkedIcon size={12} /> Fork of #{fromArtifactParam}
          </Link>
        )}

        {/* Preset Example Picker & Inline Title Rename */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          {isEditingTitle ? (
            <input
              type="text"
              value={draftTitle}
              aria-label="Model title"
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitleChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitTitleChange();
                } else if (e.key === "Escape") {
                  setDraftTitle(currentTitle);
                  setIsEditingTitle(false);
                }
              }}
              style={{
                width: 170,
                height: 28,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid var(--color-accent-fg, #0969da)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            />
          ) : (
            <ActionMenu>
              <ActionMenu.Button size="small">
                <span
                  style={{
                    display: "inline-block",
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "bottom",
                  }}
                >
                  {currentTitle}
                </span>
                {isDirty && (
                  <span
                    title="Unsaved changes"
                    aria-label="Unsaved changes"
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "#f59e0b",
                      marginLeft: 6,
                      verticalAlign: "middle",
                    }}
                  />
                )}
              </ActionMenu.Button>
              <ActionMenu.Overlay width="large">
                <ActionList>
                  <ActionList.Group title="Curated Starter Models">
                    {HERO_EXAMPLES.map((ex) => (
                      <ActionList.Item key={ex.id} onSelect={() => onSelectExample(ex)}>
                        <ActionList.LeadingVisual>
                          <FileIcon />
                        </ActionList.LeadingVisual>
                        {ex.title}
                        <ActionList.Description variant="inline">{ex.category}</ActionList.Description>
                      </ActionList.Item>
                    ))}
                  </ActionList.Group>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          )}
          {onTitleChange && !isEditingTitle && (
            <IconButton
              aria-label="Rename model"
              title="Rename model"
              icon={PencilIcon}
              size="small"
              variant="invisible"
              className="nav-hide-sm"
              onClick={() => {
                setDraftTitle(currentTitle);
                setIsEditingTitle(true);
              }}
            />
          )}
        </div>

        {/* Language / Dialect Selector */}
        {onSelectLang && (
          <ActionMenu>
            <ActionMenu.Button size="small" leadingVisual={CodeIcon} className="nav-hide-sm">
              <span>{currentLangOption.label}</span>
            </ActionMenu.Button>
            <ActionMenu.Overlay width="medium" style={{ maxHeight: "360px", overflowY: "auto" }}>
              <ActionList selectionVariant="single">
                <ActionList.Group title="Engineering Dialect (44 Languages)">
                  {PLAYGROUND_LANGUAGES.map((lang) => (
                    <ActionList.Item
                      key={lang.id}
                      selected={lang.id === currentLang}
                      onSelect={() => onSelectLang(lang.id)}
                    >
                      {lang.label}
                      <ActionList.Description variant="inline">{lang.ext}</ActionList.Description>
                    </ActionList.Item>
                  ))}
                </ActionList.Group>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        )}
      </NavLeft>

      <NavRight>
        {/* Global Search / Command Palette */}
        <Button
          size="small"
          variant="invisible"
          leadingVisual={SearchIcon}
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          title={`Search models, packages & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
          className="nav-hide-sm"
        >
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            {isMac ? "⌘K" : "Ctrl+K"}
          </span>
        </Button>

        {/* Promote to Multi-File VS Code Workbench */}
        {onOpenInVsCode && (
          <Button
            size="small"
            variant="default"
            leadingVisual={TerminalIcon}
            onClick={onOpenInVsCode}
            title="Promote this model to the full multi-file VS Code Workbench"
            className="nav-hide-sm"
          >
            <NavText>Open in VS Code</NavText>
          </Button>
        )}

        {/* Export Menu */}
        <ActionMenu>
          <ActionMenu.Button size="small" leadingVisual={DownloadIcon}>
            <NavText>Export</NavText>
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList>
              <ActionList.Item onSelect={onDownloadModel}>
                <ActionList.LeadingVisual>
                  <DownloadIcon />
                </ActionList.LeadingVisual>
                Download Model ({currentLangOption.ext})
              </ActionList.Item>
              <ActionList.Item onSelect={onCopyEmbed}>
                <ActionList.LeadingVisual>
                  <CodeIcon />
                </ActionList.LeadingVisual>
                Copy Embed Widget (HTML)
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        {/* Share Button */}
        <Button size="small" variant="default" leadingVisual={ShareIcon} onClick={onOpenShare}>
          <NavText>Share</NavText>
        </Button>

        {/* Publish / Save Edit / Reply / Fork to Feed */}
        {user ? (
          <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={onPublishToFeed}>
            {effectivePublishLabel}
          </Button>
        ) : (
          <div style={{ display: "flex", gap: "6px" }}>
            <Link to="/login" style={{ textDecoration: "none" }} className="nav-hide-sm">
              <Button size="small" variant="default">
                Sign In
              </Button>
            </Link>
            <Link to="/signup" style={{ textDecoration: "none" }}>
              <Button size="small" variant="primary">
                Sign Up
              </Button>
            </Link>
          </div>
        )}
      </NavRight>
    </NavbarContainer>
  );
};
