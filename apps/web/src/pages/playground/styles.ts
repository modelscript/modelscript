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
  height: 48px;
  min-height: 48px;
  background-color: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  z-index: 20;
  box-sizing: border-box;

  @media (max-width: 768px) {
    padding: 0 8px;
    gap: 6px;
  }

  @media (max-width: 1200px) {
    .nav-hide-lg {
      display: none !important;
    }
  }

  @media (max-width: 900px) {
    .nav-hide-md {
      display: none !important;
    }
  }

  @media (max-width: 680px) {
    .nav-hide-sm {
      display: none !important;
    }
  }
`;

export const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;

  @media (max-width: 768px) {
    gap: 6px;
  }
`;

export const NavCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 1 auto;
  min-width: 0;

  /* Modernized, sleek engineering workbench segmented control */
  ul[data-size="small"] {
    background: var(--color-canvas-subtle, var(--ms-bg-soft, rgba(0, 0, 0, 0.04)));
    border: 1px solid var(--color-border-subtle, var(--ms-border, rgba(15, 23, 42, 0.12)));
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    height: 32px;
    box-sizing: border-box;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  /* Segmented control items */
  li {
    margin: 0 !important;
  }

  li::after {
    display: none !important; /* Remove harsh 1px tick separators */
  }

  /* Button styling */
  button {
    border-radius: 6px !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
    height: 100% !important;
    padding: 0 10px !important;
  }

  /* Inactive button hover */
  button:not([aria-current="true"]):hover {
    background-color: var(
      --color-action-list-item-default-hover-bg,
      var(--ms-surface-hover, rgba(125, 125, 125, 0.08))
    ) !important;
    color: var(--color-fg-default) !important;
  }

  /* Active selected button styling with ModelScript brand cyan accent */
  button[aria-current="true"] {
    font-weight: 600 !important;
    background-color: var(--color-canvas-default, var(--ms-bg, #ffffff)) !important;
    color: var(--ms-brand, #0891b2) !important;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.12),
      0 0 0 1px rgba(0, 0, 0, 0.06) !important;
  }

  button[aria-current="true"] svg {
    color: var(--ms-brand, #0891b2) !important;
    fill: var(--ms-brand, #0891b2) !important;
  }

  /* Responsive label collapse: between 600px and 1160px, collapse button text so all 6 tabs fit comfortably */
  @media (max-width: 1160px) {
    button {
      padding: 0 8px !important;
    }
    /* Primer renders span.segmentedControl-content > (icon div, div.segmentedControl-text).
       Hide only the text so icons remain; accessible name comes from aria-label. */
    .segmentedControl-text {
      display: none !important;
    }
  }

  @media (max-width: 600px) {
    display: none;
  }
`;

export const NavRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

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
  height: calc(100vh - 48px);
  height: calc(100dvh - 48px);
  position: relative;
  overflow: hidden;
`;
