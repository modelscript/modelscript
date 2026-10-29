// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface VsCodeIconProps {
  size?: number | undefined;
  color?: string | undefined;
  style?: React.CSSProperties | undefined;
  className?: string | undefined;
}

/**
 * Recognizable Visual Studio Code ribbon glyph SVG.
 */
export const VsCodeIcon: React.FC<VsCodeIconProps> = ({ size = 15, color = "currentColor", style, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style }}
    aria-hidden="true"
  >
    <path
      d="M17.583 2.222L9.31 9.818 4.442 6.01a.912.912 0 0 0-1.158.062L1.89 7.35a.915.915 0 0 0-.003 1.347L5.61 12l-3.723 3.303a.915.915 0 0 0 .003 1.347l1.394 1.278a.912.912 0 0 0 1.158.062l4.868-3.808 8.273 7.596a1.14 1.14 0 0 0 1.884-.854V3.076a1.14 1.14 0 0 0-1.884-.854zM17.5 16.59L12.18 12 17.5 7.41v9.18z"
      fill={color}
    />
  </svg>
);

export default VsCodeIcon;
