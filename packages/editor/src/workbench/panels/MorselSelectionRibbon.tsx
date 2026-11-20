// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon, MirrorIcon, SlidersIcon, SyncIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton } from "@primer/react";
import React from "react";
import { getComponentDomain } from "../ComponentList";

export interface MorselSelectionRibbonProps {
  selectedComponent: string;
  selectedProperties?: Record<string, unknown>;
  colorMode: string;
  onRotate: (deltaDegrees?: number) => void;
  onFlip: (axis?: "x" | "y") => void;
  onDuplicate: () => void;
  onInspect: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export const MorselSelectionRibbon: React.FC<MorselSelectionRibbonProps> = React.memo(function MorselSelectionRibbon({
  selectedComponent,
  selectedProperties,
  colorMode: _colorMode,
  onRotate,
  onFlip,
  onDuplicate,
  onInspect,
  onDelete,
  onClose,
}) {
  const rawKind = selectedProperties?.classKind || selectedProperties?.className || "component";
  const rawClassName = selectedProperties?.className || "";
  const domainInfo = getComponentDomain(rawClassName, rawKind);
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);

  return (
    <div
      className="morsel-selection-ribbon"
      role="toolbar"
      aria-label="Component Selection Actions"
      style={{
        position: "absolute",
        bottom: 62,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 34,
        padding: "0 6px",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: "var(--ms-surface-glass)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--borderColor-muted, var(--ms-divider))",
        boxShadow: "var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.3))",
        userSelect: "none",
        animation: "morsel-fade-in 0.15s ease-out",
      }}
    >
      {/* Selected Component Pill */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px 0 6px",
          fontSize: 11.5,
          fontWeight: 600,
          fontFamily: "var(--ms-font-mono, monospace)",
          color: "var(--fgColor-default, var(--ms-text-1))",
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={`${selectedComponent} (${domainInfo.domain})`}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: domainInfo.color,
            boxShadow: `0 0 6px ${domainInfo.color}`,
            flexShrink: 0,
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedComponent}</span>
      </div>

      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--borderColor-muted, var(--ms-divider))",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      <Button
        size="small"
        variant="invisible"
        leadingVisual={SyncIcon}
        onClick={() => onRotate(90)}
        title={`Rotate 90° Clockwise (${isMac ? "R / ⇧R" : "R / Shift+R"})`}
        aria-label="Rotate 90° Clockwise"
        style={{ height: 24, padding: "0 7px", fontSize: 11, borderRadius: 7 }}
      >
        Rotate
      </Button>

      <Button
        size="small"
        variant="invisible"
        leadingVisual={MirrorIcon}
        onClick={() => onFlip("x")}
        title="Flip Horizontal (F)"
        aria-label="Flip Horizontal"
        style={{ height: 24, padding: "0 7px", fontSize: 11, borderRadius: 7 }}
      >
        Flip
      </Button>

      <Button
        size="small"
        variant="invisible"
        leadingVisual={CopyIcon}
        onClick={onDuplicate}
        title={`Duplicate (${isMac ? "⌘D" : "Ctrl+D"})`}
        aria-label="Duplicate"
        style={{ height: 24, padding: "0 7px", fontSize: 11, borderRadius: 7 }}
      >
        Duplicate
      </Button>

      <Button
        size="small"
        variant="invisible"
        leadingVisual={SlidersIcon}
        onClick={onInspect}
        title="Inspect Properties (I)"
        aria-label="Inspect Properties"
        style={{ height: 24, padding: "0 7px", fontSize: 11, borderRadius: 7 }}
      >
        Inspect
      </Button>

      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--borderColor-muted, var(--ms-divider))",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      <IconButton
        icon={TrashIcon}
        size="small"
        variant="invisible"
        onClick={onDelete}
        title={`Delete (${isMac ? "⌫" : "Del"})`}
        aria-label="Delete"
        style={{ width: 24, height: 24, borderRadius: 7, color: "var(--fgColor-danger, var(--ms-danger))" }}
      />

      <IconButton
        icon={XIcon}
        size="small"
        variant="invisible"
        onClick={onClose}
        title="Deselect (Esc)"
        aria-label="Deselect"
        style={{ width: 24, height: 24, borderRadius: 7, color: "var(--fgColor-muted)" }}
      />
    </div>
  );
});
