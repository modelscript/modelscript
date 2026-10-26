// SPDX-License-Identifier: AGPL-3.0-or-later

import styled, { css, keyframes } from "styled-components";
import type { JobStatus } from "../../api";

/* ─── Keyframe Animations ─── */
export const pulseLive = keyframes`
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 160, 67, 0.7); }
  70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(46, 160, 67, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 160, 67, 0); }
`;

export const pulseProcessing = keyframes`
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
`;

/* ─── Styled Components ─── */
export const TerminalContainer = styled.div<{
  $isFullscreen?: boolean | undefined;
  $isCollapsed?: boolean | undefined;
}>`
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-inset, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  margin-bottom: 20px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  ${(props) =>
    props.$isFullscreen &&
    css`
      position: fixed;
      inset: 20px;
      z-index: 1000;
      margin: 0;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.75);
    `}
`;

export const TerminalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  user-select: none;
  gap: 12px;
  flex-wrap: wrap;
`;

export const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const WindowDots = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const Dot = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  display: inline-block;
  opacity: 0.85;
`;

export const TerminalTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #e6edf3);
`;

export const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const StatusPill = styled.div<{ $status: JobStatus | "streaming" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  text-transform: capitalize;

  ${(props) => {
    switch (props.$status) {
      case "processing":
      case "streaming":
        return css`
          background: rgba(56, 139, 253, 0.15);
          color: var(--color-accent-fg, #58a6ff);
          border: 1px solid rgba(56, 139, 253, 0.3);
        `;
      case "completed":
        return css`
          background: rgba(46, 160, 67, 0.15);
          color: var(--color-success-fg, #3fb950);
          border: 1px solid rgba(46, 160, 67, 0.3);
        `;
      case "failed":
        return css`
          background: rgba(248, 81, 73, 0.15);
          color: var(--color-danger-fg, #f85149);
          border: 1px solid rgba(248, 81, 73, 0.3);
        `;
      default:
        return css`
          background: rgba(139, 148, 158, 0.15);
          color: var(--color-text-muted, #8b949e);
          border: 1px solid rgba(139, 148, 158, 0.3);
        `;
    }
  }}
`;

export const LiveBeacon = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success-fg, #3fb950);
  animation: ${pulseLive} 2s infinite ease-in-out;
`;

export const ProcessingBeacon = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent-fg, #58a6ff);
  animation: ${pulseProcessing} 1.5s infinite ease-in-out;
`;

export const ToolbarButton = styled.button<{ $active?: boolean | undefined }>`
  background: ${(props) => (props.$active ? "rgba(56, 139, 253, 0.15)" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "rgba(56, 139, 253, 0.4)" : "var(--color-border-subtle, #21262d)")};
  color: ${(props) => (props.$active ? "var(--color-accent-fg, #58a6ff)" : "var(--color-text-secondary, #8b949e)")};
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-canvas-subtle, #21262d);
    color: var(--color-text-primary, #e6edf3);
    border-color: var(--color-border-default, #30363d);
  }
`;

export const FilterInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

export const FilterIconSpan = styled.span`
  position: absolute;
  left: 8px;
  color: var(--color-text-muted, #6e7681);
  pointer-events: none;
  display: flex;
`;

export const FilterInput = styled.input`
  background: var(--color-canvas-inset, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 5px;
  padding: 3px 24px 3px 26px;
  font-size: 11px;
  font-family: inherit;
  color: var(--color-text-primary, #e6edf3);
  width: 140px;
  transition: all 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--color-accent-fg, #58a6ff);
    width: 200px;
  }

  &::placeholder {
    color: var(--color-text-muted, #6e7681);
  }
`;

export const ClearFilterButton = styled.button`
  position: absolute;
  right: 6px;
  background: none;
  border: none;
  color: var(--color-text-muted, #8b949e);
  cursor: pointer;
  padding: 0;
  display: flex;

  &:hover {
    color: var(--color-text-primary, #e6edf3);
  }
`;

export const TerminalScrollArea = styled.div<{ $isFullscreen?: boolean | undefined }>`
  flex: 1;
  max-height: ${(props) => (props.$isFullscreen ? "calc(100vh - 120px)" : "360px")};
  min-height: 180px;
  overflow-y: auto;
  overflow-x: auto;
  padding: 10px 0;
  background: var(--color-canvas-inset, #0d1117);
  scroll-behavior: smooth;

  /* Custom subtle scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border-subtle, #30363d);
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-default, #484f58);
  }
`;

export const LogLineRow = styled.div<{
  $isError?: boolean | undefined;
  $isWarning?: boolean | undefined;
  $isHighlight?: boolean | undefined;
}>`
  display: flex;
  align-items: flex-start;
  padding: 1.5px 12px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;

  ${(props) =>
    props.$isError &&
    css`
      background: rgba(248, 81, 73, 0.08);
      border-left: 2px solid var(--color-danger-fg, #f85149);
    `}

  ${(props) =>
    props.$isWarning &&
    css`
      background: rgba(210, 153, 34, 0.08);
      border-left: 2px solid var(--color-attention-fg, #d29922);
    `}

  &:hover {
    background: var(--color-canvas-subtle, rgba(110, 118, 129, 0.08));
  }
`;

export const LineNumber = styled.span`
  user-select: none;
  color: var(--color-text-muted, #484f58);
  width: 42px;
  min-width: 42px;
  text-align: right;
  padding-right: 12px;
  font-size: 11px;
`;

export const LineContent = styled.span`
  flex: 1;
  color: var(--color-text-primary, #e6edf3);
`;

export const JumpToBottomPill = styled.button`
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-accent-fg, #1f6feb);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  z-index: 10;
  animation: ${pulseProcessing} 2s infinite ease-in-out;
  transition: all 0.15s ease;

  &:hover {
    background: #388bfd;
    transform: translateX(-50%) scale(1.03);
  }
`;

export const CollapsedSummaryBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-canvas-subtle, #161b22);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--color-border-subtle, #21262d);
  }
`;
