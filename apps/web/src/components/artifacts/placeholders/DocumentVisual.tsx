// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VisualProps } from "./types";

export const DocumentVisual: React.FC<VisualProps> = ({ isDark, strokeColor, accentSecondary }) => (
  <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
    {/* Engineering Document Blueprint */}
    <g transform="translate(140, 30)">
      <rect
        x="0"
        y="0"
        width="120"
        height="165"
        rx="6"
        fill={isDark ? "rgba(15, 23, 42, 0.8)" : "#ffffff"}
        stroke={strokeColor}
        strokeWidth="2"
      />
      {/* Corner fold */}
      <polygon points="95,0 120,25 95,25" fill={isDark ? "#38bdf8" : "#0284c7"} opacity="0.4" />
      {/* Text lines */}
      <line x1="20" y1="35" x2="80" y2="35" stroke={accentSecondary} strokeWidth="3" strokeLinecap="round" />
      <line x1="20" y1="52" x2="100" y2="52" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="20" y1="66" x2="90" y2="66" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="20" y1="80" x2="95" y2="80" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* Mini diagram box */}
      <rect
        x="20"
        y="98"
        width="80"
        height="42"
        rx="4"
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      <circle cx="45" cy="119" r="8" fill="none" stroke={accentSecondary} strokeWidth="1.5" />
      <circle cx="75" cy="119" r="8" fill="none" stroke="#10b981" strokeWidth="1.5" />
      <line x1="53" y1="119" x2="67" y2="119" stroke={strokeColor} strokeWidth="1.5" />
    </g>
  </svg>
);
