// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import styled, { keyframes } from "styled-components";

// ── Animations ────────────────────────────────────────────────────────
// Note: styled-components keyframes may only be interpolated inside styled/css templates.
// For inline `style={{ animation }}` use the global keyframes in index.css (`ms-pulse`, `shimmer`, `spin`).

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const SpinningIcon = styled(SyncIcon)<{ $isSpinning: boolean }>`
  animation: ${(props) => (props.$isSpinning ? spin : "none")} 0.8s linear infinite;
`;

export const MetricCard = styled.div`
  background: var(--color-bg-card, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    transform: translateY(-2px);
    border-color: var(--color-border-hover, rgba(255, 255, 255, 0.16));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
`;

export const TabButton = styled.button<{ $isActive: boolean; $activeColor?: string | undefined }>`
  padding: 12px 18px;
  background: none;
  border: none;
  border-bottom: 2px solid
    ${(props) => (props.$isActive ? props.$activeColor || "var(--color-accent-cyan)" : "transparent")};
  color: ${(props) => (props.$isActive ? "var(--color-text-primary, #ffffff)" : "var(--color-text-muted, #8b949e)")};
  font-weight: ${(props) => (props.$isActive ? 700 : 500)};
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: -1px;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.02);
  }
`;

export const FilterChip = styled.button<{ $isSelected: boolean; $activeColor?: string | undefined }>`
  background: ${(props) =>
    props.$isSelected
      ? props.$activeColor || "var(--color-accent-cyan, #06b6d4)"
      : "var(--color-bg-card, rgba(255, 255, 255, 0.04))"};
  border: 1px solid
    ${(props) =>
      props.$isSelected
        ? props.$activeColor || "var(--color-accent-cyan, #06b6d4)"
        : "var(--color-border-glass, rgba(255, 255, 255, 0.08))"};
  color: ${(props) => (props.$isSelected ? "#ffffff" : "var(--color-text-muted, #8b949e)")};
  border-radius: 9999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.2);
  }
`;
