// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon, SlidersIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import { getComponentDomain } from "../ComponentList";

export interface MorselSelectionRibbonProps {
  selectedComponent: string;
  selectedProperties?: any;
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
  colorMode,
  onRotate,
  onFlip,
  onDuplicate,
  onInspect,
  onDelete,
  onClose,
}) {
  const isDark = colorMode === "dark";
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
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 32,
        padding: "0 6px",
        borderRadius: "var(--ms-radius-pill, 999px)",
        background: isDark ? "var(--ms-surface-glass, rgba(15, 23, 42, 0.88))" : "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--ms-divider, rgba(255, 255, 255, 0.12))",
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
          color: "var(--ms-text-1, var(--color-fg-default))",
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

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--ms-divider, rgba(255, 255, 255, 0.12))",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      {/* Rotate 90° Clockwise */}
      <button
        type="button"
        onClick={() => onRotate(90)}
        title={`Rotate 90° Clockwise (${isMac ? "R / ⇧R" : "R / Shift+R"})`}
        aria-label="Rotate 90° Clockwise"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 7px",
          fontSize: 11,
          fontWeight: 500,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-1, var(--color-fg-default))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2a6 6 0 1 0 6 6 0.75 0.75 0 0 0-1.5 0 4.5 4.5 0 1 1-4.5-4.5V5.5a.75.75 0 0 0 1.28.53l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5A.75.75 0 0 0 8 .5V2z" />
        </svg>
        <span>Rotate</span>
      </button>

      {/* Flip Horizontal */}
      <button
        type="button"
        onClick={() => onFlip("x")}
        title={`Flip Horizontal (${isMac ? "F" : "F"})`}
        aria-label="Flip Horizontal"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 7px",
          fontSize: 11,
          fontWeight: 500,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-1, var(--color-fg-default))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1v14M3 4l-2 4 2 4V4zm10 0l2 4-2 4V4z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Flip</span>
      </button>

      {/* Duplicate */}
      <button
        type="button"
        onClick={onDuplicate}
        title={`Duplicate (${isMac ? "⌘D" : "Ctrl+D"})`}
        aria-label="Duplicate"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 7px",
          fontSize: 11,
          fontWeight: 500,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-1, var(--color-fg-default))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <CopyIcon size={12} />
        <span>Duplicate</span>
      </button>

      {/* Inspect */}
      <button
        type="button"
        onClick={onInspect}
        title="Inspect Properties (I)"
        aria-label="Inspect Properties"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 7px",
          fontSize: 11,
          fontWeight: 500,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-1, var(--color-fg-default))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <SlidersIcon size={12} />
        <span>Inspect</span>
      </button>

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: 16,
          background: "var(--ms-divider, rgba(255, 255, 255, 0.12))",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        title={`Delete (${isMac ? "⌫" : "Del"})`}
        aria-label="Delete"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-2, var(--color-fg-muted))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
          e.currentTarget.style.color = "#f87171";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
        }}
      >
        <TrashIcon size={12} />
      </button>

      {/* Deselect / Close */}
      <button
        type="button"
        onClick={onClose}
        title="Deselect (Esc)"
        aria-label="Deselect"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "var(--ms-radius-pill, 999px)",
          border: "none",
          background: "transparent",
          color: "var(--ms-text-2, var(--color-fg-muted))",
          cursor: "pointer",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <XIcon size={12} />
      </button>
    </div>
  );
});
