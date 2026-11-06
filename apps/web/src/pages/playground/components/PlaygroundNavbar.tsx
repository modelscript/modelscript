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
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StackIcon,
  TableIcon,
  TerminalIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, IconButton, SegmentedControl } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { AnsatzSketchIcon } from "../../../components/icons";
import { getLanguageInfo } from "../../../components/morsel/constants";
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
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onTitleChange?: (newTitle: string) => void;
  onSelectExample: (ex: HeroExample) => void;
  onSelectLang?: (lang: string) => void;
  onViewChange?: (view: "diagram" | "code" | "split" | "simulation" | "3d" | "inspector") => void;
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
  isSidebarOpen,
  onToggleSidebar,
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
        {onToggleSidebar && (
          <IconButton
            icon={isSidebarOpen === false ? SidebarExpandIcon : SidebarCollapseIcon}
            size="small"
            variant="invisible"
            aria-label={isSidebarOpen === false ? "Show Libraries sidebar" : "Hide Libraries sidebar"}
            title={
              isSidebarOpen === false
                ? `Show Libraries sidebar (${isMac ? "⌘B" : "Ctrl+B"})`
                : `Hide Libraries sidebar (${isMac ? "⌘B" : "Ctrl+B"})`
            }
            onClick={onToggleSidebar}
            style={{ height: 32, width: 32, borderRadius: 6, marginRight: 4 }}
          />
        )}
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
            borderRadius: "var(--ms-radius-sm, 6px)",
            color: "var(--color-fg-muted)",
            textDecoration: "none",
            border: "1px solid var(--color-border-subtle, var(--ms-border, rgba(15, 23, 42, 0.12)))",
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
              fontFamily: "var(--ms-font-mono, monospace)",
              padding: "2px 8px",
              borderRadius: "var(--ms-radius-pill, 999px)",
              background: "var(--ms-status-warn-bg, rgba(217, 119, 6, 0.12))",
              color: "var(--ms-status-warn-fg, #d97706)",
              border: "1px solid var(--ms-status-warn-border, rgba(217, 119, 6, 0.32))",
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
                fontSize: 13,
                fontWeight: 600,
                borderRadius: "var(--ms-radius-sm, 6px)",
                border: "1px solid var(--ms-brand, #0891b2)",
                boxShadow: "var(--ms-focus-ring, 0 0 0 3px rgba(8, 145, 178, 0.25))",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <ActionMenu>
              <ActionMenu.Button size="small">
                <span
                  style={{
                    display: "inline-block",
                    minWidth: 100,
                    maxWidth: "clamp(100px, 18vw, 240px)",
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
                      backgroundColor: "var(--ms-warning, #d97706)",
                      marginLeft: 6,
                      verticalAlign: "middle",
                      boxShadow: "0 0 4px var(--ms-warning, #d97706)",
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
                        <span style={{ color: "var(--ms-link, var(--color-accent-fg, #0891b2))", fontWeight: 600 }}>
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

      {onViewChange &&
        (() => {
          const langInfo = getLanguageInfo(currentLang);
          const supportsDiagram = langInfo?.supportsDiagram ?? true;
          const supportsSimulation = langInfo?.supportsSimulation ?? true;
          const supports3d = Boolean(langInfo?.supports3d || currentView === "3d");
          const inspectorLabel =
            langInfo?.id === "owl2" ? "Reasoner" : langInfo?.id === "sysml2" ? "Requirements" : "Inspector";

          const viewTabs: Array<{
            id: "diagram" | "3d" | "simulation" | "inspector" | "code" | "split";
            label: string;
            icon: any;
            onClick: () => void;
          }> = [];

          if (supportsDiagram) {
            viewTabs.push({
              id: "diagram",
              label: "Diagram",
              icon: WorkflowIcon,
              title: "Diagram schematic view (⌥1)",
              onClick: () => onViewChange("diagram"),
            });
          }
          if (supports3d) {
            viewTabs.push({
              id: "3d",
              label: "3D",
              icon: StackIcon,
              title: "3D CAD & multibody animation (⌥2)",
              onClick: () => onViewChange("3d"),
            });
          }
          if (supportsSimulation) {
            viewTabs.push({
              id: "simulation",
              label: "Simulation",
              icon: GraphIcon,
              title: "Simulation plots & variables (⌥3)",
              onClick: () => onViewChange("simulation"),
            });
          }
          viewTabs.push({
            id: "inspector",
            label: inspectorLabel,
            icon: TableIcon,
            title: `${inspectorLabel} table & properties (⌥4)`,
            onClick: () => onViewChange("inspector"),
          });
          viewTabs.push({
            id: "code",
            label: "Code",
            icon: CodeIcon,
            title: "Source code editor (⌥5)",
            onClick: () => onViewChange("code"),
          });
          viewTabs.push({
            id: "split",
            label: "Split",
            icon: ColumnsIcon,
            title: "Side-by-side diagram & code split (⌥6)",
            onClick: () => onViewChange("split"),
          });

          const selectedIndex = viewTabs.findIndex(
            (t) =>
              t.id === currentView ||
              (t.id === "simulation" && currentView === "plot") ||
              (t.id === "split" && (currentView === "split-columns" || currentView === "split-rows")),
          );

          return (
            <NavCenter>
              <SegmentedControl
                size="small"
                aria-label="Workbench View"
                onChange={(index) => {
                  const target = viewTabs[index];
                  if (target) {
                    target.onClick();
                  }
                }}
              >
                {viewTabs.map((tab, idx) => (
                  <SegmentedControl.Button
                    key={tab.id}
                    selected={idx === (selectedIndex !== -1 ? selectedIndex : 0)}
                    leadingVisual={tab.icon}
                    title={tab.title}
                    aria-label={tab.label}
                    onClick={tab.onClick}
                  >
                    {tab.label}
                  </SegmentedControl.Button>
                ))}
              </SegmentedControl>
            </NavCenter>
          );
        })()}

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
              height: 32,
              borderRadius: "var(--ms-radius-sm, 6px)",
              background: isSimulating
                ? "var(--color-neutral-muted, var(--ms-text-3, #4b5563))"
                : "linear-gradient(180deg, var(--ms-accent-teal, #14b8a6) 0%, var(--ms-brand, #0e7490) 100%)",
              borderColor: isSimulating ? "transparent" : "var(--ms-brand-active, #155e75)",
              boxShadow: isSimulating ? "none" : "0 1px 3px rgba(14, 116, 144, 0.25)",
              color: "#ffffff",
              minWidth: 78,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            title={isSimulating ? "Simulation running…" : `Run Simulation (${isMac ? "⇧↵" : "F5"})`}
          >
            {isSimulating ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    border: "2px solid #ffffff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    display: "inline-block",
                  }}
                />
                Running…
              </span>
            ) : (
              "Run"
            )}
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
          style={{ height: 32, width: 32, borderRadius: 6 }}
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
            style={{ height: 32, borderRadius: 6 }}
          >
            <NavText>Open in VS Code</NavText>
          </Button>
        )}

        {/* Unified Share & Export Menu */}
        <ActionMenu>
          <ActionMenu.Button size="small" leadingVisual={ShareIcon} style={{ height: 32, borderRadius: 6 }}>
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
              <Button size="small" variant="invisible">
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
