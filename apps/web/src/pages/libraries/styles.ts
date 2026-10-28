// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

// Shared, theme-aware tab strip (was a copy with a hardcoded dark background).
export { PageTab as Tab, PageTabBar as TabBar } from "../../components/SharedStyles";

export const ResultCount = styled.span`
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  margin-left: 8px;
`;

export const CardList = styled.div`
  display: flex;
  flex-direction: column;
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
