// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const PlaygroundContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  background-color: var(--color-canvas-default);
  overflow: hidden;
  position: relative;
`;

export const PlaygroundNavbar = styled.header`
  height: 44px;
  min-height: 44px;
  background-color: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 20;
  container-type: inline-size;
  overflow: hidden;

  @media (max-width: 768px) {
    padding: 0 8px;
    gap: 6px;
  }

  @container (max-width: 1400px) {
    .nav-hide-xl {
      display: none !important;
    }
    .nav-icon-only-xl [data-component="text"],
    .nav-icon-only-xl span {
      display: none !important;
    }
  }

  @media (max-width: 1400px) {
    .nav-hide-xl {
      display: none !important;
    }
    .nav-icon-only-xl [data-component="text"],
    .nav-icon-only-xl span {
      display: none !important;
    }
  }

  @container (max-width: 1240px) {
    .nav-hide-lg {
      display: none !important;
    }
  }

  @media (max-width: 1240px) {
    .nav-hide-lg {
      display: none !important;
    }
  }

  @container (max-width: 960px) {
    .nav-hide-md {
      display: none !important;
    }
  }

  @media (max-width: 960px) {
    .nav-hide-md {
      display: none !important;
    }
  }

  @container (max-width: 768px) {
    .nav-hide-sm {
      display: none !important;
    }
  }

  @media (max-width: 768px) {
    .nav-hide-sm {
      display: none !important;
    }
  }
`;

export const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  white-space: nowrap;

  @media (max-width: 768px) {
    gap: 4px;
  }
`;

export const NavCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 0;
  gap: 6px;

  /* Modernized, sleek engineering workbench segmented control */
  ul[data-size="small"] {
    background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(0, 0, 0, 0.04)));
    border: 1px solid var(--ms-divider, var(--color-border-subtle, rgba(15, 23, 42, 0.1)));
    border-radius: var(--ms-radius-pill, 999px);
    padding: 2px;
    gap: 2px;
    height: 30px;
    box-sizing: border-box;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  /* Segmented control items */
  li {
    margin: 0 !important;
  }

  li::after {
    display: none !important; /* Remove harsh 1px tick separators */
  }

  /* Button styling */
  ul[data-size="small"] button,
  li button {
    border: 1px solid transparent !important;
    outline: none !important;
    border-radius: var(--ms-radius-pill, 999px) !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease !important;
    height: 100% !important;
    padding: 0 10px !important;
    box-sizing: border-box !important;
  }

  /* Remove any inner borders from Primer's internal content wrapper and neutralize differing padding */
  ul[data-size="small"] button span,
  ul[data-size="small"] button [class*="Content"],
  ul[data-size="small"] button [class*="Content"] * {
    border: none !important;
    border-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }

  ul[data-size="small"] button [class*="Content"] {
    padding: 0 !important;
  }

  /* Prevent Primer hidden pseudo-element from reserving bold width or causing jitter */
  [class*="Text"]::after,
  .segmentedControl-text::after {
    display: none !important;
  }

  /* Inactive button hover */
  ul[data-size="small"] button:not([aria-current="true"]):hover,
  li button:not([aria-current="true"]):hover {
    background-color: var(
      --color-action-list-item-default-hover-bg,
      var(--ms-surface-hover, rgba(125, 125, 125, 0.08))
    ) !important;
    color: var(--color-fg-default) !important;
  }

  /* Active selected button styling matching ModelScript dialect chip background and brand blue border */
  ul[data-size="small"] button[aria-current="true"],
  li button[aria-current="true"] {
    border: 1px solid var(--ms-brand, #0891b2) !important;
    border-radius: var(--ms-radius-pill, 999px) !important;
    outline: none !important;
    font-weight: 600 !important;
    background-color: var(--ms-brand-soft, rgba(8, 145, 178, 0.12)) !important;
    color: var(--ms-brand, #0891b2) !important;
    box-shadow: 0 1px 4px var(--ms-glow-cyan, rgba(8, 145, 178, 0.2)) !important;
    padding: 0 10px !important;
  }

  ul[data-size="small"] button[aria-current="true"] [class*="Content"],
  li button[aria-current="true"] [class*="Content"] {
    border: none !important;
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none !important;
    padding: 0 !important;
  }

  ul[data-size="small"] button[aria-current="true"] svg,
  li button[aria-current="true"] svg {
    color: var(--ms-brand, #0891b2) !important;
    fill: var(--ms-brand, #0891b2) !important;
  }

  /* Responsive label collapse: at <= 1280px, collapse button text so tabs fit comfortably without crowding */
  @container (max-width: 1280px) {
    ul[data-size="small"] button,
    li button {
      padding: 0 8px !important;
    }
    .segmentedControl-text {
      display: none !important;
    }
  }

  @media (max-width: 1280px) {
    ul[data-size="small"] button,
    li button {
      padding: 0 8px !important;
    }
    /* Primer renders span.segmentedControl-content > (icon div, div.segmentedControl-text).
       Hide only the text so icons remain; accessible name comes from aria-label. */
    .segmentedControl-text {
      display: none !important;
    }
  }

  @container (max-width: 640px) {
    display: none;
  }

  @media (max-width: 640px) {
    display: none;
  }
`;

export const SplitToggleButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--ms-radius-pill, 999px);
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
  user-select: none;
  outline: none;
  flex-shrink: 0;
  background: ${(props) =>
    props.$active
      ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))"
      : "var(--ms-surface-hover, var(--color-canvas-subtle, rgba(0, 0, 0, 0.04)))"};
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--ms-brand, #0891b2)"
        : "var(--ms-divider, var(--color-border-subtle, rgba(15, 23, 42, 0.1)))"};
  color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--color-fg-muted))")};
  box-shadow: ${(props) =>
    props.$active ? "0 1px 4px var(--ms-glow-cyan, rgba(8, 145, 178, 0.2))" : "inset 0 1px 2px rgba(0, 0, 0, 0.03)"};

  svg {
    color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "currentColor")};
    fill: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "currentColor")};
    flex-shrink: 0;
  }

  &:hover:not(:disabled) {
    background: ${(props) =>
      props.$active
        ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))"
        : "var(--color-action-list-item-default-hover-bg, var(--ms-surface-hover, rgba(125, 125, 125, 0.08)))"};
    color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "var(--color-fg-default)")};
    border-color: ${(props) => (props.$active ? "var(--ms-brand, #0891b2)" : "var(--color-border-default)")};
  }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
    background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(0, 0, 0, 0.04)));
    border: 1px solid var(--ms-divider, var(--color-border-subtle, rgba(15, 23, 42, 0.06)));
    color: var(--ms-text-3, var(--color-fg-muted));
    box-shadow: none;
  }

  @container (max-width: 1280px) {
    padding: 0 8px;
    span {
      display: none !important;
    }
  }

  @media (max-width: 1280px) {
    padding: 0 8px;
    span {
      display: none !important;
    }
  }
`;

export const NavRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
  flex-shrink: 0;
  white-space: nowrap;

  @media (max-width: 768px) {
    gap: 4px;
  }
`;

export const BrandLink = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--color-fg-default);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    text-decoration: none;
    opacity: 0.85;
  }
`;

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ms-brand-soft);
  color: var(--ms-link);
  border: 1px solid color-mix(in srgb, var(--ms-brand) 30%, transparent);
  font-weight: 600;

  @media (max-width: 600px) {
    display: none;
  }
`;

export const NavText = styled.span`
  @media (max-width: 640px) {
    display: none;
  }
`;

export const EditorArea = styled.main`
  flex: 1;
  width: 100%;
  height: calc(100vh - 44px);
  height: calc(100dvh - 44px);
  position: relative;
  overflow: hidden;
`;

export const NavDivider = styled.span`
  width: 1px;
  height: 18px;
  background: var(--color-border-subtle, var(--ms-border, rgba(15, 23, 42, 0.12)));
  flex-shrink: 0;
  margin: 0 2px;
  @container (max-width: 900px) {
    display: none;
  }
  @media (max-width: 900px) {
    display: none;
  }
`;

export const NavBackLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: var(--ms-radius-sm, 6px);
  color: var(--color-fg-muted);
  text-decoration: none;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    text-decoration: none;
    color: var(--color-fg-default);
    background: var(--color-action-list-item-default-hover-bg, rgba(125, 125, 125, 0.08));
    border-color: var(--color-border-subtle, rgba(15, 23, 42, 0.08));
  }
`;

export const SearchTrigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle, var(--ms-border, rgba(15, 23, 42, 0.12)));
  background: var(--color-canvas-subtle, var(--ms-bg-soft, rgba(0, 0, 0, 0.04)));
  color: var(--color-fg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  box-sizing: border-box;

  &:hover {
    color: var(--color-fg-default);
    background: var(--color-canvas-default, var(--ms-surface, transparent));
    border-color: var(--color-border-default, var(--ms-border-active, rgba(15, 23, 42, 0.2)));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  kbd {
    font-size: 10px;
    font-family: inherit;
    font-weight: 500;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--color-neutral-muted, rgba(125, 125, 125, 0.15));
    border: 1px solid var(--color-border-subtle, rgba(0, 0, 0, 0.08));
    color: var(--color-fg-muted);
    letter-spacing: 0;
  }

  @container (max-width: 1200px) {
    padding: 0 8px;
    .search-label,
    kbd {
      display: none !important;
    }
  }

  @media (max-width: 1200px) {
    padding: 0 8px;
    .search-label,
    kbd {
      display: none !important;
    }
  }
`;
