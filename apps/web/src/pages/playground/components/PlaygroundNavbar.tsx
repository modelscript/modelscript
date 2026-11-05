// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  BookmarkIcon,
  CodeIcon,
  ColumnsIcon,
  CrossReferenceIcon,
  DownloadIcon,
  FileIcon,
  GraphIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepoForkedIcon,
  RepoIcon,
  SearchIcon,
  ShareIcon,
  TerminalIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, IconButton, SegmentedControl } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { AnsatzSketchIcon } from "../../../components/icons";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { useTheme } from "../../../theme";
import { getExtensionForDialect } from "../../../util/editor-routing";
import {
  DEFAULT_EMPTY_MODELICA_CODE,
  HERO_EXAMPLES,
  useVisiblePlaygroundLanguages,
  type HeroExample,
} from "../constants";
import {
  Badge,
  BrandLink,
  NavCenter,
  NavLeft,
  NavRight,
  NavText,
  PlaygroundNavbar as NavbarContainer,
} from "../styles";

export interface PlaygroundNavbarProps {
  fromArtifactParam: string | null;
  currentTitle: string;
  currentLang?: string;
  currentView?: string;
  isDirty?: boolean;
  isSimulating?: boolean;
  publishLabel?: string;
  onTitleChange?: (newTitle: string) => void;
  onSelectExample: (ex: HeroExample) => void;
  onSelectLang?: (lang: string) => void;
  onViewChange?: (view: "diagram" | "code" | "split" | "simulation") => void;
  onSimulate?: () => void;
  onOpenInVsCode?: () => void;
  onOpenTemplates?: () => void;
  onSaveToArtifact?: () => void;
  onCreateRepo?: () => void;
  onDownloadModel: () => void;
  onCopyEmbed: () => void;
  onOpenShare: () => void;
  onPublishToFeed: () => void;
}

export const PlaygroundNavbar: React.FC<PlaygroundNavbarProps> = ({
  fromArtifactParam,
  currentTitle,
  currentLang = "modelica",
  currentView = "diagram",
  isDirty = false,
  isSimulating = false,
  publishLabel,
  onTitleChange,
  onSelectExample,
  onSelectLang,
  onViewChange,
  onSimulate,
  onOpenInVsCode,
  onOpenTemplates,
  onSaveToArtifact,
  onCreateRepo,
  onDownloadModel,
  onCopyEmbed,
  onOpenShare,
  onPublishToFeed,
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const branding = useInstanceBranding();
  const visiblePlaygroundLanguages = useVisiblePlaygroundLanguages();
  const customLogoSrc = theme === "dark" ? branding.brandLogoDarkUrl || branding.brandLogoUrl : branding.brandLogoUrl;
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

  const currentLangOption = visiblePlaygroundLanguages.find((l) => l.id === currentLang) || {
    id: currentLang,
    label: currentLang.toUpperCase(),
    ext: getExtensionForDialect(currentLang),
  };

  const effectivePublishLabel = publishLabel || (fromArtifactParam ? "Post your fork" : "Post");

  return (
    <NavbarContainer>
      <NavLeft>
        <BrandLink
          href={branding.docsBaseUrl || "https://modelscript.org"}
          target="_blank"
          rel="noopener noreferrer"
          title="Ansatz Sketch"
          aria-label="ModelScript Homepage"
        >
          <img
            src={customLogoSrc || (theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png")}
            alt="ModelScript"
            width={24}
            height={24}
            style={{ borderRadius: "5px", flexShrink: 0, display: "block" }}
          />
          <span
            className="nav-hide-md"
            style={{ fontWeight: 700, letterSpacing: "-0.01em", color: "var(--color-fg-default)" }}
          >
            ModelScript
          </span>
          <Badge data-testid="playground-brand-badge" title="Ansatz Sketch">
            <AnsatzSketchIcon size={14} variant="outline" style={{ marginRight: "3px" }} />
            <span>Sketch</span>
          </Badge>
        </BrandLink>

        <Link
          to={user ? "/home" : "/explore"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "12px",
            fontWeight: 500,
            padding: "3px 8px",
            borderRadius: "6px",
            color: "var(--color-fg-muted)",
            textDecoration: "none",
            border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.1))",
            background: "var(--color-canvas-subtle)",
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}
          title="Return to Ansatz Platform"
          aria-label="Back to Ansatz Platform"
        >
          <ArrowLeftIcon size={12} />
          <span className="nav-hide-md">Ansatz</span>
        </Link>

        {fromArtifactParam && (
          <Link
            to={`/sketch?fromArtifact=${fromArtifactParam}`}
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
              flexShrink: 0,
            }}
            title={`Forked from Artifact #${fromArtifactParam}`}
          >
            <RepoForkedIcon size={12} /> Fork of #{fromArtifactParam}
          </Link>
        )}

        {/* Preset Example Picker & Inline Title Rename */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
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
                width: 150,
                maxWidth: "38vw",
                height: 28,
                padding: "2px 8px",
                fontSize: 14,
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
                    minWidth: 120,
                    maxWidth: "clamp(120px, 20vw, 240px)",
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
                  {onTitleChange && (
                    <>
                      <ActionList.Item
                        onSelect={() => {
                          setDraftTitle(currentTitle);
                          setIsEditingTitle(true);
                        }}
                      >
                        <ActionList.LeadingVisual>
                          <PencilIcon />
                        </ActionList.LeadingVisual>
                        Rename Model…
                      </ActionList.Item>
                      <ActionList.Divider />
                    </>
                  )}
                  <ActionList.Item
                    onSelect={() =>
                      onSelectExample({
                        id: "untitled",
                        title: "Untitled Model",
                        category: "General",
                        lang: currentLang,
                        code: DEFAULT_EMPTY_MODELICA_CODE,
                      })
                    }
                  >
                    <ActionList.LeadingVisual>
                      <PlusIcon />
                    </ActionList.LeadingVisual>
                    New Blank Model
                    <ActionList.Description variant="inline">Reset to empty canvas</ActionList.Description>
                  </ActionList.Item>
                  {onOpenTemplates && (
                    <ActionList.Item onSelect={onOpenTemplates}>
                      <ActionList.LeadingVisual>
                        <CrossReferenceIcon />
                      </ActionList.LeadingVisual>
                      Browse Starter Templates…
                      <ActionList.Description variant="inline">Explore multi-physics gallery</ActionList.Description>
                    </ActionList.Item>
                  )}
                  <ActionList.Divider />
                  <ActionList.Group title="Curated Starter Models">
                    {HERO_EXAMPLES.slice(0, 7).map((ex) => (
                      <ActionList.Item key={ex.id} onSelect={() => onSelectExample(ex)}>
                        <ActionList.LeadingVisual>
                          <FileIcon />
                        </ActionList.LeadingVisual>
                        {ex.title}
                        <ActionList.Description variant="inline">{ex.category}</ActionList.Description>
                      </ActionList.Item>
                    ))}
                    {onOpenTemplates && (
                      <ActionList.Item onSelect={onOpenTemplates}>
                        <ActionList.LeadingVisual>
                          <CrossReferenceIcon />
                        </ActionList.LeadingVisual>
                        <span style={{ color: "var(--color-accent-fg, #0969da)", fontWeight: 600 }}>
                          View all in template gallery →
                        </span>
                      </ActionList.Item>
                    )}
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

        {/* Templates Gallery Button */}
        {onOpenTemplates && (
          <Button
            size="small"
            variant="invisible"
            leadingVisual={CrossReferenceIcon}
            onClick={onOpenTemplates}
            title="Browse starter engineering templates"
            className="nav-hide-md"
          >
            <NavText>Templates</NavText>
          </Button>
        )}

        {/* Language / Dialect Selector */}
        {onSelectLang && (
          <ActionMenu>
            <ActionMenu.Button size="small" leadingVisual={CodeIcon} aria-label="Select engineering dialect">
              <span
                style={{
                  display: "inline-block",
                  maxWidth: "clamp(64px, 18vw, 140px)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  verticalAlign: "bottom",
                }}
              >
                {currentLangOption.label}
              </span>
            </ActionMenu.Button>
            <ActionMenu.Overlay width="medium" style={{ maxHeight: "360px", overflowY: "auto" }}>
              <ActionList selectionVariant="single">
                <ActionList.Group title={`Engineering Dialect (${visiblePlaygroundLanguages.length} Languages)`}>
                  {visiblePlaygroundLanguages.map((lang) => (
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

      {onViewChange && (
        <NavCenter>
          <SegmentedControl size="small" aria-label="Workbench View">
            <SegmentedControl.Button
              selected={currentView === "diagram"}
              leadingVisual={WorkflowIcon}
              onClick={() => onViewChange("diagram")}
            >
              Diagram
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={currentView === "code"}
              leadingVisual={CodeIcon}
              onClick={() => onViewChange("code")}
            >
              Code
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={currentView === "split" || currentView === "split-columns" || currentView === "split-rows"}
              leadingVisual={ColumnsIcon}
              onClick={() => onViewChange("split")}
            >
              Split
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={currentView === "simulation" || currentView === "plot"}
              leadingVisual={GraphIcon}
              onClick={() => onViewChange("simulation")}
            >
              Simulation
            </SegmentedControl.Button>
          </SegmentedControl>
        </NavCenter>
      )}

      <NavRight>
        {/* Primary Run Simulation CTA */}
        {onSimulate && (
          <Button
            size="small"
            variant="primary"
            leadingVisual={isSimulating ? undefined : PlayIcon}
            onClick={onSimulate}
            disabled={isSimulating}
            style={{
              fontWeight: 600,
              backgroundColor: isSimulating ? "#047857" : "#059669",
              borderColor: "#047857",
              color: "#ffffff",
              minWidth: 70,
            }}
            title={isSimulating ? "Simulation running…" : "Run Simulation (F5)"}
          >
            {isSimulating ? "Running…" : "Run"}
          </Button>
        )}

        {/* Global Search / Command Palette */}
        <IconButton
          size="small"
          variant="invisible"
          icon={SearchIcon}
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          aria-label={`Search models & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
          title={`Search models, packages & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
        />

        {/* Promote to Multi-File VS Code Workbench */}
        {onOpenInVsCode && (
          <Button
            size="small"
            variant="default"
            leadingVisual={TerminalIcon}
            onClick={onOpenInVsCode}
            title="Promote this model to the full multi-file VS Code Workbench"
            className="nav-hide-lg"
          >
            <NavText>Open in VS Code</NavText>
          </Button>
        )}

        {/* Unified Share & Export Menu */}
        <ActionMenu>
          <ActionMenu.Button size="small" leadingVisual={ShareIcon}>
            <NavText>Share</NavText>
          </ActionMenu.Button>
          <ActionMenu.Overlay width="medium">
            <ActionList>
              <ActionList.Item onSelect={onOpenShare}>
                <ActionList.LeadingVisual>
                  <ShareIcon />
                </ActionList.LeadingVisual>
                Share Link & Embeds…
                <ActionList.Description variant="inline">URL, iframe, custom tag</ActionList.Description>
              </ActionList.Item>
              <ActionList.Item onSelect={onCopyEmbed}>
                <ActionList.LeadingVisual>
                  <CodeIcon />
                </ActionList.LeadingVisual>
                Copy Embed Snippet
              </ActionList.Item>
              <ActionList.Divider />
              <ActionList.Item onSelect={onDownloadModel}>
                <ActionList.LeadingVisual>
                  <DownloadIcon />
                </ActionList.LeadingVisual>
                Download Model ({currentLangOption.ext})
              </ActionList.Item>
              {onSaveToArtifact && (
                <ActionList.Item onSelect={onSaveToArtifact}>
                  <ActionList.LeadingVisual>
                    <BookmarkIcon />
                  </ActionList.LeadingVisual>
                  Save to Cloud Library
                </ActionList.Item>
              )}
              {onCreateRepo && (
                <ActionList.Item onSelect={onCreateRepo}>
                  <ActionList.LeadingVisual>
                    <RepoIcon />
                  </ActionList.LeadingVisual>
                  Create Git Repository…
                </ActionList.Item>
              )}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        {/* Publish / Save Edit / Reply / Fork to Feed & Ansatz Profile Menu */}
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={onPublishToFeed}>
              {effectivePublishLabel}
            </Button>
            <ActionMenu>
              <ActionMenu.Button
                size="small"
                variant="invisible"
                style={{ padding: "0 4px", minWidth: 28 }}
                aria-label="Ansatz Account & Workspaces"
                title={`Ansatz Account (@${user.username || "user"})`}
              >
                <img
                  src={user.avatar_url || (theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png")}
                  alt={user.username || "User"}
                  width={22}
                  height={22}
                  style={{ borderRadius: "50%", display: "block" }}
                />
              </ActionMenu.Button>
              <ActionMenu.Overlay width="medium">
                <ActionList>
                  <ActionList.Item disabled>
                    <ActionList.Description variant="block">
                      Signed in as <strong>@{user.username || "user"}</strong>
                    </ActionList.Description>
                  </ActionList.Item>
                  <ActionList.Divider />
                  <ActionList.LinkItem as={Link} to="/home">
                    Ansatz Feed
                  </ActionList.LinkItem>
                  <ActionList.LinkItem as={Link} to="/repos">
                    My Workspaces & Repos
                  </ActionList.LinkItem>
                  <ActionList.LinkItem as={Link} to="/explore">
                    Explore Community Models
                  </ActionList.LinkItem>
                  <ActionList.Divider />
                  <ActionList.LinkItem as={Link} to="/settings">
                    Settings
                  </ActionList.LinkItem>
                  <ActionList.LinkItem as={Link} to="/logout">
                    Sign Out
                  </ActionList.LinkItem>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
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
