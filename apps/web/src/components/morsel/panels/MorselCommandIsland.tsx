// SPDX-License-Identifier: AGPL-3.0-or-later

import { FlowchartIcon, PlusIcon } from "@primer/octicons-react";
import React from "react";

export interface MorselCommandIslandProps {
  showPalette: boolean;
  onTogglePalette: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRotateSelected?: () => void;
  onAutoLayout?: () => void;
  colorMode: "dark" | "light";
  translations?: any;
  supportsDiagram?: boolean;
}

export const MorselCommandIsland: React.FC<MorselCommandIslandProps> = ({
  showPalette,
  onTogglePalette,
  onUndo,
  onRedo,
  onRotateSelected,
  onAutoLayout,
  colorMode,
  translations = {},
  supportsDiagram = true,
}) => {
  const isDark = colorMode === "dark";

  return (
    <div
      className="morsel-command-island"
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
        background: isDark ? "var(--ms-surface-glass, rgba(15, 23, 42, 0.85))" : "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--ms-divider, rgba(255, 255, 255, 0.12))",
        boxShadow: "var(--ms-shadow-card, 0 8px 28px -4px rgba(0, 0, 0, 0.3))",
        userSelect: "none",
        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Add Element / Stencil Palette CTA */}
      <button
        type="button"
        onClick={onTogglePalette}
        className="morsel-island-primary-btn"
        title="Open interactive element & stencil palette"
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
          color: showPalette ? "#ffffff" : isDark ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
          boxShadow: showPalette ? "0 0 12px var(--ms-glow-cyan, rgba(8, 145, 178, 0.4))" : "none",
        }}
      >
        <PlusIcon size={13} />
        <span>Add Element</span>
      </button>

      {supportsDiagram && (
        <>
          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 16,
              backgroundColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
              margin: "0 3px",
            }}
          />

          {/* History: Undo / Redo */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
            <button
              type="button"
              className="morsel-toolbar-btn"
              onClick={onUndo}
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
                <path d="M3 7h7a4 4 0 0 1 4 4v1" />
                <path d="M6 4L3 7l3 3" />
              </svg>
            </button>

            <button
              type="button"
              className="morsel-toolbar-btn"
              onClick={onRedo}
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
                <path d="M13 7H6a4 4 0 0 0-4 4v1" />
                <path d="M10 4l3 3-3 3" />
              </svg>
            </button>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 16,
              backgroundColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
              margin: "0 3px",
            }}
          />

          {/* Rotate 90° */}
          {onRotateSelected && (
            <button
              type="button"
              className="morsel-toolbar-btn"
              onClick={onRotateSelected}
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
                <path d="M14 7A6 6 0 1 1 8 2h4" />
                <path d="M9 5l3-3-3-3" />
              </svg>
            </button>
          )}

          {/* Auto-Layout */}
          {onAutoLayout && (
            <button
              type="button"
              className="morsel-toolbar-btn"
              onClick={onAutoLayout}
              aria-label={translations.autoLayout || "Auto-layout diagram"}
              title={translations.autoLayout || "Auto-layout diagram"}
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
              <FlowchartIcon size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
};
