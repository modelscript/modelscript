// SPDX-License-Identifier: AGPL-3.0-or-later

import styled from "styled-components";

export const TweetButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--ms-control-md);
  padding: 0 18px;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast);
  border: 1px solid transparent;
  border-radius: var(--ms-radius-pill);
  font-size: var(--text-md, 15px);
  line-height: var(--leading-md, 20px);
  font-weight: 700;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: var(--ms-brand-shadow);
  transition:
    background-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;

  &:hover:not(:disabled) {
    background: var(--ms-brand-hover);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--ms-focus-ring);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
  }
`;

export const CommandPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  font-family: inherit;
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm, 16px);
  font-weight: 600;
  color: var(--ms-text-2);
  background: transparent;
  border: 1px solid var(--ms-border);
  padding: 0 10px;
  border-radius: var(--ms-radius-pill);
  cursor: pointer;
  outline: none;
  transition:
    color 0.15s,
    background-color 0.15s,
    border-color 0.15s;
  white-space: nowrap;

  &:hover {
    color: var(--ms-text-1);
    border-color: var(--ms-border-strong);
  }

  &[aria-pressed="true"] {
    color: var(--ms-brand);
    background: var(--ms-brand-soft);
    border-color: color-mix(in srgb, var(--ms-brand) 45%, transparent);
  }

  &:focus-visible {
    box-shadow: var(--ms-focus-ring);
  }

  .pill-icon {
    display: inline-flex;
    align-items: center;
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
  font-size: var(--text-xl, 20px);
  line-height: var(--leading-xl, 24px);
  font-weight: 400;
  letter-spacing: normal;
  font-kerning: normal;
  padding: 6px 0 4px 0;
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  color: var(--color-fg-default);
  z-index: 0;
`;

export const ComposeInput = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: var(--text-xl, 20px);
  line-height: var(--leading-xl, 24px);
  font-weight: 400;
  letter-spacing: normal;
  font-kerning: normal;
  padding: 6px 0 4px 0;
  margin: 0;
  resize: none;
  background: transparent !important;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  caret-color: var(--color-fg-default) !important;
  font-family: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
  box-sizing: border-box;
  flex-shrink: 0;
  margin-bottom: 12px;
  position: relative;
  z-index: 1;
  &::selection {
    background: rgba(6, 182, 212, 0.24);
    color: transparent;
    -webkit-text-fill-color: transparent;
  }
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
  width: 100%;
  flex: 1;
`;

export const NotebookPageOverlay = styled.div<{ $inline?: boolean | undefined }>`
  position: ${(props) => (props.$inline ? "relative" : "fixed")};
  inset: ${(props) => (props.$inline ? "auto" : "0")};
  width: ${(props) => (props.$inline ? "100%" : "100vw")};
  height: ${(props) => (props.$inline ? "100%" : "100vh")};
  min-height: ${(props) => (props.$inline ? "calc(100vh - var(--dev-header-height, 0px))" : "100vh")};
  z-index: 9999;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-inset, #ffffff);
  color: var(--ms-text-1);
  overflow: hidden;
`;

export const NotebookTopBar = styled.header`
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--ms-divider);
  background: var(--color-canvas-inset, #ffffff);
  flex-shrink: 0;
  z-index: 30;

  @media (max-width: 640px) {
    padding: 0 12px;
    gap: 8px;
  }
`;

export const NotebookCanvasScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--color-canvas-inset, #ffffff);
`;

export const NotebookDocumentColumn = styled.div<{ $wide?: boolean | undefined }>`
  width: 100%;
  max-width: ${(props) => (props.$wide ? "1280px" : "760px")};
  padding: ${(props) => (props.$wide ? "32px 40px 140px" : "56px 64px 200px")};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1;

  @media (max-width: 768px) {
    padding: 32px 24px 160px;
  }
`;

export const NotebookTitleInput = styled.textarea`
  width: 100%;
  padding: 0;
  margin: 0;
  font-size: 38px;
  line-height: 1.18;
  font-weight: 800;
  letter-spacing: -0.028em;
  color: var(--ms-text-heading, var(--ms-text-1));
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  box-sizing: border-box;
  font-family: inherit;

  &::placeholder {
    color: var(--ms-text-3, #94a3b8);
    opacity: 0.55;
    font-weight: 800;
  }

  @media (max-width: 640px) {
    font-size: 28px;
  }
`;

export const NotebookSubtitleInput = styled.textarea`
  width: 100%;
  padding: 0;
  margin: 6px 0 0 0;
  font-size: 18px;
  line-height: 1.5;
  font-weight: 400;
  color: var(--ms-text-2);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  box-sizing: border-box;
  font-family: inherit;

  &::placeholder {
    color: var(--ms-text-3, #94a3b8);
    opacity: 0.65;
  }
`;

export const NotionGhostButton = styled.button<{ $active?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: ${(props) => (props.$active ? "var(--ms-surface-selected, rgba(15, 23, 42, 0.06))" : "transparent")};
  color: ${(props) => (props.$active ? "var(--ms-text-1)" : "var(--ms-text-3)")};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.05));
    color: var(--ms-text-1);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

export const NotionPropertyTable = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 14px;
  padding: 8px 0 14px;
  border-bottom: 1px solid var(--ms-divider);
`;

export const NotionPropertyRow = styled.div`
  display: flex;
  align-items: center;
  min-height: 32px;
  font-size: 13.5px;
  gap: 8px;
`;

export const NotionPropertyLabel = styled.div`
  width: 140px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ms-text-3);
  font-weight: 500;
  font-size: 13px;
  user-select: none;
`;

export const NotionPropertyValueInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--ms-text-1);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
  transition: background-color 0.12s ease;

  &:hover {
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.04));
  }

  &:focus {
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.04));
    border-color: var(--ms-border);
  }

  &::placeholder {
    color: var(--ms-text-3);
    opacity: 0.6;
  }
`;

export const NotionBlockRow = styled.div<{ $active?: boolean | undefined }>`
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 2px 0;
  border-radius: 6px;

  &:hover .notion-block-gutter,
  &:focus-within .notion-block-gutter {
    opacity: 1;
  }
`;

export const NotionBlockGutter = styled.div`
  position: absolute;
  left: -52px;
  top: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
  user-select: none;

  @media (max-width: 768px) {
    position: static;
    opacity: 0.7;
    margin-bottom: 2px;
  }
`;

export const NotionGutterIconButton = styled.button`
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--ms-text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.06));
    color: var(--ms-text-1);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

export const NotebookCellCard = styled.div<{ $active?: boolean | undefined; $isArtifact?: boolean | undefined }>`
  position: relative;
  display: flex;
  flex-direction: column;
`;

export const NotebookCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--ms-text-3);
`;

export const CellActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--ms-text-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover:not(:disabled) {
    color: var(--ms-text-1);
    background: var(--ms-surface-hover);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

export const NotebookCellTextarea = styled.textarea<{
  $variant?: "p" | "h1" | "h2" | "h3" | "quote" | "callout" | undefined;
}>`
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: ${(props) =>
    props.$variant === "callout" ? "var(--ms-surface-hover, rgba(15, 23, 42, 0.03))" : "transparent"};
  border-left: ${(props) =>
    props.$variant === "quote"
      ? "3px solid var(--ms-border-strong)"
      : props.$variant === "callout"
        ? "3px solid var(--ms-brand)"
        : "none"};
  border-radius: ${(props) => (props.$variant === "callout" ? "0 8px 8px 0" : "0")};
  padding: ${(props) =>
    props.$variant === "quote"
      ? "4px 0 4px 14px"
      : props.$variant === "callout"
        ? "10px 14px"
        : props.$variant === "h1"
          ? "12px 0 4px"
          : props.$variant === "h2"
            ? "10px 0 4px"
            : props.$variant === "h3"
              ? "6px 0 2px"
              : "3px 0"};
  font-size: ${(props) =>
    props.$variant === "h1" ? "28px" : props.$variant === "h2" ? "22px" : props.$variant === "h3" ? "18px" : "16.5px"};
  font-weight: ${(props) =>
    props.$variant === "h1" || props.$variant === "h2" ? "750" : props.$variant === "h3" ? "650" : "400"};
  line-height: ${(props) =>
    props.$variant === "h1" || props.$variant === "h2" || props.$variant === "h3" ? "1.3" : "1.72"};
  letter-spacing: ${(props) => (props.$variant === "h1" || props.$variant === "h2" ? "-0.018em" : "normal")};
  min-height: 28px;
  color: var(--ms-text-1);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--ms-text-3, #94a3b8);
    opacity: 0.6;
    font-weight: 400;
  }
`;

export const ArtifactCaptionInput = styled.input`
  width: 100%;
  border: none;
  outline: none;
  font-size: 13px;
  padding: 6px 2px;
  background: transparent;
  color: var(--ms-text-2);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--ms-text-3, #94a3b8);
    opacity: 0.65;
  }
`;

export const SlashMenuPopover = styled.div`
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 250;
  width: 320px;
  max-width: 90vw;
  max-height: 360px;
  overflow-y: auto;
  background: var(--surface-overlay, #ffffff);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  box-shadow:
    0 12px 32px rgba(15, 23, 42, 0.14),
    0 2px 6px rgba(15, 23, 42, 0.06);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

export const SlashMenuSectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: var(--ms-text-3);
  padding: 6px 10px 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
`;

export const SlashMenuItemButton = styled.button<{ $selected?: boolean | undefined }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: ${(props) => (props.$selected ? "var(--ms-surface-hover, rgba(15, 23, 42, 0.06))" : "transparent")};
  color: var(--ms-text-1);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--ms-surface-hover, rgba(15, 23, 42, 0.06));
  }

  .slash-item-icon {
    width: 32px;
    height: 32px;
    border-radius: 7px;
    border: 1px solid var(--ms-divider);
    background: var(--color-canvas-inset, #ffffff);
    color: var(--ms-text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--font-mono, monospace);
  }

  .slash-item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .slash-item-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ms-text-1);
    line-height: 1.25;
  }

  .slash-item-desc {
    font-size: 11.5px;
    color: var(--ms-text-3);
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
