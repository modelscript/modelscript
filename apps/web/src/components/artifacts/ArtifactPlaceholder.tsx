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
  border-radius: 0;
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
    ? "radial-gradient(circle at center, #2b2e36 0%, #1f2229 55%, #14161b 100%)"
    : "radial-gradient(circle at center, #cdced0 0%, #d6d7d9 50%, #e2e3e4 100%)";
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
          backgroundColor: isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(15, 23, 42, 0.82)",
          border: "1px solid rgba(56, 189, 248, 0.35)",
          backdropFilter: "blur(6px)",
          padding: "4px 10px",
          borderRadius: "9999px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "#38bdf8",
            boxShadow: "0 0 6px #38bdf8",
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            fontWeight: "bold",
            letterSpacing: "0.5px",
            color: "#e2e8f0",
          }}
        >
          {title || getBadgeLabel(normType)}
        </span>
      </div>
    </Wrapper>
  );
};

export default ArtifactPlaceholder;
