// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  CodeIcon,
  ColumnsIcon,
  GraphIcon,
  ImageIcon,
  RowsIcon,
  SidebarExpandIcon,
  SparkleFillIcon,
  StackIcon,
  TableIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Breadcrumbs, IconButton } from "@primer/react";
import React from "react";
import type { AnsatzLanguageInfo } from "../constants";
import { LanguageToolbarButtons } from "./LanguageToolbarButtons";

const ViewTabsWrapper: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, ...rest }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexShrink: 0,
      ...style,
    }}
    {...rest}
  />
);

const TabTrack = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function TabTrack(
  { style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        height: "32px",
        padding: "3px",
        boxSizing: "border-box",
        borderRadius: "11px",
        background: "var(--bgColor-inset, var(--ms-bg-inset, rgba(15, 23, 42, 0.05)))",
        border: "1px solid var(--borderColor-muted, var(--ms-divider, rgba(15, 23, 42, 0.08)))",
        boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.05)",
        ...style,
      }}
      {...rest}
    />
  );
});

const TabIndicator: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...rest }) => (
  <span className={className ? `ms-sub-header-tab-indicator ${className}` : "ms-sub-header-tab-indicator"} {...rest} />
);

const TabButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function TabButton(
  { className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={className ? `ms-sub-header-tab-btn ${className}` : "ms-sub-header-tab-btn"}
      {...rest}
    />
  );
});

interface ViewTabListProps {
  tabs: Array<{ id: string; label: string; icon: React.ElementType; title: string; onClick: () => void }>;
  activeIndex: number;
  ariaLabel: string;
}

/**
 * Accessible tablist with a sliding selection indicator and roving-tabindex
 * arrow-key navigation (Left/Right/Home/End).
 */
const ViewTabList: React.FC<ViewTabListProps> = ({ tabs, activeIndex, ariaLabel }) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [indicator, setIndicator] = React.useState<{ x: number; w: number } | null>(null);

  const measure = React.useCallback(() => {
    const btn = buttonRefs.current[activeIndex];
    if (btn) setIndicator({ x: btn.offsetLeft, w: btn.offsetWidth });
  }, [activeIndex]);

  React.useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    buttonRefs.current.forEach((b) => b && ro.observe(b));
    return () => ro.disconnect();
  }, [measure, tabs.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = tabs.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = activeIndex >= last ? 0 : activeIndex + 1;
    else if (e.key === "ArrowLeft") next = activeIndex <= 0 ? last : activeIndex - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    tabs[next]?.onClick();
    buttonRefs.current[next]?.focus();
  };

  return (
    <TabTrack ref={trackRef} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {indicator && (
        <TabIndicator aria-hidden style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }} />
      )}
      {tabs.map((tab, idx) => {
        const Icon = tab.icon;
        const selected = idx === activeIndex;
        return (
          <TabButton
            key={tab.id}
            ref={(el) => {
              buttonRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.label}
            tabIndex={selected ? 0 : -1}
            title={tab.title}
            onClick={tab.onClick}
          >
            <Icon size={14} />
            <span className="tab-label">{tab.label}</span>
          </TabButton>
        );
      })}
    </TabTrack>
  );
};

interface SplitToggleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  $active?: boolean | undefined;
}

const SplitToggleButton: React.FC<SplitToggleButtonProps> = ({ $active, className, ...rest }) => (
  <button
    data-active={$active ? "true" : "false"}
    className={className ? `ms-sub-header-split-btn ${className}` : "ms-sub-header-split-btn"}
    {...rest}
  />
);

export interface AnsatzViewSubHeaderProps {
  activeLangInfo: AnsatzLanguageInfo;
  selectedTreeClassName?: string | null;
  treeVisible?: boolean;
  setTreeVisible?: React.Dispatch<React.SetStateAction<boolean>>;
  toggleTreeLabel?: string;
  drillDownPath?: string[];
  onDrillRoot?: () => void;
  onDrillUp?: (index: number) => void;
  effectiveDiagramType: string;
  setDiagramType?: (type: string) => void;
  supports3dView: boolean;
  showResultsView: boolean;
  showCadView: boolean;
  showAnalysisView: boolean;
  isStudioView?: boolean;
  isCodeView: boolean;
  isSplitActive: boolean;
  canSplit?: boolean;
  splitOrientation?: "columns" | "rows";
  onSelectView: (target: "diagram" | "3d" | "simulation" | "inspector" | "studio" | "code") => void;
  onToggleSplit?: () => void;
  showHypergraphOverlay?: boolean;
  onToggleHypergraphOverlay?: () => void;
  isAiOpen?: boolean;
  onToggleAi?: () => void;
  floating?: boolean;
  leftOffset?: number;
  colorMode?: "dark" | "light";
}

export const AnsatzViewSubHeader: React.FC<AnsatzViewSubHeaderProps> = ({
  activeLangInfo,
  selectedTreeClassName,
  treeVisible,
  setTreeVisible,
  toggleTreeLabel,
  drillDownPath,
  onDrillRoot,
  onDrillUp,
  effectiveDiagramType,
  setDiagramType,
  supports3dView,
  showResultsView,
  showCadView,
  showAnalysisView,
  isStudioView = false,
  isCodeView,
  isSplitActive,
  canSplit = true,
  splitOrientation = "columns",
  onSelectView,
  onToggleSplit,
  showHypergraphOverlay = false,
  onToggleHypergraphOverlay,
  isAiOpen = false,
  onToggleAi,
  floating = false,
  leftOffset = 12,
  colorMode = "light",
}) => {
  const supportsDiagram = activeLangInfo.supportsDiagram ?? true;
  const supportsSimulation = activeLangInfo.supportsSimulation ?? true;
  const hasIconMode = Boolean(supportsDiagram && activeLangInfo.diagramTypes?.some((dt) => dt.id === "icon"));
  const inspectorLabel =
    activeLangInfo.id === "owl2"
      ? "Reasoner"
      : activeLangInfo.id === "sysml2"
        ? "Requirements"
        : activeLangInfo.id === "csv"
          ? "Table"
          : "Inspector";

  type ViewTabId = "diagram" | "icon" | "3d" | "simulation" | "inspector" | "studio" | "code";
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
        setDiagramType?.("diagram");
        onSelectView("diagram");
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
        setDiagramType?.("icon");
        onSelectView("diagram");
      },
    });
  }
  if (supports3dView) {
    viewTabs.push({
      id: "3d",
      label: "3D",
      icon: StackIcon,
      title: "3D CAD & multibody animation (⌥2)",
      onClick: () => onSelectView("3d"),
    });
  }
  if (supportsSimulation) {
    viewTabs.push({
      id: "simulation",
      label: "Simulation",
      icon: GraphIcon,
      title: "Simulation plots & variables (⌥3)",
      onClick: () => onSelectView("simulation"),
    });
  }
  viewTabs.push({
    id: "inspector",
    label: inspectorLabel,
    icon: TableIcon,
    title: `${inspectorLabel} table & properties (⌥4)`,
    onClick: () => onSelectView("inspector"),
  });
  viewTabs.push({
    id: "studio",
    label: "AI Studio",
    icon: BeakerIcon,
    title: "AI Training, Zonotope Certification, Annotation & DiskANN Studio (⌥7)",
    onClick: () => onSelectView("studio"),
  });
  viewTabs.push({
    id: "code",
    label: "Code",
    icon: CodeIcon,
    title: "Source code editor (⌥5)",
    onClick: () => onSelectView("code"),
  });

  const activeTabId: ViewTabId = isCodeView
    ? "code"
    : showAnalysisView
      ? isStudioView
        ? "studio"
        : "inspector"
      : showCadView
        ? "3d"
        : showResultsView
          ? "simulation"
          : hasIconMode && effectiveDiagramType === "icon"
            ? "icon"
            : "diagram";

  const selectedIndex = viewTabs.findIndex((t) => t.id === activeTabId);
  const SplitIcon = splitOrientation === "rows" ? RowsIcon : ColumnsIcon;
  const splitTitle = !canSplit
    ? "Split view unavailable: window too small"
    : isCodeView
      ? "Split view is unavailable when Code tab is full"
      : isSplitActive
        ? "Close split view (⌥6)"
        : splitOrientation === "rows"
          ? "Split view: Code on top, selected view on bottom (⌥6)"
          : "Split view: Code on left, selected view on right (⌥6)";

  const floatingShadow =
    colorMode === "dark"
      ? "0 8px 28px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)"
      : "0 8px 28px rgba(15, 23, 42, 0.08), 0 1px 4px rgba(15, 23, 42, 0.05)";

  return (
    <div
      style={
        floating
          ? {
              position: "absolute",
              top: 72,
              left: leftOffset,
              right: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 12px",
              minHeight: 42,
              borderRadius: 14,
              border: "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))",
              backgroundColor: colorMode === "dark" ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.94)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              boxShadow: floatingShadow,
              gap: 8,
              flexShrink: 0,
              zIndex: 28,
            }
          : {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 12px",
              minHeight: 40,
              borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
              backgroundColor: "var(--bgColor-muted, var(--ms-bg-alt))",
              gap: 8,
              flexShrink: 0,
              zIndex: 10,
            }
      }
    >
      {/* Left: Sidebar Expand & Breadcrumbs / Active Class Name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
        {!treeVisible && setTreeVisible && (
          <IconButton
            icon={SidebarExpandIcon}
            size="small"
            variant="invisible"
            aria-label={toggleTreeLabel || "Expand Libraries"}
            title={toggleTreeLabel || "Expand Libraries"}
            onClick={() => {
              setTreeVisible(true);
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("ansatz:sidebar-changed", { detail: { open: true } }));
              }
            }}
            style={{ borderRadius: 8 }}
          />
        )}
        {drillDownPath && drillDownPath.length > 0 && !isCodeView ? (
          <Breadcrumbs>
            <Breadcrumbs.Item
              href="#root"
              onClick={(e) => {
                e.preventDefault();
                onDrillRoot?.();
              }}
            >
              Root
            </Breadcrumbs.Item>
            {drillDownPath.map((seg, idx) => (
              <Breadcrumbs.Item
                key={`${seg}-${idx}`}
                href={`#${seg}`}
                selected={idx === drillDownPath.length - 1}
                onClick={(e) => {
                  e.preventDefault();
                  onDrillUp?.(idx);
                }}
              >
                {seg}
              </Breadcrumbs.Item>
            ))}
          </Breadcrumbs>
        ) : (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--fgColor-default, var(--ms-text-1))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={selectedTreeClassName || activeLangInfo.label || activeLangInfo.name}
            >
              {selectedTreeClassName || activeLangInfo.label || activeLangInfo.name}
            </span>
          </div>
        )}
      </div>

      {/* Right: Per-Language/View Toolbar Buttons + Unified View Tabs + Split */}
      <ViewTabsWrapper>
        <LanguageToolbarButtons
          languageId={activeLangInfo.id}
          activeView={activeTabId === "studio" ? "inspector" : activeTabId}
          maxPrimary={activeTabId === "icon" ? 6 : 2}
        />

        <ViewTabList
          tabs={viewTabs}
          activeIndex={selectedIndex !== -1 ? selectedIndex : 0}
          ariaLabel="Workbench View"
        />

        {onToggleHypergraphOverlay && (
          <SplitToggleButton
            type="button"
            role="button"
            aria-pressed={showHypergraphOverlay}
            aria-label="Toggle Zonotope & Hypergraph Annotation Overlay"
            $active={showHypergraphOverlay}
            onClick={onToggleHypergraphOverlay}
            title={
              showHypergraphOverlay
                ? "Hide Zonotope generator ribbon & hypergraph annotation overlay"
                : "Show Zonotope generator ribbon, brushes & hypergraph annotation overlay"
            }
          >
            <BeakerIcon size={14} />
            <span>Zonotope</span>
          </SplitToggleButton>
        )}

        {onToggleAi && (
          <SplitToggleButton
            type="button"
            role="button"
            aria-pressed={isAiOpen}
            aria-label="Toggle Ansatz AI Copilot"
            $active={isAiOpen}
            onClick={onToggleAi}
            title={isAiOpen ? "Hide Ansatz AI Copilot" : "Open Ansatz AI Copilot"}
          >
            <SparkleFillIcon size={14} />
            <span>AI</span>
          </SplitToggleButton>
        )}

        {onToggleSplit && (
          <SplitToggleButton
            type="button"
            role="button"
            aria-pressed={isSplitActive && !isCodeView && canSplit}
            aria-label={
              splitOrientation === "rows"
                ? "Split view (Code on top, visualizer on bottom)"
                : "Split view (Code on left, visualizer on right)"
            }
            disabled={isCodeView || !canSplit}
            $active={isSplitActive && !isCodeView && canSplit}
            onClick={onToggleSplit}
            title={splitTitle}
          >
            <SplitIcon size={14} />
            <span>Split</span>
          </SplitToggleButton>
        )}
      </ViewTabsWrapper>
    </div>
  );
};
