import styled from "styled-components";

export const StickyHeader = styled.div`
  display: flex;
  flex-direction: row;
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  align-items: center;
  background: transparent;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-canvas-default);
    opacity: 0.85;
    z-index: -1;
  }
`;

export const CircleIconButton = styled.button<{ $color?: string; $hoverColor?: string; $hoverBg?: string }>`
  background: none;
  border: none;
  color: ${(props) => props.$color || "var(--color-fg-default)"};
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
    color: ${(props) => props.$hoverColor || "var(--color-fg-default)"};
    background-color: ${(props) => props.$hoverBg || "rgba(128, 128, 128, 0.15)"};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
