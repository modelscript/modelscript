// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  margin-top: 24px;
`;

export const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
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
