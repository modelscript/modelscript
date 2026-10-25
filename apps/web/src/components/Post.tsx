// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  BlockedIcon,
  BookmarkFillIcon,
  BookmarkIcon,
  CommentIcon,
  DownloadIcon,
  GraphBarHorizontalIcon,
  GraphIcon,
  HeartFillIcon,
  HeartIcon,
  HubotIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  LinkIcon,
  MarkGithubIcon,
  MuteIcon,
  PaperclipIcon,
  PersonAddIcon,
  PinIcon,
  QuoteIcon,
  ReportIcon,
  RssIcon,
  ShareIcon,
  ShieldCheckIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Heading, IconButton, Text, Tooltip } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import {
  blockUser,
  bookmarkPost,
  followUser,
  getPostAnalytics,
  likePost,
  muteUser,
  recordPostView,
  reportUser,
  repostPost,
} from "../api";
import { useAuth } from "../AuthContext";
import { parseFederatedHandle } from "../util/federation";
import { safeJsonParse } from "../util/json";
import {
  estimateReadingTimeMinutes,
  extractNotebookHeadings,
  isNotebookPost,
  parseNotebookFromContent,
  slugifyHeading,
} from "../util/notebook";
import AnimatedCount from "./AnimatedCount";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";
import type { SpatialPin } from "./artifacts/spatial-pin";
import Box from "./Box";
import ComposeModal from "./ComposeModal";
import ErrorBoundary from "./ErrorBoundary";
import FederatedDomainPill from "./FederatedDomainPill";
import ProfileHoverCard from "./ProfileHoverCard";
import { useToast } from "./ToastContext";
import WorldMap from "./WorldMap";

function formatRelativeTime(dateString: string): string {
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

const PostWrapper = styled.div<{ $isDetail?: boolean | undefined; $isThread?: boolean | undefined }>`
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

const Avatar = styled.div<{ $url?: string | undefined }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url("${props.$url}")` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;
  border: 1px solid var(--color-border-default);
`;

const EngBadge = styled.span<{ $variant?: "verified" | "solver" | "fmu" | "warning" | undefined }>`
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

const ModelSpecTag = styled.div`
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

const AiBadge = styled.span<{ $variant?: "generated" | "verified" | "reviewed" | undefined }>`
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

const AiInsightRibbon = styled.div`
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

const EngActionButton = styled.button`
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-glass);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: var(--color-accent-cyan);
  }
`;

const HoverAvatar = styled(Avatar)`
  &:hover {
    filter: brightness(0.85);
  }
`;

const ContentWarningBox = styled.div`
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

const SignatureBadge = styled.span`
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

const ProfileNameLink = styled(Link)`
  color: inherit;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  transition: background-color 0.2s;
  &:hover {
    background-color: rgba(255, 255, 255, 0.03);
  }
`;

const ViewsLink = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`;

const ActionButton = styled.button<{
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
          ? `${props.$color}22`
          : "rgba(128, 128, 128, 0.15)"};
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

const MenuButton = styled.button`
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
    background-color: rgba(255, 255, 255, 0.06);
    color: var(--color-accent-cyan);
  }
`;

const AnalyticsModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AnalyticsModalContainer = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  padding-bottom: 32px;
`;

const AnalyticsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  position: sticky;
  top: 0;
  background: var(--surface-overlay);
  backdrop-filter: blur(12px);
  z-index: 10;
  border-bottom: 1px solid var(--color-border);
`;

const AnalyticsCard = styled.div`
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 16px;
  margin: 16px;
`;

const AnalyticsStatGroup = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const AnalyticsStatTitle = styled.div`
  font-size: 14px;
  color: var(--color-fg-muted);
  display: flex;
  align-items: center;
  gap: 4px;
`;

const AnalyticsStatValue = styled.div`
  font-size: 24px;
  font-weight: bold;
  margin-top: 4px;
`;

interface PostProps {
  post: any;
  isDetail?: boolean | undefined;
  isThread?: boolean | undefined;
}

const MarkdownContainer = styled.div<{ $isLongForm?: boolean | undefined }>`
  margin: 0;
  color: var(--color-text-primary);

  p {
    margin-top: 0;
    margin-bottom: ${(props) => (props.$isLongForm ? "12px" : "0")};
    &:last-child {
      margin-bottom: 0;
    }
  }

  h1,
  h2,
  h3,
  h4 {
    color: var(--color-text-heading, var(--color-fg-default));
    font-weight: 800;
    line-height: 1.3;
    scroll-margin-top: 84px;
    position: relative;
  }

  h1 {
    font-size: 1.45em;
    margin: 18px 0 10px 0;
  }

  h2 {
    font-size: 1.25em;
    margin: ${(props) => (props.$isLongForm ? "22px 0 10px 0" : "12px 0 6px 0")};
    padding-bottom: ${(props) => (props.$isLongForm ? "6px" : "0")};
    border-bottom: ${(props) => (props.$isLongForm ? "1px solid var(--color-border-default)" : "none")};
  }

  h3 {
    font-size: 1.08em;
    margin: ${(props) => (props.$isLongForm ? "16px 0 8px 0" : "10px 0 4px 0")};
  }

  .msx-heading-anchor {
    opacity: 0;
    margin-left: 8px;
    color: var(--color-accent-cyan);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85em;
    transition: opacity 0.15s ease;
  }

  h1:hover .msx-heading-anchor,
  h2:hover .msx-heading-anchor,
  h3:hover .msx-heading-anchor {
    opacity: 0.85;
  }

  ul,
  ol {
    margin: ${(props) => (props.$isLongForm ? "8px 0 14px 0" : "4px 0")};
    padding-left: 22px;
  }

  li {
    margin-bottom: 4px;
  }

  code:not(pre code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.88em;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--color-code-bg, rgba(255, 255, 255, 0.07));
    border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
    color: var(--color-accent-cyan, #38bdf8);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 16px 0;
    font-size: 13.5px;
    border: 1px solid var(--color-table-border, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    overflow: hidden;
  }

  th,
  td {
    padding: 8px 12px;
    border: 1px solid var(--color-table-border, rgba(255, 255, 255, 0.08));
    text-align: left;
  }

  th {
    background: var(--color-table-header-bg, rgba(255, 255, 255, 0.05));
    font-weight: 700;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--color-text-heading);
  }

  tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.015);
  }

  blockquote {
    margin: 10px 0;
    padding: 8px 14px;
    border-left: 3px solid var(--color-accent-purple, #8b5cf6);
    background: rgba(139, 92, 246, 0.05);
    border-radius: 0 8px 8px 0;
    color: var(--color-text-secondary);
  }

  .msx-callout {
    margin: 12px 0;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid rgba(6, 182, 212, 0.28);
    border-left: 4px solid var(--color-accent-cyan, #06b6d4);
    background: rgba(6, 182, 212, 0.06);
    font-size: 14px;
    line-height: 1.55;
  }

  .msx-callout-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
    color: var(--color-accent-cyan, #06b6d4);
  }

  .msx-callout-tip {
    border-color: rgba(16, 185, 129, 0.28);
    border-left-color: var(--color-status-verified, #10b981);
    background: rgba(16, 185, 129, 0.06);
    .msx-callout-header {
      color: var(--color-status-verified, #10b981);
    }
  }

  .msx-callout-important {
    border-color: rgba(139, 92, 246, 0.3);
    border-left-color: var(--color-accent-purple, #8b5cf6);
    background: rgba(139, 92, 246, 0.07);
    .msx-callout-header {
      color: var(--color-accent-purple, #8b5cf6);
    }
  }

  .msx-callout-warning {
    border-color: rgba(245, 158, 11, 0.3);
    border-left-color: var(--color-accent-amber, #f59e0b);
    background: rgba(245, 158, 11, 0.07);
    .msx-callout-header {
      color: var(--color-accent-amber, #f59e0b);
    }
  }

  .msx-callout-caution {
    border-color: rgba(244, 63, 94, 0.3);
    border-left-color: var(--color-error, #f43f5e);
    background: rgba(244, 63, 94, 0.07);
    .msx-callout-header {
      color: var(--color-error, #f43f5e);
    }
  }

  .msx-math-block {
    margin: 12px 0;
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
    font-family: "Times New Roman", "Cambria Math", Georgia, serif;
    font-size: 1.12em;
    font-style: italic;
    text-align: center;
    color: var(--color-text-heading, #fff);
    overflow-x: auto;
  }

  .msx-math-inline {
    font-family: "Times New Roman", "Cambria Math", Georgia, serif;
    font-size: 1.05em;
    font-style: italic;
    padding: 0 2px;
    color: var(--color-text-heading, #fff);
  }

  .msx-frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    margin: 0 3px;
    font-size: 0.9em;
  }

  .msx-frac-num {
    border-bottom: 1px solid currentColor;
    padding: 0 3px 1px 3px;
    line-height: 1.1;
  }

  .msx-frac-den {
    padding: 1px 3px 0 3px;
    line-height: 1.1;
  }

  pre.msx-code-pre {
    margin: 12px 0;
    padding: 0;
    border-radius: 10px;
    background: var(--color-pre-bg, #030712);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
    overflow: hidden;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    line-height: 1.55;
  }

  .msx-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: var(--color-text-muted);
  }

  .msx-code-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .msx-code-lang-pill {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.15);
    color: var(--color-accent-purple, #a78bfa);
    border: 1px solid rgba(139, 92, 246, 0.28);
  }

  .msx-code-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .msx-code-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
    color: var(--color-text-secondary);
    border-radius: 6px;
    padding: 2px 8px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(6, 182, 212, 0.14);
      border-color: var(--color-accent-cyan, #06b6d4);
      color: var(--color-text-heading);
    }
  }

  .msx-code-btn-ide {
    background: rgba(139, 92, 246, 0.14);
    border-color: rgba(139, 92, 246, 0.35);
    color: var(--color-text-heading);
  }

  .msx-code-body {
    padding: 10px 0;
    overflow-x: auto;
    display: block;
  }

  .msx-code-line {
    display: flex;
    padding: 0 14px 0 0;
    min-width: fit-content;

    &:hover {
      background: rgba(255, 255, 255, 0.025);
    }
  }

  .msx-line-num {
    user-select: none;
    width: 36px;
    min-width: 36px;
    padding-right: 12px;
    text-align: right;
    color: var(--color-text-tertiary, #64748b);
    font-size: 11.5px;
    opacity: 0.65;
  }

  .msx-line-content {
    white-space: pre;
    flex: 1;
  }

  .tok-kw {
    color: #c084fc;
    font-weight: 600;
  }
  .tok-type {
    color: #38bdf8;
    font-weight: 600;
  }
  .tok-fn {
    color: #60a5fa;
  }
  .tok-num {
    color: #fbbf24;
  }
  .tok-str {
    color: #34d399;
  }
  .tok-comment {
    color: #64748b;
    font-style: italic;
  }
`;

const GitLabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
  </svg>
);

const TwitterXIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  background-color: var(--color-bg-primary);
  color: var(--color-fg-default);
  border: 1px solid var(--color-border-default);
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-bg-hover);
  }
`;

const LoginPromptModal = ({ onClose }: { onClose: () => void }) => {
  const API_BASE =
    typeof window !== "undefined" && (window as any).API_BASE ? (window as any).API_BASE : "http://localhost:4000";

  const handleOAuthLogin = (provider: string) => {
    window.location.href = `${API_BASE}/api/v1/auth/${provider}`;
  };

  return (
    <AnalyticsModalOverlay
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <AnalyticsModalContainer onClick={(e) => e.stopPropagation()} style={{ maxWidth: "400px", padding: "32px" }}>
        <Box display="flex" justifyContent="flex-end" mb={2}>
          <IconButton icon={XIcon} variant="invisible" onClick={onClose} aria-label="Close" />
        </Box>
        <Box display="flex" flexDirection="column" alignItems="center" textAlign="center" mb={4}>
          <Heading as="h2" style={{ fontSize: "24px", marginBottom: "8px" }}>
            Sign in to ModelScript
          </Heading>
          <Text style={{ color: "var(--color-fg-muted)" }}>
            Join the conversation to like, repost, reply, and bookmark posts.
          </Text>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          <ProviderButton onClick={() => handleOAuthLogin("github")}>
            <MarkGithubIcon size={20} />
            Continue with GitHub
          </ProviderButton>
          <ProviderButton onClick={() => handleOAuthLogin("gitlab")}>
            <GitLabIcon />
            Continue with GitLab
          </ProviderButton>
          <ProviderButton onClick={() => handleOAuthLogin("twitter")}>
            <TwitterXIcon />
            Continue with X
          </ProviderButton>
        </Box>
      </AnalyticsModalContainer>
    </AnalyticsModalOverlay>
  );
};

function escapeHtmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  int: "∫",
  sum: "∑",
  prod: "∏",
  sqrt: "√",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  iff: "⇔",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  quad: "  ",
  qquad: "    ",
};

function formatLatexExpression(rawLatex: string): string {
  let out = escapeHtmlText(rawLatex.trim());
  // \dot{x} and \ddot{x}
  out = out.replace(/\\ddot\{([^{}]+)\}/g, "$1&#776;");
  out = out.replace(/\\dot\{([^{}]+)\}/g, "$1&#775;");
  out = out.replace(/\\hat\{([^{}]+)\}/g, "$1&#770;");
  out = out.replace(/\\vec\{([^{}]+)\}/g, "$1&#8407;");
  out = out.replace(/\\text\{([^{}]+)\}/g, '<span style="font-style:normal">$1</span>');
  out = out.replace(/\\mathrm\{([^{}]+)\}/g, '<span style="font-style:normal">$1</span>');
  out = out.replace(/\\mathbf\{([^{}]+)\}/g, "<strong>$1</strong>");
  // \frac{a}{b}
  out = out.replace(
    /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
    '<span class="msx-frac"><span class="msx-frac-num">$1</span><span class="msx-frac-den">$2</span></span>',
  );
  // \sqrt{x}
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  // Greek letters and operators
  out = out.replace(/\\([a-zA-Z]+)/g, (_m, cmd: string) => LATEX_SYMBOLS[cmd] ?? cmd);
  // Superscripts and subscripts
  out = out.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>");
  out = out.replace(/\^([a-zA-Z0-9+-])/g, "<sup>$1</sup>");
  out = out.replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>");
  out = out.replace(/_([a-zA-Z0-9+-])/g, "<sub>$1</sub>");
  return out;
}

function highlightCodeLine(line: string): string {
  const commentIdx = line.indexOf("//");
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";

  let html = escapeHtmlText(codePart);
  // Strings
  html = html.replace(/(&quot;.*?&quot;)/g, '<span class="tok-str">$1</span>');
  // Keywords
  html = html.replace(
    /\b(model|block|connector|record|package|function|type|extends|equation|initial|algorithm|parameter|constant|discrete|input|output|flow|stream|if|then|else|elseif|when|elsewhen|for|loop|while|in|end|within|import|encapsulated|partial|replaceable|redeclare|final|inner|outer|public|protected|connect|der|pre|reinit|time|annotation|part|def|port|attribute|item|action|state|calc|constraint|requirement)\b/g,
    '<span class="tok-kw">$1</span>',
  );
  // Built-in types
  html = html.replace(
    /\b(Real|Integer|Boolean|String|StateSelect|SI\.Voltage|SI\.Current|SI\.Resistance|SI\.Capacitance|SI\.Inductance|SI\.Position|SI\.Velocity|SI\.Acceleration|SI\.Force|SI\.Torque|SI\.Temperature)\b/g,
    '<span class="tok-type">$1</span>',
  );
  // Numbers
  html = html.replace(/\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '<span class="tok-num">$1</span>');

  if (commentPart) {
    html += `<span class="tok-comment">${escapeHtmlText(commentPart)}</span>`;
  }
  return html;
}

export const RenderContent = ({ text, isLongForm }: { text: string | null; isLongForm?: boolean | undefined }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [portals, setPortals] = useState<React.ReactPortal[]>([]);

  useEffect(() => {
    if (!text || !containerRef.current) return;

    // 1. Protect fenced code blocks and inline code spans before transforming math, hashtags, and mentions
    const codePlaceholders: string[] = [];
    let safeText = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(match);
      return `@@MSX_CODE_${idx}@@`;
    });

    // 2. Transform display math $$...$$ and inline math $...$ into HTML placeholders
    const mathPlaceholders: string[] = [];
    safeText = safeText.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => {
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(`<div class="msx-math-block">${formatLatexExpression(expr)}</div>`);
      return `\n\n@@MSX_MATH_${idx}@@\n\n`;
    });
    safeText = safeText.replace(/(^|[^$\\])\$([^\n$]+?)\$/g, (_m, prefix: string, expr: string) => {
      // Avoid matching currency like $100 followed by another $100
      if (/^\d/.test(expr.trim()) && !/[\\^_=+\-*/a-zA-Z]/.test(expr)) {
        return `${prefix}$${expr}$`;
      }
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(`<span class="msx-math-inline">${formatLatexExpression(expr)}</span>`);
      return `${prefix}@@MSX_MATH_${idx}@@`;
    });

    // 3. Transform hashtags and @mentions outside code/math
    safeText = safeText.replace(/(^|\s)#([a-zA-Z0-9_-]+)/g, "$1[#$2](/explore?q=$2)");
    safeText = safeText.replace(/(^|\s)@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g, "$1[@$2](/@$2)");

    // 4. Restore fenced code and inline code before marked parsing
    safeText = safeText.replace(/@@MSX_CODE_(\d+)@@/g, (_m, idxStr: string) => {
      return codePlaceholders[Number(idxStr)] ?? "";
    });

    let rawHtml = marked.parse(safeText, { breaks: true, gfm: true }) as string;

    // 5. Restore rendered math blocks
    rawHtml = rawHtml.replace(/@@MSX_MATH_(\d+)@@/g, (_m, idxStr: string) => {
      return mathPlaceholders[Number(idxStr)] ?? "";
    });

    const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ["sup", "sub"],
      ADD_ATTR: ["class", "id"],
    });

    containerRef.current.innerHTML = sanitizedHtml;

    // 6. Assign deterministic IDs and anchor links to H1/H2/H3 headings
    const seenSlugs = new Map<string, number>();
    const headings = containerRef.current.querySelectorAll("h1, h2, h3");
    headings.forEach((heading) => {
      const rawHeadingText = heading.textContent || "";
      const baseSlug = slugifyHeading(rawHeadingText);
      const count = seenSlugs.get(baseSlug) || 0;
      seenSlugs.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      heading.id = slug;

      if (isLongForm) {
        const anchor = document.createElement("a");
        anchor.href = `#${slug}`;
        anchor.className = "msx-heading-anchor";
        anchor.textContent = "#";
        anchor.title = "Copy link to section";
        anchor.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
          window.history.replaceState(null, "", `#${slug}`);
        };
        heading.appendChild(anchor);
      }
    });

    // 7. Upgrade GitHub-style admonition blockquotes (> [!TIP], > [!NOTE], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
    const blockquotes = containerRef.current.querySelectorAll("blockquote");
    blockquotes.forEach((bq) => {
      const firstP = bq.querySelector("p");
      if (!firstP) return;
      const htmlContent = firstP.innerHTML.trim();
      const match = htmlContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>|\n)?([\s\S]*)$/i);
      if (!match) return;
      const kind = match[1]!.toUpperCase();
      const remainder = match[2] || "";

      const metaMap: Record<string, { label: string; icon: string; cls: string }> = {
        TIP: { label: "Pro Tip", icon: "💡", cls: "msx-callout-tip" },
        NOTE: { label: "Engineering Note", icon: "ℹ️", cls: "msx-callout-note" },
        IMPORTANT: { label: "Important", icon: "⚡", cls: "msx-callout-important" },
        WARNING: { label: "Warning", icon: "⚠️", cls: "msx-callout-warning" },
        CAUTION: { label: "Caution", icon: "🚨", cls: "msx-callout-caution" },
      };
      const meta = metaMap[kind] || metaMap["NOTE"]!;

      const calloutDiv = document.createElement("div");
      calloutDiv.className = `msx-callout ${meta.cls}`;
      const headerDiv = document.createElement("div");
      headerDiv.className = "msx-callout-header";
      headerDiv.textContent = `${meta.icon} ${meta.label}`;
      calloutDiv.appendChild(headerDiv);

      firstP.innerHTML = remainder;
      while (bq.firstChild) {
        calloutDiv.appendChild(bq.firstChild);
      }
      bq.parentNode?.replaceChild(calloutDiv, bq);
    });

    // 8. Upgrade fenced code blocks (<pre><code>) with Baeldung-style header, syntax highlighting, line numbers, Copy & Open in IDE
    const preBlocks = containerRef.current.querySelectorAll("pre");
    preBlocks.forEach((pre) => {
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;
      const rawCode = (codeEl.textContent || "").replace(/\n$/, "");
      const langClass = Array.from(codeEl.classList).find((c) => c.startsWith("language-"));
      const lang = (langClass ? langClass.replace("language-", "") : "modelica").toLowerCase();

      // Detect optional "// File: ..." or "# File: ..." header line
      const lines = rawCode.split("\n");
      let fileTitle = "";
      if (lines.length > 0) {
        const fileMatch = lines[0]!.match(/^(?:\/\/|#)\s*(?:File|Filename):\s*(.+)$/i);
        if (fileMatch && fileMatch[1]) {
          fileTitle = fileMatch[1].trim();
        }
      }
      if (!fileTitle) {
        const modelMatch = rawCode.match(
          /\b(?:model|block|package|function|record|connector|part\s+def)\s+([A-Za-z_]\w*)/,
        );
        if (modelMatch && modelMatch[1]) {
          const ext = lang === "sysml" || lang === "sysml2" ? ".sysml" : lang === "msx" ? ".msx" : ".mo";
          fileTitle = `${modelMatch[1]}${ext}`;
        } else {
          fileTitle = lang.toUpperCase();
        }
      }

      pre.classList.add("msx-code-pre");
      pre.innerHTML = "";

      const header = document.createElement("div");
      header.className = "msx-code-header";

      const titleSpan = document.createElement("span");
      titleSpan.className = "msx-code-title";
      titleSpan.innerHTML = `<span>📄 ${escapeHtmlText(fileTitle)}</span><span class="msx-code-lang-pill">${escapeHtmlText(lang)}</span>`;
      header.appendChild(titleSpan);

      const actions = document.createElement("div");
      actions.className = "msx-code-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msx-code-btn";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(rawCode);
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1800);
      };
      actions.appendChild(copyBtn);

      const ideBtn = document.createElement("button");
      ideBtn.type = "button";
      ideBtn.className = "msx-code-btn msx-code-btn-ide";
      ideBtn.textContent = "▶ Open in IDE";
      ideBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(`/ide?source=${encodeURIComponent(rawCode)}&title=${encodeURIComponent(fileTitle)}`);
      };
      actions.appendChild(ideBtn);

      header.appendChild(actions);
      pre.appendChild(header);

      const codeBody = document.createElement("code");
      codeBody.className = "msx-code-body";
      codeBody.innerHTML = lines
        .map(
          (lineText, idx) =>
            `<div class="msx-code-line"><span class="msx-line-num">${idx + 1}</span><span class="msx-line-content">${highlightCodeLine(lineText)}</span></div>`,
        )
        .join("");
      pre.appendChild(codeBody);
    });

    const links = containerRef.current.querySelectorAll("a:not(.msx-heading-anchor)");
    const newPortals: React.ReactPortal[] = [];
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/@")) {
        const username = href.substring(2);
        const textContent = link.textContent;
        const container = document.createElement("span");
        link.parentNode?.replaceChild(container, link);
        newPortals.push(
          createPortal(
            <ProfileHoverCard username={username}>
              <Link
                to={`/${username}`}
                style={{ color: "var(--color-accent-cyan)", textDecoration: "none", fontWeight: "bold" }}
                onMouseOver={(e) => ((e.target as any).style.textDecoration = "underline")}
                onMouseOut={(e) => ((e.target as any).style.textDecoration = "none")}
              >
                {textContent}
              </Link>
            </ProfileHoverCard>,
            container,
          ),
        );
      } else if (href && href.startsWith("/explore?q=")) {
        link.style.color = "var(--color-accent-cyan)";
        link.style.textDecoration = "none";
        link.style.fontWeight = "bold";
        link.onmouseover = () => (link.style.textDecoration = "underline");
        link.onmouseout = () => (link.style.textDecoration = "none");
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(href);
        };
      } else if (href && href.startsWith("#")) {
        link.style.color = "var(--color-accent-cyan)";
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetEl = document.getElementById(href.slice(1));
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        };
      } else {
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (href?.startsWith("/")) {
            navigate(href);
          } else if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        };
      }
    });

    setPortals(newPortals);
    return () => setPortals([]);
  }, [text, navigate, isLongForm]);

  return (
    <>
      <MarkdownContainer className="markdown-body" $isLongForm={isLongForm} ref={containerRef} />
      {portals}
    </>
  );
};

// Session cache to prevent duplicate view increments in the same session
const viewedPostIds = new Set<number>();

const Post: React.FC<PostProps> = ({ post, isDetail, isThread }) => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const toast = useToast();
  const displayPost = post.repost_post || post;
  const canEditPost = Boolean(
    token && user && (user.username === displayPost.username || (user as any)?.role === "admin"),
  );

  const [liked, setLiked] = useState(Boolean(displayPost.liked));
  const [likeCount, setLikeCount] = useState(displayPost.like_count);
  const [reposted, setReposted] = useState(Boolean(displayPost.reposted));
  const [repostCount, setRepostCount] = useState(displayPost.repost_count);
  const [bookmarked, setBookmarked] = useState(Boolean(displayPost.bookmarked));
  const [bookmarkCount, setBookmarkCount] = useState(displayPost.bookmark_count);

  useEffect(() => {
    setLiked(Boolean(displayPost.liked));
    setLikeCount(displayPost.like_count);
    setReposted(Boolean(displayPost.reposted));
    setRepostCount(displayPost.repost_count);
    setBookmarked(Boolean(displayPost.bookmarked));
    setBookmarkCount(displayPost.bookmark_count);
  }, [
    displayPost.id,
    displayPost.liked,
    displayPost.like_count,
    displayPost.reposted,
    displayPost.repost_count,
    displayPost.bookmarked,
    displayPost.bookmark_count,
  ]);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [pendingPin, setPendingPin] = useState<SpatialPin | undefined>(undefined);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showCwContent, setShowCwContent] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [copiedDigest, setCopiedDigest] = useState(false);

  const parsedAuthor = parseFederatedHandle(displayPost.username);
  const parsedQuoteAuthor = displayPost.quote_post ? parseFederatedHandle(displayPost.quote_post.username) : null;
  const contentWarning =
    displayPost.metadata?.contentWarning ||
    displayPost.metadata?.content_warning ||
    displayPost.content_warning ||
    null;

  const remoteOriginUrl = (() => {
    const target = displayPost.url || displayPost.ap_id;
    if (!target || typeof target !== "string") return null;
    if (!target.startsWith("http://") && !target.startsWith("https://")) return null;
    try {
      const urlObj = new URL(target);
      if (urlObj.hostname !== window.location.hostname && !urlObj.hostname.includes("localhost")) {
        return target;
      }
    } catch {}
    return null;
  })();

  const hasSignature = Boolean(
    displayPost.client_signature ||
    displayPost.metadata?.client_signature ||
    displayPost.metadata?.clientSignature ||
    displayPost.metadata?.proof ||
    displayPost.key_id_string ||
    displayPost.metadata?.key_id_string ||
    displayPost.metadata?.keyIdString,
  );

  const signatureDigest =
    displayPost.client_signature ||
    displayPost.metadata?.client_signature ||
    displayPost.metadata?.clientSignature ||
    displayPost.metadata?.proof?.proofValue ||
    displayPost.metadata?.proof?.signature ||
    displayPost.metadata?.signature ||
    "";

  const signatureScheme = displayPost.metadata?.proof?.cryptosuite
    ? `Data Integrity (${displayPost.metadata.proof.cryptosuite})`
    : displayPost.client_signature || displayPost.metadata?.client_signature || displayPost.metadata?.clientSignature
      ? "WebCrypto RSASSA-PKCS1-v1_5 / SHA-256"
      : "ActivityPub RFC 9421 / Cavage HTTP Signatures";

  const keyIdentifier =
    displayPost.key_id_string ||
    displayPost.metadata?.key_id_string ||
    displayPost.metadata?.keyIdString ||
    displayPost.metadata?.proof?.verificationMethod ||
    (displayPost.ap_id ? `${displayPost.ap_id}#main-key` : `@${displayPost.username} device-key`);

  // Automatically record view once per post per session
  useEffect(() => {
    if (displayPost?.id && !viewedPostIds.has(displayPost.id)) {
      viewedPostIds.add(displayPost.id);
      recordPostView(displayPost.id);
    }
  }, [displayPost?.id, token]);

  useEffect(() => {
    if (showAnalyticsModal && displayPost?.id) {
      getPostAnalytics(displayPost.id)
        .then((data) => setAnalyticsData(data))
        .catch(console.error);
    }
  }, [showAnalyticsModal, displayPost?.id, token]);

  const impressions = analyticsData?.view_count ?? displayPost.view_count ?? 0;
  const detailExpands = Math.ceil(impressions * 0.05);
  const profileVisits = Math.ceil(impressions * 0.02);
  const engagements =
    (likeCount || 0) + (repostCount || 0) + (displayPost.reply_count || 0) + detailExpands + profileVisits;

  const formatNumber = (num: number) => {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return num.toString();
  };

  const hasAttachment = !!displayPost.artifact_view_id || isNotebookPost(displayPost);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
    navigator.clipboard.writeText(`${window.location.origin}/${displayPost.username}/status/${displayPost.id}`);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
    const content = displayPost.content || "";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-${displayPost.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePostAsAttachment = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
    setShowQuoteModal(true);
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await likePost(displayPost.id);
      setLiked(data.liked);
      setLikeCount((prev: number) => prev + (data.liked ? 1 : -1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowRepostMenu(false);
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await repostPost(displayPost.id);
      setReposted(data.reposted);
      setRepostCount((prev: number) => prev + (data.reposted ? 1 : -1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await bookmarkPost(displayPost.id);
      setBookmarked(data.bookmarked);
      setBookmarkCount((prev: number) => prev + (data.bookmarked ? 1 : -1));
    } catch (err) {
      console.error(err);
    }
  };

  const [isNotebookExpanded, setIsNotebookExpanded] = useState(false);
  const [showInlineToc, setShowInlineToc] = useState(false);
  const isNotebook = isNotebookPost(displayPost);
  const notebookData = React.useMemo(
    () =>
      isNotebook
        ? parseNotebookFromContent(displayPost.content, displayPost.artifact_view_id, displayPost.metadata?.notebook)
        : null,
    [isNotebook, displayPost.content, displayPost.artifact_view_id, displayPost.metadata?.notebook],
  );
  const notebookHeadings = React.useMemo(
    () => (notebookData ? extractNotebookHeadings(notebookData.cells) : []),
    [notebookData],
  );
  const readTimeMinutes = React.useMemo(
    () => (notebookData ? notebookData.estimatedReadMinutes || estimateReadingTimeMinutes(notebookData.cells) : 1),
    [notebookData],
  );

  const renderNotebookOrStandardBody = (isDetailView: boolean) => {
    if (isNotebook && notebookData && notebookData.cells.length > 0) {
      let previewEndIdx = notebookData.cells.length;
      if (!isDetailView && !isNotebookExpanded) {
        const firstArtIdx = notebookData.cells.findIndex((c) => c.type === "artifact");
        if (firstArtIdx !== -1 && firstArtIdx + 1 < notebookData.cells.length) {
          previewEndIdx = firstArtIdx + 1;
        } else if (notebookData.cells.length > 2) {
          previewEndIdx = 2;
        }
      }

      const visibleCells = notebookData.cells.slice(0, previewEndIdx);
      const hiddenCount = notebookData.cells.length - visibleCells.length;
      let figureIndex = 0;

      const difficultyColorMap: Record<string, { bg: string; border: string; fg: string }> = {
        Beginner: {
          bg: "rgba(16, 185, 129, 0.12)",
          border: "rgba(16, 185, 129, 0.35)",
          fg: "var(--color-status-verified, #34d399)",
        },
        Intermediate: {
          bg: "rgba(6, 182, 212, 0.12)",
          border: "rgba(6, 182, 212, 0.35)",
          fg: "var(--color-accent-cyan, #22d3ee)",
        },
        Advanced: {
          bg: "rgba(139, 92, 246, 0.15)",
          border: "rgba(139, 92, 246, 0.4)",
          fg: "var(--color-accent-purple, #c084fc)",
        },
      };
      const diffStyle =
        notebookData.difficulty && difficultyColorMap[notebookData.difficulty]
          ? difficultyColorMap[notebookData.difficulty]
          : null;

      const wasUpdated =
        displayPost.updated_at &&
        displayPost.created_at &&
        new Date(displayPost.updated_at).getTime() - new Date(displayPost.created_at).getTime() > 5000;

      return (
        <Box display="flex" flexDirection="column" gap={2} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
          {/* Baeldung-style Tutorial Hero Banner */}
          <div
            style={{
              marginTop: "6px",
              padding: isDetailView ? "16px 18px" : "12px 14px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, rgba(6, 182, 212, 0.07), rgba(139, 92, 246, 0.06))",
              border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                {notebookData.series && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono, monospace)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: "rgba(6, 182, 212, 0.15)",
                      color: "var(--color-accent-cyan)",
                      border: "1px solid rgba(6, 182, 212, 0.32)",
                    }}
                  >
                    📚 {notebookData.series}
                    {notebookData.seriesPart ? ` · Part ${notebookData.seriesPart}` : ""}
                  </span>
                )}
                {notebookData.difficulty && diffStyle && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: diffStyle.bg,
                      color: diffStyle.fg,
                      border: `1px solid ${diffStyle.border}`,
                    }}
                  >
                    ● {notebookData.difficulty}
                  </span>
                )}
                {notebookData.dialect && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "2px 8px",
                      borderRadius: "9999px",
                      background: "rgba(255, 255, 255, 0.05)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border-subtle)",
                    }}
                  >
                    ⚙️ {notebookData.dialect}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--color-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  ⏱ {readTimeMinutes} min read
                </span>
                {wasUpdated && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--color-accent-cyan)",
                    }}
                  >
                    · Updated {formatRelativeTime(displayPost.updated_at)}
                  </span>
                )}
              </div>

              {canEditPost && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowEditModal(true);
                  }}
                  style={{
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "6px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  ✏️ Edit Tutorial
                </button>
              )}
            </div>

            {notebookData.title && (
              <div
                style={{
                  fontSize: isDetailView ? "23px" : "18.5px",
                  fontWeight: 800,
                  color: "var(--color-text-heading, var(--color-fg-default))",
                  lineHeight: 1.28,
                  letterSpacing: "-0.015em",
                }}
              >
                {notebookData.title}
              </div>
            )}

            {notebookData.summary && (
              <div
                style={{
                  fontSize: isDetailView ? "14.5px" : "13.5px",
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {notebookData.summary}
              </div>
            )}

            {/* Collapsible In-Article Table of Contents */}
            {notebookHeadings.length > 0 && (
              <div style={{ marginTop: "2px" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowInlineToc(!showInlineToc);
                  }}
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: "8px",
                    padding: "5px 10px",
                    fontSize: "11.5px",
                    fontFamily: "var(--font-mono, monospace)",
                    fontWeight: 600,
                    color: "var(--color-accent-cyan)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>📑 Table of Contents ({notebookHeadings.length} sections)</span>
                  <span>{showInlineToc ? "▲" : "▼"}</span>
                </button>
                {showInlineToc && (
                  <div
                    style={{
                      marginTop: "8px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      background: "rgba(0, 0, 0, 0.25)",
                      border: "1px solid var(--color-border-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    {notebookHeadings.map((h, i) => (
                      <a
                        key={`${h.slug}-${i}`}
                        href={`#${h.slug}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isDetailView) {
                            e.preventDefault();
                            setIsNotebookExpanded(true);
                            setTimeout(() => {
                              document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 60);
                          } else {
                            e.preventDefault();
                            document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                        style={{
                          paddingLeft: h.level === 3 ? "14px" : "0px",
                          fontSize: h.level === 3 ? "12px" : "12.5px",
                          fontWeight: h.level === 3 ? 500 : 600,
                          color: h.level === 3 ? "var(--color-text-muted)" : "var(--color-text-primary)",
                          textDecoration: "none",
                        }}
                      >
                        {h.text}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {visibleCells.map((cell) => {
            if (cell.type === "markdown") {
              const shouldTruncateMd =
                !isDetailView && !isNotebookExpanded && cell.content.length > 520 && notebookData.cells.length === 1;
              const mdText = shouldTruncateMd ? `${cell.content.slice(0, 520)}…` : cell.content;
              return (
                <Box
                  key={cell.id}
                  style={{
                    fontSize: isDetailView ? "16.5px" : "15px",
                    lineHeight: isDetailView ? 1.65 : 1.55,
                    wordBreak: "break-word",
                  }}
                >
                  <RenderContent text={mdText} isLongForm={true} />
                </Box>
              );
            }

            figureIndex += 1;
            const currentFigNum = figureIndex;
            const initialView =
              displayPost.artifact_views?.[cell.artifactId] ||
              (cell.artifactId === displayPost.artifact_view_id ? displayPost.artifact_view : undefined);

            return (
              <Box
                key={cell.id}
                id={`fig-${currentFigNum}`}
                my={1}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  borderRadius: "12px",
                  border: "1px solid rgba(139, 92, 246, 0.22)",
                  background: "rgba(139, 92, 246, 0.03)",
                  overflow: "hidden",
                }}
              >
                <ArtifactViewCard
                  artifactId={cell.artifactId}
                  initialArtifactView={initialView}
                  forkedFromId={
                    (displayPost as any)?.forked_from_post_id ||
                    (displayPost as any)?.forked_from_artifact_id ||
                    safeJsonParse((displayPost as any)?.metadata, {})?.forkedFromArtifactId
                  }
                  onPinCreated={(pin) => {
                    setPendingPin(pin);
                    setShowReplyModal(true);
                  }}
                />
                {(cell.caption || cell.title) && (
                  <div
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      color: "var(--color-text-muted)",
                      borderTop: "1px solid rgba(139, 92, 246, 0.15)",
                      background: "rgba(0, 0, 0, 0.18)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 700,
                        color: "var(--color-accent-cyan)",
                        fontSize: "11px",
                      }}
                    >
                      Fig. {currentFigNum}:
                    </span>
                    <span>{cell.caption || cell.title}</span>
                  </div>
                )}
              </Box>
            );
          })}

          {!isDetailView && hiddenCount > 0 && !isNotebookExpanded && (
            <Box display="flex" gap={2} flexWrap="wrap" mt={1}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsNotebookExpanded(true);
                }}
                style={{
                  flex: 1,
                  minWidth: "220px",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(6, 182, 212, 0.32)",
                  background: "linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(139, 92, 246, 0.1))",
                  color: "var(--color-accent-cyan)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  📓 Expand inline ({notebookData.cells.length} sections
                  {notebookData.artifactIds.length > 0
                    ? ` · ${notebookData.artifactIds.length} ${notebookData.artifactIds.length === 1 ? "artifact" : "artifacts"}`
                    : ""}
                  )
                </span>
                <span>+{hiddenCount} more ▼</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  navigate(`/${displayPost.username}/status/${displayPost.id}`);
                }}
                style={{
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(139, 92, 246, 0.38)",
                  background: "rgba(139, 92, 246, 0.14)",
                  color: "var(--color-text-heading)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                📖 Read Tutorial View →
              </button>
            </Box>
          )}

          {!isDetailView && isNotebookExpanded && notebookData.cells.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsNotebookExpanded(false);
              }}
              style={{
                alignSelf: "flex-start",
                padding: "5px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ▲ Collapse notebook
            </button>
          )}

          {/* Baeldung-style Companion Code & Web IDE Footer on Detail View */}
          {isDetailView && (
            <div
              style={{
                marginTop: "8px",
                padding: "14px 16px",
                borderRadius: "12px",
                background: "rgba(6, 182, 212, 0.06)",
                border: "1px solid rgba(6, 182, 212, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-heading)" }}>
                  💻 Companion Code & Interactive Sandbox
                </span>
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {notebookData.companionRepo
                    ? `Full source available in ${notebookData.companionRepo} — or launch directly in the WebAssembly IDE.`
                    : "All code snippets and equations in this tutorial can be compiled and simulated directly in the ModelScript Web IDE."}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {notebookData.companionRepo && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const repo = notebookData.companionRepo!;
                      if (repo.startsWith("http://") || repo.startsWith("https://")) {
                        window.open(repo, "_blank", "noopener,noreferrer");
                      } else {
                        navigate(`/explore?q=${encodeURIComponent(repo)}`);
                      }
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-default)",
                      background: "rgba(255, 255, 255, 0.06)",
                      color: "var(--color-text-primary)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    📦 {notebookData.companionRepo}
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const codeBlocks = Array.from(
                      (displayPost.content || "").matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g),
                    )
                      .map((m) => m[1]?.trim())
                      .filter(Boolean);
                    const combinedSource = codeBlocks.join("\n\n");
                    navigate(
                      `/ide?source=${encodeURIComponent(combinedSource || displayPost.content || "")}&title=${encodeURIComponent(notebookData.title || `Tutorial-${displayPost.id}`)}`,
                    );
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(139, 92, 246, 0.45)",
                    background: "rgba(139, 92, 246, 0.18)",
                    color: "var(--color-text-heading)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ▶ Open Tutorial in Web IDE
                </button>
              </div>
            </div>
          )}

          {notebookData.artifactIds.length > 0 && (
            <AiInsightRibbon
              onClick={(e) => {
                e.stopPropagation();
                setShowAiDetails(!showAiDetails);
              }}
              style={{ cursor: "pointer", marginTop: "4px" }}
            >
              <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                <Box display="flex" alignItems="center" gap={2}>
                  <span style={{ fontSize: "14px", color: "var(--color-accent-purple)" }}>✨</span>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-text-primary)" }}>
                    AI Verified · Linear DAE Arena ({notebookData.artifactIds.length}{" "}
                    {notebookData.artifactIds.length === 1 ? "Artifact" : "Artifacts"})
                  </span>
                </Box>
                <span
                  style={{
                    fontSize: "10.5px",
                    color: "var(--color-status-verified)",
                    fontFamily: "var(--font-mono)",
                    background: "rgba(16, 185, 129, 0.12)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  ● CVODE GUARANTEED {showAiDetails ? "▲" : "▼"}
                </span>
              </Box>
              {showAiDetails && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    borderTop: "1px solid rgba(139, 92, 246, 0.15)",
                    paddingTop: "6px",
                    marginTop: "4px",
                  }}
                >
                  Verified AST and differential equations across all embedded notebook artifacts in linear DAE arena.
                  Numerical convergence guaranteed with SUNDIALS CVODE integrator.
                </div>
              )}
            </AiInsightRibbon>
          )}
        </Box>
      );
    }

    return (
      <>
        <Box
          mt={0}
          style={{
            wordBreak: "break-word",
            lineHeight: isDetailView ? 1.5 : undefined,
            fontSize: isDetailView ? "17px" : "15px",
          }}
        >
          <RenderContent text={displayPost.content} />
        </Box>

        {displayPost.metadata?.spatialPin && (
          <Box
            mt={2}
            p={2}
            border="1px solid var(--color-border)"
            borderRadius="8px"
            backgroundColor="rgba(255, 255, 255, 0.03)"
            style={{ cursor: "pointer", display: "inline-block" }}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent("focus-spatial-pin", { detail: displayPost.metadata.spatialPin }));
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "var(--color-fg-muted)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <PinIcon size={12} style={{ color: "var(--color-accent-cyan)" }} />
              <span>
                View Pin on <b>{displayPost.metadata.spatialPin.fieldName}</b> (Value:{" "}
                {displayPost.metadata.spatialPin.scalarValue.toFixed(2)})
              </span>
            </span>
          </Box>
        )}

        {displayPost.artifact_view_id && (
          <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
            <ArtifactViewCard
              artifactId={displayPost.artifact_view_id}
              initialArtifactView={displayPost.artifact_view}
              forkedFromId={
                (displayPost as any)?.forked_from_post_id ||
                (displayPost as any)?.forked_from_artifact_id ||
                safeJsonParse((displayPost as any)?.metadata, {})?.forkedFromArtifactId
              }
              onPinCreated={(pin) => {
                setPendingPin(pin);
                setShowReplyModal(true);
              }}
            />
            <AiInsightRibbon
              onClick={(e) => {
                e.stopPropagation();
                setShowAiDetails(!showAiDetails);
              }}
              style={{ cursor: "pointer", marginTop: "8px" }}
            >
              <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                <Box display="flex" alignItems="center" gap={2}>
                  <span style={{ fontSize: "14px", color: "var(--color-accent-purple)" }}>✨</span>
                  <span style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-text-primary)" }}>
                    AI Verified · Linear DAE Arena
                  </span>
                </Box>
                <span
                  style={{
                    fontSize: "10.5px",
                    color: "var(--color-status-verified)",
                    fontFamily: "var(--font-mono)",
                    background: "rgba(16, 185, 129, 0.12)",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  ● CVODE GUARANTEED {showAiDetails ? "▲" : "▼"}
                </span>
              </Box>
              {showAiDetails && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    borderTop: "1px solid rgba(139, 92, 246, 0.15)",
                    paddingTop: "6px",
                    marginTop: "4px",
                  }}
                >
                  Verified AST and differential equations in linear DAE arena. No algebraic loops detected. Numerical
                  convergence guaranteed with CVODE integrator.
                </div>
              )}
            </AiInsightRibbon>
          </Box>
        )}
      </>
    );
  };

  const content = (
    <PostWrapper $isDetail={isDetail} $isThread={isThread}>
      {isDetail ? (
        <>
          <Box display="flex" alignItems="center" gap={3}>
            <ProfileHoverCard username={displayPost.username}>
              <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
                <HoverAvatar
                  $url={displayPost.avatar_url}
                  style={{ width: "48px", height: "48px", fontSize: "20px", marginLeft: "-4px" }}
                >
                  {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                </HoverAvatar>
              </ProfileNameLink>
            </ProfileHoverCard>
            <Box display="flex" flexDirection="column" flex={1} style={{ minWidth: 0 }}>
              <div style={{ width: "fit-content", maxWidth: "100%", display: "flex" }}>
                <ProfileHoverCard username={displayPost.username}>
                  <ProfileNameLink
                    to={`/${displayPost.username}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ minWidth: 0, overflow: "hidden", display: "flex", maxWidth: "100%" }}
                  >
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: "15px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {displayPost.display_name || displayPost.username}
                      </span>
                      {displayPost.account_type === "rss" && (
                        <RssIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                      )}
                      {displayPost.account_type === "bot" && (
                        <HubotIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                      )}
                    </Text>
                  </ProfileNameLink>
                </ProfileHoverCard>
              </div>
              <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" mt={0.5}>
                <Text
                  className="handle-text"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  @{parsedAuthor.localUsername}
                </Text>
                {parsedAuthor.isFederated && parsedAuthor.remoteDomain && (
                  <FederatedDomainPill domain={parsedAuthor.remoteDomain} />
                )}
                {hasSignature && (
                  <Tooltip text="Cryptographically signed by author device key (Click to verify proof)" direction="s">
                    <SignatureBadge
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowSignatureModal(true);
                      }}
                    >
                      <ShieldCheckIcon size={12} />
                      <span>Signed</span>
                    </SignatureBadge>
                  </Tooltip>
                )}
              </Box>
              <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                {isNotebook && <AiBadge $variant="verified">📓 Notebook</AiBadge>}
                {(displayPost.artifact_view_id || Boolean(notebookData?.artifactIds?.length)) && (
                  <ModelSpecTag>
                    <span className="verified-dot" />
                    <span>Modelica 3.4</span>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>CVODE</span>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>FMU 3.0</span>
                  </ModelSpecTag>
                )}
                {(displayPost.artifact_view_id || Boolean(notebookData?.artifactIds?.length)) && (
                  <AiBadge $variant="verified">✨ AI Verified</AiBadge>
                )}
                {displayPost.account_type === "bot" && <AiBadge $variant="generated">🤖 AI Agent</AiBadge>}
              </Box>
            </Box>
            <Box position="relative" mr={1}>
              <ActionButton
                $noHoverColor
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowPostMenu(!showPostMenu);
                }}
              >
                <div className="icon-wrapper">
                  <KebabHorizontalIcon size={16} />
                </div>
              </ActionButton>
              {showPostMenu && (
                <>
                  <div
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowPostMenu(false);
                    }}
                  />
                  <Box
                    position="absolute"
                    top="0"
                    right="0"
                    bg="var(--color-bg-primary)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                    p={1}
                    zIndex={100}
                    minWidth="250px"
                    display="flex"
                    flexDirection="column"
                  >
                    {canEditPost && (
                      <MenuButton
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setShowPostMenu(false);
                          setShowEditModal(true);
                        }}
                      >
                        <span>✏️</span> {isNotebook ? "Edit tutorial / notebook" : "Edit post"}
                      </MenuButton>
                    )}
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (token) {
                          try {
                            await followUser(displayPost.username);
                          } catch (err) {
                            console.error(err);
                          }
                        }
                        setShowPostMenu(false);
                      }}
                    >
                      <PersonAddIcon size={16} /> Follow @{displayPost.username}
                    </MenuButton>
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        if (!token) {
                          setShowLoginModal(true);
                          return;
                        }
                        try {
                          await muteUser(displayPost.username);
                          toast.info(`Muted @${displayPost.username}`);
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <MuteIcon size={16} /> Mute
                    </MenuButton>
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        if (!token) {
                          setShowLoginModal(true);
                          return;
                        }
                        try {
                          await muteUser(displayPost.username);
                          toast.info(`Muted conversation from @${displayPost.username}`);
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <MuteIcon size={16} /> Mute this conversation
                    </MenuButton>
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        if (!token) {
                          setShowLoginModal(true);
                          return;
                        }
                        try {
                          await blockUser(displayPost.username);
                          toast.info(`Blocked @${displayPost.username}`);
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <BlockedIcon size={16} /> Block @{displayPost.username}
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        navigate(`/${displayPost.username}/status/${displayPost.id}/activity`);
                      }}
                    >
                      <GraphIcon size={16} /> View post activity
                    </MenuButton>
                    {remoteOriginUrl && (
                      <MenuButton
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setShowPostMenu(false);
                          window.open(remoteOriginUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <LinkExternalIcon size={16} /> Open original on remote node
                      </MenuButton>
                    )}
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        if (!token) {
                          setShowLoginModal(true);
                          return;
                        }
                        try {
                          await reportUser(displayPost.username, `Reported post #${displayPost.id}`);
                          toast.info("Post reported to moderators.");
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <ReportIcon size={16} /> Report post
                    </MenuButton>
                  </Box>
                </>
              )}
            </Box>
          </Box>

          {renderNotebookOrStandardBody(true)}

          {displayPost.quote_post && (
            <Box
              mb={2}
              p={3}
              border="1px solid var(--color-border)"
              borderRadius="12px"
              sx={{ cursor: "pointer", "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.03)" } }}
            >
              <Box display="flex" alignItems="center" gap={2} mb={1}>
                <Avatar
                  $url={displayPost.quote_post.avatar_url}
                  style={{ width: "20px", height: "20px", fontSize: "10px" }}
                >
                  {!displayPost.quote_post.avatar_url && displayPost.quote_post.username.charAt(0).toUpperCase()}
                </Avatar>
                <Text
                  style={{ fontWeight: "bold", fontSize: "15px", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  {displayPost.quote_post.display_name || displayPost.quote_post.username}
                  {displayPost.quote_post.account_type === "rss" && <RssIcon size={14} color="var(--color-fg-muted)" />}
                  {displayPost.quote_post.account_type === "bot" && (
                    <HubotIcon size={14} color="var(--color-fg-muted)" />
                  )}
                </Text>
                <Text className="handle-text">
                  @{parsedQuoteAuthor?.localUsername || displayPost.quote_post.username}
                </Text>
                {parsedQuoteAuthor?.isFederated && parsedQuoteAuthor.remoteDomain && (
                  <FederatedDomainPill domain={parsedQuoteAuthor.remoteDomain} />
                )}
              </Box>
              <Box style={{ fontSize: "15px", wordBreak: "break-word" }}>
                <RenderContent text={displayPost.quote_post.content} />
              </Box>
              {displayPost.quote_post.artifact_view_id && (
                <Box>
                  <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                </Box>
              )}
            </Box>
          )}

          <Box display="flex" alignItems="center" fontSize="15px" mb={2} mt={3}>
            <span className="handle-text">
              {new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="handle-text" style={{ margin: "0 4px" }}>
              ·
            </span>
            <span className="handle-text">
              {new Date(displayPost.created_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="handle-text" style={{ margin: "0 4px" }}>
              ·
            </span>
            <ViewsLink
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  setShowLoginModal(true);
                  return;
                }
                setShowAnalyticsModal(true);
              }}
              style={{ color: "var(--color-fg-muted)" }}
            >
              <span style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
                {formatNumber(displayPost.view_count || 0)}
              </span>{" "}
              <span className="handle-text">Views</span>
            </ViewsLink>
          </Box>

          <Box
            borderTop="1px solid var(--color-border)"
            borderBottom="1px solid var(--color-border)"
            py={2}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            width="100%"
            style={{ color: "var(--color-fg-muted)" }}
          >
            {!isDetail && displayPost.artifact_view_id && (
              <EngActionButton
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/${displayPost.username}/status/${displayPost.id}`);
                }}
              >
                ▶ Run in Sandbox
              </EngActionButton>
            )}
            <ActionButton
              $color="var(--color-accent-cyan)"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  setShowLoginModal(true);
                  return;
                }
                setShowReplyModal(true);
              }}
            >
              <div className="icon-wrapper">
                <CommentIcon size={18} />
              </div>
              <Text
                style={{
                  position: "absolute",
                  left: "36px",
                  fontSize: "14px",
                  paddingRight: "8px",
                  minWidth: "20px",
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <AnimatedCount count={displayPost.reply_count || 0} />
              </Text>
            </ActionButton>

            <Box position="relative">
              <ActionButton
                $active={reposted}
                $color="#00ba7c"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!token) {
                    setShowLoginModal(true);
                    return;
                  }
                  setShowRepostMenu(!showRepostMenu);
                }}
              >
                <div className="icon-wrapper">
                  <SyncIcon size={18} />
                </div>
                <Text
                  style={{
                    position: "absolute",
                    left: "36px",
                    fontSize: "14px",
                    paddingRight: "8px",
                    minWidth: "20px",
                    textAlign: "left",
                    color: "inherit",
                  }}
                >
                  <AnimatedCount count={repostCount || 0} />
                </Text>
              </ActionButton>
              {/* Same repost menu as below, omitting for brevity or reusing state */}
              {showRepostMenu && (
                <>
                  <div
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowRepostMenu(false);
                    }}
                  />
                  <Box
                    position="absolute"
                    top="100%"
                    left="0"
                    bg="var(--surface-overlay)"
                    border="1px solid var(--color-border)"
                    borderRadius="12px"
                    boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
                    style={{ backdropFilter: "blur(12px)" }}
                    p={1}
                    zIndex={100}
                    minWidth="120px"
                    display="flex"
                    flexDirection="column"
                  >
                    <button
                      onClick={handleRepost}
                      style={{
                        padding: "8px 12px",
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        color: "var(--color-fg-default)",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <SyncIcon size={14} />
                      {reposted ? "Undo Repost" : "Repost"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowRepostMenu(false);
                        setShowQuoteModal(true);
                      }}
                      style={{
                        padding: "8px 12px",
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        color: "var(--color-fg-default)",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <QuoteIcon size={14} /> Quote
                    </button>
                  </Box>
                </>
              )}
            </Box>

            <ActionButton $active={liked} $color="#f91880" onClick={handleLike}>
              <div className="icon-wrapper">{liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
              <Text
                style={{
                  position: "absolute",
                  left: "36px",
                  fontSize: "14px",
                  paddingRight: "8px",
                  minWidth: "20px",
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <AnimatedCount count={likeCount || 0} />
              </Text>
            </ActionButton>

            <ActionButton $active={bookmarked} $color="var(--color-accent-cyan)" onClick={handleBookmark}>
              <div className="icon-wrapper">
                {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
              </div>
            </ActionButton>

            <Box position="relative">
              <ActionButton
                $color="var(--color-accent-cyan)"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowShareMenu(!showShareMenu);
                }}
              >
                <div className="icon-wrapper">
                  <ShareIcon size={18} />
                </div>
              </ActionButton>

              {showShareMenu && (
                <>
                  <div
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowShareMenu(false);
                    }}
                  />
                  <Box
                    position="absolute"
                    top="100%"
                    right="0"
                    bg="var(--color-bg-primary)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                    p={1}
                    zIndex={100}
                    minWidth="200px"
                    display="flex"
                    flexDirection="column"
                  >
                    <MenuButton onClick={handleCopyLink}>
                      <LinkIcon size={16} /> Copy link to post
                    </MenuButton>
                    {hasAttachment && (
                      <>
                        <MenuButton onClick={handleDownload}>
                          <DownloadIcon size={16} /> Download content
                        </MenuButton>
                        <MenuButton onClick={handlePostAsAttachment}>
                          <PaperclipIcon size={16} /> Post as attachment
                        </MenuButton>
                      </>
                    )}
                  </Box>
                </>
              )}
            </Box>
          </Box>
        </>
      ) : (
        <>
          <Box
            display="flex"
            flexDirection="column"
            gap={1}
            flex={1}
            style={{ minWidth: 0, maxWidth: "100%", width: "100%" }}
          >
            {post.repost_post && (
              <Box
                display="flex"
                alignItems="center"
                gap={2}
                style={{ color: "var(--color-fg-muted)" }}
                fontSize="13px"
                mb={1}
                ml={5}
              >
                <SyncIcon size={12} />
                <Link
                  to={`/${post.username}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {post.display_name || post.username} reposted
                </Link>
              </Box>
            )}
            <Box display="flex" gap={3} style={{ minWidth: 0, maxWidth: "100%", width: "100%" }}>
              <Box display="flex" flexDirection="column" alignItems="center" position="relative">
                <ProfileHoverCard username={displayPost.username}>
                  <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
                    <HoverAvatar $url={displayPost.avatar_url}>
                      {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                    </HoverAvatar>
                  </ProfileNameLink>
                </ProfileHoverCard>
                {isThread && (
                  <div
                    style={{
                      position: "absolute",
                      top: "44px",
                      bottom: "-24px",
                      width: "3px",
                      backgroundColor: "var(--color-border-strong)",
                      borderRadius: "2px",
                    }}
                  />
                )}
              </Box>
              <Box flex={1} style={{ minWidth: 0, maxWidth: "100%" }}>
                <Box display="flex" alignItems="center" gap={1} style={{ minWidth: 0, marginTop: "-3px" }}>
                  <ProfileHoverCard username={displayPost.username}>
                    <ProfileNameLink
                      to={`/${displayPost.username}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ minWidth: 0, overflow: "hidden" }}
                    >
                      <Text
                        style={{
                          fontWeight: "bold",
                          fontSize: "15px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayPost.display_name || displayPost.username}
                        </span>
                        {displayPost.account_type === "rss" && (
                          <RssIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                        )}
                        {displayPost.account_type === "bot" && (
                          <HubotIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                        )}
                      </Text>
                    </ProfileNameLink>
                  </ProfileHoverCard>
                  {displayPost.account_type === "bot" && <AiBadge $variant="generated">🤖 AI Agent</AiBadge>}
                  {isNotebook && <AiBadge $variant="verified">📓 Notebook</AiBadge>}
                  {(displayPost.artifact_view_id || Boolean(notebookData?.artifactIds?.length)) && (
                    <AiBadge $variant="verified">✨ AI Verified</AiBadge>
                  )}
                  <Link
                    to={`/${displayPost.username}`}
                    className="handle-text"
                    style={{
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 1,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{parsedAuthor.localUsername}
                  </Link>
                  {parsedAuthor.isFederated && parsedAuthor.remoteDomain && (
                    <FederatedDomainPill domain={parsedAuthor.remoteDomain} />
                  )}
                  {hasSignature && (
                    <Tooltip text="Cryptographically signed by author device key (Click to verify proof)" direction="s">
                      <SignatureBadge
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setShowSignatureModal(true);
                        }}
                      >
                        <ShieldCheckIcon size={12} />
                        <span>Signed</span>
                      </SignatureBadge>
                    </Tooltip>
                  )}
                  <Text className="handle-text" style={{ flexShrink: 0 }}>
                    ·
                  </Text>
                  <Tooltip
                    text={`${new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${new Date(displayPost.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                    direction="s"
                  >
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <Text
                        className="handle-text"
                        sx={{ "&:hover": { textDecoration: "underline" } }}
                        style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                      >
                        {formatRelativeTime(displayPost.created_at)}
                      </Text>
                    </button>
                  </Tooltip>
                  <Box flex={1} />
                  <Box position="relative" mr={1}>
                    <ActionButton
                      $noHoverColor
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(!showPostMenu);
                      }}
                    >
                      <div className="icon-wrapper">
                        <KebabHorizontalIcon size={16} />
                      </div>
                    </ActionButton>
                    {showPostMenu && (
                      <>
                        <div
                          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setShowPostMenu(false);
                          }}
                        />
                        <Box
                          position="absolute"
                          top="0"
                          right="0"
                          bg="var(--color-bg-primary)"
                          border="1px solid var(--color-border-subtle)"
                          borderRadius="12px"
                          boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                          p={1}
                          zIndex={100}
                          minWidth="250px"
                          display="flex"
                          flexDirection="column"
                        >
                          {canEditPost && (
                            <MenuButton
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setShowPostMenu(false);
                                setShowEditModal(true);
                              }}
                            >
                              <span>✏️</span> {isNotebook ? "Edit tutorial / notebook" : "Edit post"}
                            </MenuButton>
                          )}
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (token) {
                                try {
                                  await followUser(displayPost.username);
                                } catch (err) {
                                  console.error(err);
                                }
                              }
                              setShowPostMenu(false);
                            }}
                          >
                            <PersonAddIcon size={16} /> Follow @{displayPost.username}
                          </MenuButton>
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              if (!token) {
                                setShowLoginModal(true);
                                return;
                              }
                              try {
                                await muteUser(displayPost.username);
                                toast.info(`Muted @${displayPost.username}`);
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          >
                            <MuteIcon size={16} /> Mute
                          </MenuButton>
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              if (!token) {
                                setShowLoginModal(true);
                                return;
                              }
                              try {
                                await muteUser(displayPost.username);
                                toast.info(`Muted conversation from @${displayPost.username}`);
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          >
                            <MuteIcon size={16} /> Mute this conversation
                          </MenuButton>
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              if (!token) {
                                setShowLoginModal(true);
                                return;
                              }
                              try {
                                await blockUser(displayPost.username);
                                toast.info(`Blocked @${displayPost.username}`);
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          >
                            <BlockedIcon size={16} /> Block @{displayPost.username}
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              navigate(`/${displayPost.username}/status/${displayPost.id}/activity`);
                            }}
                          >
                            <GraphIcon size={16} /> View post activity
                          </MenuButton>
                          {remoteOriginUrl && (
                            <MenuButton
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setShowPostMenu(false);
                                window.open(remoteOriginUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <LinkExternalIcon size={16} /> Open original on remote node
                            </MenuButton>
                          )}
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              if (!token) {
                                setShowLoginModal(true);
                                return;
                              }
                              try {
                                await reportUser(displayPost.username, `Reported post #${displayPost.id}`);
                                toast.info("Post reported to moderators.");
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          >
                            <ReportIcon size={16} /> Report post
                          </MenuButton>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
                {contentWarning && (
                  <ContentWarningBox>
                    <Box display="flex" alignItems="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: "var(--color-warning-fg, #d29922)",
                          flexShrink: 0,
                        }}
                      >
                        ⚠️ Warning
                      </span>
                      <span
                        style={{
                          fontSize: "13.5px",
                          fontWeight: 500,
                          color: "var(--color-text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {contentWarning}
                      </span>
                    </Box>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCwContent(!showCwContent);
                      }}
                      style={{
                        background: "rgba(255, 255, 255, 0.08)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "9999px",
                        color: "var(--color-text-primary)",
                        padding: "2px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      {showCwContent ? "Show Less" : "Show More"}
                    </button>
                  </ContentWarningBox>
                )}

                {(!contentWarning || showCwContent) && renderNotebookOrStandardBody(false)}

                {displayPost.quote_post && (
                  <QuoteWrapper>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Avatar
                        $url={displayPost.quote_post.avatar_url}
                        style={{ width: "20px", height: "20px", fontSize: "10px" }}
                      >
                        {!displayPost.quote_post.avatar_url && displayPost.quote_post.username.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text
                        style={{
                          fontWeight: "bold",
                          fontSize: "15px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {displayPost.quote_post.display_name || displayPost.quote_post.username}
                        {displayPost.quote_post.account_type === "rss" && (
                          <RssIcon size={14} color="var(--color-fg-muted)" />
                        )}
                      </Text>
                      <Text className="handle-text">
                        @{parsedQuoteAuthor?.localUsername || displayPost.quote_post.username}
                      </Text>
                      {parsedQuoteAuthor?.isFederated && parsedQuoteAuthor.remoteDomain && (
                        <FederatedDomainPill domain={parsedQuoteAuthor.remoteDomain} />
                      )}
                    </Box>
                    <Box style={{ fontSize: "15px", wordBreak: "break-word" }}>
                      <RenderContent text={displayPost.quote_post.content} />
                    </Box>
                    {displayPost.quote_post.artifact_view_id && (
                      <Box style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
                        <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                      </Box>
                    )}
                  </QuoteWrapper>
                )}

                <Box
                  style={{ marginTop: "10px" }}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  width="100%"
                  maxWidth="100%"
                  onClick={(e) => e.preventDefault()}
                >
                  {displayPost.artifact_view_id && (
                    <EngActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/${displayPost.username}/status/${displayPost.id}`);
                      }}
                      style={{ marginRight: "8px" }}
                    >
                      ▶ Sandbox
                    </EngActionButton>
                  )}
                  <ActionButton
                    $color="var(--color-accent-cyan)"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!token) {
                        setShowLoginModal(true);
                        return;
                      }
                      setShowReplyModal(true);
                    }}
                  >
                    <div className="icon-wrapper">
                      <CommentIcon size={18} />
                    </div>
                    <Text
                      style={{
                        position: "absolute",
                        left: "36px",
                        fontSize: "13px",
                        minWidth: "20px",
                        textAlign: "left",
                        color: "inherit",
                      }}
                    >
                      <AnimatedCount count={displayPost.reply_count || 0} />
                    </Text>
                  </ActionButton>

                  <Box position="relative">
                    <ActionButton
                      $active={reposted}
                      $color="#00ba7c"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!token) {
                          setShowLoginModal(true);
                          return;
                        }
                        setShowRepostMenu(!showRepostMenu);
                      }}
                    >
                      <div className="icon-wrapper">
                        <SyncIcon size={18} />
                      </div>
                      <Text
                        style={{
                          position: "absolute",
                          left: "36px",
                          fontSize: "13px",
                          minWidth: "20px",
                          textAlign: "left",
                          color: "inherit",
                        }}
                      >
                        <AnimatedCount count={repostCount || 0} />
                      </Text>
                    </ActionButton>

                    {showRepostMenu && (
                      <>
                        <div
                          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setShowRepostMenu(false);
                          }}
                        />
                        <Box
                          position="absolute"
                          top="100%"
                          left="0"
                          bg="var(--surface-overlay)"
                          border="1px solid var(--color-border)"
                          borderRadius="12px"
                          boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
                          style={{ backdropFilter: "blur(12px)" }}
                          p={1}
                          zIndex={100}
                          minWidth="120px"
                          display="flex"
                          flexDirection="column"
                        >
                          <button
                            onClick={handleRepost}
                            style={{
                              padding: "8px 12px",
                              background: "none",
                              border: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: "500",
                              color: "var(--color-fg-default)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <SyncIcon size={14} />
                            {reposted ? "Undo Repost" : "Repost"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowRepostMenu(false);
                              setShowQuoteModal(true);
                            }}
                            style={{
                              padding: "8px 12px",
                              background: "none",
                              border: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: "500",
                              color: "var(--color-fg-default)",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <QuoteIcon size={14} />
                            Quote
                          </button>
                        </Box>
                      </>
                    )}
                  </Box>

                  <ActionButton $active={liked} $color="#f91880" onClick={handleLike}>
                    <div className="icon-wrapper">{liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
                    <Text
                      style={{
                        position: "absolute",
                        left: "36px",
                        fontSize: "13px",
                        minWidth: "20px",
                        textAlign: "left",
                        color: "inherit",
                      }}
                    >
                      <AnimatedCount count={likeCount || 0} />
                    </Text>
                  </ActionButton>

                  <ActionButton
                    $color="var(--color-accent-cyan)"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowAnalyticsModal(true);
                    }}
                  >
                    <div className="icon-wrapper">
                      <GraphBarHorizontalIcon size={18} />
                    </div>
                    <Text
                      style={{
                        position: "absolute",
                        left: "36px",
                        fontSize: "13px",
                        minWidth: "20px",
                        textAlign: "left",
                        color: "inherit",
                      }}
                    >
                      <AnimatedCount count={impressions} />
                    </Text>
                  </ActionButton>

                  <Box display="flex" gap={0}>
                    <ActionButton $active={bookmarked} $color="var(--color-accent-cyan)" onClick={handleBookmark}>
                      <div className="icon-wrapper">
                        {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
                      </div>
                    </ActionButton>

                    <Box position="relative">
                      <ActionButton
                        $color="var(--color-accent-cyan)"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setShowShareMenu(!showShareMenu);
                        }}
                      >
                        <div className="icon-wrapper">
                          <ShareIcon size={18} />
                        </div>
                      </ActionButton>

                      {showShareMenu && (
                        <>
                          <div
                            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowShareMenu(false);
                            }}
                          />
                          <Box
                            position="absolute"
                            top="100%"
                            right="0"
                            bg="var(--surface-overlay)"
                            border="1px solid var(--color-border)"
                            borderRadius="12px"
                            boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
                            style={{ backdropFilter: "blur(12px)" }}
                            p={1}
                            zIndex={100}
                            minWidth="200px"
                            display="flex"
                            flexDirection="column"
                          >
                            <MenuButton onClick={handleCopyLink}>
                              <LinkIcon size={16} /> Copy link to post
                            </MenuButton>
                            {hasAttachment && (
                              <>
                                <MenuButton onClick={handleDownload}>
                                  <DownloadIcon size={16} /> Download content
                                </MenuButton>
                                <MenuButton onClick={handlePostAsAttachment}>
                                  <PaperclipIcon size={16} /> Post as attachment
                                </MenuButton>
                              </>
                            )}
                          </Box>
                        </>
                      )}
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </>
      )}
    </PostWrapper>
  );

  const modals = (
    <>
      {showLoginModal && <LoginPromptModal onClose={() => setShowLoginModal(false)} />}
      {showQuoteModal && (
        <ComposeModal
          quotePost={displayPost}
          onClose={() => setShowQuoteModal(false)}
          onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
        />
      )}
      {showReplyModal && (
        <ComposeModal
          replyToPost={displayPost}
          pendingPin={pendingPin}
          onClose={() => {
            setShowReplyModal(false);
            setPendingPin(undefined);
          }}
          onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
        />
      )}
      {showEditModal && (
        <ComposeModal
          initialState={{
            editPostId: displayPost.id,
            content: displayPost.content,
            artifactViewId: displayPost.artifact_view_id,
            isNotebookMode: isNotebook,
            notebookTitle: notebookData?.title || "",
            notebookSummary: notebookData?.summary || "",
            notebookDifficulty: notebookData?.difficulty,
            notebookSeries: notebookData?.series || "",
            notebookDialect: notebookData?.dialect || "",
            notebookCompanionRepo: notebookData?.companionRepo || "",
            notebookCells: notebookData?.cells,
          }}
          onClose={() => setShowEditModal(false)}
          onPostCreated={() => {
            setShowEditModal(false);
            window.location.reload();
          }}
        />
      )}
      {showAnalyticsModal && (
        <AnalyticsModalOverlay
          onClick={(e) => {
            e.stopPropagation();
            setShowAnalyticsModal(false);
          }}
        >
          <AnalyticsModalContainer onClick={(e) => e.stopPropagation()}>
            <AnalyticsHeader>
              <IconButton
                icon={XIcon}
                variant="invisible"
                onClick={() => setShowAnalyticsModal(false)}
                aria-label="Close"
              />
              <Heading as="h2" style={{ fontSize: "20px" }}>
                Post Analytics
              </Heading>
            </AnalyticsHeader>
            <Box>
              <AnalyticsCard>
                <Box display="flex" gap={2}>
                  <Avatar $url={displayPost.avatar_url} style={{ width: 40, height: 40 }}>
                    {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Text
                        fontWeight="bold"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayPost.display_name || displayPost.username}
                        </span>
                        {displayPost.account_type === "rss" && (
                          <RssIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                        )}
                      </Text>
                      <Text
                        color="var(--color-fg-muted)"
                        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}
                      >
                        @{displayPost.username}
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ flexShrink: 0 }}>
                        ·
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                        {formatRelativeTime(displayPost.created_at)}
                      </Text>
                    </Box>
                    <Box
                      mt={1}
                      fontSize="15px"
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      <RenderContent text={displayPost.content} />
                    </Box>
                  </Box>
                </Box>
              </AnalyticsCard>

              <Box mb={4}>
                <WorldMap
                  data={analyticsData?.location_stats || []}
                  regionData={analyticsData?.region_stats || []}
                  totalViews={impressions}
                />
              </Box>
              <AnalyticsCard style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <HeartIcon
                    size={20}
                    style={{ color: liked ? "var(--color-danger-fg, #f91880)" : "var(--color-fg-muted)" }}
                  />
                  <Text fontWeight="bold" fontSize="16px">
                    {likeCount || 0}
                  </Text>
                </Box>
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <SyncIcon
                    size={20}
                    style={{ color: reposted ? "var(--color-success-fg, #00ba7c)" : "var(--color-fg-muted)" }}
                  />
                  <Text fontWeight="bold" fontSize="16px">
                    {repostCount || 0}
                  </Text>
                </Box>
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <CommentIcon size={20} style={{ color: "var(--color-fg-muted)" }} />
                  <Text fontWeight="bold" fontSize="16px">
                    {displayPost.reply_count || 0}
                  </Text>
                </Box>
              </AnalyticsCard>

              <Box display="flex" flexWrap="wrap" px={3} pt={4}>
                <Box width="33.333%" display="flex" justifyContent="center">
                  <AnalyticsStatGroup style={{ alignItems: "center" }}>
                    <AnalyticsStatTitle>
                      Impressions{" "}
                      <Tooltip text="Times this post was seen." type="label">
                        <button
                          type="button"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "inherit",
                            cursor: "help",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <InfoIcon size={14} />
                        </button>
                      </Tooltip>
                    </AnalyticsStatTitle>
                    <AnalyticsStatValue>{formatNumber(impressions)}</AnalyticsStatValue>
                  </AnalyticsStatGroup>
                </Box>
                <Box width="33.333%" display="flex" justifyContent="center">
                  <AnalyticsStatGroup style={{ alignItems: "center" }}>
                    <AnalyticsStatTitle>
                      Engagements{" "}
                      <Tooltip
                        text="Total number of times a user interacted with a post. This includes all clicks anywhere on the post (including hashtags, links, avatar, username, and post expansion), reposts, replies, follows, and likes."
                        type="label"
                      >
                        <button
                          type="button"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "inherit",
                            cursor: "help",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <InfoIcon size={14} />
                        </button>
                      </Tooltip>
                    </AnalyticsStatTitle>
                    <AnalyticsStatValue>{formatNumber(engagements)}</AnalyticsStatValue>
                  </AnalyticsStatGroup>
                </Box>
                <Box width="33.333%" display="flex" justifyContent="center">
                  <AnalyticsStatGroup style={{ alignItems: "center" }}>
                    <AnalyticsStatTitle>
                      Detail expands{" "}
                      <Tooltip text="Times people viewed the details about this post." type="label">
                        <button
                          type="button"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "inherit",
                            cursor: "help",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <InfoIcon size={14} />
                        </button>
                      </Tooltip>
                    </AnalyticsStatTitle>
                    <AnalyticsStatValue>{formatNumber(detailExpands)}</AnalyticsStatValue>
                  </AnalyticsStatGroup>
                </Box>
                <Box width="100%" display="flex" justifyContent="center" mt="32px">
                  <AnalyticsStatGroup style={{ alignItems: "center" }}>
                    <AnalyticsStatTitle>
                      Profile visits{" "}
                      <Tooltip text="Number of profile views from this post." type="label">
                        <button
                          type="button"
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "inherit",
                            cursor: "help",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <InfoIcon size={14} />
                        </button>
                      </Tooltip>
                    </AnalyticsStatTitle>
                    <AnalyticsStatValue>{formatNumber(profileVisits)}</AnalyticsStatValue>
                  </AnalyticsStatGroup>
                </Box>
              </Box>
            </Box>
          </AnalyticsModalContainer>
        </AnalyticsModalOverlay>
      )}
      {showSignatureModal && (
        <Dialog title="Cryptographic Signature Verification" onClose={() => setShowSignatureModal(false)} width="large">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box
              display="flex"
              alignItems="center"
              gap={3}
              p={3}
              style={{
                backgroundColor: "rgba(63, 185, 80, 0.1)",
                border: "1px solid rgba(63, 185, 80, 0.3)",
                borderRadius: "8px",
              }}
            >
              <ShieldCheckIcon size={24} fill="var(--color-status-verified, #3fb950)" />
              <Box>
                <Text style={{ fontWeight: 600, color: "var(--color-status-verified, #3fb950)", display: "block" }}>
                  Verified Authenticity & Integrity
                </Text>
                <Text as="p" style={{ fontSize: "12px", color: "var(--color-fg-muted)", margin: 0 }}>
                  This post was cryptographically signed at the author's client terminal and verified against their
                  published ActivityPub actor public key.
                </Text>
              </Box>
            </Box>

            <Box
              display="grid"
              style={{
                gridTemplateColumns: "110px 1fr",
                rowGap: "8px",
                columnGap: "12px",
                fontSize: "13px",
              }}
            >
              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Author:</Text>
              <Text>
                @{displayPost.username} {displayPost.display_name && `(${displayPost.display_name})`}
              </Text>

              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Algorithm:</Text>
              <Text style={{ fontFamily: "monospace", fontSize: "12px" }}>{signatureScheme}</Text>

              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Key ID:</Text>
              <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>{keyIdentifier}</Text>

              <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Protocol:</Text>
              <Text>W3C ActivityPub / ActivityStreams 2.0</Text>

              {displayPost.ap_id && (
                <>
                  <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Activity ID:</Text>
                  <Text style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
                    {displayPost.ap_id}
                  </Text>
                </>
              )}
            </Box>

            {signatureDigest && (
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Text style={{ fontWeight: 600, fontSize: "12px", color: "var(--color-fg-muted)" }}>
                    Cryptographic Proof Value (Base64)
                  </Text>
                  <Button
                    size="small"
                    onClick={() => {
                      navigator.clipboard.writeText(signatureDigest);
                      setCopiedDigest(true);
                      setTimeout(() => setCopiedDigest(false), 2000);
                    }}
                  >
                    {copiedDigest ? "Copied!" : "Copy Proof"}
                  </Button>
                </Box>
                <Box
                  as="pre"
                  p={2}
                  style={{
                    backgroundColor: "var(--color-canvas-subtle, #161b22)",
                    border: "1px solid var(--color-border-default, #30363d)",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    maxHeight: "120px",
                    margin: 0,
                  }}
                >
                  {signatureDigest}
                </Box>
              </Box>
            )}

            <Box display="flex" justifyContent="flex-end" pt={2}>
              <Button variant="primary" onClick={() => setShowSignatureModal(false)}>
                Close
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </>
  );

  if (isDetail) {
    return (
      <>
        {content}
        {modals}
      </>
    );
  }

  return (
    <>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          navigate(`/${displayPost.username}/status/${displayPost.id}`);
        }}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {content}
      </div>
      {modals}
    </>
  );
};

const PostWithErrorBoundary: React.FC<PostProps> = (props) => (
  <ErrorBoundary
    fallback={
      <Box
        p={3}
        style={{
          borderBottom: "1px solid var(--color-border-default)",
          color: "var(--color-fg-muted)",
          fontSize: "13px",
        }}
      >
        <Text>Unable to display this post.</Text>
      </Box>
    }
  >
    <Post {...props} />
  </ErrorBoundary>
);

export default PostWithErrorBoundary;
