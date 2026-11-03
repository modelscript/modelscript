// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-backdrop, rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh 16px;
  overflow-y: auto;
`;

export const NestedOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay-backdrop, rgba(0, 0, 0, 0.65));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
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
  max-height: 88dvh;
  min-height: 250px;
  transition: max-width 0.2s ease;
`;

export const ConfirmModalPanel = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  width: 100%;
  max-width: 340px;
  border-radius: 16px;
  border: 1px solid var(--color-border-glass);
  box-shadow:
    0 24px 48px rgba(0, 0, 0, 0.7),
    0 0 0 1px var(--color-border-glass);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 10002;
  margin: auto;
  animation: confirmModalPopIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes confirmModalPopIn {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
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
  min-height: 0;
`;
