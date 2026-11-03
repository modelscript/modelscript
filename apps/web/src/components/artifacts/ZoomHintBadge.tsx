// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface ZoomHintBadgeProps {
  show: boolean;
  label?: string | undefined;
  style?: React.CSSProperties | undefined;
}

/**
 * Centered floating pill hint reminding the user to hold Ctrl/Cmd to zoom the embedded artifact.
 */
export const ZoomHintBadge: React.FC<ZoomHintBadgeProps> = ({ show, label = "💡 Hold ⌘/Ctrl to zoom", style }) => {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 25,
        background: "rgba(15, 23, 42, 0.90)",
        backdropFilter: "blur(8px)",
        color: "#f8fafc",
        padding: "6px 14px",
        borderRadius: "20px",
        fontSize: "12px",
        fontWeight: 600,
        fontFamily: "var(--font-mono, monospace)",
        whiteSpace: "nowrap",
        border: "1px solid rgba(255, 255, 255, 0.22)",
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.45)",
        userSelect: "none",
        ...style,
      }}
    >
      {label}
    </div>
  );
};

export default ZoomHintBadge;
