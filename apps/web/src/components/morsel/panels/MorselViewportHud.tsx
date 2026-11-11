// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramGridMode } from "@modelscript/diagram";
import React, { useEffect, useRef, useState } from "react";

export interface MorselViewportHudProps {
  currentZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (scale: number) => void;
  onZoomToFit: () => void;
  isMinimapActive: boolean;
  onToggleMinimap: () => void;
  gridMode: DiagramGridMode;
  onGridModeChange: (mode: DiagramGridMode) => void;
  isSnapActive: boolean;
  onToggleSnap: () => void;
  colorMode: "dark" | "light";
  translations?: any;
}

export const MorselViewportHud: React.FC<MorselViewportHudProps> = ({
  currentZoom,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onZoomToFit,
  isMinimapActive,
  onToggleMinimap,
  gridMode,
  onGridModeChange,
  isSnapActive,
  onToggleSnap,
  colorMode,
  translations: _translations = {},
}) => {
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showGridMenu, setShowGridMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const gridMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showZoomMenu && !showGridMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showZoomMenu && zoomMenuRef.current && !zoomMenuRef.current.contains(target)) {
        setShowZoomMenu(false);
      }
      if (showGridMenu && gridMenuRef.current && !gridMenuRef.current.contains(target)) {
        setShowGridMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showZoomMenu, showGridMenu]);

  const isDark = colorMode === "dark";

  return (
    <div
      className="morsel-viewport-hud"
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 34,
        padding: "0 6px",
        borderRadius: "var(--ms-radius-pill, 999px)",
        background: isDark ? "var(--ms-surface-glass, rgba(15, 23, 42, 0.85))" : "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--ms-divider, rgba(255, 255, 255, 0.12))",
        boxShadow: "var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.25))",
        userSelect: "none",
      }}
    >
      {/* Zoom Out */}
      <button
        type="button"
        className="morsel-toolbar-btn"
        onClick={onZoomOut}
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
          transition: "background-color 0.15s ease, color 0.15s ease",
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

      {/* Zoom Percentage Dropdown Trigger */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="morsel-toolbar-btn-text"
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
            transition: "background-color 0.15s ease",
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
              border: isDark ? "1px solid rgba(255, 255, 255, 0.14)" : "1px solid rgba(0, 0, 0, 0.12)",
              backgroundColor: isDark ? "rgba(22, 27, 34, 0.95)" : "#ffffff",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
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
                  className="morsel-menu-item"
                  onClick={() => {
                    onZoomTo(preset.scale);
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
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                margin: "3px 0",
              }}
            />
            <button
              type="button"
              className="morsel-menu-item"
              onClick={() => {
                onZoomToFit();
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
              }}
            >
              Zoom to Fit (Shift+1)
            </button>
          </div>
        )}
      </div>

      {/* Zoom In */}
      <button
        type="button"
        className="morsel-toolbar-btn"
        onClick={onZoomIn}
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
          transition: "background-color 0.15s ease, color 0.15s ease",
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

      {/* Zoom to Fit */}
      <button
        type="button"
        className="morsel-toolbar-btn"
        onClick={onZoomToFit}
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
          transition: "background-color 0.15s ease, color 0.15s ease",
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

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: 14,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
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
            transition: "background-color 0.15s ease, color 0.15s ease",
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
              border: isDark ? "1px solid rgba(255, 255, 255, 0.14)" : "1px solid rgba(0, 0, 0, 0.12)",
              backgroundColor: isDark ? "rgba(22, 27, 34, 0.95)" : "#ffffff",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
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
                letterSpacing: "0.04em",
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
                className="morsel-menu-item"
                onClick={() => {
                  onGridModeChange(item.mode);
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
                }}
              >
                <span>{item.label}</span>
                {gridMode === item.mode && <span>✓</span>}
              </button>
            ))}
            <div
              style={{
                height: 1,
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                margin: "3px 0",
              }}
            />
            <button
              type="button"
              className="morsel-menu-item"
              onClick={onToggleSnap}
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
              }}
            >
              <span>Snap to Grid</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: isSnapActive ? "var(--ms-brand-soft, rgba(8,145,178,0.2))" : "rgba(125,125,125,0.15)",
                }}
              >
                {isSnapActive ? "ON" : "OFF"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Minimap Toggle */}
      <button
        type="button"
        onClick={onToggleMinimap}
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
          transition: "background-color 0.15s ease, color 0.15s ease",
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
  );
};
