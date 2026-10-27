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
import { getJobStatus, type JobInfo, type JobStatus } from "../../api";
import { parseAnsiLine, renderSpan } from "./AnsiRenderer";
import {
  ClearFilterButton,
  CollapsedSummaryBar,
  Dot,
  FilterIconSpan,
  FilterInput,
  FilterInputWrapper,
  HeaderLeft,
  HeaderRight,
  JumpToBottomPill,
  LineContent,
  LineNumber,
  LiveBeacon,
  LogLineRow,
  ProcessingBeacon,
  StatusPill,
  TerminalContainer,
  TerminalHeader,
  TerminalScrollArea,
  TerminalTitle,
  ToolbarButton,
  WindowDots,
} from "./styles";

/* ─── Main Component Props ─── */
export interface TerminalLogViewerProps {
  packageName: string;
  packageVersion: string;
  jobId?: string | number | undefined;
  isProcessing?: boolean | undefined;
  initialJobInfo?: JobInfo | null | undefined;
  onJobCompleted?: (() => void) | undefined;
  defaultCollapsed?: boolean | undefined;
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

export default TerminalLogViewer;
