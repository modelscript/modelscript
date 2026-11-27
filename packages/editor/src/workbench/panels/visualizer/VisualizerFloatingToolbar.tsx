// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import {
  FlowchartIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  type Icon,
} from "@primer/octicons-react";
import { Button, IconButton, SegmentedControl } from "@primer/react";
import React from "react";
import type { Translations } from "../../util/i18n";

export interface VisualizerCenterTab {
  id: "diagram" | "simulation" | "3d" | "inspector";
  label: string;
  icon: Icon;
}

export interface VisualizerPaletteCategory {
  id: string;
  label: string;
  items: Array<{
    type?: string;
    label: string;
    snippet?: string;
    className?: string;
    iconSvg?: string;
    description?: string;
  }>;
}

export interface VisualizerStencilItem {
  label: string;
  snippet: string;
  className?: string;
}

export interface VisualizerFloatingToolbarProps {
  colorMode: "dark" | "light";
  isNarrow: boolean;
  isAnsatzEditorRoute: boolean;
  nestedModelsCount: number;
  dialect: string;
  activeLangInfo: {
    label?: string | undefined;
    supportsDiagram?: boolean | undefined;
    diagramTypes?: Array<{ id: string; label: string }> | undefined;
  };
  effectiveDiagramType: string;
  setDiagramType?: (diagramType: string) => void;
  treeVisible?: boolean;
  setTreeVisible?: React.Dispatch<React.SetStateAction<boolean>>;
  translations: Translations;
  centerViewTabs: VisualizerCenterTab[];
  showVrRotunda: boolean;
  setShowVrRotunda: (next: boolean) => void;
  toggleVrRotunda: () => void;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showCadView: boolean;
  setShowCadView: (v: boolean) => void;
  showAnalysisView: boolean;
  setShowAnalysisView: (v: boolean) => void;
  showPalette: boolean;
  setShowPalette: React.Dispatch<React.SetStateAction<boolean>>;
  lspPaletteCategories: VisualizerPaletteCategory[];
  activePaletteCategory: string;
  setActivePaletteCategory: (id: string) => void;
  stencils: VisualizerStencilItem[];
  onInsertStencilSnippet?: (snippet: string, className?: string) => void;
  onOpenComponentWizard: () => void;
  cadComponentsCount: number;
  animationMode: "idle" | "playing" | "paused" | "stopped" | "live";
  animationControllerRef: React.MutableRefObject<AnimationController | null>;
  onAutoLayout?: () => void;
}

export const VisualizerFloatingToolbar: React.FC<VisualizerFloatingToolbarProps> = ({
  colorMode,
  isNarrow,
  isAnsatzEditorRoute,
  nestedModelsCount,
  dialect,
  activeLangInfo,
  effectiveDiagramType,
  setDiagramType,
  treeVisible,
  setTreeVisible,
  translations,
  centerViewTabs,
  showVrRotunda,
  setShowVrRotunda,
  toggleVrRotunda,
  showResultsView,
  setShowResultsView,
  showCadView,
  setShowCadView,
  showAnalysisView,
  setShowAnalysisView,
  showPalette,
  setShowPalette,
  lspPaletteCategories,
  activePaletteCategory,
  setActivePaletteCategory,
  stencils,
  onInsertStencilSnippet,
  onOpenComponentWizard,
  cadComponentsCount,
  animationMode,
  animationControllerRef,
  onAutoLayout,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        top: nestedModelsCount > 1 ? "48px" : "12px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "max-content",
        maxWidth: "calc(100% - 24px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        zIndex: 100,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: 6,
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: isNarrow ? "4px 8px" : "6px 10px",
          borderRadius: 12,
          backgroundColor: "var(--ms-surface-glass)",
          backdropFilter: "blur(12px)",
          boxShadow:
            colorMode === "dark"
              ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))"
              : "0 4px 24px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))",
        }}
      >
        {isAnsatzEditorRoute && !isNarrow && setTreeVisible && (
          <>
            <IconButton
              icon={treeVisible ? SidebarExpandIcon : SidebarCollapseIcon}
              size="small"
              variant="invisible"
              aria-label={translations.toggleTree}
              title={translations.toggleTree}
              onClick={() => setTreeVisible((prev) => !prev)}
              style={
                treeVisible
                  ? {
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
                      borderRadius: 6,
                    }
                  : {}
              }
            />
            <div style={{ width: 1, height: 18, backgroundColor: "var(--ms-border, var(--color-border-default))" }} />
          </>
        )}

        {!isNarrow && (
          <SegmentedControl
            aria-label="Center Pane View"
            size="small"
            variant="default"
            onChange={(i) => {
              const targetTab = centerViewTabs[i];
              if (!targetTab) return;
              setShowVrRotunda(false);
              if (targetTab.id === "diagram") {
                setShowResultsView(false);
                setShowCadView(false);
                setShowAnalysisView(false);
              } else if (targetTab.id === "simulation") {
                setShowResultsView(true);
                setShowCadView(false);
                setShowAnalysisView(false);
              } else if (targetTab.id === "3d") {
                setShowResultsView(false);
                setShowCadView(true);
                setShowAnalysisView(false);
              } else if (targetTab.id === "inspector") {
                setShowResultsView(false);
                setShowCadView(false);
                setShowAnalysisView(true);
              }
            }}
          >
            {centerViewTabs.map((tab) => {
              const isSelected =
                !showVrRotunda &&
                (tab.id === "diagram"
                  ? !showResultsView && !showCadView && !showAnalysisView
                  : tab.id === "simulation"
                    ? showResultsView && !showAnalysisView
                    : tab.id === "3d"
                      ? showCadView && !showAnalysisView
                      : showAnalysisView);
              return (
                <SegmentedControl.Button key={tab.id} selected={isSelected} leadingVisual={tab.icon}>
                  {tab.label}
                </SegmentedControl.Button>
              );
            })}
          </SegmentedControl>
        )}

        {!showVrRotunda &&
          !showResultsView &&
          !showCadView &&
          !showAnalysisView &&
          activeLangInfo.supportsDiagram &&
          activeLangInfo.diagramTypes &&
          activeLangInfo.diagramTypes.length > 1 &&
          setDiagramType && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: 2,
                borderRadius: 8,
                backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
              }}
            >
              {activeLangInfo.diagramTypes.map((dt) => {
                const isSelected = effectiveDiagramType === dt.id;
                return (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => setDiagramType(dt.id)}
                    style={{
                      border: "none",
                      borderRadius: 6,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: isSelected ? 600 : 400,
                      cursor: "pointer",
                      backgroundColor: isSelected
                        ? "var(--ms-surface-hover, rgba(125, 125, 125, 0.14))"
                        : "transparent",
                      color: isSelected
                        ? "var(--ms-brand, var(--color-accent-fg))"
                        : "var(--ms-text-2, var(--color-fg-muted))",
                    }}
                  >
                    {dt.label}
                  </button>
                );
              })}
            </div>
          )}

        {!showVrRotunda && !showResultsView && !showCadView && !showAnalysisView && (
          <button
            type="button"
            onClick={() => setShowPalette((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 999,
              border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 40%, transparent)",
              background: showPalette ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
              color: colorMode === "dark" ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            title="Open interactive element & stencil palette"
          >
            <PlusIcon size={12} />
            <span>Add Element</span>
          </button>
        )}

        {cadComponentsCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowVrRotunda(false);
              setShowResultsView(false);
              setShowAnalysisView(false);
              setShowCadView(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 20,
              border: "1px solid rgba(6, 182, 212, 0.4)",
              background: showCadView && !showVrRotunda ? "rgba(6, 182, 212, 0.2)" : "rgba(6, 182, 212, 0.08)",
              color: "#06b6d4",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            title="Digital Thread CAD binding active. Click to view 3D assembly"
          >
            <span style={{ fontSize: 13 }}>🧵</span>
            <span>{cadComponentsCount} CAD Twins</span>
          </button>
        )}

        <button
          type="button"
          data-testid="ansatz-vr-rotunda-toggle"
          onClick={toggleVrRotunda}
          aria-pressed={showVrRotunda}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 999,
            border: showVrRotunda ? "1px solid rgba(129, 140, 248, 0.85)" : "1px solid rgba(99, 102, 241, 0.45)",
            background: showVrRotunda
              ? "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)"
              : colorMode === "dark"
                ? "linear-gradient(135deg, rgba(99, 102, 241, 0.24) 0%, rgba(6, 182, 212, 0.18) 100%)"
                : "linear-gradient(135deg, rgba(99, 102, 241, 0.14) 0%, rgba(6, 182, 212, 0.12) 100%)",
            color: showVrRotunda ? "#ffffff" : colorMode === "dark" ? "#c7d2fe" : "#4338ca",
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: showVrRotunda ? "0 4px 14px rgba(99, 102, 241, 0.35)" : "none",
            transition: "all 0.15s ease",
          }}
          title="Open in Engineering VR Rotunda (45° Drafting Podium, 3D Plinth, CAE Overlays & WebXR VR/AR)"
        >
          <span aria-hidden="true" style={{ fontSize: 12 }}>
            🥽
          </span>
          <span>VR Rotunda</span>
        </button>

        {showCadView && !showVrRotunda && animationControllerRef.current?.hasData && (
          <Button
            variant="primary"
            size="small"
            leadingVisual={animationMode === "playing" ? PauseIcon : PlayIcon}
            onClick={() => {
              const ctrl = animationControllerRef.current;
              if (!ctrl) return;
              if (ctrl.mode === "playing") {
                ctrl.pause();
              } else {
                ctrl.play();
              }
            }}
            style={{
              marginLeft: 8,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {animationMode === "playing" ? "Pause" : "Animate"}
          </Button>
        )}

        {isAnsatzEditorRoute && !isNarrow && onAutoLayout && activeLangInfo.supportsDiagram && (
          <>
            <div style={{ width: 1, height: 18, backgroundColor: "var(--ms-border, var(--color-border-default))" }} />
            <IconButton
              icon={FlowchartIcon}
              size="small"
              variant="invisible"
              aria-label={translations.autoLayout}
              title={translations.autoLayout}
              onClick={onAutoLayout}
            />
          </>
        )}
      </div>

      {/* Collapsible Stencil Palette Bar */}
      {showPalette && !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 10,
            backgroundColor: "var(--ms-surface-glass)",
            backdropFilter: "blur(12px)",
            boxShadow:
              colorMode === "dark"
                ? "0 4px 16px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))"
                : "0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--ms-text-2, var(--color-fg-muted))",
              marginRight: 4,
            }}
          >
            {activeLangInfo.label} Palette:
          </span>
          {lspPaletteCategories.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginRight: 6 }}>
                {dialect === "pscad" && (
                  <button
                    type="button"
                    onClick={onOpenComponentWizard}
                    style={{
                      border: "1px solid var(--ms-brand, #0891b2)",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      backgroundColor: "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
                      color: "var(--ms-brand, #0891b2)",
                    }}
                    title="Open visual <Graphics>/<form> Component Definition Wizard"
                  >
                    + New Defn
                  </button>
                )}
                {lspPaletteCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActivePaletteCategory(cat.id)}
                    style={{
                      border: "1px solid var(--ms-divider, rgba(125,125,125,0.25))",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      backgroundColor:
                        activePaletteCategory === cat.id
                          ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.2))"
                          : "transparent",
                      color:
                        activePaletteCategory === cat.id
                          ? "var(--ms-brand, #0891b2)"
                          : "var(--ms-text-2, var(--color-fg-muted))",
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {(
                lspPaletteCategories.find((c) => c.id === activePaletteCategory)?.items ??
                lspPaletteCategories[0]?.items ??
                []
              ).map((item) => (
                <button
                  key={item.type || item.className || item.label}
                  type="button"
                  onClick={() => {
                    const defName = item.type || item.className || item.label;
                    const snippet =
                      item.snippet ||
                      (dialect === "pscad"
                        ? `    <User cmp="${defName}" name="${item.label}" id="${Date.now()}" x="200" y="200" />\n`
                        : "");
                    onInsertStencilSnippet?.(snippet, defName);
                  }}
                  style={{
                    border:
                      colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                    color: "var(--ms-text-1, var(--color-fg-default))",
                  }}
                  title={`Insert ${item.label} (${item.type || "component"})`}
                >
                  + {item.label}
                </button>
              ))}
            </>
          ) : (
            stencils.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  onInsertStencilSnippet?.(item.snippet, item.className);
                }}
                style={{
                  border:
                    colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                  color: "var(--ms-text-1, var(--color-fg-default))",
                }}
                title={`Insert ${item.label} into ${activeLangInfo.label} document`}
              >
                + {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
