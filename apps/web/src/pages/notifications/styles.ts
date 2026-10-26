// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";
import { safeCssImageUrl } from "../../util/url";

export const NotificationWrapper = styled.div<{ $unread: boolean }>`
  display: flex;
  gap: 14px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-default);
  background-color: ${(props) => (props.$unread ? "var(--color-canvas-subtle)" : "transparent")};
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--color-canvas-subtle);
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
  font-size: 12px;
  color: var(--color-fg-muted);
  background: var(--color-canvas-subtle);
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
`;

export const Avatar = styled.div<{ $url?: string | undefined }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--gradient-ai, linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%));
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  flex-shrink: 0;
`;

export const AvatarsRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

export const TabButton = styled.button<{ $active: boolean }>`
  flex: 1;
  min-width: 90px;
  padding: 12px 10px;
  background: none;
  border: none;
  border-bottom: 2px solid ${(props) => (props.$active ? "var(--color-accent-fg)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  cursor: pointer;
  font-size: 13px;
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

export const UnreadPill = styled.span`
  background: var(--color-accent-emphasis);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.2;
`;
