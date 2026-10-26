// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
`;

export const ModalPanel = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  width: 100%;
  max-width: 600px;
  border-radius: 16px;
  border: 1px solid var(--color-border-glass);
  box-shadow: var(--glow-card);
  display: flex;
  flex-direction: column;
  overflow: visible;
  max-height: 84vh;
  min-height: 250px;
  transition: max-width 0.2s ease;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 16px 4px;
  flex-shrink: 0;
`;

export const Body = styled.div`
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
`;
