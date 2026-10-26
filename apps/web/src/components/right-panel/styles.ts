// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { safeCssImageUrl } from "../../util/url";

export const PanelContainer = styled.aside`
  width: 350px;
  position: sticky;
  top: 0;
  padding: 16px 24px 12px 24px;
  box-sizing: border-box;

  @media (max-width: 1000px) {
    display: none;
  }
`;

export const SearchContainer = styled.div`
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 100;
  margin-top: -16px;
  margin-left: -24px;
  margin-right: -24px;
  padding-top: 16px;
  padding-bottom: 12px;
  padding-left: 24px;
  padding-right: 24px;
  margin-bottom: 4px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-bg-primary);
    opacity: 0.85;
    z-index: -1;
  }
`;

export const AiSearchBar = styled.div`
  width: 100%;
  height: 42px;
  background: var(--color-search-bg, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-search-border, var(--color-border-glass));
  border-radius: 9999px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
  user-select: none;

  &:hover {
    border-color: rgba(139, 92, 246, 0.55);
    background: rgba(255, 255, 255, 0.07);
    box-shadow:
      0 0 16px rgba(139, 92, 246, 0.22),
      0 0 0 1px rgba(139, 92, 246, 0.3);
    color: var(--color-text-primary);
  }

  .sparkle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-accent-purple, #8b5cf6);
    filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.6));
    font-size: 14px;
  }

  .text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  kbd {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }
`;

export const Card = styled.div`
  background: var(--color-bg-card);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.35);
    box-shadow: var(--glow-card);
  }
`;

export const WalletCard = styled(Card)`
  border: 1px solid var(--color-accent-purple-border);
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--color-accent-cyan), var(--color-accent-purple), var(--color-accent-blue));
  }
`;

export const TopUpButton = styled.button`
  background: var(--color-accent-purple-bg);
  border: 1px solid var(--color-accent-purple-border);
  color: var(--color-accent-purple);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    background: var(--color-accent-purple);
    color: #ffffff;
    border-color: var(--color-accent-purple);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(124, 58, 237, 0.25);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const CloudRunButton = styled.button`
  margin-top: 6px;
  background: var(--color-canvas-subtle, rgba(6, 182, 212, 0.08));
  border: 1px solid var(--color-border-default, rgba(6, 182, 212, 0.25));
  color: var(--color-accent-cyan);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    background: var(--surface-row-hover, rgba(6, 182, 212, 0.16));
    border-color: var(--color-accent-cyan);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(6, 182, 212, 0.25);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const SpinSyncIcon = styled(SyncIcon)<{ $isSpinning: boolean }>`
  animation: ${(props) => (props.$isSpinning ? "spin 1s linear infinite" : "none")};
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

export const Avatar = styled.div<{ $url?: string | undefined; $letter?: string | undefined }>`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--gradient-icon-box, linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.2)));
  border: 1px solid var(--color-border-default);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-heading);
  font-size: 13.5px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.2s ease;

  &::after {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }

  &:hover {
    transform: scale(1.05);
    border-color: var(--color-accent-purple-border);
  }
`;

export const ProfileNameLink = styled(Link)`
  color: inherit;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  &:hover {
    text-decoration: underline;
  }
`;

export const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  background: var(--color-btn-secondary-bg);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-glass);
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover);
    border-color: var(--color-border-strong);
  }
`;

export const TrendingItem = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  margin: 0 -16px;
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s;
  border-radius: 6px;

  &:hover {
    background-color: var(--surface-row-hover);
  }
`;

export const ShowMoreLink = styled(Link)`
  color: var(--color-accent-cyan);
  text-decoration: none;
  font-size: 14px;
  padding: 12px 16px;
  margin: 4px -16px -16px -16px;
  border-radius: 0 0 16px 16px;
  display: block;
  transition: all 0.2s;

  &:hover {
    background-color: rgba(6, 182, 212, 0.06);
    color: var(--color-link-hover);
  }
`;

export const KebabButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.2s,
    color 0.2s;

  &:hover {
    background-color: var(--color-accent-purple-bg);
    color: var(--color-accent-purple);
  }
`;
