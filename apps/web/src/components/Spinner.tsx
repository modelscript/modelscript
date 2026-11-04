// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import React from "react";

export type SpinnerSize = "small" | "medium" | "large" | number;

export interface SpinnerProps extends Omit<React.ComponentPropsWithoutRef<typeof SyncIcon>, "size"> {
  /**
   * Predefined or numeric size for the spinner:
   * - 'small': 16px (matches PackageCardItem & inline button spinners)
   * - 'medium': 24px (standard tab and panel spinner)
   * - 'large': 32px (matches LibraryListPage package loading spinner)
   * - number: custom pixel dimension
   * Defaults to 'medium'.
   */
  size?: SpinnerSize;
  /** Fill color for the spinner icon. Defaults to "var(--color-text-muted)". */
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
  fill = "var(--color-text-muted)",
  className,
  srText = "Loading...",
  style,
  ...rest
}) => {
  const pixelSize = typeof size === "number" ? size : (SIZE_MAP[size] ?? 24);
  const classes = ["spinner-spin", className].filter(Boolean).join(" ");

  return (
    <SyncIcon
      size={pixelSize}
      fill={fill}
      className={classes}
      role="status"
      aria-label={rest["aria-label"] || (srText ?? undefined)}
      style={{
        transformOrigin: "center",
        verticalAlign: "middle",
        display: "inline-block",
        ...style,
      }}
      {...rest}
    />
  );
};

export default Spinner;
