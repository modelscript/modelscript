// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export type SpinnerSize = "small" | "medium" | "large" | number;

export interface SpinnerProps extends Omit<React.SVGProps<SVGSVGElement>, "size" | "fill"> {
  /**
   * Predefined or numeric size for the spinner:
   * - 'small': 16px (matches Library panel & inline button spinners)
   * - 'medium': 24px (standard tab and panel spinner)
   * - 'large': 32px (matches LibraryListPage package loading spinner)
   * - number: custom pixel dimension
   * Defaults to 'medium'.
   */
  size?: SpinnerSize;
  /** Color for the spinner ring and arc. Defaults to "var(--ms-spinner-color, #06b6d4)". */
  fill?: string;
  /** Accessibility text for screen readers. Defaults to "Loading...". */
  srText?: string | null;
  /** Custom CSS classes. Appended to the base "spinner-spin" animation class. */
  className?: string;
}

const SIZE_MAP: Record<"small" | "medium" | "large", number> = {
  small: 16,
  medium: 24,
  large: 32,
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = "medium",
  fill = "var(--ms-spinner-color, #06b6d4)",
  className,
  srText = "Loading...",
  style,
  ...rest
}) => {
  const pixelSize = typeof size === "number" ? size : (SIZE_MAP[size] ?? 24);
  const classes = ["ms-spinner", "spinner-spin", className].filter(Boolean).join(" ");

  return (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 24 24"
      fill="none"
      className={classes}
      role="status"
      aria-label={rest["aria-label"] || (srText ?? undefined)}
      style={{
        color: fill,
        transformOrigin: "center",
        verticalAlign: "middle",
        display: "inline-block",
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} />
      <path
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        style={{ opacity: 0.75 }}
      />
    </svg>
  );
};

export default Spinner;
