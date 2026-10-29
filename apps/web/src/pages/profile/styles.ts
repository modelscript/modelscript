// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  margin-top: 24px;
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  z-index: 45;
`;

export const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 53px;
  padding: 0 16px;
  background: none;
  border: none;
  font-size: 15px;
  line-height: 20px;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--color-canvas-subtle);
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
