// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TweetButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.35);
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    box-shadow: 0 0 18px rgba(6, 182, 212, 0.5);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: none;
    background: var(--color-btn-disabled-bg, rgba(255, 255, 255, 0.08));
    color: var(--color-text-muted);
    border: 1px solid var(--color-border-subtle);
  }
`;

export const CommandPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  outline: none;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;

  &:hover {
    color: var(--color-text-heading);
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--color-border-strong, rgba(255, 255, 255, 0.25));
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .pill-icon {
    display: inline-flex;
    align-items: center;
    color: var(--color-accent-cyan);
    opacity: 0.85;
  }
`;

export const ActionIconButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: all 0.2s ease;
  padding: 0;

  &:hover:not(:disabled) {
    background-color: rgba(6, 182, 212, 0.12);
    color: var(--color-accent-cyan);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  & svg {
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 0.2px;
    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  &:hover:not(:disabled) svg {
    transform: scale(1.15);
  }
`;

export const OverlayWrapper = styled.div`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
`;

export const Backdrop = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  font-size: 20px;
  padding: 6px 0 4px 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--color-fg-default);
  z-index: 0;
`;

export const ComposeInput = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: 20px;
  padding: 6px 0 4px 0;
  resize: none;
  background: transparent !important;
  color: var(--color-fg-default) !important;
  -webkit-text-fill-color: transparent !important;
  caret-color: var(--color-fg-default);
  font-family: inherit;
  overflow: hidden;
  box-sizing: border-box;
  flex-shrink: 0;
  margin-bottom: 12px;
  position: relative;
  z-index: 1;
  &::placeholder {
    color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted);
    opacity: 1;
  }
`;

export const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background-color: rgba(255, 255, 255, 0.02);
`;

export const NotebookContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
`;

export const NotebookTitleInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-fg-default);
  background: rgba(139, 92, 246, 0.06);
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus {
    border-color: var(--color-accent-cyan);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.15);
  }

  &::placeholder {
    color: var(--color-text-muted);
    font-weight: 500;
  }
`;

export const NotebookCellCard = styled.div<{ $active?: boolean | undefined; $isArtifact?: boolean | undefined }>`
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--color-accent-cyan, #06b6d4)"
        : props.$isArtifact
          ? "rgba(139, 92, 246, 0.28)"
          : "var(--color-border-default, rgba(255, 255, 255, 0.12))"};
  border-radius: 12px;
  background: ${(props) => (props.$isArtifact ? "rgba(139, 92, 246, 0.04)" : "rgba(255, 255, 255, 0.02)")};
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
`;

export const NotebookCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text-muted);
`;

export const CellActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    color: var(--color-fg-default);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

export const NotebookCellTextarea = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: 15.5px;
  line-height: 1.55;
  padding: 10px 12px;
  resize: vertical;
  min-height: 68px;
  background: transparent;
  color: var(--color-fg-default);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }
`;

export const ArtifactCaptionInput = styled.input`
  width: 100%;
  border: none;
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  outline: none;
  font-size: 12.5px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-fg-default);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }
`;

export function formatRelativeTime(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return "Just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
