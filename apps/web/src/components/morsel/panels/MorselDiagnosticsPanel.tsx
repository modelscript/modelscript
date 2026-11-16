// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import type { editor } from "monaco-editor";
import React, { useMemo, useRef, useState } from "react";
import { MorselResizeHandle } from "./MorselResizeHandle";

export interface MorselDiagnosticsPanelProps {
  diagnostics: editor.IMarkerData[];
  colorMode: "dark" | "light";
  isFloatingWorkspace: boolean;
  treeVisible: boolean;
  treeWidth: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  panelHeight: number;
  onResizeHeight: (height: number) => void;
  onSelectDiagnostic: (marker: editor.IMarkerData) => void;
}

type SeverityFilter = "all" | "error" | "warning";

const SEVERITY_ERROR = 8;
const SEVERITY_WARNING = 4;

export const COLLAPSED_DIAGNOSTICS_HEIGHT = 44;

function formatMarkerCode(code: editor.IMarkerData["code"]): string | null {
  if (!code) return null;
  if (typeof code === "string") return code;
  if (typeof code === "object" && "value" in code && typeof code.value === "string") {
    return code.value;
  }
  return null;
}

export const MorselDiagnosticsPanel: React.FC<MorselDiagnosticsPanelProps> = ({
  diagnostics,
  colorMode,
  isFloatingWorkspace,
  treeVisible,
  treeWidth,
  isExpanded,
  onToggleExpand,
  panelHeight,
  onResizeHeight,
  onSelectDiagnostic,
}) => {
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const isDark = colorMode === "dark";

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const d of diagnostics) {
      if (d.severity >= SEVERITY_ERROR) errors++;
      else if (d.severity >= SEVERITY_WARNING) warnings++;
      else infos++;
    }
    return { errors, warnings, infos, total: diagnostics.length };
  }, [diagnostics]);

  const filteredDiagnostics = useMemo(() => {
    const sorted = [...diagnostics].sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
      return a.startColumn - b.startColumn;
    });
    if (filter === "error") return sorted.filter((d) => d.severity >= SEVERITY_ERROR);
    if (filter === "warning")
      return sorted.filter((d) => d.severity >= SEVERITY_WARNING && d.severity < SEVERITY_ERROR);
    return sorted;
  }, [diagnostics, filter]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startY - moveEvent.clientY;
      const next = Math.max(100, Math.min(420, startHeight + delta));
      onResizeHeight(next);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizeTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    isResizingRef.current = true;
    setIsResizing(true);
    const startY = touch.clientY;
    const startHeight = panelHeight;

    const onTouchMove = (moveEvent: TouchEvent) => {
      if (!isResizingRef.current) return;
      const t = moveEvent.touches[0];
      if (!t) return;
      const delta = startY - t.clientY;
      const next = Math.max(100, Math.min(420, startHeight + delta));
      onResizeHeight(next);
    };

    const onTouchEnd = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      document.body.style.userSelect = "";
    };

    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    document.body.style.userSelect = "none";
  };

  const isCompactPill = isFloatingWorkspace && !isExpanded && counts.total === 0;
  const headerHeight = isCompactPill ? 36 : COLLAPSED_DIAGNOSTICS_HEIGHT;

  const floatingShadow = isDark
    ? "0 12px 32px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255, 255, 255, 0.04)"
    : "0 12px 32px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.05)";

  const outerStyle: React.CSSProperties = isFloatingWorkspace
    ? {
        position: "absolute",
        left: treeVisible ? treeWidth + 24 : 12,
        ...(isCompactPill ? { right: "auto", bottom: 16 } : { right: 12, bottom: 12 }),
        height: isExpanded ? panelHeight : headerHeight,
        zIndex: 30,
        overflow: "visible",
        pointerEvents: "none",
        transition: isResizing ? "none" : "height 0.16s ease, left 0.16s ease",
      }
    : {
        position: "relative",
        height: isExpanded ? panelHeight : COLLAPSED_DIAGNOSTICS_HEIGHT,
        flexShrink: 0,
        overflow: "visible",
        pointerEvents: "auto",
        transition: isResizing ? "none" : "height 0.16s ease",
      };

  const cardStyle: React.CSSProperties = {
    width: isCompactPill ? "auto" : "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: 12,
    border: isFloatingWorkspace
      ? "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))"
      : "1px solid var(--borderColor-muted, var(--ms-divider))",
    backgroundColor: isDark ? "rgba(24, 24, 27, 0.94)" : "rgba(255, 255, 255, 0.96)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: floatingShadow,
    overflow: "hidden",
    pointerEvents: "auto",
  };

  const textPrimary = isDark ? "#e4e4e7" : "#0f172a";
  const textMuted = isDark ? "#a1a1aa" : "#64748b";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)";

  return (
    <div style={outerStyle} role="region" aria-label="Diagnostics panel">
      {isExpanded && (
        <MorselResizeHandle
          orientation="horizontal"
          cursor="ns-resize"
          ariaLabel="Resize diagnostics panel"
          ariaValueNow={panelHeight}
          ariaValueMin={100}
          ariaValueMax={420}
          isDragging={isResizing}
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
          onDoubleClick={() => onResizeHeight(160)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onResizeHeight(Math.min(420, panelHeight + 16));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onResizeHeight(Math.max(100, panelHeight - 16));
            }
          }}
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            top: -9,
            height: 8,
            zIndex: 31,
          }}
        />
      )}

      <div style={cardStyle}>
        {/* Header Bar */}
        <div
          onClick={onToggleExpand}
          style={{
            height: headerHeight,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: isCompactPill ? 8 : 12,
            padding: isCompactPill ? "0 12px" : "8px 16px",
            boxSizing: "border-box",
            cursor: "pointer",
            userSelect: "none",
            borderBottom: isExpanded ? `1px solid ${borderColor}` : "none",
            color: textPrimary,
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {!isCompactPill && <span style={{ fontWeight: 600, letterSpacing: "0.01em" }}>Diagnostics</span>}

            {counts.total === 0 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: isCompactPill ? 500 : 400,
                  color: isDark ? "#4ade80" : "#16a34a",
                  whiteSpace: "nowrap",
                }}
              >
                <CheckCircleFillIcon size={12} />
                <span>No problems</span>
              </span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {counts.errors > 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: isDark ? "rgba(248, 81, 73, 0.16)" : "rgba(220, 38, 38, 0.10)",
                      color: isDark ? "#f85149" : "#dc2626",
                    }}
                  >
                    <XCircleFillIcon size={11} />
                    <span>{counts.errors}</span>
                  </span>
                )}
                {counts.warnings > 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: isDark ? "rgba(210, 153, 34, 0.18)" : "rgba(217, 119, 6, 0.10)",
                      color: isDark ? "#e3b341" : "#d97706",
                    }}
                  >
                    <AlertIcon size={11} />
                    <span>{counts.warnings}</span>
                  </span>
                )}
                {counts.infos > 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: isDark ? "rgba(56, 189, 248, 0.16)" : "rgba(2, 132, 199, 0.10)",
                      color: isDark ? "#38bdf8" : "#0284c7",
                    }}
                  >
                    <InfoIcon size={11} />
                    <span>{counts.infos}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isExpanded && counts.total > 0 && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 4 }}
              >
                {(["all", "error", "warning"] as SeverityFilter[]).map((key) => {
                  const active = filter === key;
                  const label =
                    key === "all"
                      ? `All (${counts.total})`
                      : key === "error"
                        ? `Errors (${counts.errors})`
                        : `Warnings (${counts.warnings})`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      style={{
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: active
                          ? isDark
                            ? "rgba(255, 255, 255, 0.12)"
                            : "rgba(15, 23, 42, 0.08)"
                          : "transparent",
                        color: active ? textPrimary : textMuted,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              aria-label={isExpanded ? "Collapse diagnostics panel" : "Expand diagnostics panel"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: textMuted,
                cursor: "pointer",
              }}
            >
              {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} />}
            </button>
          </div>
        </div>

        {/* Scrollable Diagnostic List */}
        {isExpanded && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "4px 6px",
            }}
          >
            {filteredDiagnostics.length === 0 ? (
              <div
                style={{
                  height: "100%",
                  minHeight: 54,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: textMuted,
                  fontSize: 12,
                }}
              >
                {counts.total === 0
                  ? "No diagnostics in current document."
                  : "No diagnostics match the selected filter."}
              </div>
            ) : (
              filteredDiagnostics.map((d, idx) => {
                const isErr = d.severity >= SEVERITY_ERROR;
                const isWarn = !isErr && d.severity >= SEVERITY_WARNING;
                const codeStr = formatMarkerCode(d.code);
                const sourceLabel = d.source ? (codeStr ? `${d.source}(${codeStr})` : d.source) : codeStr;
                return (
                  <button
                    key={`${d.startLineNumber}:${d.startColumn}:${codeStr ?? ""}:${idx}`}
                    type="button"
                    onClick={() => onSelectDiagnostic(d)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: "5px 8px",
                      borderRadius: 6,
                      border: "none",
                      background: "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                      color: textPrimary,
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "rgba(255, 255, 255, 0.06)"
                        : "rgba(15, 23, 42, 0.04)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        marginTop: 2,
                        color: isErr
                          ? isDark
                            ? "#f85149"
                            : "#dc2626"
                          : isWarn
                            ? isDark
                              ? "#e3b341"
                              : "#d97706"
                            : isDark
                              ? "#38bdf8"
                              : "#0284c7",
                      }}
                    >
                      {isErr ? (
                        <XCircleFillIcon size={13} />
                      ) : isWarn ? (
                        <AlertIcon size={13} />
                      ) : (
                        <InfoIcon size={13} />
                      )}
                    </span>

                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        wordBreak: "break-word",
                      }}
                    >
                      {d.message}
                    </span>

                    {sourceLabel && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                          color: textMuted,
                        }}
                      >
                        {sourceLabel}
                      </span>
                    )}

                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                        color: textMuted,
                        minWidth: 72,
                        textAlign: "right",
                      }}
                    >
                      Ln {d.startLineNumber}, Col {d.startColumn}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
