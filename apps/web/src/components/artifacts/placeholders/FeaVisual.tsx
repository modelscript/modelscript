// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VisualProps } from "./types";

export const FeaVisual: React.FC<VisualProps> = ({ isDark, strokeColor }) => (
  <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
    <defs>
      <linearGradient id="feaGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#2563eb" stopOpacity="0.4" />
        <stop offset="50%" stopColor="#10b981" stopOpacity="0.4" />
        <stop offset="75%" stopColor="#f59e0b" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#ef4444" stopOpacity="0.6" />
      </linearGradient>
    </defs>
    {/* Triangular & Quadrilateral Finite Element Mesh */}
    <polygon points="100,50 160,40 150,110 80,100" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    <polygon points="160,40 230,45 220,115 150,110" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    <polygon points="230,45 300,60 280,125 220,115" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    <polygon points="80,100 150,110 140,175 70,160" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    <polygon points="150,110 220,115 210,180 140,175" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    <polygon points="220,115 280,125 270,185 210,180" fill="url(#feaGrad)" stroke={strokeColor} strokeWidth="1.5" />
    {/* Node markers */}
    {[
      [100, 50],
      [160, 40],
      [230, 45],
      [300, 60],
      [80, 100],
      [150, 110],
      [220, 115],
      [280, 125],
      [70, 160],
      [140, 175],
      [210, 180],
      [270, 185],
    ].map(([x, y], idx) => (
      <circle
        key={idx}
        cx={x}
        cy={y}
        r="3.5"
        fill="#38bdf8"
        stroke={isDark ? "#0f172a" : "#ffffff"}
        strokeWidth="1.5"
      />
    ))}
  </svg>
);
