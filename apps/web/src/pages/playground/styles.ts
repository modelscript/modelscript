// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from "react-router-dom";
import styled from "styled-components";

export const PlaygroundContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
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
`;

export const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;

  @media (max-width: 768px) {
    gap: 6px;
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

export const BrandLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--color-fg-default);
  font-weight: 600;
  font-size: 14px;

  &:hover {
    text-decoration: none;
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
  background: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan, #06b6d4);
  border: 1px solid rgba(6, 182, 212, 0.25);
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
  position: relative;
  overflow: hidden;
`;
