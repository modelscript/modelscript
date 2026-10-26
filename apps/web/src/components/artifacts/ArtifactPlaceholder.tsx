// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import { CadVisual, CfdVisual, DocumentVisual, FeaVisual, SimulationVisual, getBadgeLabel } from "./placeholders";

export interface ArtifactPlaceholderProps {
  type?: "cfd" | "fea" | "cad" | "pdf" | "generic" | string | undefined;
  title?: string | undefined;
  aspectRatio?: string | undefined;
  height?: string | number | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

const Wrapper = styled.div<{ $aspectRatio?: string | undefined; $height?: string | number | undefined }>`
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
        return <CfdVisual isDark={isDark} strokeColor={strokeColor} accentSecondary={accentSecondary} />;
      case "fea":
      case "fea-result":
        return <FeaVisual isDark={isDark} strokeColor={strokeColor} accentSecondary={accentSecondary} />;
      case "cad":
      case "cad-step":
      case "3d-model":
        return <CadVisual isDark={isDark} strokeColor={strokeColor} accentSecondary={accentSecondary} />;
      case "pdf":
      case "tei-document":
        return <DocumentVisual isDark={isDark} strokeColor={strokeColor} accentSecondary={accentSecondary} />;
      default:
        return (
          <SimulationVisual
            normType={normType}
            isDark={isDark}
            strokeColor={strokeColor}
            accentSecondary={accentSecondary}
          />
        );
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
          {title || getBadgeLabel(normType)}
        </span>
      </div>
    </Wrapper>
  );
};

export default ArtifactPlaceholder;
