// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramGridMode } from "@modelscript/diagram";
import { AppsIcon, EyeIcon, ScreenFullIcon, ZoomInIcon, ZoomOutIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, IconButton } from "@primer/react";
import React from "react";

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
  translations?: Record<string, string>;
}

const ZOOM_PRESETS = [
  { label: "50%", scale: 0.5 },
  { label: "75%", scale: 0.75 },
  { label: "100%", scale: 1.0, shortcut: "Ctrl+0" },
  { label: "150%", scale: 1.5 },
  { label: "200%", scale: 2.0 },
];

const GRID_MODES: Array<{ label: string; mode: DiagramGridMode }> = [
  { label: "Double Mesh (CAD)", mode: "doubleMesh" },
  { label: "Dot Matrix", mode: "dot" },
  { label: "Fine Mesh", mode: "mesh" },
  { label: "Blank (No Grid)", mode: "none" },
];

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
  colorMode: _colorMode,
  translations: _translations = {},
}) => {
  const zoomPercent = Math.round(currentZoom * 100);

  return (
    <div
      className="morsel-viewport-hud"
      role="toolbar"
      aria-label="Viewport controls"
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 36,
        padding: "0 6px",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: "var(--ms-surface-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--borderColor-muted, var(--ms-divider))",
        boxShadow: "var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.25))",
        userSelect: "none",
      }}
    >
      <IconButton
        icon={ZoomOutIcon}
        size="small"
        variant="invisible"
        onClick={onZoomOut}
        aria-label="Zoom Out"
        title="Zoom Out (Ctrl+-)"
        style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
      />

      {/* Zoom Percentage ActionMenu */}
      <ActionMenu>
        <ActionMenu.Button
          size="small"
          variant="invisible"
          aria-label={`Zoom level: ${zoomPercent}%`}
          title="Zoom presets / Reset to 100% (Ctrl+0)"
          style={{
            height: 26,
            padding: "0 6px",
            fontSize: 11,
            fontWeight: 600,
            minWidth: 52,
            borderRadius: 7,
            fontVariantNumeric: "tabular-nums",
            color: "var(--fgColor-default)",
          }}
        >
          {zoomPercent}%
        </ActionMenu.Button>
        <ActionMenu.Overlay side="outside-top" align="end" width="small">
          <ActionList selectionVariant="single">
            {ZOOM_PRESETS.map((preset) => (
              <ActionList.Item
                key={preset.label}
                selected={Math.abs(currentZoom - preset.scale) < 0.02}
                onSelect={() => onZoomTo(preset.scale)}
              >
                {preset.label}
                {preset.shortcut && <ActionList.TrailingVisual>{preset.shortcut}</ActionList.TrailingVisual>}
              </ActionList.Item>
            ))}
            <ActionList.Divider />
            <ActionList.Item onSelect={onZoomToFit}>
              Zoom to Fit
              <ActionList.TrailingVisual>Shift+1</ActionList.TrailingVisual>
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>

      <IconButton
        icon={ZoomInIcon}
        size="small"
        variant="invisible"
        onClick={onZoomIn}
        aria-label="Zoom In"
        title="Zoom In (Ctrl+=)"
        style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
      />

      <IconButton
        icon={ScreenFullIcon}
        size="small"
        variant="invisible"
        onClick={onZoomToFit}
        aria-label="Zoom to Fit"
        title="Zoom to Fit (Shift+1)"
        style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
      />

      <div
        style={{
          width: 1,
          height: 14,
          backgroundColor: "var(--borderColor-muted, var(--ms-divider))",
          margin: "0 3px",
        }}
      />

      {/* Grid & Snapping ActionMenu */}
      <ActionMenu>
        <ActionMenu.Anchor>
          <IconButton
            icon={AppsIcon}
            size="small"
            variant="invisible"
            aria-label="Grid & Snapping Options"
            title="Grid & Snapping Options"
            style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
          />
        </ActionMenu.Anchor>
        <ActionMenu.Overlay side="outside-top" align="end" width="small">
          <ActionList>
            <ActionList.Group selectionVariant="single">
              <ActionList.GroupHeading>Canvas Grid Style</ActionList.GroupHeading>
              {GRID_MODES.map((item) => (
                <ActionList.Item
                  key={item.mode}
                  selected={gridMode === item.mode}
                  onSelect={() => onGridModeChange(item.mode)}
                >
                  {item.label}
                </ActionList.Item>
              ))}
            </ActionList.Group>
            <ActionList.Divider />
            <ActionList.Item selected={isSnapActive} onSelect={onToggleSnap}>
              Snap to Grid
              <ActionList.TrailingVisual>{isSnapActive ? "ON" : "OFF"}</ActionList.TrailingVisual>
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>

      <IconButton
        icon={EyeIcon}
        size="small"
        variant="invisible"
        onClick={onToggleMinimap}
        aria-label="Toggle Minimap"
        aria-pressed={isMinimapActive}
        title="Toggle Minimap (M)"
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          backgroundColor: isMinimapActive ? "var(--ms-brand-soft)" : undefined,
          color: isMinimapActive ? "var(--fgColor-accent, var(--ms-brand))" : "var(--fgColor-muted)",
        }}
      />
    </div>
  );
};
