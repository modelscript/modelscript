// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  BookmarkIcon,
  CodeIcon,
  ColumnsIcon,
  DownloadIcon,
  GraphIcon,
  ImageIcon,
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
import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../AuthContext";
import { MorselIcon } from "../../../components/icons";
import { getLanguageInfo } from "../../../components/morsel/constants";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { useTheme } from "../../../theme";
import { getExtensionForDialect } from "../../../util/editor-routing";
import { useVisiblePlaygroundLanguages, type HeroExample } from "../constants";
import {
  Badge,
  BrandLink,
  BrandTierBadge,
  NavCenter,
  NavDivider,
  NavLeft,
  NavRight,
  NavText,
  PlaygroundNavbar as NavbarContainer,
  SplitToggleButton,
} from "../styles";

export interface PlaygroundNavbarProps {
  fromArtifactParam: string | null;
  currentTitle: string;
  currentLang?: string;
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

export const PlaygroundNavbar: React.FC<PlaygroundNavbarProps> = ({
  fromArtifactParam,
  currentTitle: _currentTitle,
  currentLang = "modelica",
  currentView = "diagram",
  diagramType = "diagram",
  isSplit = false,
  canSplit = true,
  splitOrientation = "horizontal",
  onToggleSplit,
  isDirty = false,
  isSimulating = false,
  runStatus,
  onOpenProblems,
  publishLabel,
  isSidebarOpen,
  onToggleSidebar,
  onTitleChange: _onTitleChange,
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
  const visiblePlaygroundLanguages = useVisiblePlaygroundLanguages();
  const customLogoSrc = theme === "dark" ? branding.brandLogoDarkUrl || branding.brandLogoUrl : branding.brandLogoUrl;

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);

  const currentLangOption = visiblePlaygroundLanguages.find((l) => l.id === currentLang) || {
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
    icon: any;
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
            style={{ height: 30, width: 30, borderRadius: 6, flexShrink: 0 }}
          />
        )}
        <BrandLink
          href={onBrandClick ? "#new-model" : branding.docsBaseUrl || "https://modelscript.org"}
          target={onBrandClick ? undefined : "_blank"}
          rel={onBrandClick ? undefined : "noopener noreferrer"}
          title={onBrandClick ? "New workspace & New Model" : "Morsel"}
          aria-label="Morsel"
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
            alt="Morsel"
            height={22}
            style={{ height: "22px", width: "auto", flexShrink: 0, display: "block" }}
            data-testid="morsel-brand-icon"
          />
          {Boolean(customLogoSrc) && (
            <Badge data-testid="playground-brand-badge" title="Morsel" className="nav-hide-xl">
              <MorselIcon size={13} style={{ marginRight: "3px" }} />
              <span>Morsel</span>
            </Badge>
          )}
          <BrandTierBadge data-testid="morsel-brand-beta-badge">
            {branding.instanceBadge?.trim() || "Beta"}
          </BrandTierBadge>
        </BrandLink>

        <NavDivider />

        {fromArtifactParam && (
          <Link
            to={`/morsel?fromArtifact=${fromArtifactParam}`}
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
            title={`Forked from Morsel #${fromArtifactParam}`}
          >
            <RepoForkedIcon size={12} /> Fork of #{fromArtifactParam}
          </Link>
        )}

        {/* Static Colored Language Label */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0, flexShrink: 1 }}>
          <span
            data-testid="morsel-language-badge"
            title={`Active language: ${currentLangOption.label} (${currentLangOption.ext})`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              padding: "0 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ms-brand, #0891b2)",
              background: "var(--ms-brand-soft, rgba(8, 145, 178, 0.10))",
              border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 22%, transparent)",
              whiteSpace: "nowrap",
              userSelect: "none",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "var(--ms-brand, #0891b2)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentLangOption.label}
            </span>
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
                boxShadow: "0 0 4px var(--ms-warning, #d97706)",
                flexShrink: 0,
              }}
            />
          )}
        </div>
      </NavLeft>

      {onViewChange && (
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
              <SegmentedControl.IconButton
                key={tab.id}
                selected={idx === (selectedIndex !== -1 ? selectedIndex : 0)}
                icon={tab.icon}
                aria-label={tab.label}
                description={tab.title}
                onClick={tab.onClick}
              />
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
              <span>Split</span>
            </SplitToggleButton>
          )}
        </NavCenter>
      )}

      <NavRight>
        {/* Compilation / Solver Error Status Pill */}
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
              borderRadius: 6,
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
              height: 30,
              padding: "0 13px",
              borderRadius: "var(--ms-radius-pill, 999px)",
              background: isSimulating
                ? "var(--color-neutral-muted, var(--ms-text-3, #4b5563))"
                : "linear-gradient(180deg, var(--ms-accent-teal, #14b8a6) 0%, var(--ms-brand, #0e7490) 100%)",
              borderColor: isSimulating ? "transparent" : "var(--ms-brand-active, #155e75)",
              boxShadow: isSimulating
                ? "0 0 12px var(--ms-glow-cyan, rgba(6, 182, 212, 0.45))"
                : "0 2px 8px rgba(14, 116, 144, 0.35)",
              color: "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
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
                  className="nav-hide-lg"
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    opacity: 0.85,
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.2)",
                    lineHeight: "12px",
                  }}
                >
                  {isMac ? "⌘↵" : "F5"}
                </kbd>
              </span>
            )}
          </Button>
        )}

        {/* Global Search / Command Palette */}
        <IconButton
          icon={SearchIcon}
          size="small"
          variant="invisible"
          onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
          aria-label={`Search models & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
          title={`Search models, packages & commands (${isMac ? "⌘K" : "Ctrl+K"})`}
          style={{ height: 30, width: 30, borderRadius: 6 }}
        />

        {/* Dark / Light Mode Toggle */}
        <IconButton
          icon={theme === "dark" ? SunIcon : MoonIcon}
          size="small"
          variant="invisible"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          style={{ height: 30, width: 30, borderRadius: 6 }}
        />

        {/* Promote to Multi-File VS Code Workbench */}
        {onOpenInVsCode && (
          <IconButton
            icon={TerminalIcon}
            size="small"
            variant="invisible"
            onClick={onOpenInVsCode}
            aria-label="Open in VS Code Workbench"
            title="Promote this model to the full multi-file VS Code Workbench"
            className="nav-hide-sm"
            style={{ height: 30, width: 30, borderRadius: 6 }}
          />
        )}

        {/* Unified Share & Export Menu */}
        <ActionMenu>
          <ActionMenu.Button
            size="small"
            leadingVisual={ShareIcon}
            className="nav-icon-only-xl"
            style={{ height: 30, borderRadius: 6 }}
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

        {/* Publish / Save Edit / Reply / Fork to Feed & Ansatz Profile Menu */}
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Button
              size="small"
              variant="default"
              leadingVisual={ZapIcon}
              onClick={onPublishToFeed}
              style={{ height: 30, borderRadius: 6, fontWeight: 600 }}
            >
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
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Link to="/login" style={{ textDecoration: "none" }} className="nav-hide-lg">
              <Button size="small" variant="invisible" style={{ height: 30, borderRadius: 6 }}>
                Sign In
              </Button>
            </Link>
            <Link to="/signup" style={{ textDecoration: "none" }}>
              <Button
                size="small"
                variant="default"
                style={{
                  height: 30,
                  borderRadius: 8,
                  fontWeight: 600,
                  backgroundColor: "var(--fgColor-default, #0f172a)",
                  color: "var(--bgColor-default, #ffffff)",
                  borderColor: "transparent",
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
