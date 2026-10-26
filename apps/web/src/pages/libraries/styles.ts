// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(6, 8, 15, 0.85);
`;

export const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 3px;
    width: 56px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

export const ResultCount = styled.span`
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  margin-left: 8px;
`;

export const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
`;

export const FilterPillBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const FilterPill = styled.button<{ $active: boolean; $color?: string | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${(p) =>
      p.$active ? p.$color || "var(--color-accent-cyan, #06b6d4)" : "var(--color-border, rgba(255, 255, 255, 0.12))"};
  background: ${(p) => (p.$active ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(p) => p.$color || "var(--color-accent-cyan, #06b6d4)"};
    color: var(--color-text-primary);
  }
`;

export const DomainBadge = styled.span<{ $domain: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: ${(p) => {
    switch (p.$domain) {
      case "modelica":
        return "rgba(234, 179, 8, 0.12)";
      case "sysml2":
        return "rgba(168, 85, 247, 0.12)";
      case "cad":
        return "rgba(6, 182, 212, 0.12)";
      case "fmu":
        return "rgba(244, 63, 94, 0.12)";
      case "dataset":
        return "rgba(59, 130, 246, 0.12)";
      default:
        return "rgba(156, 163, 175, 0.12)";
    }
  }};
  color: ${(p) => {
    switch (p.$domain) {
      case "modelica":
        return "#eab308";
      case "sysml2":
        return "#c084fc";
      case "cad":
        return "#06b6d4";
      case "fmu":
        return "#f43f5e";
      case "dataset":
        return "#60a5fa";
      default:
        return "#9ca3af";
    }
  }};
`;
