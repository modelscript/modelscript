// SPDX-License-Identifier: AGPL-3.0-or-later

import { getLanguageInfo } from "@modelscript/editor/workbench/constants";
import { LanguageToolbarButtons } from "@modelscript/editor/workbench/panels/LanguageToolbarButtons";
import {
  AlertIcon,
  BookmarkIcon,
  CodeIcon,
  ColumnsIcon,
  DownloadIcon,
  GraphIcon,
  ImageIcon,
  KebabHorizontalIcon,
  MoonIcon,
  PlayIcon,
  RepoForkedIcon,
  RepoIcon,
  RowsIcon,
  SearchIcon,
  ShareIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StackIcon,
  SunIcon,
  TableIcon,
  TerminalIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, IconButton, SegmentedControl } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { AnsatzIcon } from "../../../components/icons";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { useTheme } from "../../../theme";
import { getExtensionForDialect } from "../../../util/editor-routing";
import { useVisibleAnsatzEditorLanguages, type HeroExample } from "../constants";
import {
  Badge,
  BrandLink,
  BrandTierBadge,
  DocIdentity,
  DocMeta,
  DocTitleInput,
  NavCenter,
  NavDivider,
  NavLeft,
  NavRight,
  NavText,
  AnsatzEditorNavbar as NavbarContainer,
  SearchTrigger,
  SplitToggleButton,
} from "../styles";

export interface AnsatzEditorNavbarProps {
  fromArtifactParam: string | null;
  currentTitle: string;
  currentLang?: string;
  lockedLanguage?: string | undefined;
  currentView?: string;
  diagramType?: string;
  isSplit?: boolean;
  canSplit?: boolean;
  splitOrientation?: "horizontal" | "vertical";
  onToggleSplit?: () => void;
  isDirty?: boolean;
  isSimulating?: boolean;
  publishLabel?: string;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onTitleChange?: (newTitle: string) => void;
  onSelectExample: (ex: HeroExample) => void;
  onSelectLang?: (lang: string) => void;
  onSelectDiagramType?: (diagramType: string) => void;
  onViewChange?: (view: "diagram" | "code" | "split" | "simulation" | "3d" | "inspector") => void;
  onSimulate?: () => void;
  onOpenInVsCode?: () => void;
  onBrandClick?: () => void;
  onSaveToArtifact?: () => void;
  onCreateRepo?: () => void;
  runStatus?: {
    state: "idle" | "compiling" | "ok" | "error";
    errors?: number;
    message?: string;
  };
  onOpenProblems?: () => void;
  onDownloadModel: () => void;
  onCopyEmbed: () => void;
  onOpenShare: () => void;
  onPublishToFeed: () => void;
}

export const AnsatzEditorNavbar: React.FC<AnsatzEditorNavbarProps> = ({
  fromArtifactParam,
  currentTitle,
  currentLang = "modelica",
  lockedLanguage,
  currentView = "diagram",
  diagramType = "diagram",
  isSplit = false,
  canSplit = true,
  splitOrientation = "horizontal",
  onToggleSplit,
  isDirty: _isDirty = false,
  isSimulating = false,
  runStatus,
  onOpenProblems,
  publishLabel,
  isSidebarOpen,
  onToggleSidebar,
  onTitleChange,
  onSelectExample: _onSelectExample,
  onSelectLang: _onSelectLang,
  onSelectDiagramType,
  onViewChange,
  onSimulate,
  onOpenInVsCode,
  onBrandClick,
  onSaveToArtifact,
  onCreateRepo,
  onDownloadModel,
  onCopyEmbed,
  onOpenShare,
  onPublishToFeed,
}) => {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const branding = useInstanceBranding();
  const visibleAnsatzEditorLanguages = useVisibleAnsatzEditorLanguages();
  const customLogoSrc = theme === "dark" ? branding.brandLogoDarkUrl || branding.brandLogoUrl : branding.brandLogoUrl;

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);

  const [draftTitle, setDraftTitle] = useState(currentTitle);
  useEffect(() => {
    setDraftTitle(currentTitle);
  }, [currentTitle]);

  const commitTitle = () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(currentTitle);
      return;
    }
    if (trimmed !== currentTitle) {
      onTitleChange?.(trimmed);
    }
  };

  const currentLangOption = visibleAnsatzEditorLanguages.find((l) => l.id === currentLang) || {
    id: currentLang,
    label: currentLang.toUpperCase(),
    ext: getExtensionForDialect(currentLang),
  };

  const effectivePublishLabel = publishLabel || (fromArtifactParam ? "Post your fork" : "Post");

  const activeLangInfo = getLanguageInfo(currentLang);
  const supportsDiagram = activeLangInfo.supportsDiagram ?? true;
  const supportsSimulation = activeLangInfo.supportsSimulation ?? true;
  const hasIconMode = Boolean(supportsDiagram && activeLangInfo.diagramTypes?.some((dt) => dt.id === "icon"));
  const supports3dView = Boolean(activeLangInfo.supports3d);
  const inspectorLabel =
    activeLangInfo.id === "owl2"
      ? "Reasoner"
      : activeLangInfo.id === "sysml2"
        ? "Requirements"
        : activeLangInfo.id === "csv"
          ? "Table"
          : "Inspector";

  type ViewTabId = "diagram" | "icon" | "3d" | "simulation" | "inspector" | "code";
  const viewTabs: Array<{
    id: ViewTabId;
    label: string;
    icon: React.ElementType;
    title: string;
    onClick: () => void;
  }> = [];

  if (supportsDiagram) {
    viewTabs.push({
      id: "diagram",
      label: "Diagram",
      icon: WorkflowIcon,
      title: "Diagram schematic view (⌥1)",
      onClick: () => {
        onSelectDiagramType?.("diagram");
        onViewChange?.("diagram");
      },
    });
  }
  if (hasIconMode) {
    viewTabs.push({
      id: "icon",
      label: "Icon",
      icon: ImageIcon,
      title: "Icon graphical view",
      onClick: () => {
        onSelectDiagramType?.("icon");
        onViewChange?.("diagram");
      },
    });
  }
  if (supports3dView) {
    viewTabs.push({
      id: "3d",
      label: "3D",
      icon: StackIcon,
      title: "3D CAD & multibody animation (⌥2)",
      onClick: () => onViewChange?.("3d"),
    });
  }
  if (supportsSimulation) {
    viewTabs.push({
      id: "simulation",
      label: "Simulation",
      icon: GraphIcon,
      title: "Simulation plots & variables (⌥3)",
      onClick: () => onViewChange?.("simulation"),
    });
  }
  viewTabs.push({
    id: "inspector",
    label: inspectorLabel,
    icon: TableIcon,
    title: `${inspectorLabel} table & properties (⌥4)`,
    onClick: () => onViewChange?.("inspector"),
  });
  viewTabs.push({
    id: "code",
    label: "Code",
    icon: CodeIcon,
    title: "Source code editor (⌥5)",
    onClick: () => onViewChange?.("code"),
  });

  const isCodeView = currentView === "code";
  const activeTabId: ViewTabId = isCodeView
    ? "code"
    : currentView === "inspector"
      ? "inspector"
      : currentView === "3d" && supports3dView
        ? "3d"
        : currentView === "simulation" && supportsSimulation
          ? "simulation"
          : supportsDiagram
            ? hasIconMode && diagramType === "icon"
              ? "icon"
              : "diagram"
            : supports3dView
              ? "3d"
              : supportsSimulation
                ? "simulation"
                : "inspector";

  const selectedIndex = viewTabs.findIndex((t) => t.id === activeTabId);
  const SplitIcon = splitOrientation === "vertical" ? RowsIcon : ColumnsIcon;
  const splitTitle = !canSplit
    ? "Split view unavailable: window too small"
    : isCodeView
      ? "Split view is unavailable when Code tab is full"
      : isSplit
        ? "Close split view (⌥6)"
        : splitOrientation === "vertical"
          ? "Split view: Code on top, selected view on bottom (⌥6)"
          : "Split view: Code on left, selected view on right (⌥6)";

  return (
    <NavbarContainer>
      {/* Left: Sidebar toggle, brand, document title & language metadata */}
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
            style={{ height: 28, width: 28, borderRadius: 6, flexShrink: 0 }}
          />
        )}
        <BrandLink
          href={onBrandClick ? "#new-model" : branding.docsBaseUrl || "https://modelscript.org"}
          target={onBrandClick ? undefined : "_blank"}
          rel={onBrandClick ? undefined : "noopener noreferrer"}
          title={onBrandClick ? "New workspace & New Model" : "Ansatz"}
          aria-label="Ansatz"
          onClick={
            onBrandClick
              ? (e) => {
                  e.preventDefault();
                  onBrandClick();
                }
              : undefined
          }
        >
          <img
            src={customLogoSrc || (theme === "dark" ? "/brand-dark.png" : "/brand.png")}
            alt="Ansatz"
            height={20}
            style={{ height: "20px", width: "auto", flexShrink: 0, display: "block" }}
            data-testid="ansatz-brand-icon"
          />
          {Boolean(customLogoSrc) && (
            <Badge data-testid="ansatz-brand-badge" title="Ansatz" className="nav-hide-xl">
              <AnsatzIcon size={13} style={{ marginRight: "3px" }} />
              <span>Ansatz</span>
            </Badge>
          )}
          <BrandTierBadge data-testid="ansatz-brand-beta-badge" className="nav-hide-xl">
            {branding.instanceBadge?.trim() || "Beta"}
          </BrandTierBadge>
        </BrandLink>

        <NavDivider />

        <DocIdentity>
          {onTitleChange ? (
            <DocTitleInput
              type="text"
              aria-label="Model title"
              title="Click to rename model"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setDraftTitle(currentTitle);
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ms-text-1, var(--fgColor-default))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentTitle}
            </span>
          )}

          <DocMeta
            data-testid="ansatz-language-badge"
            title={
              lockedLanguage
                ? `Single-language mode: ${currentLangOption.label} (${currentLangOption.ext})`
                : `Active language: ${currentLangOption.label} (${currentLangOption.ext})`
            }
          >
            · {currentLangOption.label}
          </DocMeta>
        </DocIdentity>

        {fromArtifactParam && (
          <Link
            to={`/editor?fromArtifact=${fromArtifactParam}`}
            className="nav-hide-lg"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontFamily: "var(--ms-font-mono, monospace)",
              padding: "2px 7px",
              borderRadius: "var(--ms-radius-pill, 999px)",
              background: "var(--ms-status-warn-bg, rgba(217, 119, 6, 0.12))",
              color: "var(--ms-status-warn-fg, #d97706)",
              border: "1px solid var(--ms-status-warn-border, rgba(217, 119, 6, 0.32))",
              textDecoration: "none",
              fontWeight: 600,
              flexShrink: 0,
            }}
            title={`Forked from Model #${fromArtifactParam}`}
          >
            <RepoForkedIcon size={12} /> #{fromArtifactParam}
          </Link>
        )}
      </NavLeft>

      {/* Centre: True-centred view switcher + split toggle */}
      {onViewChange ? (
        <NavCenter>
          <SegmentedControl
            size="small"
            aria-label="Workbench View"
            onChange={(idx) => {
              const target = viewTabs[idx];
              if (target) target.onClick();
            }}
          >
            {viewTabs.map((tab, idx) => (
              <SegmentedControl.Button
                key={tab.id}
                selected={idx === (selectedIndex !== -1 ? selectedIndex : 0)}
                leadingIcon={tab.icon}
                aria-label={tab.label}
                title={tab.title}
                onClick={tab.onClick}
              >
                {tab.label}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>

          {onToggleSplit && (
            <SplitToggleButton
              type="button"
              role="button"
              aria-pressed={Boolean(isSplit && !isCodeView && canSplit)}
              aria-label={
                splitOrientation === "vertical"
                  ? "Split view (Code on top, visualizer on bottom)"
                  : "Split view (Code on left, visualizer on right)"
              }
              disabled={isCodeView || !canSplit}
              $active={Boolean(isSplit && !isCodeView && canSplit)}
              onClick={onToggleSplit}
              title={splitTitle}
            >
              <SplitIcon size={14} />
            </SplitToggleButton>
          )}
        </NavCenter>
      ) : (
        <div />
      )}

      {/* Right: Error pill, Search, Language Tools, Share, Options, Run CTA, Account */}
      <NavRight>
        {Boolean(runStatus && (runStatus.state === "error" || (runStatus.errors ?? 0) > 0)) && (
          <button
            type="button"
            onClick={onOpenProblems}
            title={`${runStatus?.errors ?? 1} issue${(runStatus?.errors ?? 1) > 1 ? "s" : ""} detected. Click to inspect.`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 28,
              padding: "0 8px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              background: "var(--ms-status-danger-bg, rgba(239, 68, 68, 0.12))",
              color: "var(--ms-status-danger-fg, #ef4444)",
              border: "1px solid var(--ms-status-danger-border, rgba(239, 68, 68, 0.3))",
              cursor: onOpenProblems ? "pointer" : "default",
              transition: "all 0.15s ease",
            }}
          >
            <AlertIcon size={12} />
            <span>
              {runStatus?.errors ?? 1} {(runStatus?.errors ?? 1) === 1 ? "error" : "errors"}
            </span>
          </button>
        )}

        {/* Command Palette / Global Search */}
        <SearchTrigger
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          aria-label={`Search models & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
          title={`Search models, packages & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
        >
          <SearchIcon size={14} />
          <span className="search-label">Search…</span>
          <kbd>{isMac ? "⌘K" : "Ctrl+K"}</kbd>
        </SearchTrigger>

        {/* Language-specific tools (borderless, folds cleanly into Tools ▾) */}
        <LanguageToolbarButtons
          languageId={currentLang}
          activeView={activeTabId}
          maxPrimary={activeTabId === "icon" ? 6 : 0}
          autoFit
          plain
          languageLabel={currentLangOption.label}
        />

        {/* Unified Share & Export Menu */}
        <ActionMenu>
          <ActionMenu.Button
            size="small"
            variant="invisible"
            leadingVisual={ShareIcon}
            className="nav-icon-only-xl"
            style={{ height: 28, borderRadius: 8 }}
          >
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

        {/* Global App Utilities Menu (Theme Toggle, Open in VS Code Workbench) */}
        <ActionMenu>
          <ActionMenu.Anchor>
            <IconButton
              icon={KebabHorizontalIcon}
              size="small"
              variant="invisible"
              aria-label="Workspace options"
              title="Appearance & workspace options"
              data-testid="ansatz-workspace-options-btn"
              style={{ height: 28, width: 28, borderRadius: 8 }}
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay width="medium">
            <ActionList>
              <ActionList.Item onSelect={toggleTheme}>
                <ActionList.LeadingVisual>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</ActionList.LeadingVisual>
                Switch to {theme === "dark" ? "light" : "dark"} mode
              </ActionList.Item>
              {onOpenInVsCode && (
                <>
                  <ActionList.Divider />
                  <ActionList.Item onSelect={onOpenInVsCode}>
                    <ActionList.LeadingVisual>
                      <TerminalIcon />
                    </ActionList.LeadingVisual>
                    Open in VS Code Workbench
                  </ActionList.Item>
                </>
              )}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        <NavDivider />

        {/* Primary CTA: Language-Dependent Run Simulation (the only filled brand button) */}
        {supportsSimulation && onSimulate && (
          <Button
            size="small"
            variant="primary"
            leadingVisual={isSimulating ? undefined : PlayIcon}
            onClick={onSimulate}
            disabled={isSimulating}
            style={{
              fontWeight: 600,
              height: 28,
              padding: "0 10px",
              borderRadius: 8,
              background: isSimulating
                ? "var(--color-neutral-muted, var(--ms-text-3, #4b5563))"
                : "var(--ms-brand, #0e7490)",
              borderColor: isSimulating ? "transparent" : "var(--ms-brand-active, #155e75)",
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              flexShrink: 0,
              transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            title={isSimulating ? "Simulation running…" : `Run Simulation (${isMac ? "⌘↵" : "F5"})`}
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span>Run</span>
                <kbd
                  className="nav-hide-xl"
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    opacity: 0.85,
                    padding: "1px 4px",
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.18)",
                    lineHeight: "12px",
                  }}
                >
                  {isMac ? "⌘↵" : "F5"}
                </kbd>
              </span>
            )}
          </Button>
        )}

        {/* Publish / Account */}
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Button
              size="small"
              variant="default"
              leadingVisual={ZapIcon}
              onClick={onPublishToFeed}
              className="nav-icon-only-xl"
              style={{ height: 28, borderRadius: 8, fontWeight: 600 }}
            >
              {effectivePublishLabel}
            </Button>
            <ActionMenu>
              <ActionMenu.Button
                size="small"
                variant="invisible"
                style={{ padding: "0 4px", minWidth: 28, height: 28, borderRadius: 8 }}
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
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Link to="/login" style={{ textDecoration: "none" }} className="nav-hide-lg">
              <Button size="small" variant="invisible" style={{ height: 28, borderRadius: 8 }}>
                Sign In
              </Button>
            </Link>
            <Link to="/signup" style={{ textDecoration: "none" }}>
              <Button
                size="small"
                variant="default"
                style={{
                  height: 28,
                  borderRadius: 8,
                  fontWeight: 600,
                }}
              >
                Sign Up
              </Button>
            </Link>
          </div>
        )}
      </NavRight>
    </NavbarContainer>
  );
};
