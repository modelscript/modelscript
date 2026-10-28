// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const StickyHeader = styled.div`
  display: flex;
  flex-direction: row;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  align-items: center;
  background: var(--surface-hud, rgba(6, 8, 15, 0.85));
  color: var(--color-text-heading);
`;

export const CircleIconButton = styled.button<{
  $color?: string | undefined;
  $hoverColor?: string | undefined;
  $hoverBg?: string | undefined;
}>`
  background: none;
  border: none;
  color: ${(props) => props.$color || "var(--color-text-primary)"};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  transition:
    background-color 0.2s,
    color 0.2s;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    color: ${(props) => props.$hoverColor || "var(--color-text-heading)"};
    background-color: ${(props) => props.$hoverBg || "var(--surface-row-hover, rgba(125, 125, 125, 0.1))"};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/**
 * Sticky top-of-column tab strip (Twitter-style). Theme-aware: uses the HUD
 * surface token so it renders correctly in light and dark mode.
 */
export const PageTabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: saturate(160%) blur(14px);
  -webkit-backdrop-filter: saturate(160%) blur(14px);
  background: var(--surface-hud);
`;

export const PageTab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding: 0 16px;
  background: none;
  border: none;
  font: inherit;
  font-size: var(--text-md);
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? 650 : 500)};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--surface-row-hover);
    color: var(--color-text-heading);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ms-brand);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 3px;
    width: 48px;
    background: var(--ms-brand);
    border-radius: var(--radius-pill);
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;
