// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";

interface ArtifactPlaceholderProps {
  type?: "cfd" | "fea" | "cad" | "pdf" | "generic" | string;
  title?: string;
  aspectRatio?: string;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

const Wrapper = styled.div<{ $aspectRatio?: string; $height?: string | number }>`
  position: relative;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  height: ${(props) =>
    props.$height ? (typeof props.$height === "number" ? `${props.$height}px` : props.$height) : "auto"};
  ${(props) => (!props.$height ? `aspect-ratio: ${props.$aspectRatio || "16 / 9"};` : "")}
  min-height: 180px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
`;

export const ArtifactPlaceholder: React.FC<ArtifactPlaceholderProps> = ({
  type = "generic",
  title,
  aspectRatio,
  height,
  className,
  style,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const normType = type?.toLowerCase() || "generic";

  const bgGradient = isDark
    ? "linear-gradient(135deg, #090d16 0%, #111827 50%, #0d1527 100%)"
    : "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #edf2f7 100%)";

  const gridColor = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)";
  const strokeColor = isDark ? "#38bdf8" : "#0284c7";
  const accentSecondary = isDark ? "#a855f7" : "#7c3aed";

  const renderVisual = () => {
    switch (normType) {
      case "cfd":
      case "cfd-result":
      case "cfd-animation":
        return (
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

      case "fea":
      case "fea-result":
        return (
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
            <polygon
              points="100,50 160,40 150,110 80,100"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <polygon
              points="160,40 230,45 220,115 150,110"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <polygon
              points="230,45 300,60 280,125 220,115"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <polygon
              points="80,100 150,110 140,175 70,160"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <polygon
              points="150,110 220,115 210,180 140,175"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            <polygon
              points="220,115 280,125 270,185 210,180"
              fill="url(#feaGrad)"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
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

      case "cad":
      case "cad-step":
      case "3d-model":
        return (
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
              <ellipse
                cx="0"
                cy="-25"
                rx="30"
                ry="15"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                strokeDasharray="3 2"
              />
              <line
                x1="-30"
                y1="-25"
                x2="-30"
                y2="40"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="3 2"
                opacity="0.6"
              />
              <line
                x1="30"
                y1="-25"
                x2="30"
                y2="40"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="3 2"
                opacity="0.6"
              />
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

      case "pdf":
      case "tei-document":
        return (
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
              <line
                x1="20"
                y1="52"
                x2="100"
                y2="52"
                stroke={strokeColor}
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.6"
              />
              <line
                x1="20"
                y1="66"
                x2="90"
                y2="66"
                stroke={strokeColor}
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.6"
              />
              <line
                x1="20"
                y1="80"
                x2="95"
                y2="80"
                stroke={strokeColor}
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.6"
              />
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

      case "fmu":
      case "fmi":
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="fmuGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <g transform="translate(200, 112)">
              {/* Co-simulation block */}
              <rect
                x="-80"
                y="-55"
                width="160"
                height="110"
                rx="10"
                fill="url(#fmuGrad)"
                stroke="#a78bfa"
                strokeWidth="2"
              />
              <text
                x="0"
                y="-30"
                textAnchor="middle"
                fill="#c4b5fd"
                fontSize="11"
                fontWeight="bold"
                fontFamily="monospace"
              >
                FMI 2.0 / 3.0
              </text>
              {/* Differential state indicator */}
              <text
                x="0"
                y="-8"
                textAnchor="middle"
                fill="#38bdf8"
                fontSize="13"
                fontWeight="bold"
                fontFamily="monospace"
              >
                dx/dt = f(x, u, t)
              </text>
              <text x="0" y="14" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                y = g(x, u, t)
              </text>
              {/* Mini dynamic step response inside the block */}
              <path d="M -50 38 Q -30 38, -20 22 T 0 25 T 20 24 T 50 24" fill="none" stroke="#22d3ee" strokeWidth="2" />
              {/* Input pins */}
              <line x1="-120" y1="-20" x2="-80" y2="-20" stroke="#60a5fa" strokeWidth="2" />
              <circle cx="-120" cy="-20" r="4" fill="#60a5fa" />
              <text x="-128" y="-16" textAnchor="end" fill="#60a5fa" fontSize="9" fontFamily="monospace">
                u1
              </text>
              <line x1="-120" y1="20" x2="-80" y2="20" stroke="#60a5fa" strokeWidth="2" />
              <circle cx="-120" cy="20" r="4" fill="#60a5fa" />
              <text x="-128" y="24" textAnchor="end" fill="#60a5fa" fontSize="9" fontFamily="monospace">
                u2
              </text>
              {/* Output pins */}
              <line x1="80" y1="0" x2="120" y2="0" stroke="#34d399" strokeWidth="2" />
              <circle cx="120" cy="0" r="4" fill="#34d399" />
              <text x="128" y="4" textAnchor="start" fill="#34d399" fontSize="9" fontFamily="monospace">
                y1
              </text>
            </g>
          </svg>
        );

      case "sysml":
      case "kerml":
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <g transform="translate(200, 112)">
              {/* Root System Block */}
              <rect
                x="-140"
                y="-70"
                width="280"
                height="140"
                rx="8"
                fill={isDark ? "rgba(30, 58, 138, 0.15)" : "rgba(219, 234, 254, 0.4)"}
                stroke="#3b82f6"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
              <text x="-128" y="-52" fill="#60a5fa" fontSize="10" fontWeight="bold" fontFamily="monospace">
                «system» SystemArchitecture
              </text>
              {/* Sub-part 1: Controller */}
              <rect
                x="-120"
                y="-35"
                width="100"
                height="50"
                rx="6"
                fill={isDark ? "rgba(15, 23, 42, 0.8)" : "#ffffff"}
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
              <text
                x="-70"
                y="-18"
                textAnchor="middle"
                fill="#38bdf8"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                fc: Avionics
              </text>
              <text x="-70" y="-2" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">
                port pwrIn
              </text>
              {/* Sub-part 2: Plant / Actuator */}
              <rect
                x="20"
                y="-35"
                width="100"
                height="50"
                rx="6"
                fill={isDark ? "rgba(15, 23, 42, 0.8)" : "#ffffff"}
                stroke="#a855f7"
                strokeWidth="1.5"
              />
              <text
                x="70"
                y="-18"
                textAnchor="middle"
                fill="#c084fc"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                act: Motor[4]
              </text>
              <text x="70" y="-2" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">
                port ctrlIn
              </text>
              {/* Port connection line */}
              <line x1="-20" y1="-10" x2="20" y2="-10" stroke="#34d399" strokeWidth="2" strokeDasharray="2 2" />
              <circle cx="-20" cy="-10" r="3" fill="#34d399" />
              <circle cx="20" cy="-10" r="3" fill="#34d399" />
              {/* Requirement validation shield */}
              <g transform="translate(0, 42)">
                <rect
                  x="-90"
                  y="-12"
                  width="180"
                  height="24"
                  rx="12"
                  fill={isDark ? "rgba(16, 185, 129, 0.15)" : "rgba(209, 250, 229, 0.7)"}
                  stroke="#10b981"
                  strokeWidth="1.2"
                />
                <circle cx="-74" cy="0" r="5" fill="#10b981" />
                <text x="-62" y="4" fill="#34d399" fontSize="9.5" fontWeight="bold" fontFamily="monospace">
                  REQ-01: Verified [Pass]
                </text>
              </g>
            </g>
          </svg>
        );

      case "dataset":
      case "csv":
      case "tsv":
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <g transform="translate(70, 32)">
              {/* Table header */}
              <rect
                x="0"
                y="0"
                width="260"
                height="28"
                rx="4"
                fill={isDark ? "rgba(6, 182, 212, 0.18)" : "rgba(207, 250, 254, 0.8)"}
                stroke="#06b6d4"
                strokeWidth="1.5"
              />
              <text x="20" y="18" fill="#22d3ee" fontSize="10.5" fontWeight="bold" fontFamily="monospace">
                id
              </text>
              <text x="80" y="18" fill="#22d3ee" fontSize="10.5" fontWeight="bold" fontFamily="monospace">
                timestamp_s
              </text>
              <text x="180" y="18" fill="#22d3ee" fontSize="10.5" fontWeight="bold" fontFamily="monospace">
                torque_nm
              </text>
              {/* Rows */}
              {[
                { id: "001", t: "0.00", v: "12.45" },
                { id: "002", t: "0.05", v: "24.81" },
                { id: "003", t: "0.10", v: "36.90" },
                { id: "004", t: "0.15", v: "41.20" },
              ].map((row, idx) => (
                <g key={row.id} transform={`translate(0, ${36 + idx * 24})`}>
                  <rect
                    x="0"
                    y="0"
                    width="260"
                    height="20"
                    rx="3"
                    fill={
                      idx % 2 === 0 ? (isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)") : "transparent"
                    }
                  />
                  <text x="20" y="14" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                    {row.id}
                  </text>
                  <text x="80" y="14" fill={isDark ? "#e2e8f0" : "#334155"} fontSize="10" fontFamily="monospace">
                    {row.t}
                  </text>
                  <text x="180" y="14" fill="#a78bfa" fontSize="10" fontFamily="monospace">
                    {row.v}
                  </text>
                  {/* Mini horizontal distribution bar */}
                  <rect x="225" y="6" width={Number(row.v) * 0.7} height="7" rx="2" fill="#38bdf8" opacity="0.7" />
                </g>
              ))}
              {/* Total count footer */}
              <text x="130" y="148" textAnchor="middle" fill="#64748b" fontSize="9.5" fontFamily="monospace">
                ── 10,000+ entries &bull; 8 profiled columns ──
              </text>
            </g>
          </svg>
        );

      case "gcode":
      case "cam":
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <g transform="translate(200, 112)">
              {/* Build plate grid in perspective */}
              <polygon
                points="-100,40 0,75 100,40 0,5"
                fill={isDark ? "rgba(30, 41, 59, 0.5)" : "rgba(226, 232, 240, 0.6)"}
                stroke={isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"}
                strokeWidth="1.5"
              />
              <line
                x1="-50"
                y1="22"
                x2="50"
                y2="58"
                stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0,0,0,0.08)"}
                strokeDasharray="3 3"
              />
              <line
                x1="-50"
                y1="58"
                x2="50"
                y2="22"
                stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0,0,0,0.08)"}
                strokeDasharray="3 3"
              />
              {/* Extruder nozzle */}
              <polygon points="0,-40 -12,-65 12,-65" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
              <circle cx="0" cy="-38" r="2.5" fill="#ef4444" />
              {/* Rapid travel move (G0, cyan dashed) */}
              <path
                d="M -70 20 Q -40 -10, 0 -38"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.8"
                strokeDasharray="4 3"
              />
              {/* Extrusion path (G1, green solid) */}
              <path
                d="M -60 30 L -20 45 L 20 40 L 40 25 L 10 15 L -30 20 Z"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
              />
              {/* Coordinate axis chip */}
              <text x="75" y="70" fill="#38bdf8" fontSize="9" fontFamily="monospace" fontWeight="bold">
                X Y Z
              </text>
            </g>
          </svg>
        );

      case "plot":
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            <g transform="translate(60, 25)">
              {/* Coordinate axes */}
              <line x1="20" y1="160" x2="300" y2="160" stroke={strokeColor} strokeWidth="1.5" opacity="0.6" />
              <line x1="20" y1="20" x2="20" y2="160" stroke={strokeColor} strokeWidth="1.5" opacity="0.6" />
              {/* Horizontal grid lines */}
              <line
                x1="20"
                y1="60"
                x2="300"
                y2="60"
                stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
                strokeDasharray="3 3"
              />
              <line
                x1="20"
                y1="110"
                x2="300"
                y2="110"
                stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
                strokeDasharray="3 3"
              />
              {/* Harmonic curve 1 (Cyan) */}
              <path
                d="M 20 160 Q 60 40, 100 90 T 180 100 T 260 95 T 300 95"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2.5"
              />
              {/* Harmonic curve 2 (Purple) */}
              <path
                d="M 20 160 Q 80 180, 130 70 T 210 120 T 300 115"
                fill="none"
                stroke="#a855f7"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
              {/* Channel legend pills */}
              <rect
                x="200"
                y="24"
                width="42"
                height="16"
                rx="4"
                fill="rgba(6, 182, 212, 0.15)"
                stroke="#06b6d4"
                strokeWidth="1"
              />
              <text x="221" y="35" textAnchor="middle" fill="#22d3ee" fontSize="8.5" fontFamily="monospace">
                ch1: pos
              </text>
              <rect
                x="250"
                y="24"
                width="42"
                height="16"
                rx="4"
                fill="rgba(168, 85, 247, 0.15)"
                stroke="#a855f7"
                strokeWidth="1"
              />
              <text x="271" y="35" textAnchor="middle" fill="#c084fc" fontSize="8.5" fontFamily="monospace">
                ch2: vel
              </text>
            </g>
          </svg>
        );

      default:
        return (
          <svg viewBox="0 0 400 225" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
            {/* System Dynamics Bond Graph & Block Diagram */}
            <g transform="translate(200, 112)">
              <circle
                cx="-90"
                cy="0"
                r="28"
                fill={isDark ? "rgba(56, 189, 248, 0.15)" : "rgba(2, 132, 199, 0.15)"}
                stroke={strokeColor}
                strokeWidth="2"
              />
              <text x="-90" y="5" textAnchor="middle" fill={strokeColor} fontSize="12" fontWeight="bold">
                INPUT
              </text>
              <rect
                x="-30"
                y="-24"
                width="60"
                height="48"
                rx="6"
                fill={isDark ? "rgba(168, 85, 247, 0.15)" : "rgba(124, 58, 237, 0.15)"}
                stroke={accentSecondary}
                strokeWidth="2"
              />
              <text x="0" y="5" textAnchor="middle" fill={accentSecondary} fontSize="12" fontWeight="bold">
                PLANT
              </text>
              <circle
                cx="90"
                cy="0"
                r="28"
                fill={isDark ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.15)"}
                stroke="#10b981"
                strokeWidth="2"
              />
              <text x="90" y="5" textAnchor="middle" fill="#10b981" fontSize="12" fontWeight="bold">
                STATE
              </text>
              {/* Connecting signal lines */}
              <line x1="-62" y1="0" x2="-30" y2="0" stroke={strokeColor} strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="30" y1="0" x2="62" y2="0" stroke={accentSecondary} strokeWidth="2" />
              {/* Feedback loop */}
              <path
                d="M 90 28 Q 90 60, 0 60 Q -90 60, -90 28"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
            </g>
          </svg>
        );
    }
  };

  const getBadgeLabel = () => {
    switch (normType) {
      case "cfd":
      case "cfd-result":
      case "cfd-animation":
        return "CFD · FLUID DYNAMICS";
      case "fea":
      case "fea-result":
        return "FEA · STRUCTURAL TENSOR";
      case "cad":
      case "cad-step":
      case "3d-model":
        return "3D CAD · STEP GEOMETRY";
      case "gcode":
      case "cam":
        return "CAM · G-CODE TOOLPATH";
      case "fmu":
      case "fmi":
        return "FMI · CO-SIMULATION FMU";
      case "sysml":
      case "kerml":
        return "SYSML V2 · ARCHITECTURE";
      case "dataset":
      case "csv":
      case "tsv":
        return "DATASET · TABULAR MATRIX";
      case "plot":
        return "SIMULATION · TIME SERIES";
      case "pdf":
      case "tei-document":
        return "SPECIFICATION · TEI / PDF";
      default:
        return "MODELICA · SIMULATION ARTIFACT";
    }
  };

  return (
    <Wrapper
      $aspectRatio={aspectRatio}
      $height={height}
      className={className}
      style={{
        background: bgGradient,
        backgroundImage: `radial-gradient(${gridColor} 1px, transparent 1px), ${bgGradient}`,
        backgroundSize: "20px 20px, 100% 100%",
        border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
        ...style,
      }}
    >
      {renderVisual()}

      {/* Futuristic technical badge overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.9)",
          border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.3)" : "rgba(2, 132, 199, 0.3)"}`,
          backdropFilter: "blur(6px)",
          padding: "4px 10px",
          borderRadius: "9999px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: isDark ? "#38bdf8" : "#0284c7",
            boxShadow: `0 0 6px ${isDark ? "#38bdf8" : "#0284c7"}`,
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            fontWeight: "bold",
            letterSpacing: "0.5px",
            color: isDark ? "#e2e8f0" : "#1e293b",
          }}
        >
          {title || getBadgeLabel()}
        </span>
      </div>
    </Wrapper>
  );
};

export default ArtifactPlaceholder;
