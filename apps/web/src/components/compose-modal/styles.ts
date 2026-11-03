// SPDX-License-Identifier: AGPL-3.0-or-later

import styledImport from "styled-components";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

export const Overlay = styled.div<{
  $isFullPageNotebook?: boolean;
  $isExpanded?: boolean;
}>`
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
  padding: ${(p) => (p.$isFullPageNotebook ? "0" : p.$isExpanded ? "3dvh 16px" : "6dvh 16px")};
  overflow-y: auto;

  @media (max-width: 767px) {
    padding: 0;
    align-items: stretch;
  }
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

export const ModalPanel = styled.div<{
  $isFullPageNotebook?: boolean;
  $isExpanded?: boolean;
  $isDrafts?: boolean;
}>`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  width: ${(p) => (p.$isFullPageNotebook ? "100vw" : "100%")};
  max-width: ${(p) => (p.$isDrafts ? "600px" : p.$isFullPageNotebook ? "100vw" : p.$isExpanded ? "1180px" : "600px")};
  height: ${(p) => (p.$isFullPageNotebook ? "100dvh" : "auto")};
  max-height: ${(p) => (p.$isFullPageNotebook ? "100dvh" : p.$isExpanded ? "92dvh" : "86dvh")};
  border-radius: ${(p) => (p.$isFullPageNotebook ? "0" : "16px")};
  border: ${(p) => (p.$isFullPageNotebook ? "none" : "1px solid var(--color-border-glass)")};
  box-shadow: var(--ms-shadow-pop, var(--glow-card));
  display: flex;
  flex-direction: column;
  overflow: visible;
  min-height: 0;
  margin: 0 auto;
  transition: max-width 0.2s ease;

  @media (max-width: 767px) {
    width: 100%;
    max-width: 100%;
    border-radius: 0;
    border: none;
    height: var(--compose-vvh, 100dvh);
    max-height: var(--compose-vvh, 100dvh);
    min-height: var(--compose-vvh, 100dvh);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
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
  padding: 10px 16px;
  flex-shrink: 0;

  @media (max-width: 640px) {
    padding: 8px 12px;

    .desktop-only-action {
      display: none !important;
    }
  }
`;

export const Body = styled.div`
  padding: 14px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;

  @media (max-width: 640px) {
    padding: 10px 14px 14px;
  }
`;
