// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VisualProps } from "./types";

export const CadVisual: React.FC<VisualProps> = ({ isDark, strokeColor, accentSecondary }) => (
  <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
    {/* Isometric 3D Mechanical Assembly Wireframe */}
    <g transform="translate(200, 112)">
      {/* Top face */}
      <polygon
        points="0,-60 70,-25 0,10 -70,-25"
        fill={isDark ? "rgba(56, 189, 248, 0.15)" : "rgba(2, 132, 199, 0.15)"}
        stroke={strokeColor}
        strokeWidth="2"
      />
      {/* Right face */}
      <polygon
        points="70,-25 70,45 0,80 0,10"
        fill={isDark ? "rgba(168, 85, 247, 0.15)" : "rgba(124, 58, 237, 0.15)"}
        stroke={accentSecondary}
        strokeWidth="2"
      />
      {/* Left face */}
      <polygon
        points="-70,-25 0,10 0,80 -70,45"
        fill={isDark ? "rgba(30, 41, 59, 0.4)" : "rgba(226, 232, 240, 0.5)"}
        stroke={strokeColor}
        strokeWidth="2"
      />
      {/* Inner bore / cylinder cutout */}
      <ellipse cx="0" cy="-25" rx="30" ry="15" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeDasharray="3 2" />
      <line x1="-30" y1="-25" x2="-30" y2="40" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
      <line x1="30" y1="-25" x2="30" y2="40" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
      {/* Coordinate axes */}
      <line x1="-120" y1="60" x2="-80" y2="60" stroke="#ef4444" strokeWidth="2" />
      <text x="-75" y="64" fill="#ef4444" fontSize="10" fontWeight="bold">
        X
      </text>
      <line x1="-120" y1="60" x2="-100" y2="25" stroke="#10b981" strokeWidth="2" />
      <text x="-98" y="22" fill="#10b981" fontSize="10" fontWeight="bold">
        Y
      </text>
      <line x1="-120" y1="60" x2="-140" y2="85" stroke="#3b82f6" strokeWidth="2" />
      <text x="-150" y="92" fill="#3b82f6" fontSize="10" fontWeight="bold">
        Z
      </text>
    </g>
  </svg>
);
