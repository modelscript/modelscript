// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { safeCssImageUrl } from "../../util/url";

export const PanelContainer = styled.aside`
  width: 100%;
  max-width: 350px;
  height: fit-content;
  align-self: flex-start;
  position: sticky;
  top: 0;
  padding: 16px 24px 12px 24px;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;

  @media (max-width: 1000px) {
    display: none;
  }
`;

export const SearchContainer = styled.div<{ $scrolled?: boolean | undefined }>`
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
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
`;

export const AiSearchBar = styled.div`
  width: 100%;
  height: 38px;
  background: color-mix(in srgb, var(--color-bg-primary) 85%, var(--color-search-bg, rgba(255, 255, 255, 0.04)));
  border: 1px solid var(--color-search-border, var(--color-border-glass));
  border-radius: 9999px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 13.5px;
  line-height: 18px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
  user-select: none;

  &:hover,
  &:focus-visible {
    border-color: color-mix(in srgb, var(--ms-brand) 55%, transparent);
    background: color-mix(in srgb, var(--color-bg-primary) 92%, var(--color-search-bg, rgba(255, 255, 255, 0.07)));
    box-shadow:
      0 0 16px color-mix(in srgb, var(--ms-brand) 22%, transparent),
      0 0 0 1px color-mix(in srgb, var(--ms-brand) 30%, transparent);
    color: var(--color-text-primary);
    outline: none;
  }

  .sparkle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ms-brand);
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
    border-color: var(--color-glass-border-hover);
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
    box-shadow: 0 2px 6px color-mix(in srgb, var(--ms-brand) 25%, transparent);
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
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--gradient-icon-box, linear-gradient(135deg, rgba(8, 145, 178, 0.2), rgba(6, 182, 212, 0.2)));
  border: 1px solid var(--color-border-default);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-heading);
  font-size: 12.5px;
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
  height: 36px;
  background: var(--color-btn-secondary-bg);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-glass);
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;

  &:hover {
    background: var(--surface-row-hover);
    border-color: var(--color-border-strong);
  }
`;

export const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
`;

export const CardTitle = styled.h2`
  font-size: 16.5px;
  line-height: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--color-text-heading);
`;

export const PanelList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const TrendingItem = styled.div<{ $active?: boolean | undefined }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  margin: 0 -8px;
  cursor: pointer;
  position: relative;
  border-radius: 10px;
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-blue-border)" : "transparent")};
  background: ${(props) => (props.$active ? "var(--ms-brand-soft)" : "transparent")};
  text-decoration: none;
  color: inherit;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background-color: ${(props) => (props.$active ? "var(--ms-brand-soft)" : "var(--surface-row-hover)")};
  }
`;

export const PanelRow = TrendingItem;

export const PanelIconBox = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent-cyan);
  flex-shrink: 0;
`;

export const PanelBadge = styled.span`
  font-size: 10px;
  line-height: 14px;
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--ms-brand-soft);
  color: var(--ms-brand);
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
`;

export const ShowMoreLink = styled(Link)`
  color: var(--ms-brand);
  text-decoration: none;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 18px;
  padding: 6px 8px;
  margin: 4px -8px -4px -8px;
  border-radius: 8px;
  display: block;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background-color: var(--surface-row-hover);
    color: var(--color-link-hover);
  }
`;

export const KebabButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background-color 0.2s,
    color 0.2s;

  &:hover {
    background-color: var(--color-accent-purple-bg);
    color: var(--color-accent-purple);
  }
`;

export const PanelFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 12px 12px;
  font-size: 12px;
  color: var(--color-text-muted);

  a {
    color: inherit;
    font-size: inherit;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
`;
