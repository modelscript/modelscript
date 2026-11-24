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
import { Breadcrumbs, IconButton, SegmentedControl } from "@primer/react";
import React from "react";
import styled from "styled-components";
import type { MorselLanguageInfo } from "../constants";
import { LanguageToolbarButtons } from "./LanguageToolbarButtons";

const ViewTabsWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;

  ul[data-size="small"] {
    background: var(--bgColor-inset, var(--ms-bg-inset, #f1f5f9));
    border: 1px solid var(--borderColor-muted, var(--ms-divider));
    border-radius: 10px;
    padding: 2px;
    gap: 2px;
    height: 30px;
    box-sizing: border-box;
  }

  li {
    margin: 0 !important;
  }

  li::after {
    display: none !important;
  }

  ul[data-size="small"] button,
  li button {
    border: 1px solid transparent !important;
    outline: none !important;
    border-radius: 8px !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease !important;
    height: 100% !important;
    padding: 0 10px !important;
    box-sizing: border-box !important;
  }

  ul[data-size="small"] button span,
  ul[data-size="small"] button [class*="Content"],
  ul[data-size="small"] button [class*="Content"] * {
    border: none !important;
    border-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }

  ul[data-size="small"] button [class*="Content"] {
    padding: 0 !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 5px !important;
  }

  /* Primer marks the selected segment with aria-pressed (older versions used aria-current). */
  button[aria-pressed="true"],
  button[aria-current="true"] {
    background-color: var(--ms-bg-elv, var(--bgColor-default, #ffffff)) !important;
    color: var(--fgColor-default, var(--ms-text-1)) !important;
    font-weight: 600 !important;
    border: 1px solid var(--ms-border, rgba(15, 23, 42, 0.12)) !important;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08) !important;
  }

  button[aria-pressed="true"] svg,
  button[aria-current="true"] svg {
    color: var(--ms-brand, #0891b2) !important;
    fill: var(--ms-brand, #0891b2) !important;
  }

  button:not([aria-pressed="true"]):not([aria-current="true"]):hover {
    background-color: color-mix(in srgb, var(--bgColor-default, #ffffff) 60%, transparent) !important;
    color: var(--fgColor-default, var(--ms-text-1)) !important;
  }

  @media (max-width: 960px) {
    ul[data-size="small"] button,
    li button {
      padding: 0 8px !important;
    }
  }
`;

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

export interface MorselViewSubHeaderProps {
  activeLangInfo: MorselLanguageInfo;
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

export const MorselViewSubHeader: React.FC<MorselViewSubHeaderProps> = ({
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
                window.dispatchEvent(new CustomEvent("morsel:sidebar-changed", { detail: { open: true } }));
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
              leadingVisual={tab.icon}
              title={tab.title}
              aria-label={tab.label}
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
