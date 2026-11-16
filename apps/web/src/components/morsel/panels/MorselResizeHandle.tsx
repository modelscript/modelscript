// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";

export interface MorselResizeHandleProps {
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

const BRAND_COLOR = "var(--ms-brand, #0891b2)";
const BRAND_GLOW = "0 0 6px color-mix(in srgb, var(--ms-brand, #0891b2) 50%, transparent)";

export const MorselResizeHandle: React.FC<MorselResizeHandleProps> = ({
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
  const isVertical = orientation === "vertical";
  const isActive = isHovered || isDragging;

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
      {/* Active highlight line centered on the handle */}
      <div
        style={{
          width: isVertical ? 3 : "100%",
          height: isVertical ? "100%" : 3,
          borderRadius: 999,
          backgroundColor: isActive ? BRAND_COLOR : "transparent",
          transition: "background-color 0.15s ease",
        }}
      />
      {/* Grab pill in the center */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: isVertical ? 6 : 32,
          height: isVertical ? 32 : 6,
          borderRadius: 999,
          backgroundColor: isActive ? BRAND_COLOR : "transparent",
          boxShadow: isActive ? BRAND_GLOW : "none",
          opacity: isActive ? 1 : 0,
          transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
