// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDownIcon, ChevronRightIcon, PlayIcon, SyncIcon, TerminalIcon, TrashIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  evaluateReplInMorsel,
  executeLspAction,
  listLspActionsInMorsel,
  type MorselLspActionInfo,
} from "../util/lsp-bridge";

export interface MorselReplPanelProps {
  documentUri: string;
  dialect: string;
  colorMode: "light" | "dark";
}

type ReplEntryKind = "input" | "output" | "error" | "action" | "info";

interface ReplLogEntry {
  id: number;
  kind: ReplEntryKind;
  text: string;
  meta?: string | undefined;
  timestamp: string;
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatUnknownValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatActionResult(result: unknown): { text: string; isError: boolean } {
  if (result === undefined || result === null) {
    return { text: "(completed with no output)", isError: false };
  }
  if (typeof result === "string") {
    return { text: result || "(completed)", isError: false };
  }
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return { text: record.error, isError: true };
    }
    if (record.ok === false && typeof record.message === "string" && record.message.trim()) {
      return { text: record.message, isError: true };
    }
    if (typeof record.output === "string" && record.output.trim() && Object.keys(record).length <= 2) {
      return { text: record.output, isError: false };
    }
  }
  return { text: formatUnknownValue(result), isError: false };
}

export const MorselReplPanel: React.FC<MorselReplPanelProps> = ({ documentUri, dialect, colorMode }) => {
  const isDark = colorMode === "dark";

  // REPL state
  const [entries, setEntries] = useState<ReplLogEntry[]>([]);
  const [input, setInput] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const draftInputRef = useRef<string>("");
  const nextEntryIdRef = useRef<number>(1);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Document LSP Actions state
  const [actions, setActions] = useState<MorselLspActionInfo[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [actionsExpanded, setActionsExpanded] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const actionsRequestSeqRef = useRef<number>(0);

  const appendEntry = useCallback((kind: ReplEntryKind, text: string, meta?: string) => {
    const id = nextEntryIdRef.current++;
    setEntries((prev) => [
      ...prev,
      {
        id,
        kind,
        text,
        meta,
        timestamp: formatTimestamp(),
      },
    ]);
  }, []);

  // Auto-scroll REPL log to the latest entry
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  // Fetch Document LSP Actions whenever documentUri or dialect changes
  const fetchActions = useCallback(async () => {
    const seq = ++actionsRequestSeqRef.current;
    if (!documentUri && !dialect) {
      setActions([]);
      setActionsError(null);
      setActionsLoading(false);
      return;
    }
    setActionsLoading(true);
    setActionsError(null);
    try {
      const list = await listLspActionsInMorsel(documentUri, dialect);
      if (actionsRequestSeqRef.current !== seq) return;
      setActions(Array.isArray(list) ? list : []);
    } catch (err) {
      if (actionsRequestSeqRef.current !== seq) return;
      setActions([]);
      setActionsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (actionsRequestSeqRef.current === seq) {
        setActionsLoading(false);
      }
    }
  }, [documentUri, dialect]);

  useEffect(() => {
    void fetchActions();
  }, [fetchActions]);

  // Evaluate REPL input
  const handleEvaluate = useCallback(async () => {
    const code = input.trim();
    if (!code || isEvaluating) return;

    appendEntry("input", code);
    setCommandHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === code) {
        return prev;
      }
      return [...prev, code];
    });
    setHistoryIndex(-1);
    draftInputRef.current = "";
    setInput("");
    setIsEvaluating(true);

    try {
      const res = await evaluateReplInMorsel(code, documentUri);
      if (res.status === "error" || (typeof res.error === "string" && res.error.trim())) {
        const errText = res.error?.trim() || formatUnknownValue(res.result) || "Evaluation error.";
        appendEntry("error", errText);
      } else if (res.status === "incomplete") {
        appendEntry("info", res.output?.trim() || "Incomplete expression.");
      } else {
        const hasOutput = typeof res.output === "string" && res.output.length > 0;
        const formattedResult = res.result !== undefined ? formatUnknownValue(res.result) : "";
        if (hasOutput) {
          appendEntry("output", res.output!);
        }
        if (formattedResult && (!hasOutput || formattedResult.trim() !== res.output!.trim())) {
          appendEntry("output", formattedResult);
        }
        if (!hasOutput && !formattedResult) {
          appendEntry("info", "(ok)");
        }
      }
    } catch (err) {
      appendEntry("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsEvaluating(false);
      inputRef.current?.focus();
    }
  }, [appendEntry, documentUri, input, isEvaluating]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleEvaluate();
        return;
      }

      if (e.key === "ArrowUp") {
        if (commandHistory.length === 0) return;
        e.preventDefault();
        if (historyIndex === -1) {
          draftInputRef.current = input;
          const nextIdx = commandHistory.length - 1;
          setHistoryIndex(nextIdx);
          setInput(commandHistory[nextIdx] ?? "");
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setInput(commandHistory[nextIdx] ?? "");
        }
        return;
      }

      if (e.key === "ArrowDown") {
        if (historyIndex === -1) return;
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          setInput(commandHistory[nextIdx] ?? "");
        } else {
          setHistoryIndex(-1);
          setInput(draftInputRef.current);
        }
      }
    },
    [commandHistory, handleEvaluate, historyIndex, input],
  );

  // Execute a Document LSP Action and print the result into the REPL log
  const handleRunAction = useCallback(
    async (action: MorselLspActionInfo) => {
      if (runningActionId !== null) return;
      const label = action.title?.trim() || action.command || action.id;
      setRunningActionId(action.id);
      appendEntry("action", `Running action: ${label}`, action.id);
      try {
        const res = await executeLspAction(action.id, dialect, documentUri);
        const formatted = formatActionResult(res);
        appendEntry(formatted.isError ? "error" : "output", formatted.text, label);
      } catch (err) {
        appendEntry("error", err instanceof Error ? err.message : String(err), label);
      } finally {
        setRunningActionId(null);
      }
    },
    [appendEntry, dialect, documentUri, runningActionId],
  );

  const handleClearLog = useCallback(() => {
    setEntries([]);
    inputRef.current?.focus();
  }, []);

  // Theme tokens with Morsel / Primer CSS variables and dark/light fallbacks
  const surfaceBg = isDark ? "var(--bgColor-default, #0d1117)" : "var(--bgColor-default, #ffffff)";
  const headerBg = isDark ? "var(--bgColor-muted, #161b22)" : "var(--bgColor-muted, #f6f8fa)";
  const insetBg = isDark ? "var(--bgColor-inset, #010409)" : "var(--bgColor-inset, #f6f8fa)";
  const borderColor = isDark ? "var(--borderColor-default, #30363d)" : "var(--borderColor-default, #d0d7de)";
  const textPrimary = isDark ? "var(--fgColor-default, #e6edf3)" : "var(--fgColor-default, #1f2328)";
  const textMuted = isDark ? "var(--fgColor-muted, #8b949e)" : "var(--fgColor-muted, #656d76)";
  const accentFg = isDark ? "var(--fgColor-accent, #58a6ff)" : "var(--fgColor-accent, #0969da)";
  const dangerFg = isDark ? "var(--fgColor-danger, #f85149)" : "var(--fgColor-danger, #cf222e)";
  const dangerBg = isDark
    ? "var(--ms-status-fail-bg, rgba(248, 81, 73, 0.12))"
    : "var(--ms-status-fail-bg, rgba(207, 34, 46, 0.08))";
  const badgeBg = isDark ? "rgba(110, 118, 129, 0.24)" : "rgba(175, 184, 193, 0.28)";
  const actionBg = isDark ? "rgba(56, 139, 253, 0.12)" : "rgba(9, 105, 218, 0.08)";
  const monoFont =
    "var(--font-mono, var(--ms-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace))";
  const sansFont = "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        backgroundColor: surfaceBg,
        color: textPrimary,
        fontFamily: sansFont,
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      {/* ── Top Section: Interactive REPL ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* REPL Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 10px",
            backgroundColor: headerBg,
            borderBottom: `1px solid ${borderColor}`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ color: accentFg, display: "inline-flex", flexShrink: 0 }}>
              <TerminalIcon size={14} />
            </span>
            <span style={{ fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>REPL</span>
            {dialect && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: monoFont,
                  padding: "1px 6px",
                  borderRadius: 999,
                  backgroundColor: badgeBg,
                  color: textMuted,
                  whiteSpace: "nowrap",
                }}
              >
                {dialect}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleClearLog}
            disabled={entries.length === 0}
            title="Clear REPL output"
            aria-label="Clear REPL output"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              fontSize: 11,
              borderRadius: 5,
              border: `1px solid ${borderColor}`,
              backgroundColor: "transparent",
              color: entries.length === 0 ? textMuted : textPrimary,
              opacity: entries.length === 0 ? 0.5 : 1,
              cursor: entries.length === 0 ? "default" : "pointer",
            }}
          >
            <TrashIcon size={12} />
            <span>Clear</span>
          </button>
        </div>

        {/* Scrollable REPL History */}
        <div
          ref={logContainerRef}
          role="log"
          aria-live="polite"
          aria-label="REPL output log"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "8px 10px",
            backgroundColor: insetBg,
            fontFamily: monoFont,
            fontSize: 12,
            lineHeight: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {entries.length === 0 ? (
            <div style={{ color: textMuted, fontStyle: "italic", padding: "4px 2px" }}>
              Enter an expression below and press Enter to evaluate, or run a Document LSP Action.
            </div>
          ) : (
            entries.map((entry) => {
              if (entry.kind === "input") {
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      wordBreak: "break-word",
                    }}
                  >
                    <span style={{ color: accentFg, fontWeight: 700, flexShrink: 0, userSelect: "none" }}>ms&gt;</span>
                    <span style={{ color: textPrimary, whiteSpace: "pre-wrap", flex: 1 }}>{entry.text}</span>
                    <span style={{ color: textMuted, fontSize: 10, flexShrink: 0 }}>{entry.timestamp}</span>
                  </div>
                );
              }

              if (entry.kind === "action") {
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "3px 8px",
                      borderRadius: 4,
                      backgroundColor: actionBg,
                      color: accentFg,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{entry.text}</span>
                    <span style={{ color: textMuted, fontSize: 10, flexShrink: 0 }}>{entry.timestamp}</span>
                  </div>
                );
              }

              if (entry.kind === "error") {
                return (
                  <pre
                    key={entry.id}
                    style={{
                      margin: 0,
                      padding: "4px 8px",
                      borderRadius: 4,
                      backgroundColor: dangerBg,
                      color: dangerFg,
                      fontFamily: monoFont,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {entry.meta ? `[${entry.meta}] ${entry.text}` : entry.text}
                  </pre>
                );
              }

              if (entry.kind === "info") {
                return (
                  <div
                    key={entry.id}
                    style={{
                      color: textMuted,
                      paddingLeft: 26,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {entry.text}
                  </div>
                );
              }

              return (
                <pre
                  key={entry.id}
                  style={{
                    margin: 0,
                    paddingLeft: 26,
                    color: textPrimary,
                    fontFamily: monoFont,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {entry.text}
                </pre>
              );
            })
          )}
        </div>

        {/* Monospace Prompt Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            backgroundColor: surfaceBg,
            borderTop: `1px solid ${borderColor}`,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: monoFont,
              fontSize: 12,
              fontWeight: 700,
              color: accentFg,
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            ms&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (historyIndex !== -1) {
                setHistoryIndex(-1);
              }
            }}
            onKeyDown={handleInputKeyDown}
            disabled={isEvaluating}
            placeholder={isEvaluating ? "Evaluating…" : "Type expression (Enter to run, ↑/↓ history)"}
            aria-label="REPL expression input"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: textPrimary,
              fontFamily: monoFont,
              fontSize: 12,
              lineHeight: "20px",
            }}
          />
          <button
            type="button"
            onClick={() => void handleEvaluate()}
            disabled={isEvaluating || !input.trim()}
            style={{
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 5,
              border: `1px solid ${borderColor}`,
              backgroundColor: headerBg,
              color: isEvaluating || !input.trim() ? textMuted : accentFg,
              opacity: isEvaluating || !input.trim() ? 0.55 : 1,
              cursor: isEvaluating || !input.trim() ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            {isEvaluating ? "Running…" : "Eval"}
          </button>
        </div>
      </div>

      {/* ── Bottom Collapsible Section: Document LSP Actions ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderTop: `1px solid ${borderColor}`,
          backgroundColor: surfaceBg,
          maxHeight: actionsExpanded ? "42%" : undefined,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 10px",
            backgroundColor: headerBg,
            borderBottom: actionsExpanded ? `1px solid ${borderColor}` : "none",
          }}
        >
          <button
            type="button"
            onClick={() => setActionsExpanded((prev) => !prev)}
            aria-expanded={actionsExpanded}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: "transparent",
              color: textPrimary,
              fontWeight: 600,
              fontSize: 12,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <span style={{ color: textMuted, display: "inline-flex" }}>
              {actionsExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            </span>
            <span>Document LSP Actions</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: monoFont,
                padding: "1px 6px",
                borderRadius: 999,
                backgroundColor: badgeBg,
                color: textMuted,
              }}
            >
              {actions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void fetchActions()}
            disabled={actionsLoading}
            title="Refresh LSP actions"
            aria-label="Refresh LSP actions"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              fontSize: 11,
              borderRadius: 5,
              border: `1px solid ${borderColor}`,
              backgroundColor: "transparent",
              color: textMuted,
              cursor: actionsLoading ? "default" : "pointer",
              opacity: actionsLoading ? 0.6 : 1,
            }}
          >
            <SyncIcon size={12} />
            <span>Refresh</span>
          </button>
        </div>

        {actionsExpanded && (
          <div
            style={{
              overflowY: "auto",
              padding: "6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {actionsLoading ? (
              <div style={{ color: textMuted, fontSize: 11, padding: "4px 2px" }}>Loading LSP actions…</div>
            ) : actionsError ? (
              <div
                style={{
                  color: dangerFg,
                  backgroundColor: dangerBg,
                  padding: "6px 8px",
                  borderRadius: 5,
                  fontSize: 11,
                }}
              >
                Failed to load actions: {actionsError}
              </div>
            ) : actions.length === 0 ? (
              <div style={{ color: textMuted, fontSize: 11, padding: "4px 2px" }}>
                No LSP actions available for this document.
              </div>
            ) : (
              actions.map((action) => {
                const isRunning = runningActionId === action.id;
                const displayTitle = action.title?.trim() || action.command || action.id;
                return (
                  <div
                    key={action.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: `1px solid ${borderColor}`,
                      backgroundColor: insetBg,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 12,
                            color: textPrimary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={displayTitle}
                        >
                          {displayTitle}
                        </span>
                        {action.category && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "0px 5px",
                              borderRadius: 4,
                              backgroundColor: badgeBg,
                              color: textMuted,
                            }}
                          >
                            {action.category}
                          </span>
                        )}
                      </div>
                      {action.description && (
                        <div
                          style={{
                            fontSize: 11,
                            color: textMuted,
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={action.description}
                        >
                          {action.description}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRunAction(action)}
                      disabled={runningActionId !== null}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 9px",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 5,
                        border: `1px solid ${borderColor}`,
                        backgroundColor: headerBg,
                        color: isRunning ? textMuted : accentFg,
                        opacity: runningActionId !== null && !isRunning ? 0.5 : 1,
                        cursor: runningActionId !== null ? "default" : "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <PlayIcon size={12} />
                      <span>{isRunning ? "Running…" : "Run"}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MorselReplPanel;
