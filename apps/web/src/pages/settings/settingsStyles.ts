// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const Header = styled.div`
  padding: 0 16px;
  min-height: 53px;
  font-size: var(--text-xl, 20px);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  background: var(--surface-hud);
  backdrop-filter: saturate(160%) blur(14px);
  -webkit-backdrop-filter: saturate(160%) blur(14px);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
  margin-bottom: 12px;

  & > button:first-child:not(.subtab-back) {
    @media (min-width: 901px) {
      display: none;
    }
  }
`;

export const DetailItem = styled.div<{ $clickable?: boolean | undefined }>`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 16px;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  transition: background-color 0.2s;
  color: var(--color-text-primary);

  &:hover {
    background-color: ${(props) => (props.$clickable ? "var(--color-canvas-subtle)" : "transparent")};
  }
`;

export const DetailIcon = styled.div`
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
`;

export const DetailText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`;

export const DetailTitle = styled.span`
  font-size: 15px;
  color: var(--color-text-primary);
`;

export const DetailSubtitle = styled.span`
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: 2px;
`;

export const SaveButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 16px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  align-self: flex-end;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.25);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const PrimaryButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.25);
  transition: all 0.15s ease-in-out;
  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const SecondaryButton = styled.button`
  background-color: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s ease-in-out;
  &:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: var(--color-border-hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const DangerButton = styled.button`
  background-color: var(--color-danger-fg, #cf222e);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 10px 20px;
  font-weight: bold;
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.15s ease-in-out;
  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const FormInput = styled.input`
  width: 100%;
  padding: 12px 16px;
  border-radius: 4px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-canvas-default);
  color: var(--color-text-primary);
  outline: none;
  font-size: 15px;
  margin-top: 8px;
  margin-bottom: 16px;
  &:focus {
    border-color: var(--color-accent-emphasis);
  }
`;

export const FormLabel = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  display: block;
`;
