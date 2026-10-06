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
