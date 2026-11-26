// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  ColumnsIcon,
  GraphIcon,
  ImageIcon,
  RowsIcon,
  SidebarExpandIcon,
  StackIcon,
  TableIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Breadcrumbs, IconButton } from "@primer/react";
import React from "react";
import styled from "styled-components";
import type { AnsatzLanguageInfo } from "../constants";
import { LanguageToolbarButtons } from "./LanguageToolbarButtons";

const ViewTabsWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const TabTrack = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 3px;
  box-sizing: border-box;
  border-radius: 11px;
  background: var(--bgColor-inset, var(--ms-bg-inset, rgba(15, 23, 42, 0.05)));
  border: 1px solid var(--borderColor-muted, var(--ms-divider, rgba(15, 23, 42, 0.08)));
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.05);
`;

const TabIndicator = styled.span`
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: 8px;
  pointer-events: none;
  background: var(--ms-bg-elv, var(--bgColor-default, #ffffff));
  border: 1px solid var(--ms-border, rgba(15, 23, 42, 0.1));
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.12),
    0 0 0 1px color-mix(in srgb, var(--ms-brand, #0891b2) 8%, transparent);
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    width 260ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 120ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const TabButton = styled.button`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 11px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--fgColor-muted, var(--ms-text-2));
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    color 160ms ease,
    background-color 160ms ease;

  svg {
    flex-shrink: 0;
    opacity: 0.75;
    transition:
      color 160ms ease,
      fill 160ms ease,
      opacity 160ms ease;
  }

  &:hover:not([aria-selected="true"]) {
    color: var(--fgColor-default, var(--ms-text-1));
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.05));
  }

  &:active {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #0891b2);
    outline-offset: 1px;
  }

  &[aria-selected="true"] {
    color: var(--fgColor-default, var(--ms-text-1));
    font-weight: 600;
  }

  &[aria-selected="true"] svg {
    color: var(--ms-brand, #0891b2);
    fill: var(--ms-brand, #0891b2);
    opacity: 1;
  }

  @media (max-width: 960px) {
    padding: 0 8px;
    gap: 0;

    /* Collapse to icon-only on narrow screens, keep the active tab labelled. */
    span.tab-label {
      display: none;
    }
    &[aria-selected="true"] span.tab-label {
      display: inline;
      margin-left: 6px;
    }
  }
`;

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

const SplitToggleButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand, #0891b2)" : "var(--borderColor-muted, var(--ms-divider))")};
  background-color: ${(p) =>
    p.$active
      ? "color-mix(in srgb, var(--ms-brand, #0891b2) 12%, var(--bgColor-default, #ffffff))"
      : "var(--bgColor-default, var(--ms-bg, #ffffff))"};
  color: ${(p) => (p.$active ? "var(--ms-brand, #0891b2)" : "var(--fgColor-muted, var(--ms-text-2))")};
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: ${(p) =>
      p.$active
        ? "color-mix(in srgb, var(--ms-brand, #0891b2) 18%, var(--bgColor-default, #ffffff))"
        : "var(--ms-surface-hover, rgba(0, 0, 0, 0.04))"};
    color: ${(p) => (p.$active ? "var(--ms-brand, #0891b2)" : "var(--fgColor-default, var(--ms-text-1))")};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

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
  isCodeView: boolean;
  isSplitActive: boolean;
  canSplit?: boolean;
  splitOrientation?: "columns" | "rows";
  onSelectView: (target: "diagram" | "3d" | "simulation" | "inspector" | "code") => void;
  onToggleSplit?: () => void;
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
  isCodeView,
  isSplitActive,
  canSplit = true,
  splitOrientation = "columns",
  onSelectView,
  onToggleSplit,
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
    id: "code",
    label: "Code",
    icon: CodeIcon,
    title: "Source code editor (⌥5)",
    onClick: () => onSelectView("code"),
  });

  const activeTabId: ViewTabId = isCodeView
    ? "code"
    : showAnalysisView
      ? "inspector"
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
          activeView={activeTabId}
          maxPrimary={activeTabId === "icon" ? 6 : 2}
        />

        <ViewTabList
          tabs={viewTabs}
          activeIndex={selectedIndex !== -1 ? selectedIndex : 0}
          ariaLabel="Workbench View"
        />

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
