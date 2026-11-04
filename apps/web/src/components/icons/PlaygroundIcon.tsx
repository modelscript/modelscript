// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeSquareIcon } from "@primer/octicons-react";
import React from "react";

export type PlaygroundIconFillMode = "layered" | "canvas" | "header" | "outline";

export interface PlaygroundIconProps {
  /** Icon size in pixels (width and height). Defaults to 24. */
  size?: number | undefined;
  /** Primary tone color (window frame, divider, and code chevrons). Defaults to iconic light blue ("var(--ansatz-facet-accent, #38bdf8)"). */
  color?: string | undefined;
  /** Secondary tone color (translucent canvas and title bar fills). Defaults to the primary color. */
  secondaryColor?: string | undefined;
  /** Opacity for the secondary tone fill (0.0 to 1.0). Defaults to 0.16. */
  secondaryOpacity?: number | undefined;
  /** Two-tone fill mode: 'layered' (subtle canvas + title bar), 'canvas' (interior fill), 'header' (title bar fill), or 'outline' (Primer standard crisp icon). Defaults to 'outline'. */
  fillMode?: PlaygroundIconFillMode | undefined;
  /** Optional inline styles for the svg element. */
  style?: React.CSSProperties | undefined;
  /** Optional CSS class name. */
  className?: string | undefined;
  /** Optional accessibility label. If omitted, icon is aria-hidden="true". */
  "aria-label"?: string | undefined;
}

/**
 * Standard Playground icon for ModelScript / Ansatz.
 * Features Primer's standard CodeSquareIcon with wide bracket spacing in iconic light blue (#38bdf8),
 * with optional two-tone styling support.
 */
export const PlaygroundIcon: React.FC<PlaygroundIconProps> = ({
  size = 24,
  color = "var(--ansatz-facet-accent, #38bdf8)",
  secondaryColor,
  secondaryOpacity = 0.16,
  fillMode = "outline",
  style,
  className,
  "aria-label": ariaLabel,
}) => {
  if (fillMode === "outline") {
    return (
      <CodeSquareIcon
        size={size}
        className={className ? `msx-playground-icon ${className}` : "msx-playground-icon"}
        style={{
          color,
          flexShrink: 0,
          display: "inline-block",
          verticalAlign: "middle",
          ...style,
        }}
        aria-label={ariaLabel}
      />
    );
  }

  const resolvedSecondary = secondaryColor || color;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `msx-playground-icon ${className}` : "msx-playground-icon"}
      style={{
        flexShrink: 0,
        display: "inline-block",
        verticalAlign: "middle",
        ...style,
      }}
      aria-hidden={ariaLabel ? undefined : "true"}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      {/* Two-tone background fills */}
      {(fillMode === "canvas" || fillMode === "layered") && (
        <rect
          className="playground-icon-secondary playground-icon-canvas"
          x="2.5"
          y="2.5"
          width="19"
          height="19"
          rx="4.2"
          fill={resolvedSecondary}
          fillOpacity={secondaryOpacity}
        />
      )}

      {(fillMode === "header" || fillMode === "layered") && (
        <path
          className="playground-icon-secondary playground-icon-header"
          d="M2.5 6.7C2.5 4.4 4.4 2.5 6.7 2.5H17.3C19.6 2.5 21.5 4.4 21.5 6.7V8H2.5V6.7Z"
          fill={resolvedSecondary}
          fillOpacity={fillMode === "layered" ? secondaryOpacity * 1.5 : secondaryOpacity * 1.8}
        />
      )}

      {/* Outer squircle window frame */}
      <rect
        className="playground-icon-frame"
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="4.2"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Horizontal title bar divider line */}
      <line
        className="playground-icon-divider"
        x1="2.5"
        y1="8"
        x2="21.5"
        y2="8"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Code brackets < > with wide gap (3.6px) preventing diamond illusion */}
      <g className="playground-icon-chevrons">
        {/* Left chevron < */}
        <path
          className="playground-icon-chevron-left"
          d="M10.2 11.8L6.8 14.8L10.2 17.8"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Right chevron > */}
        <path
          className="playground-icon-chevron-right"
          d="M13.8 11.8L17.2 14.8L13.8 17.8"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

export { CodeSquareIcon };
export default PlaygroundIcon;
