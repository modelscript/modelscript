// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";
import { safeCssImageUrl } from "../../util/url";

export const NotificationWrapper = styled.div<{ $unread: boolean; $selected?: boolean | undefined }>`
  position: relative;
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border-default);
  border-left: 3px solid
    ${(props) =>
      props.$selected
        ? "var(--color-accent-fg)"
        : props.$unread
          ? "var(--color-accent-cyan, var(--color-accent-fg))"
          : "transparent"};
  background-color: ${(props) =>
    props.$selected
      ? "var(--surface-selected, rgba(56, 139, 253, 0.14))"
      : props.$unread
        ? "var(--color-accent-subtle, rgba(56, 139, 253, 0.075))"
        : "transparent"};
  cursor: pointer;
  transition:
    background-color 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    border-left-color 0.35s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    background-color: ${(props) =>
      props.$selected
        ? "var(--surface-selected, rgba(56, 139, 253, 0.16))"
        : props.$unread
          ? "var(--surface-selected, rgba(56, 139, 253, 0.12))"
          : "var(--color-canvas-subtle)"};
    transition:
      background-color 0.15s ease,
      border-left-color 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
`;

export const EngineeringCard = styled.div<{ $status: "completed" | "failed" | "package" | "security" | "credit" }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--color-canvas-default);
  border: 1px solid
    ${(props) => {
      switch (props.$status) {
        case "completed":
          return "var(--color-success-emphasis, rgba(46, 160, 67, 0.4))";
        case "failed":
          return "var(--color-danger-emphasis, rgba(248, 81, 73, 0.4))";
        case "security":
          return "var(--color-danger-emphasis, rgba(248, 81, 73, 0.5))";
        case "credit":
          return "var(--color-attention-emphasis, rgba(210, 153, 34, 0.4))";
        case "package":
        default:
          return "var(--color-accent-emphasis, rgba(56, 139, 253, 0.4))";
      }
    }};
`;

export const ModelBadge = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  color: var(--color-fg-default);
  background: var(--color-canvas-subtle);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  word-break: break-all;
`;

export const MetricChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  line-height: 16px;
  color: var(--color-fg-muted);
  background: var(--color-canvas-subtle);
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
`;

export const Avatar = styled.div<{ $url?: string | undefined; $letter?: string | undefined }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--gradient-ai, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%));
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: #ffffff;
  &::before {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }
`;

export const AvatarsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
`;

export const AvatarOverflowPill = styled.span`
  height: 36px;
  min-width: 36px;
  padding: 0 8px;
  border-radius: 18px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  color: var(--color-fg-muted);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export const UnreadDotButton = styled.button`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.15s ease;

  &::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent-fg);
    transition: transform 0.15s ease;
  }

  &:hover {
    background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
    &::after {
      transform: scale(1.25);
    }
  }
`;

export const QuickActionIconButton = styled.button<{ $active?: boolean | undefined }>`
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: ${(props) => (props.$active ? "var(--color-attention-fg, #d29922)" : "var(--color-fg-muted)")};
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;

  &:hover {
    color: ${(props) => (props.$active ? "var(--color-attention-fg, #d29922)" : "var(--color-fg-default)")};
    background: var(--color-neutral-muted, rgba(175, 184, 193, 0.18));
    border-color: var(--color-border-default);
  }
`;

export const TabBar = styled.div`
  display: flex;
  overflow-x: auto;
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  z-index: 45;
  border-bottom: 1px solid var(--color-border-default);
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  min-width: 90px;
  height: 53px;
  padding: 0 10px;
  background: none;
  border: none;
  border-bottom: 2px solid ${(props) => (props.$active ? "var(--color-accent-fg)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  cursor: pointer;
  font-size: 15px;
  line-height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    background: var(--color-canvas-subtle);
  }
`;

export const FilterStrip = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-default);
  background: var(--color-canvas-subtle);
  flex-wrap: wrap;
`;

export const FilterPillGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const FilterPill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? 650 : 500)};
  border: 1px solid
    ${(props) =>
      props.$active ? "var(--color-accent-emphasis, var(--color-accent-fg))" : "var(--color-border-default)"};
  background: ${(props) =>
    props.$active ? "var(--color-accent-subtle, rgba(56, 139, 253, 0.14))" : "var(--color-canvas-default)"};
  color: ${(props) => (props.$active ? "var(--color-accent-fg)" : "var(--color-fg-muted)")};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
    border-color: var(--color-accent-fg);
  }
`;

export const CompactSearchBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  min-width: 190px;
  max-width: 260px;
  flex: 1;

  & > svg {
    position: absolute;
    left: 10px;
    color: var(--color-fg-muted);
    pointer-events: none;
  }

  input {
    width: 100%;
    height: 28px;
    padding: 0 26px 0 30px;
    border-radius: 999px;
    border: 1px solid var(--color-border-default);
    background: var(--color-canvas-default);
    color: var(--color-fg-default);
    font-size: 12.5px;
    outline: none;
    transition: border-color 0.15s ease;

    &:focus {
      border-color: var(--color-accent-fg);
    }

    &::placeholder {
      color: var(--color-fg-muted);
    }
  }
`;

export const InboxSplitLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
  align-items: start;
  min-height: calc(100vh - var(--dev-header-height, 0px) - 148px);

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

export const StreamPane = styled.div`
  border-right: 1px solid var(--color-border-default);
  min-width: 0;
  min-height: calc(100vh - var(--dev-header-height, 0px) - 148px);

  @media (max-width: 960px) {
    border-right: none;
  }
`;

export const ReadingPaneWrapper = styled.aside`
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 106px);
  max-height: calc(100vh - var(--dev-header-height, 0px) - 106px);
  overflow-y: auto;
  padding: 20px 24px;
  min-width: 0;
  box-sizing: border-box;

  @media (max-width: 960px) {
    position: static;
    max-height: none;
    border-top: 1px solid var(--color-border-default);
    padding: 16px;
  }
`;

export const KbdBadge = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-fg-muted);
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  box-shadow: inset 0 -1px 0 var(--color-border-default);
`;

export const UnreadPill = styled.span`
  background: var(--color-accent-emphasis);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.2;
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
`;

export const CountPill = styled.span`
  background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  color: var(--color-fg-muted);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.2;
`;

export const NotificationSectionDivider = styled.div<{ $variant: "new" | "earlier"; $hasActiveUnread?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border-default);
  background: ${(props) =>
    props.$variant === "new"
      ? props.$hasActiveUnread
        ? "var(--color-accent-subtle, rgba(56, 139, 253, 0.09))"
        : "var(--color-canvas-subtle)"
      : "var(--color-canvas-subtle)"};
  font-size: 12px;
  line-height: 16px;
  user-select: none;
  transition: background-color 0.65s cubic-bezier(0.16, 1, 0.3, 1);
`;

export const SectionDividerBadge = styled.span<{ $variant: "new" | "earlier"; $hasActiveUnread?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 11px;
  color: ${(props) =>
    props.$variant === "new" && props.$hasActiveUnread ? "var(--color-accent-fg)" : "var(--color-fg-muted)"};
  transition: color 0.5s ease;
`;

export const SectionDividerDot = styled.span<{ $active?: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(props) =>
    props.$active ? "var(--color-accent-cyan, var(--color-accent-fg))" : "var(--color-fg-muted)"};
  box-shadow: ${(props) => (props.$active ? "0 0 0 3px rgba(56, 139, 253, 0.2)" : "none")};
  opacity: ${(props) => (props.$active ? 1 : 0.45)};
  transition:
    background-color 0.5s ease,
    box-shadow 0.5s ease,
    opacity 0.5s ease;
`;

export const SectionDividerMeta = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fg-muted);
  transition: opacity 0.4s ease;
`;
