// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  DownloadIcon,
  FileIcon,
  PulseIcon,
  RepoForkedIcon,
  SearchIcon,
  ShareIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { useTheme } from "../../../theme";
import { HERO_EXAMPLES, type HeroExample } from "../constants";
import { Badge, BrandLink, NavLeft, NavRight, NavText, PlaygroundNavbar as NavbarContainer } from "../styles";

export interface PlaygroundNavbarProps {
  fromArtifactParam: string | null;
  currentTitle: string;
  onSelectExample: (ex: HeroExample) => void;
  onDownloadModel: () => void;
  onCopyEmbed: () => void;
  onOpenShare: () => void;
  onPublishToFeed: () => void;
}

export const PlaygroundNavbar: React.FC<PlaygroundNavbarProps> = ({
  fromArtifactParam,
  currentTitle,
  onSelectExample,
  onDownloadModel,
  onCopyEmbed,
  onOpenShare,
  onPublishToFeed,
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();

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
          <span>ModelScript</span>
        </BrandLink>
        <Badge style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <PulseIcon size={12} /> Playground
        </Badge>

        {fromArtifactParam && (
          <Link
            to={`/feed?artifact=${fromArtifactParam}`}
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
            <span>{currentTitle}</span>
          </ActionMenu.Button>
          <ActionMenu.Overlay width="large">
            <ActionList>
              <ActionList.Group title="Curated Starter Models">
                {HERO_EXAMPLES.map((ex) => (
                  <ActionList.Item key={ex.id} onSelect={() => onSelectExample(ex)}>
                    <ActionList.LeadingVisual>
                      <FileIcon />
                    </ActionList.LeadingVisual>
                    {ex.name}
                  </ActionList.Item>
                ))}
              </ActionList.Group>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </NavLeft>

      <NavRight>
        {/* Global Search / Command Palette */}
        <Button
          size="small"
          variant="invisible"
          leadingVisual={SearchIcon}
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          title="Search models, packages & commands (Cmd+K)"
        >
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>⌘K</span>
        </Button>

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
                Download Model (.mo)
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

        {/* Publish / Open in IDE */}
        {user ? (
          <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={onPublishToFeed}>
            Post to Feed
          </Button>
        ) : (
          <div style={{ display: "flex", gap: "6px" }}>
            <Link to="/login" style={{ textDecoration: "none" }}>
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
