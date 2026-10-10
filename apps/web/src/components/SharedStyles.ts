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

export const CircleIconButton = styled.button<{ $color?: string; $hoverColor?: string; $hoverBg?: string }>`
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
