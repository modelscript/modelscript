// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export type SketchIconVariant = "blueprint" | "outline" | "badge" | "triangle";

export interface AnsatzSketchIconProps {
  /** Icon size in pixels (width and height). Defaults to 24. */
  size?: number | undefined;
  /** Primary accent color (defaulting to iconic blueprint cyan #38bdf8). */
  color?: string | undefined;
  /** Secondary fill or background tone. */
  secondaryColor?: string | undefined;
  /** Styling variant: 'blueprint' (full blueprint draft), 'outline' (clean SVG linework), 'badge' (compact), 'triangle' (drafting set square). Defaults to 'blueprint'. */
  variant?: SketchIconVariant | undefined;
  /** Optional inline CSS styles. */
  style?: React.CSSProperties | undefined;
  /** Optional CSS class name. */
  className?: string | undefined;
  /** Optional accessibility label. If omitted, icon is marked aria-hidden. */
  "aria-label"?: string | undefined;
}

/**
 * Ansatz Sketch Icon: Visual symbol of Ansatz Sketch representing an engineering
 * blueprint draft — featuring technical gridlines, isometric mechanical projection,
 * dimension witness lines, and an active drafting stylus.
 */
export const AnsatzSketchIcon: React.FC<AnsatzSketchIconProps> = ({
  size = 24,
  color = "var(--ansatz-facet-accent, #38bdf8)",
  secondaryColor,
  variant = "blueprint",
  style,
  className,
  "aria-label": ariaLabel,
}) => {
  const generatedId = React.useId();
  const resolvedId = generatedId.replace(/:/g, "");
  const bgGradId = `bp-bg-${resolvedId}`;
  const glowGradId = `bp-glow-${resolvedId}`;
  const sparkGradId = `bp-spark-${resolvedId}`;

  if (variant === "triangle") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={
          className
            ? `ansatz-sketch-icon ansatz-sketch-triangle ${className}`
            : "ansatz-sketch-icon ansatz-sketch-triangle"
        }
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
        {/* Drafting set square outer perimeter */}
        <path d="M3 21h18L3 3v18z" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Interior triangular cutout */}
        <path
          d="M7 17h6L7 11v6z"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={secondaryColor ? secondaryColor : "none"}
        />
        {/* Precision ruler calibration tick marks */}
        <line x1="10" y1="21" x2="10" y2="18.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <line x1="14" y1="21" x2="14" y2="18.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === "outline") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className ? `ansatz-sketch-icon ${className}` : "ansatz-sketch-icon"}
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
        {/* Drafting sheet boundary frame with folded/notched corner */}
        <rect
          x="2.5"
          y="2.5"
          width="19"
          height="19"
          rx="4"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Subtle grid lines */}
        <line x1="8.5" y1="2.5" x2="8.5" y2="21.5" stroke={color} strokeWidth="0.8" strokeOpacity="0.25" />
        <line x1="15.5" y1="2.5" x2="15.5" y2="21.5" stroke={color} strokeWidth="0.8" strokeOpacity="0.25" />
        <line x1="2.5" y1="8.5" x2="21.5" y2="8.5" stroke={color} strokeWidth="0.8" strokeOpacity="0.25" />
        <line x1="2.5" y1="15.5" x2="21.5" y2="15.5" stroke={color} strokeWidth="0.8" strokeOpacity="0.25" />
        {/* Isometric drafting block */}
        <polygon
          points="11,6 16.5,9 11,12 5.5,9"
          stroke={color}
          strokeWidth="1.4"
          strokeLinejoin="round"
          fill={secondaryColor || color}
          fillOpacity={0.16}
        />
        <polygon
          points="5.5,9 11,12 11,17.5 5.5,14.5"
          stroke={color}
          strokeWidth="1.4"
          strokeLinejoin="round"
          fill={secondaryColor || color}
          fillOpacity={0.24}
        />
        <polygon
          points="11,12 16.5,9 16.5,14.5 11,17.5"
          stroke={color}
          strokeWidth="1.4"
          strokeLinejoin="round"
          fill={secondaryColor || color}
          fillOpacity={0.32}
        />
        {/* Drafting stylus sketching line */}
        <line x1="16.5" y1="14.5" x2="20.5" y2="10.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16.5" cy="14.5" r="1.2" fill={color} />
      </svg>
    );
  }

  // Full rich blueprint variant (matching ansatz-sketch.svg)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `ansatz-sketch-icon ${className}` : "ansatz-sketch-icon"}
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
      <defs>
        <linearGradient id={bgGradId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#081e3a" />
          <stop offset="60%" stopColor="#051428" />
          <stop offset="100%" stopColor="#030b17" />
        </linearGradient>
        <radialGradient id={glowGradId} cx="65%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
          <stop offset="60%" stopColor="#0284c7" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={sparkGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Blueprint Canvas Tile */}
      <rect width="48" height="48" rx="11" fill={`url(#${bgGradId})`} />
      <rect width="48" height="48" rx="11" fill={`url(#${glowGradId})`} />
      <rect
        x="0.75"
        y="0.75"
        width="46.5"
        height="46.5"
        rx="10.25"
        stroke="#38bdf8"
        strokeOpacity="0.32"
        strokeWidth="1.5"
      />

      {/* Blueprint Drafting Grid */}
      <g stroke="#38bdf8" strokeOpacity="0.13" strokeWidth="0.75">
        <line x1="8" y1="4" x2="8" y2="44" />
        <line x1="16" y1="4" x2="16" y2="44" />
        <line x1="24" y1="4" x2="24" y2="44" />
        <line x1="32" y1="4" x2="32" y2="44" />
        <line x1="40" y1="4" x2="40" y2="44" />
        <line x1="4" y1="8" x2="44" y2="8" />
        <line x1="4" y1="16" x2="44" y2="16" />
        <line x1="4" y1="24" x2="44" y2="24" />
        <line x1="4" y1="32" x2="44" y2="32" />
        <line x1="4" y1="40" x2="44" y2="40" />
      </g>

      {/* Technical Corner Registration Marks */}
      <g stroke="#38bdf8" strokeOpacity="0.45" strokeWidth="1.1" strokeLinecap="round">
        <path d="M 4 8 L 7 8 M 7 5 L 7 8" />
        <path d="M 44 8 L 41 8 M 41 5 L 41 8" />
        <path d="M 4 40 L 7 40 M 7 43 L 7 40" />
        <path d="M 44 40 L 41 40 M 41 43 L 41 40" />
      </g>

      {/* Hidden Projection / Dashed Construction Lines */}
      <g stroke="#38bdf8" strokeOpacity="0.45" strokeWidth="1.1" strokeDasharray="2 1.5">
        <path d="M 11 31 L 22 25 L 33 31" />
        <line x1="22" y1="25" x2="22" y2="13" />
      </g>

      {/* Isometric Engineering Block */}
      <polygon
        points="22,13 33,19 22,25 11,19"
        fill="#38bdf8"
        fillOpacity="0.14"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <ellipse
        cx="22"
        cy="19"
        rx="5"
        ry="2.6"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.2"
        strokeDasharray="2.5 1.5"
        strokeOpacity="0.9"
      />
      <g stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.75">
        <line x1="19.5" y1="19" x2="24.5" y2="19" />
        <line x1="22" y1="17.5" x2="22" y2="20.5" />
      </g>

      <polygon
        points="11,19 22,25 22,37 11,31"
        fill="#0284c7"
        fillOpacity="0.22"
        stroke="#38bdf8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="22,25 33,19 33,31 22,37"
        fill="#0369a1"
        fillOpacity="0.35"
        stroke="#38bdf8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Dimension Witness Lines */}
      <g stroke="#38bdf8" strokeOpacity="0.75" strokeWidth="0.9">
        <line x1="10" y1="19" x2="6.5" y2="19" />
        <line x1="10" y1="31" x2="6.5" y2="31" />
        <line x1="7.5" y1="19" x2="7.5" y2="31" />
        <path d="M 6 20.5 L 9 17.5 M 6 32.5 L 9 29.5" strokeWidth="1" />
      </g>

      {/* Compass Construction Arc */}
      <path
        d="M 28 8.5 A 13 13 0 0 1 39 19.5"
        fill="none"
        stroke="#38bdf8"
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeDasharray="2 2"
      />

      {/* Drafting Pencil / Technical Stylus */}
      <g id="drafting-stylus">
        <circle cx="33" cy="31" r="3.5" fill={`url(#${sparkGradId})`} />
        <circle cx="33" cy="31" r="1.2" fill="#ffffff" />
        <polygon points="33,31 34.8,28.8 36.6,30.6" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.4" />
        <polygon points="34.8,28.8 36.6,30.6 38.6,28.6 36.8,26.8" fill="#fed7aa" stroke="#d97706" strokeWidth="0.5" />
        <polygon points="36.8,26.8 38.6,28.6 39.8,27.4 38,25.6" fill="#f59e0b" />
        <polygon points="38,25.6 39.8,27.4 44.4,22.8 42.6,21" fill="#0284c7" stroke="#38bdf8" strokeWidth="0.6" />
        <line x1="38.9" y1="26.5" x2="43.5" y2="21.9" stroke="#7dd3fc" strokeWidth="0.6" />
      </g>
    </svg>
  );
};

export const DraftingTriangleIcon: React.FC<AnsatzSketchIconProps> = (props) => (
  <AnsatzSketchIcon color={props.color ?? "currentColor"} size={props.size ?? 16} {...props} variant="triangle" />
);

export { AnsatzSketchIcon as SketchIcon };
export default AnsatzSketchIcon;
