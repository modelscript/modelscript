// SPDX-License-Identifier: AGPL-3.0-or-later

import { FlowchartIcon, PlusIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";
import type { DiagramEditorHandle } from "../../Diagram";
import type { Translations } from "../../util/i18n";
import { AnsatzView } from "../types";

export interface DiagramCanvasOverlaysProps {
  supportsDiagram: boolean;
  hideCenterFloatingToolbar?: boolean | undefined;
  colorMode: "dark" | "light";
  showPalette: boolean;
  setShowPalette: React.Dispatch<React.SetStateAction<boolean>>;
  handleUndo: () => void;
  handleRedo: () => void;
  effectiveDiagramRef: React.RefObject<DiagramEditorHandle | null>;
  onAutoLayout?: (() => void) | undefined;
  translations: Translations;
  isFullScreenSplitCanvas: boolean;
  view: AnsatzView;
  splitRatio: number;
  isFloatingLayout: boolean;
  diagnosticsBottomOffset: number;
  selectedComponent: string | null;
  propertiesWidth: number;
  currentZoom: number;
  showZoomMenu: boolean;
  setShowZoomMenu: React.Dispatch<React.SetStateAction<boolean>>;
  zoomMenuRef: React.RefObject<HTMLDivElement | null>;
  showGridMenu: boolean;
  setShowGridMenu: React.Dispatch<React.SetStateAction<boolean>>;
  gridMenuRef: React.RefObject<HTMLDivElement | null>;
  gridMode: "doubleMesh" | "dot" | "mesh" | "none";
  handleGridModeChange: (mode: "doubleMesh" | "dot" | "mesh" | "none") => void;
  isSnapActive: boolean;
  handleSnapToggle: () => void;
  isMinimapActive: boolean;
  toggleMinimapView: () => void;
}

export const DiagramCanvasOverlays: React.FC<DiagramCanvasOverlaysProps> = ({
  supportsDiagram,
  hideCenterFloatingToolbar,
  colorMode,
  showPalette,
  setShowPalette,
  handleUndo,
  handleRedo,
  effectiveDiagramRef,
  onAutoLayout,
  translations,
  isFullScreenSplitCanvas,
  view,
  splitRatio,
  isFloatingLayout,
  diagnosticsBottomOffset,
  selectedComponent,
  propertiesWidth,
  currentZoom,
  showZoomMenu,
  setShowZoomMenu,
  zoomMenuRef,
  showGridMenu,
  setShowGridMenu,
  gridMenuRef,
  gridMode,
  handleGridModeChange,
  isSnapActive,
  handleSnapToggle,
  isMinimapActive,
  toggleMinimapView,
}) => {
  if (!supportsDiagram) return null;

  return (
    <>
      {/* Floating Command Island (Center-Bottom) */}
      {!hideCenterFloatingToolbar && (
        <div
          className="ansatz-command-island"
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 25,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            height: 36,
            padding: "0 6px",
            borderRadius: "var(--ms-radius-pill, 999px)",
            background:
              colorMode === "dark" ? "var(--ms-surface-glass, rgba(15, 23, 42, 0.85))" : "rgba(255, 255, 255, 0.94)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--ms-divider, rgba(255, 255, 255, 0.12))",
            boxShadow: "var(--ms-shadow-card, 0 8px 28px -4px rgba(0, 0, 0, 0.3))",
            userSelect: "none",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <button
            type="button"
            onClick={() => setShowPalette((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              padding: "0 10px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: "var(--ms-radius-pill, 999px)",
              border: showPalette
                ? "1px solid var(--ms-brand, #0891b2)"
                : "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 30%, transparent)",
              background: showPalette ? "var(--ms-brand, #0891b2)" : "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
              color: showPalette
                ? "#ffffff"
                : colorMode === "dark"
                  ? "var(--ms-link, #22d3ee)"
                  : "var(--ms-brand, #0e7490)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
              boxShadow: showPalette ? "0 0 12px var(--ms-glow-cyan, rgba(8, 145, 178, 0.4))" : "none",
            }}
            title="Open interactive element & stencil palette"
          >
            <PlusIcon size={13} />
            <span>Add Element</span>
          </button>

          <div
            style={{
              width: 1,
              height: 16,
              backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
              margin: "0 3px",
            }}
          />

          {/* Undo / Redo */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
            <button
              type="button"
              className="ansatz-toolbar-btn"
              onClick={handleUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              style={{
                border: "none",
                background: "transparent",
                borderRadius: "var(--ms-radius-pill, 999px)",
                width: 26,
                height: 26,
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ms-text-2, var(--color-fg-muted))",
                cursor: "pointer",
                transition: "background-color 0.12s ease, color 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 7h7a4 4 0 0 1 4 4v1" />
                <path d="M6 4L3 7l3 3" />
              </svg>
            </button>
            <button
              type="button"
              className="ansatz-toolbar-btn"
              onClick={handleRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Y / Cmd+Shift+Z)"
              style={{
                border: "none",
                background: "transparent",
                borderRadius: "var(--ms-radius-pill, 999px)",
                width: 26,
                height: 26,
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ms-text-2, var(--color-fg-muted))",
                cursor: "pointer",
                transition: "background-color 0.12s ease, color 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 7H6a4 4 0 0 0-4 4v1" />
                <path d="M10 4l3 3-3 3" />
              </svg>
            </button>
          </div>

          <div
            style={{
              width: 1,
              height: 16,
              backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
              margin: "0 3px",
            }}
          />

          {/* Rotate 90° */}
          <button
            type="button"
            className="ansatz-toolbar-btn"
            onClick={() => effectiveDiagramRef?.current?.rotateSelected(90)}
            aria-label="Rotate 90° Clockwise"
            title="Rotate 90° Clockwise (R / Shift+R)"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "var(--ms-radius-pill, 999px)",
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ms-text-2, var(--color-fg-muted))",
              cursor: "pointer",
              transition: "background-color 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 7A6 6 0 1 1 8 2h4" />
              <path d="M9 5l3-3-3-3" />
            </svg>
          </button>

          {/* Auto-Layout */}
          {onAutoLayout && (
            <IconButton
              icon={FlowchartIcon}
              size="small"
              variant="invisible"
              aria-label={translations.autoLayout || "Auto-layout diagram"}
              title={translations.autoLayout || "Auto-layout diagram"}
              onClick={onAutoLayout}
            />
          )}
        </div>
      )}

      {/* Floating Viewport HUD (Bottom-Right) */}
      <div
        className="ansatz-viewport-hud"
        style={{
          position: "absolute",
          bottom:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
              ? `calc(${(1 - splitRatio) * 100}% + 16px)`
              : isFloatingLayout
                ? Math.max(16, diagnosticsBottomOffset)
                : 16,
          right:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
              ? `calc(${(1 - splitRatio) * 100}% + ${selectedComponent ? propertiesWidth + 24 : 16}px)`
              : isFloatingLayout && selectedComponent
                ? propertiesWidth + 24
                : 16,
          zIndex: 25,
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          height: 36,
          padding: "0 6px",
          borderRadius: "var(--ms-radius-lg, 12px)",
          background:
            colorMode === "dark" ? "var(--ms-surface-glass, rgba(24, 24, 27, 0.94))" : "rgba(255, 255, 255, 0.96)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid var(--borderColor-muted, var(--ms-divider))",
          boxShadow: "var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.14))",
          userSelect: "none",
        }}
      >
        {/* Zoom Controls */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
          <button
            type="button"
            className="ansatz-toolbar-btn"
            onClick={() => effectiveDiagramRef?.current?.zoomOut()}
            aria-label="Zoom Out"
            title="Zoom Out (Ctrl+-)"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "var(--ms-radius-pill, 999px)",
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ms-text-2, var(--color-fg-muted))",
              cursor: "pointer",
              transition: "background-color 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l4 4" />
              <path d="M4.5 7h5" />
            </svg>
          </button>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="ansatz-toolbar-btn-text"
              onClick={() => setShowZoomMenu((v) => !v)}
              aria-label={`Zoom level: ${Math.round(currentZoom * 100)}%`}
              title="Zoom presets / Reset to 100% (Ctrl+0)"
              style={{
                border: "none",
                background: "transparent",
                borderRadius: 6,
                padding: "2px 6px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ms-text-1, var(--color-fg-default))",
                cursor: "pointer",
                minWidth: 46,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
                transition: "background-color 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span>{Math.round(currentZoom * 100)}%</span>
              <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.65 }}>
                <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
              </svg>
            </button>
            {showZoomMenu && (
              <div
                ref={zoomMenuRef}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  right: 0,
                  zIndex: 100,
                  minWidth: 140,
                  padding: 5,
                  borderRadius: 10,
                  border: "1px solid var(--borderColor-default, var(--ms-border))",
                  backgroundColor: "var(--overlay-bgColor, var(--ms-bg-elv))",
                  boxShadow:
                    colorMode === "dark" ? "0 12px 32px rgba(0, 0, 0, 0.45)" : "0 12px 32px rgba(0, 0, 0, 0.15)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {[
                  { label: "50%", scale: 0.5 },
                  { label: "75%", scale: 0.75 },
                  { label: "100%", scale: 1.0 },
                  { label: "125%", scale: 1.25 },
                  { label: "150%", scale: 1.5 },
                  { label: "200%", scale: 2.0 },
                ].map((preset) => {
                  const isCurrent = Math.round(currentZoom * 100) === Math.round(preset.scale * 100);
                  return (
                    <button
                      key={preset.scale}
                      type="button"
                      className="ansatz-menu-item"
                      onClick={() => {
                        effectiveDiagramRef?.current?.zoomTo(preset.scale);
                        setShowZoomMenu(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px",
                        fontSize: 11,
                        fontWeight: isCurrent ? 600 : 400,
                        color: isCurrent ? "var(--ms-brand, #0891b2)" : "var(--ms-text-1, var(--color-fg-default))",
                        background: "transparent",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                        transition: "background-color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <span>{preset.label}</span>
                      {isCurrent && <span>✓</span>}
                    </button>
                  );
                })}
                <div
                  style={{
                    height: 1,
                    backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                    margin: "3px 0",
                  }}
                />
                <button
                  type="button"
                  className="ansatz-menu-item"
                  onClick={() => {
                    effectiveDiagramRef?.current?.zoomToFit();
                    setShowZoomMenu(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "5px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ms-text-1, var(--color-fg-default))",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    transition: "background-color 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  Zoom to Fit (Shift+1)
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="ansatz-toolbar-btn"
            onClick={() => effectiveDiagramRef?.current?.zoomIn()}
            aria-label="Zoom In"
            title="Zoom In (Ctrl+=)"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "var(--ms-radius-pill, 999px)",
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ms-text-2, var(--color-fg-muted))",
              cursor: "pointer",
              transition: "background-color 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l4 4" />
              <path d="M7 4.5v5" />
              <path d="M4.5 7h5" />
            </svg>
          </button>

          <button
            type="button"
            className="ansatz-toolbar-btn"
            onClick={() => effectiveDiagramRef?.current?.zoomToFit()}
            aria-label="Zoom to Fit"
            title="Zoom to Fit (Shift+1)"
            style={{
              border: "none",
              background: "transparent",
              borderRadius: "var(--ms-radius-pill, 999px)",
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ms-text-2, var(--color-fg-muted))",
              cursor: "pointer",
              transition: "background-color 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
              e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 6V2h4" />
              <path d="M14 6V2h-4" />
              <path d="M2 10v4h4" />
              <path d="M14 10v4h-4" />
            </svg>
          </button>
        </div>

        <div
          style={{
            width: 1,
            height: 14,
            backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
            margin: "0 3px",
          }}
        />

        {/* Grid & Snapping Popover */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setShowGridMenu((v) => !v)}
            aria-label="Grid & Snapping Options"
            title="Grid & Snapping Options"
            style={{
              border: "none",
              background: showGridMenu ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.16))" : "transparent",
              borderRadius: "var(--ms-radius-pill, 999px)",
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: showGridMenu ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--color-fg-muted))",
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 5h14M1 11h14M5 1v14M11 1v14" />
            </svg>
          </button>
          {showGridMenu && (
            <div
              ref={gridMenuRef}
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                right: 0,
                zIndex: 100,
                minWidth: 175,
                padding: 6,
                borderRadius: 10,
                border: "1px solid var(--borderColor-default, var(--ms-border))",
                backgroundColor: "var(--overlay-bgColor, var(--ms-bg-elv))",
                boxShadow: colorMode === "dark" ? "0 12px 32px rgba(0, 0, 0, 0.45)" : "0 12px 32px rgba(0, 0, 0, 0.15)",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--ms-text-2, #8b949e)",
                  textTransform: "uppercase",
                  padding: "3px 6px",
                }}
              >
                Canvas Grid Style
              </span>
              {[
                { label: "Double Mesh (CAD)", mode: "doubleMesh" as const },
                { label: "Dot Matrix", mode: "dot" as const },
                { label: "Fine Mesh", mode: "mesh" as const },
                { label: "Blank (No Grid)", mode: "none" as const },
              ].map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  className="ansatz-menu-item"
                  onClick={() => {
                    handleGridModeChange(item.mode);
                    setShowGridMenu(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "5px 8px",
                    fontSize: 11,
                    fontWeight: gridMode === item.mode ? 600 : 400,
                    color:
                      gridMode === item.mode ? "var(--ms-brand, #0891b2)" : "var(--ms-text-1, var(--color-fg-default))",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    transition: "background-color 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span>{item.label}</span>
                  {gridMode === item.mode && <span>✓</span>}
                </button>
              ))}
              <div
                style={{
                  height: 1,
                  backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                  margin: "3px 0",
                }}
              />
              <button
                type="button"
                className="ansatz-menu-item"
                onClick={() => {
                  handleSnapToggle();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "5px 8px",
                  fontSize: 11,
                  fontWeight: isSnapActive ? 600 : 400,
                  color: isSnapActive ? "var(--ms-brand, #0891b2)" : "var(--ms-text-1, var(--color-fg-default))",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background-color 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span>Snap to Grid</span>
                <span style={{ fontSize: 9, fontWeight: 700 }}>{isSnapActive ? "ON" : "OFF"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Minimap Toggle */}
        <button
          type="button"
          onClick={toggleMinimapView}
          aria-label="Toggle Minimap"
          title="Toggle Minimap (M)"
          style={{
            border: "none",
            background: isMinimapActive ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.2))" : "transparent",
            borderRadius: "var(--ms-radius-pill, 999px)",
            width: 26,
            height: 26,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: isMinimapActive ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--color-fg-muted))",
            cursor: "pointer",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M9 9h5v5H9z" />
            <path d="M2 6h12" />
          </svg>
        </button>
      </div>
    </>
  );
};
