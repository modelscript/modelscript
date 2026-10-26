// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100vh - 54px - var(--dev-header-height, 0px));
  background-color: var(--color-canvas-default, #0d1117);
  overflow: hidden;
  position: relative;
`;

export const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background-color: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  z-index: 10;
  box-sizing: border-box;
`;

export const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

export const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

export const BreadcrumbText = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-fg-default);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  a {
    color: var(--color-accent-cyan);
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  .separator {
    color: var(--color-fg-muted);
  }
`;

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan);
  border: 1px solid rgba(6, 182, 212, 0.25);
`;

export const DeprecationBanner = styled.div`
  background: linear-gradient(90deg, rgba(210, 153, 34, 0.16) 0%, rgba(187, 128, 9, 0.08) 100%);
  border-bottom: 1px solid rgba(210, 153, 34, 0.35);
  color: var(--color-fg-default, #e6edf3);
  padding: 6px 16px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  z-index: 9;
`;

export const IframeWrapper = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
`;

export const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-canvas-default, #0d1117);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 5;
  color: var(--color-fg-muted, #8b949e);
  font-size: 14px;
`;
