// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

// Shared, theme-aware tab strip (was a copy with a hardcoded dark background).
export { PageTab as Tab, PageTabBar as TabBar } from "../../components/SharedStyles";

export const PackagesHeader = styled.header`
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  border-bottom: 1px solid var(--color-border);
`;

export const HeaderTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export const HeaderTitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

export const HeaderTitle = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 24px;
  color: var(--color-text-heading);
`;

export const ResultCount = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  background: var(--ms-surface-hover);
  border: 1px solid var(--color-border);
  padding: 1px 8px;
  border-radius: 9999px;
  line-height: 18px;
`;

export const HeaderActionsGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

export const ScopeSegmentedControl = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 8px;
  background: var(--ms-surface-hover);
  border: 1px solid var(--color-border);
  height: 32px;
  box-sizing: border-box;
`;

export const ScopeSegmentButton = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: none;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  background: ${(p) => (p.$active ? "var(--color-bg-card)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  box-shadow: ${(p) => (p.$active ? "0 1px 2px rgba(15, 23, 42, 0.08)" : "none")};

  &:hover {
    color: var(--color-text-heading);
  }
`;

export const HeaderControlsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

export const SearchFieldWrapper = styled.div`
  flex: 1 1 240px;
  min-width: 0;
  height: 36px;
  padding: 0 8px 0 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg));
  border: 1px solid var(--color-search-border);
  box-sizing: border-box;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background-color 0.18s ease;

  > svg {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: color 0.18s ease;
  }

  &:hover:not(:focus-within) {
    border-color: var(--color-border-strong);
  }

  &:focus-within {
    background: color-mix(in srgb, var(--color-bg-primary) 92%, var(--color-search-bg));
    border-color: var(--ms-brand);
    box-shadow: var(--ms-focus-ring);

    > svg {
      color: var(--ms-brand);
    }

    .search-kbd-hint {
      opacity: 0;
      pointer-events: none;
    }
  }

  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 13.5px;
    line-height: 20px;
    color: var(--color-text-primary);
    outline: none;

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.72;
    }
  }
`;

export const SearchClearButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
  }
`;

export const SearchKbdHint = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 20px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--ms-surface-hover);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  user-select: none;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
`;

export const ToolbarSelectWrapper = styled.div<{ $active?: boolean | undefined }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 36px;
  border-radius: 8px;
  background: ${(p) =>
    p.$active ? "var(--ms-brand-soft)" : "color-mix(in srgb, var(--color-bg-primary) 75%, var(--color-search-bg))"};
  border: 1px solid
    ${(p) =>
      p.$active ? "color-mix(in srgb, var(--ms-brand) 45%, var(--color-search-border))" : "var(--color-search-border)"};
  color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-primary)")};
  box-sizing: border-box;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-border-strong)")};
  }

  &:focus-within {
    border-color: var(--ms-brand);
    box-shadow: var(--ms-focus-ring);
  }

  .select-leading {
    position: absolute;
    left: 10px;
    display: inline-flex;
    align-items: center;
    color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-muted)")};
    pointer-events: none;
  }

  .select-trailing {
    position: absolute;
    right: 8px;
    display: inline-flex;
    align-items: center;
    color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-muted)")};
    pointer-events: none;
  }

  select {
    appearance: none;
    -webkit-appearance: none;
    height: 100%;
    padding: 0 26px 0 30px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: ${(p) => (p.$active ? 600 : 500)};
    font-family: inherit;
    cursor: pointer;
    outline: none;

    &:focus,
    &:focus-visible {
      outline: none;
    }

    option {
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
    }
  }
`;

export const CardList = styled.div`
  display: flex;
  flex-direction: column;
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
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-border)")};
  background: ${(p) => (p.$active ? "var(--ms-brand-soft)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--ms-brand);
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
        return "rgba(217, 119, 6, 0.12)";
      case "sysml2":
      case "sysml":
        return "rgba(147, 51, 234, 0.12)";
      case "cad":
      case "step":
      case "scad":
        return "rgba(8, 145, 178, 0.12)";
      case "fmu":
      case "ssp":
        return "rgba(225, 29, 72, 0.12)";
      case "dataset":
      case "csv":
        return "rgba(37, 99, 235, 0.12)";
      case "power":
      case "pscad":
        return "rgba(2, 132, 199, 0.12)";
      case "robotics":
      case "urdf":
        return "rgba(5, 150, 105, 0.12)";
      case "hydraulics":
      case "epanet":
        return "rgba(14, 165, 233, 0.12)";
      case "verification":
        return "rgba(79, 70, 229, 0.12)";
      case "cfd":
      case "fea":
        return "rgba(99, 102, 241, 0.12)";
      default:
        return "rgba(100, 116, 139, 0.12)";
    }
  }};
  color: ${(p) => {
    switch (p.$domain) {
      case "modelica":
        return "#d97706";
      case "sysml2":
      case "sysml":
        return "#9333ea";
      case "cad":
      case "step":
      case "scad":
        return "#0891b2";
      case "fmu":
      case "ssp":
        return "#e11d48";
      case "dataset":
      case "csv":
        return "#2563eb";
      case "power":
      case "pscad":
        return "#0284c7";
      case "robotics":
      case "urdf":
        return "#059669";
      case "hydraulics":
      case "epanet":
        return "#0284c7";
      case "verification":
        return "#4f46e5";
      case "cfd":
      case "fea":
        return "#4f46e5";
      default:
        return "var(--color-text-muted)";
    }
  }};
`;
