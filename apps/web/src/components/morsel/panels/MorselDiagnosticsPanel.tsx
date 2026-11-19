// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  ShieldCheckIcon,
  TriangleDownIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { useMemo, useRef, useState } from "react";
import { MorselResizeHandle } from "./MorselResizeHandle";

export interface ProjectDiagnosticGroup {
  fileName: string;
  uri: string;
  markers: editor.IMarkerData[];
}

export interface MorselDiagnosticsPanelProps {
  diagnostics: editor.IMarkerData[];
  projectDiagnostics?: ProjectDiagnosticGroup[] | undefined;
  activeFileName?: string | undefined;
  colorMode: "dark" | "light";
  isFloatingWorkspace: boolean;
  treeVisible: boolean;
  treeWidth: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  panelHeight: number;
  onResizeHeight: (height: number) => void;
  onSelectDiagnostic: (marker: editor.IMarkerData) => void;
  onSelectProjectDiagnostic?: ((fileName: string, marker: editor.IMarkerData) => void) | undefined;
  onFixWithAi?: ((marker: editor.IMarkerData, fileName?: string) => void) | undefined;
  onRunOnDemandLints?: ((mode: "all" | "formal" | "compiler") => void) | undefined;
  onClearOnDemandLints?: (() => void) | undefined;
  isRunningOnDemandLints?: boolean | undefined;
  hasOnDemandResults?: boolean | undefined;
}

type SeverityFilter = "all" | "error" | "warning";
type ScopeFilter = "file" | "project";

const SEVERITY_ERROR = 8;
const SEVERITY_WARNING = 4;

export const COLLAPSED_DIAGNOSTICS_HEIGHT = 48;

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
  projectDiagnostics,
  activeFileName,
  colorMode,
  isFloatingWorkspace,
  treeVisible,
  treeWidth,
  isExpanded,
  onToggleExpand,
  panelHeight,
  onResizeHeight,
  onSelectDiagnostic,
  onSelectProjectDiagnostic,
  onFixWithAi,
  onRunOnDemandLints,
  onClearOnDemandLints,
  isRunningOnDemandLints = false,
  hasOnDemandResults = false,
}) => {
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("project");
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  const isDark = colorMode === "dark";

  const hasProjectScope = Boolean(projectDiagnostics && projectDiagnostics.length > 0);
  const effectiveScope: ScopeFilter = hasProjectScope ? scope : "file";

  const scopedEntries = useMemo(() => {
    if (effectiveScope === "project" && projectDiagnostics) {
      const entries: Array<{ fileName?: string; marker: editor.IMarkerData }> = [];
      for (const group of projectDiagnostics) {
        for (const marker of group.markers) {
          entries.push({ fileName: group.fileName, marker });
        }
      }
      return entries;
    }
    return diagnostics.map((marker) => ({ fileName: activeFileName, marker }));
  }, [effectiveScope, projectDiagnostics, diagnostics, activeFileName]);

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const { marker: d } of scopedEntries) {
      if (d.severity >= SEVERITY_ERROR) errors++;
      else if (d.severity >= SEVERITY_WARNING) warnings++;
      else infos++;
    }
    return { errors, warnings, infos, total: scopedEntries.length };
  }, [scopedEntries]);

  const filteredDiagnostics = useMemo(() => {
    const sorted = [...scopedEntries].sort((a, b) => {
      if (b.marker.severity !== a.marker.severity) return b.marker.severity - a.marker.severity;
      if ((a.fileName ?? "") !== (b.fileName ?? "")) return (a.fileName ?? "").localeCompare(b.fileName ?? "");
      if (a.marker.startLineNumber !== b.marker.startLineNumber) {
        return a.marker.startLineNumber - b.marker.startLineNumber;
      }
      return a.marker.startColumn - b.marker.startColumn;
    });
    if (filter === "error") return sorted.filter((e) => e.marker.severity >= SEVERITY_ERROR);
    if (filter === "warning") {
      return sorted.filter((e) => e.marker.severity >= SEVERITY_WARNING && e.marker.severity < SEVERITY_ERROR);
    }
    return sorted;
  }, [scopedEntries, filter]);

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

  const headerHeight = COLLAPSED_DIAGNOSTICS_HEIGHT;

  const floatingShadow = isDark
    ? "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 40px -8px rgba(0, 0, 0, 0.56)"
    : "0 1px 0 rgba(255, 255, 255, 0.8) inset, 0 12px 32px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.05)";

  const outerStyle: React.CSSProperties = isFloatingWorkspace
    ? {
        position: "absolute",
        left: treeVisible ? treeWidth + 24 : 12,
        right: 12,
        bottom: 12,
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
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: 12,
    border: isFloatingWorkspace
      ? "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))"
      : "1px solid var(--borderColor-muted, var(--ms-divider))",
    backgroundColor: "var(--ms-surface-glass, rgba(255, 255, 255, 0.86))",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: floatingShadow,
    overflow: "hidden",
    pointerEvents: "auto",
  };

  const textPrimary = "var(--ms-text-1, #f4f4f5)";
  const textMuted = "var(--ms-text-2, #a1a1aa)";
  const borderColor = "var(--ms-divider, rgba(255, 255, 255, 0.08))";

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
            gap: 8,
            padding: "0 12px",
            boxSizing: "border-box",
            cursor: "pointer",
            userSelect: "none",
            borderBottom: isExpanded ? `1px solid ${borderColor}` : "none",
            color: textPrimary,
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {(isExpanded || counts.total > 0) && (
              <span style={{ fontWeight: 600, letterSpacing: "0.01em" }}>Diagnostics</span>
            )}

            {counts.total === 0 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--ms-status-pass-fg, #34d399)",
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
                      backgroundColor: "var(--ms-status-fail-bg, rgba(251, 113, 133, 0.15))",
                      color: "var(--ms-status-fail-fg, #fb7185)",
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
                      backgroundColor: "var(--ms-status-warn-bg, rgba(251, 191, 36, 0.15))",
                      color: "var(--ms-status-warn-fg, #fbbf24)",
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
                      backgroundColor: "var(--ms-status-info-bg, rgba(56, 189, 248, 0.15))",
                      color: "var(--ms-status-info-fg, #38bdf8)",
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
            {isExpanded && hasProjectScope && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  marginRight: 6,
                  paddingRight: 6,
                  borderRight: `1px solid ${borderColor}`,
                }}
              >
                {(["project", "file"] as ScopeFilter[]).map((key) => {
                  const active = effectiveScope === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setScope(key)}
                      style={{
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: active
                          ? isDark
                            ? "rgba(56, 189, 248, 0.16)"
                            : "rgba(8, 145, 178, 0.12)"
                          : "transparent",
                        color: active ? (isDark ? "#38bdf8" : "#0891b2") : textMuted,
                      }}
                    >
                      {key === "project" ? "All Files" : "Current File"}
                    </button>
                  );
                })}
              </div>
            )}
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
            {onRunOnDemandLints && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 7,
                  border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.28)" : "rgba(8, 145, 178, 0.28)"}`,
                  backgroundColor: isDark ? "rgba(56, 189, 248, 0.10)" : "rgba(8, 145, 178, 0.08)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  disabled={isRunningOnDemandLints}
                  title="Run on-demand formal verification (S7xxx / M7xxx) & WASM compiler lints"
                  aria-label="Run on-demand formal verification and compiler lints"
                  onClick={() => onRunOnDemandLints("all")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    border: "none",
                    background: "transparent",
                    color: isDark ? "#38bdf8" : "#0891b2",
                    cursor: isRunningOnDemandLints ? "wait" : "pointer",
                    opacity: isRunningOnDemandLints ? 0.65 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  <ShieldCheckIcon size={12} />
                  <span>{isRunningOnDemandLints ? "Verifying…" : "Verify Formal"}</span>
                </button>
                <ActionMenu>
                  <ActionMenu.Anchor>
                    <button
                      type="button"
                      disabled={isRunningOnDemandLints}
                      aria-label="Choose on-demand lint verification mode"
                      title="Choose on-demand verification mode"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "3px 5px",
                        border: "none",
                        borderLeft: `1px solid ${isDark ? "rgba(56, 189, 248, 0.22)" : "rgba(8, 145, 178, 0.22)"}`,
                        background: "transparent",
                        color: isDark ? "#38bdf8" : "#0891b2",
                        cursor: isRunningOnDemandLints ? "wait" : "pointer",
                      }}
                    >
                      <TriangleDownIcon size={11} />
                    </button>
                  </ActionMenu.Anchor>
                  <ActionMenu.Overlay width="medium">
                    <ActionList>
                      <ActionList.Item onSelect={() => onRunOnDemandLints("all")}>
                        Run All On-Demand Checks (Formal + Compiler)
                      </ActionList.Item>
                      <ActionList.Item onSelect={() => onRunOnDemandLints("formal")}>
                        Run Formal Verification Only (S7xxx / M7xxx)
                      </ActionList.Item>
                      <ActionList.Item onSelect={() => onRunOnDemandLints("compiler")}>
                        Run WASM Compiler Lints Only (Tier-1 CST)
                      </ActionList.Item>
                      {hasOnDemandResults && onClearOnDemandLints && (
                        <>
                          <ActionList.Divider />
                          <ActionList.Item onSelect={onClearOnDemandLints}>Clear On-Demand Results</ActionList.Item>
                        </>
                      )}
                    </ActionList>
                  </ActionMenu.Overlay>
                </ActionMenu>
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
              filteredDiagnostics.map(({ fileName, marker: d }, idx) => {
                const isErr = d.severity >= SEVERITY_ERROR;
                const isWarn = !isErr && d.severity >= SEVERITY_WARNING;
                const codeStr = formatMarkerCode(d.code);
                const sourceLabel = d.source ? (codeStr ? `${d.source}(${codeStr})` : d.source) : codeStr;
                return (
                  <button
                    key={`${fileName ?? ""}:${d.startLineNumber}:${d.startColumn}:${codeStr ?? ""}:${idx}`}
                    type="button"
                    onClick={() => {
                      if (fileName && onSelectProjectDiagnostic) {
                        onSelectProjectDiagnostic(fileName, d);
                      } else {
                        onSelectDiagnostic(d);
                      }
                    }}
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

                    {effectiveScope === "project" && fileName && (
                      <span
                        style={{
                          flexShrink: 0,
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: "var(--ms-font-mono, ui-monospace, monospace)",
                          backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)",
                          color: isDark ? "#e2e8f0" : "#334155",
                        }}
                      >
                        {fileName}
                      </span>
                    )}

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

                    {onFixWithAi && (isErr || isWarn) && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onFixWithAi(d, fileName);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onFixWithAi(d, fileName);
                          }
                        }}
                        style={{
                          flexShrink: 0,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "1px 7px",
                          borderRadius: 4,
                          border: "1px solid var(--borderColor-accent-muted, rgba(56, 139, 253, 0.4))",
                          color: isDark ? "#58a6ff" : "#0969da",
                          cursor: "pointer",
                        }}
                      >
                        Fix with AI
                      </span>
                    )}
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
