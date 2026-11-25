// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";

export interface AnsatzResizeHandleProps {
  orientation: "vertical" | "horizontal";
  ariaLabel: string;
  ariaValueNow?: number | undefined;
  ariaValueMin?: number | undefined;
  ariaValueMax?: number | undefined;
  isDragging?: boolean | undefined;
  cursor?: React.CSSProperties["cursor"] | undefined;
  style?: React.CSSProperties | undefined;
  onMouseDown?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
  onTouchStart?: ((e: React.TouchEvent<HTMLDivElement>) => void) | undefined;
  onTouchMove?: ((e: React.TouchEvent<HTMLDivElement>) => void) | undefined;
  onTouchEnd?: ((e: React.TouchEvent<HTMLDivElement>) => void) | undefined;
  onDoubleClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
  onKeyDown?: ((e: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

const TRACK_COLOR_HOVER = "color-mix(in srgb, var(--ms-text-3, #94a3b8) 28%, transparent)";
const TRACK_COLOR_DRAG = "color-mix(in srgb, var(--ms-text-3, #94a3b8) 48%, transparent)";
const PILL_COLOR_HOVER = "var(--borderColor-emphasis, #cbd5e1)";
const PILL_COLOR_DRAG = "var(--ms-text-3, #94a3b8)";
const PILL_SHADOW =
  "0 1px 4px rgba(15, 23, 42, 0.10), 0 0 0 1px color-mix(in srgb, var(--color-canvas-default, #ffffff) 65%, transparent)";

export const AnsatzResizeHandle: React.FC<AnsatzResizeHandleProps> = ({
  orientation,
  ariaLabel,
  ariaValueNow,
  ariaValueMin,
  ariaValueMax,
  isDragging = false,
  cursor,
  style,
  onMouseDown,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onDoubleClick,
  onKeyDown,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const isVertical = orientation === "vertical";
  const isActive = isHovered || isDragging || isFocused;

  const trackColor = isDragging ? TRACK_COLOR_DRAG : isActive ? TRACK_COLOR_HOVER : "transparent";
  const pillColor = isDragging ? PILL_COLOR_DRAG : PILL_COLOR_HOVER;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-label={ariaLabel}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        backgroundColor: "transparent",
        outline: "none",
        userSelect: "none",
        pointerEvents: "auto",
        cursor: cursor ?? (isVertical ? "col-resize" : "row-resize"),
        ...style,
      }}
    >
      {/* Subtle inset hairline centered on the handle */}
      <div
        style={{
          width: isVertical ? 2 : "calc(100% - 16px)",
          height: isVertical ? "calc(100% - 16px)" : 2,
          borderRadius: 999,
          backgroundColor: trackColor,
          transition: "background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1)",
          pointerEvents: "none",
        }}
      />
      {/* Sleek capsule grab pill in the center */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: isDragging
            ? "translate(-50%, -50%) scale(1.08)"
            : isActive
              ? "translate(-50%, -50%) scale(1)"
              : "translate(-50%, -50%) scale(0.85)",
          width: isVertical ? 4 : 36,
          height: isVertical ? 36 : 4,
          borderRadius: 999,
          backgroundColor: pillColor,
          boxShadow: isActive ? PILL_SHADOW : "none",
          opacity: isActive ? 1 : 0,
          transition:
            "opacity 0.16s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.16s ease, box-shadow 0.16s ease",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
