// SPDX-License-Identifier: AGPL-3.0-or-later

import { FlowchartIcon, PlusIcon, RedoIcon, SyncIcon, UndoIcon } from "@primer/octicons-react";
import { Button, IconButton } from "@primer/react";
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

const Divider: React.FC = () => (
  <div
    style={{
      width: 1,
      height: 16,
      backgroundColor: "var(--borderColor-muted, var(--ms-divider))",
      margin: "0 3px",
      flexShrink: 0,
    }}
  />
);

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
      role="toolbar"
      aria-label="Diagram actions"
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 38,
        padding: "0 6px",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: "var(--ms-surface-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--borderColor-muted, var(--ms-divider))",
        boxShadow: "var(--ms-shadow-card, 0 8px 28px -4px rgba(0, 0, 0, 0.3))",
        userSelect: "none",
        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <Button
        size="small"
        variant={showPalette ? "primary" : "default"}
        leadingVisual={PlusIcon}
        onClick={onTogglePalette}
        title="Open interactive element & stencil palette"
        style={{
          height: 26,
          padding: "0 10px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 8,
          ...(showPalette
            ? {
                backgroundColor: "var(--ms-brand)",
                borderColor: "var(--ms-brand)",
                color: "#ffffff",
              }
            : {
                backgroundColor: "var(--ms-brand-soft)",
                borderColor: "color-mix(in srgb, var(--ms-brand) 30%, transparent)",
                color: isDark ? "var(--ms-link)" : "var(--ms-brand)",
              }),
        }}
      >
        Add Element
      </Button>

      {supportsDiagram && (
        <>
          <Divider />

          <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
            <IconButton
              icon={UndoIcon}
              size="small"
              variant="invisible"
              onClick={onUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
            />
            <IconButton
              icon={RedoIcon}
              size="small"
              variant="invisible"
              onClick={onRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Y / Cmd+Shift+Z)"
              style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
            />
          </div>

          {(onRotateSelected || onAutoLayout) && <Divider />}

          {onRotateSelected && (
            <IconButton
              icon={SyncIcon}
              size="small"
              variant="invisible"
              onClick={onRotateSelected}
              aria-label="Rotate 90° Clockwise"
              title="Rotate 90° Clockwise (R / Shift+R)"
              style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
            />
          )}

          {onAutoLayout && (
            <IconButton
              icon={FlowchartIcon}
              size="small"
              variant="invisible"
              onClick={onAutoLayout}
              aria-label={translations.autoLayout || "Auto-layout diagram"}
              title={translations.autoLayout || "Auto-layout diagram"}
              style={{ width: 26, height: 26, borderRadius: 7, color: "var(--fgColor-muted)" }}
            />
          )}
        </>
      )}
    </div>
  );
};
