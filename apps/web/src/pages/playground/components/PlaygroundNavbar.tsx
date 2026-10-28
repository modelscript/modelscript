// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  DownloadIcon,
  FileIcon,
  PulseIcon,
  RepoForkedIcon,
  SearchIcon,
  ShareIcon,
  TerminalIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button } from "@primer/react";
import React from "react";
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
  publishLabel?: string;
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
  publishLabel,
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
            to={`/home?artifact=${fromArtifactParam}`}
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

        {/* Preset Example Picker */}
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
          title="Search models, packages & commands (Cmd+K)"
          className="nav-hide-sm"
        >
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>⌘K</span>
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
