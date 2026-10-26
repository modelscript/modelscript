// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { VisualProps } from "./types";

interface SimulationVisualProps extends VisualProps {
  normType: string;
}

export const SimulationVisual: React.FC<SimulationVisualProps> = ({
  normType,
  isDark,
  strokeColor,
  accentSecondary,
}) => {
  switch (normType) {
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
                  fill={idx % 2 === 0 ? (isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)") : "transparent"}
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
            <path d="M -70 20 Q -40 -10, 0 -38" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeDasharray="4 3" />
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
