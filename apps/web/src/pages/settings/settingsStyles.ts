// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const Header = styled.div`
  padding: 0 var(--settings-item-px, 16px);
  min-height: 53px;
  font-size: var(--text-xl, 1.25rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: var(--space-md, 16px);
  position: sticky;
  top: var(--dev-header-height, 0px);
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  border-bottom: 1px solid var(--color-border);
  z-index: 50;
  margin-bottom: var(--space-md, 16px);

  & > button:first-child:not(.subtab-back) {
    @media (min-width: 901px) {
      display: none;
    }
  }
`;

export const DetailItem = styled.div<{ $clickable?: boolean | undefined }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: var(--settings-item-py, 16px) var(--settings-item-px, 16px);
  gap: var(--space-md, 16px);
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
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

export const DetailTitle = styled.span`
  font-size: 0.9375rem;
  color: var(--color-text-primary);
`;

export const DetailSubtitle = styled.span`
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin-top: var(--space-xs, 4px);
`;

export const SaveButton = styled.button<{ $variant?: "primary" | "danger" | "secondary" | undefined }>`
  background-color: ${(props) =>
    props.$variant === "danger"
      ? "var(--ms-danger)"
      : props.$variant === "secondary"
        ? "var(--ms-surface-hover)"
        : "var(--ms-brand)"};
  background-image: ${(props) =>
    props.$variant === "danger" || props.$variant === "secondary" ? "none" : "var(--gradient-cta)"};
  color: ${(props) =>
    props.$variant === "secondary" ? "var(--color-text-primary)" : "var(--ms-brand-contrast, #ffffff)"};
  border: ${(props) => (props.$variant === "secondary" ? "1px solid var(--ms-border)" : "none")};
  border-radius: 9999px;
  padding: var(--space-sm, 8px) var(--space-md, 16px);
  font-weight: bold;
  cursor: pointer;
  font-size: 0.875rem;
  align-self: flex-end;
  box-shadow: ${(props) =>
    props.$variant === "danger"
      ? "0 2px 8px color-mix(in srgb, var(--ms-danger) 35%, transparent)"
      : props.$variant === "secondary"
        ? "none"
        : "var(--ms-brand-shadow)"};
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &[style*="background-color"],
  &[style*="background:"],
  &.danger {
    background-image: none;
  }

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: ${(props) =>
      props.$variant === "danger"
        ? "0 4px 12px color-mix(in srgb, var(--ms-danger) 50%, transparent)"
        : props.$variant === "secondary"
          ? "var(--ms-shadow-card)"
          : "var(--ms-brand-shadow)"};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const PrimaryButton = styled.button`
  background-color: var(--color-accent-fg, #8b5cf6);
  background-image: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: var(--space-sm, 8px) var(--space-md, 16px);
  font-weight: bold;
  cursor: pointer;
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm, 8px);
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
  padding: var(--space-sm, 8px) var(--space-md, 16px);
  font-weight: 600;
  cursor: pointer;
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm, 8px);
  transition: all 0.15s ease-in-out;
  &:hover:not(:disabled) {
    background-color: var(--color-bg-hover, rgba(127, 127, 127, 0.14));
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
  padding: var(--space-sm, 8px) var(--space-md, 16px);
  font-weight: bold;
  cursor: pointer;
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm, 8px);
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
  padding: var(--space-sm, 8px) var(--settings-item-px, 16px);
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-canvas-default);
  color: var(--color-text-primary);
  outline: none;
  font-size: 0.9375rem;
  margin-top: var(--space-sm, 8px);
  margin-bottom: var(--space-md, 16px);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  &:focus,
  &:focus-visible {
    outline: 2px solid transparent;
    outline-offset: 2px;
    border-color: var(--color-accent-emphasis);
    box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
  }
`;

export const FormLabel = styled.label`
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  display: block;
`;
