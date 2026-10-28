// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from "react-router-dom";
import styled from "styled-components";
import { safeCssImageUrl } from "../../util/url";

export const PostWrapper = styled.div<{ $isDetail?: boolean | undefined; $isThread?: boolean | undefined }>`
  display: flex;
  flex-direction: ${(props) => (props.$isDetail ? "column" : "row")};
  gap: 12px;
  padding: 14px 16px;
  margin: 0;
  border-radius: 0;
  background: transparent;
  border: none;
  border-bottom: ${(props) => (props.$isDetail || props.$isThread ? "none" : "1px solid var(--color-border)")};
  transition: background-color 0.15s ease;
  cursor: ${(props) => (props.$isDetail ? "default" : "pointer")};
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;

  &:hover {
    background: ${(props) => (props.$isDetail ? "transparent" : "var(--surface-row-hover)")};
  }
`;

export const Avatar = styled.div<{ $url?: string | undefined }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => safeCssImageUrl(props.$url) ?? "none"};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;
  border: 1px solid var(--color-border-default);
`;

export const HoverAvatar = styled(Avatar)`
  &:hover {
    filter: brightness(0.85);
  }
`;

export const EngBadge = styled.span<{ $variant?: "verified" | "solver" | "fmu" | "warning" | undefined }>`
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1.4;
  background: var(--status-${(props) => props.$variant ?? "warning"}-bg);
  border: 1px solid var(--status-${(props) => props.$variant ?? "warning"}-border);
  color: var(--color-status-${(props) => props.$variant ?? "warning"});
`;

export const ModelSpecTag = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-glass);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  user-select: none;

  .verified-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-status-verified);
    box-shadow: 0 0 6px var(--color-status-verified);
  }
`;

export const AiBadge = styled.span<{ $variant?: "generated" | "verified" | "reviewed" | undefined }>`
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  line-height: 1.4;
  flex-shrink: 0;
  vertical-align: middle;
  ${(props) =>
    props.$variant === "generated"
      ? `
    background: var(--gradient-ai-subtle);
    border: 1px solid var(--color-accent-purple-border);
    color: var(--color-accent-purple);
  `
      : props.$variant === "reviewed"
        ? `
    background: var(--surface-row-hover);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
  `
        : `
    background: var(--status-verified-bg);
    border: 1px solid var(--status-verified-border);
    color: var(--color-status-verified);
  `}
`;

export const AiInsightRibbon = styled.div`
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(6, 182, 212, 0.05));
  border: 1px solid rgba(139, 92, 246, 0.22);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0;
  color: var(--color-text-secondary);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.4);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(6, 182, 212, 0.08));
  }

  strong {
    color: var(--color-accent-purple);
  }
`;

export const EngActionButton = styled.button`
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    border-color 0.2s,
    color 0.2s,
    background 0.2s;

  &:hover {
    background: var(--ms-brand-soft);
    border-color: var(--ms-brand);
    color: var(--ms-brand);
  }
`;

export const ContentWarningBox = styled.div`
  margin: 6px 0 10px 0;
  padding: 8px 12px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.25);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const SignatureBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 9999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-status-verified, #3fb950);
  background: rgba(63, 185, 80, 0.1);
  border: 1px solid rgba(63, 185, 80, 0.25);
  vertical-align: middle;
  cursor: pointer;
`;

export const ProfileNameLink = styled(Link)`
  color: inherit;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

export const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  transition: background-color 0.2s;
  &:hover {
    background-color: rgba(255, 255, 255, 0.03);
  }
`;

export const ViewsLink = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`;

export const ActionButton = styled.button<{
  $active?: boolean | undefined;
  $color?: string | undefined;
  $noHoverColor?: boolean | undefined;
}>`
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? props.$color : "var(--color-text-muted) !important")};
  cursor: pointer;
  padding: 0;
  position: relative;
  transition: color 0.2s;
  margin-left: -8px;

  &:hover {
    color: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"};
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    transition: background-color 0.2s;
  }

  &:hover .icon-wrapper {
    background-color: ${(props) =>
      props.$noHoverColor
        ? "rgba(128, 128, 128, 0.15)"
        : props.$color
          ? `color-mix(in srgb, ${props.$color} 14%, transparent)`
          : "rgba(128, 128, 128, 0.15)"};
  }

  /* Counts flow inline after the icon so they can never overlap the next action. */
  .action-count {
    font-size: 13px;
    min-width: 1.5ch;
    padding-right: 4px;
    color: inherit;
    font-variant-numeric: tabular-nums;
  }

  .icon-wrapper svg {
    fill: ${(props) => (props.$active ? props.$color : "var(--color-text-muted)")} !important;
    color: ${(props) => (props.$active ? props.$color : "var(--color-text-muted)")} !important;
    transition:
      fill 0.2s,
      color 0.2s;
  }

  &:hover .icon-wrapper svg {
    fill: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"} !important;
    color: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"} !important;
  }
`;

export const MenuButton = styled.button`
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-fg-default);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.2s;

  &:hover {
    background-color: var(--surface-row-hover);
    color: var(--ms-brand);
  }
`;

export interface PostProps {
  post: any;
  isDetail?: boolean | undefined;
  isThread?: boolean | undefined;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${Math.max(1, diffInSeconds)}s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;

  if (now.getFullYear() !== date.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatNumber(num: number): string {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return num.toString();
}
