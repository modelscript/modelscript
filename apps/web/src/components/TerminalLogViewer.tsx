// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  SearchIcon,
  SyncIcon,
  TerminalIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { getJobStatus, type JobInfo, type JobStatus } from "../api";

/* ─── Keyframe Animations ─── */
const pulseLive = keyframes`
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 160, 67, 0.7); }
  70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(46, 160, 67, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 160, 67, 0); }
`;

const pulseProcessing = keyframes`
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
`;

/* ─── Styled Components ─── */
const TerminalContainer = styled.div<{ $isFullscreen?: boolean; $isCollapsed?: boolean }>`
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

const TerminalHeader = styled.div`
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

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const WindowDots = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Dot = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  display: inline-block;
  opacity: 0.85;
`;

const TerminalTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #e6edf3);
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusPill = styled.div<{ $status: JobStatus | "streaming" }>`
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

const LiveBeacon = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success-fg, #3fb950);
  animation: ${pulseLive} 2s infinite ease-in-out;
`;

const ProcessingBeacon = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent-fg, #58a6ff);
  animation: ${pulseProcessing} 1.5s infinite ease-in-out;
`;

const ToolbarButton = styled.button<{ $active?: boolean }>`
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

const FilterInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const FilterIconSpan = styled.span`
  position: absolute;
  left: 8px;
  color: var(--color-text-muted, #6e7681);
  pointer-events: none;
  display: flex;
`;

const FilterInput = styled.input`
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

const ClearFilterButton = styled.button`
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

const TerminalScrollArea = styled.div<{ $isFullscreen?: boolean }>`
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

const LogLineRow = styled.div<{ $isError?: boolean; $isWarning?: boolean; $isHighlight?: boolean }>`
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

const LineNumber = styled.span`
  user-select: none;
  color: var(--color-text-muted, #484f58);
  width: 42px;
  min-width: 42px;
  text-align: right;
  padding-right: 12px;
  font-size: 11px;
`;

const LineContent = styled.span`
  flex: 1;
  color: var(--color-text-primary, #e6edf3);
`;

const JumpToBottomPill = styled.button`
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

const CollapsedSummaryBar = styled.div`
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

/* ─── ANSI & Syntax Highlight Engine ─── */
interface StyledSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const ANSI_COLORS: Record<number, string> = {
  30: "#484f58", // black
  31: "#ff7b72", // red
  32: "#3fb950", // green
  33: "#d29922", // yellow
  34: "#58a6ff", // blue
  35: "#bc8cff", // magenta
  36: "#39c5cf", // cyan
  37: "#f0f6fc", // white
  90: "#8b949e", // bright black / gray
  91: "#ffa198", // bright red
  92: "#56d364", // bright green
  93: "#e3b341", // bright yellow
  94: "#79c0ff", // bright blue
  95: "#d2a8ff", // bright magenta
  96: "#56d4dd", // bright cyan
  97: "#ffffff", // bright white
};

/**
 * Parses ANSI escape sequences and enhances plain text tokens with syntactic highlights.
 */
function parseAnsiLine(rawLine: string): StyledSpan[] {
  const result: StyledSpan[] = [];
  // Regex to split by ANSI escape codes: \u001b[...m
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\u001b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let isBold = false;
  let isDim = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(rawLine)) !== null) {
    const textBefore = rawLine.substring(lastIndex, match.index);
    if (textBefore) {
      result.push({ text: textBefore, color: currentColor, bold: isBold, dim: isDim });
    }

    const codeStr = match[1] || "0";
    const codes = codeStr.split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined;
        isBold = false;
        isDim = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (ANSI_COLORS[code]) {
        currentColor = ANSI_COLORS[code];
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = rawLine.substring(lastIndex);
  if (remaining) {
    result.push({ text: remaining, color: currentColor, bold: isBold, dim: isDim });
  }

  return result.length > 0 ? result : [{ text: rawLine }];
}

/**
 * Format a styled span or tokenized span into a React element
 */
function renderSpan(span: StyledSpan, index: number): React.ReactNode {
  // If span already has an ANSI color, respect it
  if (span.color || span.bold || span.dim) {
    return (
      <span
        key={index}
        style={{
          color: span.color,
          fontWeight: span.bold ? 700 : undefined,
          opacity: span.dim ? 0.75 : undefined,
        }}
      >
        {span.text}
      </span>
    );
  }

  // Tokenize plain segments: e.g. [publish], ✔, ERR, (342ms), @scope/pkg
  const text = span.text;
  const tagRegex =
    /(\[[a-zA-Z0-9_-]+\]|✔|✖|⚠|ERR|Error|failed|completed|done|\(\d+(\.\d+)?ms\)|@[\w-]+\/[\w-]+@[\d.]+|[\w-]+\.(wasm|mo|sysml|step|json|db|zip))/g;

  const parts = text.split(tagRegex);
  if (parts.length === 1) {
    return <span key={index}>{text}</span>;
  }

  return (
    <span key={index}>
      {parts.map((part, pIdx) => {
        if (!part) return null;
        if (part.startsWith("[") && part.endsWith("]")) {
          return (
            <span
              key={pIdx}
              style={{
                color: "var(--color-accent-fg, #58a6ff)",
                background: "rgba(56, 139, 253, 0.12)",
                borderRadius: "3px",
                padding: "0 4px",
                marginRight: "2px",
                fontWeight: 600,
              }}
            >
              {part}
            </span>
          );
        }
        if (part === "✔" || part.toLowerCase() === "completed" || part.toLowerCase() === "done") {
          return (
            <span key={pIdx} style={{ color: "var(--color-success-fg, #3fb950)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (
          part === "✖" ||
          part.startsWith("ERR") ||
          part.toLowerCase() === "error" ||
          part.toLowerCase() === "failed"
        ) {
          return (
            <span key={pIdx} style={{ color: "var(--color-danger-fg, #f85149)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (part === "⚠" || part.toLowerCase() === "warn" || part.toLowerCase() === "warning") {
          return (
            <span key={pIdx} style={{ color: "var(--color-attention-fg, #d29922)", fontWeight: 700 }}>
              {part}
            </span>
          );
        }
        if (part.startsWith("(") && part.endsWith("ms)")) {
          return (
            <span key={pIdx} style={{ color: "var(--color-text-muted, #8b949e)", fontStyle: "italic" }}>
              {part}
            </span>
          );
        }
        if (part.startsWith("@") && part.includes("/")) {
          return (
            <span key={pIdx} style={{ color: "var(--color-accent-cyan, #39c5cf)", fontWeight: 600 }}>
              {part}
            </span>
          );
        }
        return <span key={pIdx}>{part}</span>;
      })}
    </span>
  );
}

/* ─── Main Component Props ─── */
export interface TerminalLogViewerProps {
  packageName: string;
  packageVersion: string;
  initialJobInfo?: JobInfo | null;
  onJobCompleted?: () => void;
  defaultCollapsed?: boolean;
}

export const TerminalLogViewer: React.FC<TerminalLogViewerProps> = ({
  packageName,
  packageVersion,
  initialJobInfo,
  onJobCompleted,
  defaultCollapsed = false,
}) => {
  const [logs, setLogs] = useState<string[]>(initialJobInfo?.logs ?? []);
  const [status, setStatus] = useState<JobStatus>(initialJobInfo?.status ?? "pending");
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [newLinesWhileScrolled, setNewLinesWhileScrolled] = useState(0);
  const [filterText, setFilterText] = useState("");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed || initialJobInfo?.status === "completed");

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamActiveRef = useRef(false);

  /* ─── Server-Sent Events (SSE) with Polling Fallback ─── */
  useEffect(() => {
    if (!packageName || !packageVersion) return;
    if (status === "completed" || status === "failed") return;

    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    streamActiveRef.current = true;

    const streamUrl = `/api/v1/libraries/${packageName}/${packageVersion}/logs/stream`;

    try {
      eventSource = new EventSource(streamUrl);
      setIsStreaming(true);

      eventSource.addEventListener("init", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data.logs)) {
            setLogs(data.logs);
          }
          if (data.status) {
            setStatus(data.status);
            if (data.status === "completed") {
              onJobCompleted?.();
            }
          }
        } catch (e) {
          console.error("[TerminalLogViewer] Failed to parse init event", e);
        }
      });

      eventSource.addEventListener("log", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (typeof data.line === "string") {
            setLogs((prev) => [...prev, data.line]);
          }
        } catch (e) {
          console.error("[TerminalLogViewer] Failed to parse log event", e);
        }
      });

      eventSource.addEventListener("status", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status) {
            setStatus(data.status);
            if (data.status === "completed") {
              setIsStreaming(false);
              onJobCompleted?.();
            } else if (data.status === "failed") {
              setIsStreaming(false);
            }
          }
        } catch (e) {
          console.error("[TerminalLogViewer] Failed to parse status event", e);
        }
      });

      eventSource.onerror = () => {
        // Fallback to polling if SSE encounters an error or proxy disconnect
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        setIsStreaming(false);

        if (!pollInterval && streamActiveRef.current) {
          pollInterval = setInterval(async () => {
            try {
              const job = await getJobStatus(packageName, packageVersion);
              if (job.logs && job.logs.length > 0) {
                setLogs(job.logs);
              }
              if (job.status) {
                setStatus(job.status);
                if (job.status === "completed") {
                  if (pollInterval) clearInterval(pollInterval);
                  onJobCompleted?.();
                } else if (job.status === "failed") {
                  if (pollInterval) clearInterval(pollInterval);
                }
              }
            } catch {
              // Ignore polling errors
            }
          }, 2500);
        }
      };
    } catch {
      // EventSource instantiation failed (unsupported environment), fallback to polling
      pollInterval = setInterval(async () => {
        try {
          const job = await getJobStatus(packageName, packageVersion);
          if (job.logs) setLogs(job.logs);
          if (job.status) {
            setStatus(job.status);
            if (job.status === "completed" || job.status === "failed") {
              if (pollInterval) clearInterval(pollInterval);
              if (job.status === "completed") onJobCompleted?.();
            }
          }
        } catch {
          // Ignore polling errors
        }
      }, 2500);
    }

    return () => {
      streamActiveRef.current = false;
      if (eventSource) {
        eventSource.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      setIsStreaming(false);
    };
  }, [packageName, packageVersion, status, onJobCompleted]);

  /* ─── Auto-Scroll Management ─── */
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsUserScrolledUp(false);
      setNewLinesWhileScrolled(0);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const scrolledUp = distanceFromBottom > 35;
    setIsUserScrolledUp(scrolledUp);
    if (!scrolledUp) {
      setNewLinesWhileScrolled(0);
    }
  }, []);

  useEffect(() => {
    if (autoScroll && !isUserScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (isUserScrolledUp) {
      setNewLinesWhileScrolled((prev) => prev + 1);
    }
  }, [logs.length, autoScroll, isUserScrolledUp]);

  /* ─── Filtering & Search ─── */
  const filteredLogs = useMemo(() => {
    if (!filterText.trim()) return logs;
    const query = filterText.toLowerCase();
    return logs.filter((line) => line.toLowerCase().includes(query));
  }, [logs, filterText]);

  /* ─── Clipboard Copy ─── */
  const handleCopy = useCallback(() => {
    // Strip ANSI codes before copying to system clipboard
    // eslint-disable-next-line no-control-regex
    const cleanLogs = logs.map((l) => l.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
    navigator.clipboard.writeText(cleanLogs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  /* ─── Download Logs ─── */
  const handleDownload = useCallback(() => {
    // eslint-disable-next-line no-control-regex
    const cleanLogs = logs.map((l) => l.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
    const blob = new Blob([cleanLogs], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${packageName.replace(/[@/]/g, "-")}-${packageVersion}-ingestion.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [logs, packageName, packageVersion]);

  // Don't render if there are no logs and job is not processing/failed
  if (logs.length === 0 && status !== "processing" && status !== "pending") {
    return null;
  }

  // Collapsed View (typically used when finished)
  if (isCollapsed) {
    return (
      <TerminalContainer>
        <CollapsedSummaryBar onClick={() => setIsCollapsed(false)}>
          <HeaderLeft>
            <WindowDots>
              <Dot $color="#ff5f56" />
              <Dot $color="#ffbd2e" />
              <Dot $color="#27c93f" />
            </WindowDots>
            <TerminalTitle>
              <TerminalIcon size={14} />
              <span>Package Ingestion & Indexer Logs</span>
              <StatusPill $status={status}>{status}</StatusPill>
            </TerminalTitle>
          </HeaderLeft>
          <HeaderRight>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {logs.length} lines • Click to expand
            </span>
          </HeaderRight>
        </CollapsedSummaryBar>
      </TerminalContainer>
    );
  }

  return (
    <TerminalContainer $isFullscreen={isFullscreen}>
      {/* ─── Header ─── */}
      <TerminalHeader>
        <HeaderLeft>
          <WindowDots>
            <Dot $color="#ff5f56" />
            <Dot $color="#ffbd2e" />
            <Dot $color="#27c93f" />
          </WindowDots>
          <TerminalTitle>
            <TerminalIcon size={14} />
            <span>Ingestion & Indexing Logs</span>
            <StatusPill $status={status}>
              {status === "processing" ? (
                <>
                  <ProcessingBeacon /> Processing…
                </>
              ) : status === "completed" ? (
                <>✔ Completed</>
              ) : status === "failed" ? (
                <>✖ Failed</>
              ) : (
                status
              )}
            </StatusPill>
            {isStreaming && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  color: "var(--color-success-fg, #3fb950)",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                }}
              >
                <LiveBeacon /> LIVE
              </span>
            )}
          </TerminalTitle>
        </HeaderLeft>

        <HeaderRight>
          {/* Filter input */}
          <FilterInputWrapper>
            <FilterIconSpan>
              <SearchIcon size={12} />
            </FilterIconSpan>
            <FilterInput
              placeholder="Filter logs…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            {filterText && (
              <ClearFilterButton onClick={() => setFilterText("")} title="Clear filter">
                <XIcon size={12} />
              </ClearFilterButton>
            )}
          </FilterInputWrapper>

          {/* Auto-scroll toggle */}
          <ToolbarButton
            $active={autoScroll}
            onClick={() => setAutoScroll((prev) => !prev)}
            title="Auto-scroll to latest lines"
          >
            <SyncIcon size={12} />
            Auto-scroll
          </ToolbarButton>

          {/* Copy button */}
          <ToolbarButton onClick={handleCopy} title="Copy logs to clipboard">
            {copied ? <CheckIcon size={12} fill="var(--color-success-fg)" /> : <CopyIcon size={12} />}
            {copied ? "Copied!" : "Copy"}
          </ToolbarButton>

          {/* Download button */}
          <ToolbarButton onClick={handleDownload} title="Download .log file">
            <DownloadIcon size={12} />
          </ToolbarButton>

          {/* Fullscreen toggle */}
          <ToolbarButton
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <ScreenNormalIcon size={12} /> : <ScreenFullIcon size={12} />}
          </ToolbarButton>

          {/* Collapse button */}
          <ToolbarButton onClick={() => setIsCollapsed(true)} title="Collapse terminal">
            <XIcon size={12} />
          </ToolbarButton>
        </HeaderRight>
      </TerminalHeader>

      {/* ─── Log Scroll Area ─── */}
      <TerminalScrollArea ref={scrollRef} onScroll={handleScroll} $isFullscreen={isFullscreen}>
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "var(--color-text-muted, #8b949e)",
              fontSize: 12,
            }}
          >
            {filterText ? (
              `No log lines match "${filterText}"`
            ) : status === "pending" || status === "processing" ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <ProcessingBeacon /> Waiting for background worker output…
              </div>
            ) : (
              "No logs available."
            )}
          </div>
        ) : (
          filteredLogs.map((rawLine, idx) => {
            const isError =
              rawLine.includes("ERR") ||
              rawLine.includes("Error:") ||
              rawLine.includes("Aborted(") ||
              rawLine.toLowerCase().includes("failed");
            const isWarning =
              rawLine.includes("WARN") || rawLine.toLowerCase().includes("warning") || rawLine.includes("⚠");
            const styledSpans = parseAnsiLine(rawLine);

            return (
              <LogLineRow key={idx} $isError={isError} $isWarning={isWarning}>
                <LineNumber>{idx + 1}</LineNumber>
                <LineContent>{styledSpans.map(renderSpan)}</LineContent>
              </LogLineRow>
            );
          })
        )}
      </TerminalScrollArea>

      {/* ─── Floating Jump to Bottom Button ─── */}
      {isUserScrolledUp && (
        <JumpToBottomPill onClick={scrollToBottom}>
          ↓ Jump to latest {newLinesWhileScrolled > 0 && `(${newLinesWhileScrolled} new)`}
        </JumpToBottomPill>
      )}
    </TerminalContainer>
  );
};
