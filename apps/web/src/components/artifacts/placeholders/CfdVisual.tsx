// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VisualProps } from "./types";

export const CfdVisual: React.FC<VisualProps> = ({ isDark, strokeColor }) => (
  <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
    <defs>
      <linearGradient id="streamlineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.8" />
        <stop offset="50%" stopColor="#a855f7" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.7" />
      </linearGradient>
    </defs>
    {/* Aerodynamic streamline curves */}
    <path
      d="M 20 40 Q 140 20, 200 60 T 380 50"
      fill="none"
      stroke="url(#streamlineGrad)"
      strokeWidth="2.5"
      strokeDasharray="6 3"
      opacity="0.75"
    />
    <path
      d="M 20 75 Q 120 45, 180 90 T 380 85"
      fill="none"
      stroke="url(#streamlineGrad)"
      strokeWidth="3"
      opacity="0.9"
    />
    <path
      d="M 20 112 Q 110 80, 160 112 T 260 115 T 380 112"
      fill="none"
      stroke="url(#streamlineGrad)"
      strokeWidth="3.5"
      opacity="1"
    />
    <path
      d="M 20 150 Q 120 180, 180 135 T 380 140"
      fill="none"
      stroke="url(#streamlineGrad)"
      strokeWidth="3"
      opacity="0.9"
    />
    <path
      d="M 20 185 Q 140 205, 200 165 T 380 175"
      fill="none"
      stroke="url(#streamlineGrad)"
      strokeWidth="2.5"
      strokeDasharray="6 3"
      opacity="0.75"
    />
    {/* Airfoil profile obstacle */}
    <path
      d="M 140 112 Q 180 85, 240 108 Q 280 112, 290 112 Q 240 125, 180 125 Z"
      fill={isDark ? "rgba(30, 41, 59, 0.85)" : "rgba(226, 232, 240, 0.9)"}
      stroke={strokeColor}
      strokeWidth="2"
    />
    {/* Vortex curls */}
    <circle
      cx="310"
      cy="100"
      r="12"
      fill="none"
      stroke="#f43f5e"
      strokeWidth="1.5"
      strokeDasharray="4 2"
      opacity="0.8"
    />
    <circle
      cx="330"
      cy="125"
      r="16"
      fill="none"
      stroke="#f43f5e"
      strokeWidth="1.5"
      strokeDasharray="5 3"
      opacity="0.7"
    />
  </svg>
);
