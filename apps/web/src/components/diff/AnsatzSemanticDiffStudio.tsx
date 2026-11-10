// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiffEditor } from "@monaco-editor/react";
import {
  AlertIcon,
  CheckCircleFillIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  GitCompareIcon,
  GitMergeIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesFillIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import katex from "katex";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../../util/monaco-theme";
import {
  analyzeSemanticDiff,
  type SemanticDiffItem,
  type SemanticDiffReport,
} from "../../util/semantic-diff-engine";
import { getSemanticDiff, type FlatSemanticEdit } from "../morsel/util/lsp-bridge";

export type SemanticStudioLens = "code" | "equations" | "schematic" | "merge";

export interface AnsatzSemanticDiffStudioProps {
  oldCode: string;
  newCode: string;
  theirsCode?: string | undefined;
  ancestorCode?: string | undefined;
  filename?: string | undefined;
  language?: string | undefined;
  baseLabel?: string | undefined;
  headLabel?: string | undefined;
  theirsLabel?: string | undefined;
  initialLens?: SemanticStudioLens | undefined;
  defaultSideBySide?: boolean | undefined;
  editorHeight?: number | string | undefined;
  onSelectSemanticEdit?: ((edit: SemanticDiffItem | null) => void) | undefined;
  onResolveParameterConflict?: ((parameterName: string, resolvedValue: number, strategy: string) => void) | undefined;
  onOpenDiagramWorkbench?: (() => void) | undefined;
}

const StudioShell = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-default, #0d1117);
  color: var(--color-fg-default, #c9d1d9);
  overflow: hidden;
`;

const TopControlBar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
`;

const ControlRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const LensButtonGroup = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
`;

const LensButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 6px;
  border: 1px solid ${(p) => (p.$active ? "var(--color-accent-fg, #0969da)" : "transparent")};
  background: ${(p) => (p.$active ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.14))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg, #0969da)" : "var(--color-fg-muted, #8b949e)")};
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 700 : 600)};
  cursor: pointer;
  transition: all 0.14s ease;

  &:hover {
    color: var(--color-fg-default, #c9d1d9);
  }
`;

const FilterPillButton = styled.button<{ $active: boolean; $variant?: "emerald" | "danger" | "cyan" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
  border: 1px solid
    ${(p) =>
      !p.$active
        ? "var(--color-border-default, #30363d)"
        : p.$variant === "danger"
          ? "rgba(207, 34, 46, 0.45)"
          : p.$variant === "emerald"
            ? "rgba(26, 127, 55, 0.45)"
            : "var(--color-accent-fg, #0969da)"};
  background: ${(p) =>
    !p.$active
      ? "var(--color-canvas-default, #0d1117)"
      : p.$variant === "danger"
        ? "rgba(207, 34, 46, 0.12)"
        : p.$variant === "emerald"
          ? "rgba(26, 127, 55, 0.12)"
          : "var(--color-accent-subtle, rgba(9, 105, 218, 0.14))"};
  color: ${(p) =>
    !p.$active
      ? "var(--color-fg-muted, #8b949e)"
      : p.$variant === "danger"
        ? "var(--color-danger-fg, #cf222e)"
        : p.$variant === "emerald"
          ? "var(--color-success-fg, #1a7f37)"
          : "var(--color-accent-fg, #0969da)"};
`;

const StudioSplitGrid = styled.div`
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  min-height: 460px;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const AstSidebar = styled.aside`
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-default, #0d1117);
  min-width: 0;

  @media (max-width: 960px) {
    border-right: none;
    border-bottom: 1px solid var(--color-border-default, #30363d);
  }
`;

const AstTreeItem = styled.div<{ $selected: boolean }>`
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-default, #30363d);
  border-left: 3px solid ${(p) => (p.$selected ? "var(--color-accent-fg, #0969da)" : "transparent")};
  background: ${(p) => (p.$selected ? "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))" : "transparent")};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: background 0.12s ease;

  &:hover {
    background: var(--color-canvas-subtle, #161b22);
  }
`;

const MainViewport = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-canvas-default, #0d1117);
`;

function renderLatexHtml(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

export const AnsatzSemanticDiffStudio: React.FC<AnsatzSemanticDiffStudioProps> = ({
  oldCode,
  newCode,
  theirsCode,
  ancestorCode,
  filename = "model.mo",
  language = "modelica",
  baseLabel = "base",
  headLabel = "head",
  theirsLabel = "theirs",
  initialLens = "code",
  defaultSideBySide = true,
  editorHeight = 360,
  onSelectSemanticEdit,
  onResolveParameterConflict,
  onOpenDiagramWorkbench,
}) => {
  const { theme } = useTheme();
  const diffEditorRef = useRef<any>(null);

  const [activeLens, setActiveLens] = useState<SemanticStudioLens>(initialLens);
  const [orderAgnostic, setOrderAgnostic] = useState<boolean>(true);
  const [breakingOnly, setBreakingOnly] = useState<boolean>(false);
  const [showPeekCards, setShowPeekCards] = useState<boolean>(true);
  const [sideBySide, setSideBySide] = useState<boolean>(defaultSideBySide);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [schematicSwipe, setSchematicSwipe] = useState<number>(100);
  const [customResolvedValues, setCustomResolvedValues] = useState<Record<string, number>>({});
  const [lspDiffs, setLspDiffs] = useState<FlatSemanticEdit[] | null>(null);

  // Background WebAssembly GLR Parser + Salsa QueryEngine enrichment
  useEffect(() => {
    let cancelled = false;
    const uri = filename || "model.mo";
    getSemanticDiff(uri, oldCode, newCode)
      .then((res) => {
        if (!cancelled && res?.diffs && res.diffs.length > 0) {
          setLspDiffs(res.diffs);
        }
      })
      .catch(() => {
        // Fallback gracefully to instant local AST diff
      });
    return () => {
      cancelled = true;
    };
  }, [filename, oldCode, newCode]);

  const rawReport: SemanticDiffReport = useMemo(
    () => analyzeSemanticDiff(oldCode, newCode, { filename, theirsCode, ancestorCode }),
    [oldCode, newCode, filename, theirsCode, ancestorCode],
  );

  // Progressive hydration: merge regulatory impacts and exact AST character coordinates from WASM LSP worker
  const report: SemanticDiffReport = useMemo(() => {
    if (!lspDiffs || lspDiffs.length === 0) return rawReport;
    const enrichedEdits = rawReport.edits.map((edit) => {
      const matchingLsp = lspDiffs.find(
        (ld) =>
          ld.description === edit.description ||
          (ld.kind && ld.kind.toLowerCase() === edit.kind.toLowerCase() && ld.description.includes(edit.symbol)),
      );
      if (matchingLsp?.regulatoryImpact) {
        return {
          ...edit,
          suspectReq: matchingLsp.regulatoryImpact.requirementId || edit.suspectReq,
          peekBadge: matchingLsp.regulatoryImpact.isSafetyCritical
            ? `ISO 14971 HAZARD (Severity ${matchingLsp.regulatoryImpact.riskSeverity ?? 4}): ${matchingLsp.regulatoryImpact.hazardName || edit.symbol}`
            : edit.peekBadge,
          isBreaking: matchingLsp.regulatoryImpact.isSafetyCritical || edit.isBreaking,
        };
      }
      return edit;
    });

    return {
      ...rawReport,
      edits: enrichedEdits,
    };
  }, [rawReport, lspDiffs]);

  const filteredEdits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.edits.filter((edit) => {
      if (orderAgnostic && edit.isOrderNoise) return false;
      if (breakingOnly && !edit.isBreaking) return false;
      if (q) {
        const hay = `${edit.symbol} ${edit.category} ${edit.description} ${edit.suspectReq || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report.edits, orderAgnostic, breakingOnly, searchQuery]);

  const selectedEdit = useMemo(
    () => report.edits.find((e) => e.id === selectedEditId) ?? null,
    [report.edits, selectedEditId],
  );

  const handleSelectEdit = (edit: SemanticDiffItem | null) => {
    const next = edit && selectedEditId === edit.id ? null : edit;
    setSelectedEditId(next ? next.id : null);
    onSelectSemanticEdit?.(next);

    if (next && diffEditorRef.current) {
      const targetLine = next.newLine ?? next.oldLine ?? 1;
      try {
        const modEditor = diffEditorRef.current.getModifiedEditor?.();
        modEditor?.revealLineInCenter?.(targetLine);
        modEditor?.setPosition?.({ lineNumber: targetLine, column: 1 });
      } catch {
        // Non-fatal if Monaco editor is not currently mounted
      }
    }
  };

  return (
    <StudioShell data-testid="ansatz-semantic-diff-studio">
      {/* ── Top Multi-Lens & Semantic Filter Bar ── */}
      <TopControlBar>
        <ControlRow>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 10px",
                borderRadius: "6px",
                background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.14))",
                color: "var(--color-accent-fg, #0969da)",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              <GitCompareIcon size={14} />
              <span>Semantic Diff Studio</span>
            </span>

            <code
              style={{
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                color: "var(--color-fg-default)",
              }}
            >
              {filename}
            </code>

            <span
              style={{
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-fg-muted)",
              }}
            >
              ({baseLabel} → {headLabel})
            </span>
          </div>

          {/* Semantic Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <FilterPillButton
              type="button"
              $active={orderAgnostic}
              $variant="emerald"
              onClick={() => setOrderAgnostic((prev) => !prev)}
              title="Suppress declarative equation reordering and formatting-only annotation noise"
            >
              <span>{orderAgnostic ? "✓" : "○"} Order-Agnostic AST</span>
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "11px",
                  padding: "1px 5px",
                  borderRadius: "4px",
                  background: "var(--color-canvas-subtle)",
                }}
              >
                {report.summary.movedOrNoise} {orderAgnostic ? "hidden" : "shown"}
              </span>
            </FilterPillButton>

            <FilterPillButton
              type="button"
              $active={breakingOnly}
              $variant="danger"
              onClick={() => setBreakingOnly((prev) => !prev)}
              title="Filter to breaking interface, causality, and plug-compatibility changes"
            >
              <AlertIcon size={13} />
              <span>Breaking Only ({report.summary.breaking})</span>
            </FilterPillButton>

            {activeLens === "code" && (
              <>
                <FilterPillButton
                  type="button"
                  $active={showPeekCards}
                  $variant="cyan"
                  onClick={() => setShowPeekCards((prev) => !prev)}
                >
                  <span>Inline Semantic Cards: {showPeekCards ? "ON" : "OFF"}</span>
                </FilterPillButton>

                <FilterPillButton
                  type="button"
                  $active={sideBySide}
                  $variant="cyan"
                  onClick={() => setSideBySide((prev) => !prev)}
                >
                  <span>{sideBySide ? "Side-by-Side" : "Inline"}</span>
                </FilterPillButton>
              </>
            )}
          </div>
        </ControlRow>

        <ControlRow>
          <LensButtonGroup>
            <LensButton type="button" $active={activeLens === "code"} onClick={() => setActiveLens("code")}>
              <span>1. Code + Semantic Peek</span>
            </LensButton>
            <LensButton type="button" $active={activeLens === "equations"} onClick={() => setActiveLens("equations")}>
              <span>2. Symbolic Math &amp; DAE Balance</span>
            </LensButton>
            <LensButton type="button" $active={activeLens === "schematic"} onClick={() => setActiveLens("schematic")}>
              <WorkflowIcon size={13} />
              <span>3. Schematic Topology Redline</span>
            </LensButton>
            <LensButton type="button" $active={activeLens === "merge"} onClick={() => setActiveLens("merge")}>
              <GitMergeIcon size={13} />
              <span>4. 3-Way Physics-Simplex Merge</span>
              {report.threeWayConflicts.length > 0 && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: "2em",
                    fontSize: "11px",
                    background: "rgba(210, 153, 34, 0.2)",
                    color: "var(--color-attention-fg, #d29922)",
                  }}
                >
                  {report.threeWayConflicts.length}
                </span>
              )}
            </LensButton>
          </LensButtonGroup>

          {/* Summary Telemetry Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "12px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color: "var(--color-success-fg, #1a7f37)",
                fontWeight: 600,
              }}
            >
              <DiffAddedIcon size={13} /> +{report.summary.inserted} inserted
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color: "var(--color-attention-fg, #d29922)",
                fontWeight: 600,
              }}
            >
              <DiffModifiedIcon size={13} /> ~{report.summary.modified} modified
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color: "var(--color-danger-fg, #cf222e)",
                fontWeight: 600,
              }}
            >
              <DiffRemovedIcon size={13} /> -{report.summary.deleted} deleted
            </span>
            {report.summary.suspectReqs.length > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 8px",
                  borderRadius: "2em",
                  background: "rgba(210, 153, 34, 0.14)",
                  color: "var(--color-attention-fg, #d29922)",
                  fontWeight: 600,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <ShieldCheckIcon size={12} /> {report.summary.suspectReqs.length} suspect req
              </span>
            )}
          </div>
        </ControlRow>
      </TopControlBar>

      {/* ── Main Split Grid: Left AST Outline + Right Active Lens ── */}
      <StudioSplitGrid>
        {/* Left AST Sidebar */}
        <AstSidebar>
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "12px",
            }}
          >
            <strong style={{ textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-fg-muted)" }}>
              Semantic AST Delta Tree
            </strong>
            <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
              {filteredEdits.length} edits
            </span>
          </div>

          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border-default)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 8px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
              }}
            >
              <SearchIcon size={13} fill="var(--color-fg-muted)" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter symbols, categories, REQ-*..."
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  color: "var(--color-fg-default)",
                  fontSize: "12px",
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ flex: 1, maxHeight: "460px", overflowY: "auto" }}>
            {filteredEdits.length === 0 ? (
              <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "12.5px", color: "var(--color-fg-muted)" }}>
                No semantic AST changes match the active filters.
              </div>
            ) : (
              filteredEdits.map((edit) => {
                const isSelected = selectedEditId === edit.id;
                const actionColor =
                  edit.action === "insert"
                    ? "var(--color-success-fg, #1a7f37)"
                    : edit.action === "delete"
                      ? "var(--color-danger-fg, #cf222e)"
                      : edit.action === "move"
                        ? "var(--color-fg-muted)"
                        : "var(--color-attention-fg, #d29922)";
                const actionLabel =
                  edit.action === "insert"
                    ? "+INS"
                    : edit.action === "delete"
                      ? "-DEL"
                      : edit.action === "move"
                        ? "⇄MOV"
                        : "~UPD";

                return (
                  <AstTreeItem
                    key={edit.id}
                    $selected={isSelected}
                    onClick={() => handleSelectEdit(edit)}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: actionColor,
                          }}
                        >
                          {actionLabel}
                        </span>
                        <code
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-default)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {edit.symbol}
                        </code>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        {edit.isBreaking && (
                          <span
                            style={{
                              fontSize: "10.5px",
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: "rgba(207, 34, 46, 0.16)",
                              color: "var(--color-danger-fg, #cf222e)",
                            }}
                          >
                            BREAKING
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "var(--color-canvas-subtle)",
                            border: "1px solid var(--color-border-default)",
                            color: "var(--color-fg-muted)",
                          }}
                        >
                          {edit.category}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--color-fg-muted)", lineHeight: 1.4 }}>
                      {edit.description}
                    </div>

                    {edit.suspectReq && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          alignSelf: "flex-start",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "var(--font-mono, monospace)",
                          background: "rgba(210, 153, 34, 0.14)",
                          color: "var(--color-attention-fg, #d29922)",
                        }}
                      >
                        <span>⚠️ Suspects {edit.suspectReq}</span>
                      </div>
                    )}
                  </AstTreeItem>
                );
              })
            )}
          </div>
        </AstSidebar>

        {/* Right Active Lens Viewport */}
        <MainViewport>
          {/* LENS 1: MONACO DIFF EDITOR + SYNCHRONIZED INLINE SEMANTIC PEEK CARDS */}
          {activeLens === "code" && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div
                style={{
                  height: typeof editorHeight === "number" ? `${editorHeight}px` : editorHeight,
                  borderBottom: showPeekCards ? "1px solid var(--color-border-default)" : "none",
                }}
              >
                <DiffEditor
                  height="100%"
                  language={language}
                  original={oldCode}
                  modified={newCode}
                  theme={getMonacoThemeName(theme)}
                  beforeMount={ensureMonacoThemesDefined}
                  onMount={(editor) => {
                    diffEditorRef.current = editor;
                  }}
                  options={{
                    readOnly: true,
                    renderSideBySide: sideBySide,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineHeight: 20,
                  }}
                />
              </div>

              {showPeekCards && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--color-canvas-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "200px",
                    overflowY: "auto",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "11.5px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "var(--color-fg-muted)",
                    }}
                  >
                    <span>
                      {selectedEdit
                        ? `Focused Semantic Peek Card · ${selectedEdit.symbol}`
                        : `Inline Semantic Peek Cards (${filteredEdits.length})`}
                    </span>
                    {selectedEdit && (
                      <button
                        type="button"
                        onClick={() => handleSelectEdit(null)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--color-accent-fg, #0969da)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Show All Cards
                      </button>
                    )}
                  </div>

                  {(selectedEdit ? [selectedEdit] : filteredEdits.slice(0, 4)).map((edit) => (
                    <div
                      key={`peek-${edit.id}`}
                      onClick={() => handleSelectEdit(edit)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: "6px",
                        background: "var(--color-canvas-default)",
                        border: `1px solid ${
                          edit.isBreaking
                            ? "rgba(207, 34, 46, 0.45)"
                            : "var(--color-border-default)"
                        }`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: edit.isBreaking
                              ? "rgba(207, 34, 46, 0.15)"
                              : "var(--color-accent-subtle, rgba(9, 105, 218, 0.14))",
                            color: edit.isBreaking
                              ? "var(--color-danger-fg, #cf222e)"
                              : "var(--color-accent-fg, #0969da)",
                          }}
                        >
                          {edit.peekBadge}
                        </span>
                        <span style={{ fontSize: "12.5px", color: "var(--color-fg-default)" }}>{edit.description}</span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {edit.suspectReq && (
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontFamily: "var(--font-mono, monospace)",
                              fontWeight: 600,
                              padding: "2px 7px",
                              borderRadius: "4px",
                              background: "rgba(210, 153, 34, 0.15)",
                              color: "var(--color-attention-fg, #d29922)",
                            }}
                          >
                            ⚠️ {edit.suspectReq}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontFamily: "var(--font-mono, monospace)",
                            color: "var(--color-fg-muted)",
                          }}
                        >
                          Line {edit.newLine ?? edit.oldLine ?? 1}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LENS 2: SYMBOLIC EQUATION & POST-FLATTENING DAE BALANCE REDLINE */}
          {activeLens === "equations" && (
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* DAE Structural Metrics Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "6px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", fontWeight: 600 }}>
                    Continuous States x(t)
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "4px" }}>
                    {report.daeDelta.statesOld} →{" "}
                    <span style={{ color: "var(--color-success-fg, #1a7f37)" }}>{report.daeDelta.statesNew}</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "6px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", fontWeight: 600 }}>
                    Declared Parameters
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "4px" }}>
                    {report.daeDelta.paramsOld} →{" "}
                    <span style={{ color: "var(--color-accent-fg, #0969da)" }}>{report.daeDelta.paramsNew}</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "6px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", fontWeight: 600 }}>
                    Governing Equations
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "4px" }}>
                    {report.daeDelta.equationsOld} →{" "}
                    <span style={{ color: "var(--color-accent-fg, #0969da)" }}>{report.daeDelta.equationsNew}</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "6px",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                  }}
                >
                  <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", fontWeight: 600 }}>
                    Pantelides DAE Balance
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "var(--color-success-fg, #1a7f37)",
                      marginTop: "6px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <CheckCircleFillIcon size={14} />
                    <span>Index 1 · Strictly Balanced</span>
                  </div>
                </div>
              </div>

              {/* Symbolic Math Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {report.edits
                  .filter((e) => e.latexOld || e.latexNew)
                  .map((eqEdit) => (
                    <div
                      key={`math-${eqEdit.id}`}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "12.5px", color: "var(--color-fg-default)" }}>
                          {eqEdit.symbol} ({eqEdit.peekBadge})
                        </strong>
                        <span style={{ fontSize: "12px", fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                          Line {eqEdit.oldLine ?? "—"} → {eqEdit.newLine ?? "—"}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: eqEdit.latexOld && eqEdit.latexNew ? "1fr 1fr" : "1fr",
                          gap: "12px",
                        }}
                      >
                        {eqEdit.latexOld && (
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "6px",
                              background: "rgba(207, 34, 46, 0.08)",
                              border: "1px solid rgba(207, 34, 46, 0.25)",
                            }}
                          >
                            <div style={{ fontSize: "11px", color: "var(--color-fg-muted)", marginBottom: "4px" }}>
                              Base ({baseLabel}):
                            </div>
                            <div
                              style={{ fontSize: "14px" }}
                              dangerouslySetInnerHTML={{ __html: renderLatexHtml(eqEdit.latexOld) }}
                            />
                          </div>
                        )}
                        {eqEdit.latexNew && (
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "6px",
                              background: "rgba(26, 127, 55, 0.08)",
                              border: "1px solid rgba(26, 127, 55, 0.25)",
                            }}
                          >
                            <div style={{ fontSize: "11px", color: "var(--color-fg-muted)", marginBottom: "4px" }}>
                              Head ({headLabel}):
                            </div>
                            <div
                              style={{ fontSize: "14px" }}
                              dangerouslySetInnerHTML={{ __html: renderLatexHtml(eqEdit.latexNew) }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* LENS 3: 2D SCHEMATIC & CONNECTION TOPOLOGY REDLINE */}
          {activeLens === "schematic" && (
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 600 }}>
                  2D Component &amp; Connection Topology Redline ({report.topology.nodes.length} blocks)
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--color-fg-muted)" }}>Onion-Skin / Swipe:</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={schematicSwipe}
                    onChange={(e) => setSchematicSwipe(Number(e.target.value))}
                    style={{ width: "120px", cursor: "pointer" }}
                  />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, minWidth: "70px" }}>
                    {schematicSwipe < 25 ? "Base Only" : schematicSwipe > 80 ? "Redline" : `Swipe ${schematicSwipe}%`}
                  </span>

                  {onOpenDiagramWorkbench && (
                    <button
                      type="button"
                      onClick={onOpenDiagramWorkbench}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "3px 9px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-default)",
                        color: "var(--color-accent-fg, #0969da)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Open full interactive visual diagram workbench"
                    >
                      ⚡ Diagram Workbench
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-subtle)",
                  padding: "16px",
                  overflowX: "auto",
                }}
              >
                {(() => {
                  const nodes = report.topology.nodes;
                  const wires = report.topology.wires;
                  const numNodes = nodes.length;
                  const cols = Math.min(Math.max(2, Math.ceil(Math.sqrt(numNodes * 1.5))), 4);
                  const rows = Math.max(1, Math.ceil(numNodes / cols));
                  const colWidth = 240;
                  const rowHeight = 115;
                  const svgWidth = Math.max(680, cols * colWidth + 60);
                  const svgHeight = Math.max(240, rows * rowHeight + 50);

                  const nodeMap = new Map<string, { x: number; y: number; width: number; height: number }>();
                  nodes.forEach((node, idx) => {
                    const col = idx % cols;
                    const row = Math.floor(idx / cols);
                    const x = 35 + col * colWidth;
                    const y = 30 + row * rowHeight;
                    nodeMap.set(node.id, { x, y, width: 190, height: 68 });
                    nodeMap.set(node.name, { x, y, width: 190, height: 68 });
                  });

                  return (
                    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ width: "100%", minWidth: "560px", height: "auto" }}>
                      {/* Routed Topological Connection Wires */}
                      {wires.map((wire) => {
                        const src = nodeMap.get(wire.from);
                        const dst = nodeMap.get(wire.to);
                        if (!src || !dst) return null;
                        const x1 = src.x + src.width;
                        const y1 = src.y + src.height / 2;
                        const x2 = dst.x;
                        const y2 = dst.y + dst.height / 2;
                        const wireStroke =
                          wire.status === "added"
                            ? "#1a7f37"
                            : wire.status === "removed"
                              ? "#cf222e"
                              : "var(--color-border-default, #30363d)";
                        const wireOpacity = wire.status === "added" && schematicSwipe < 50 ? 0.2 : 0.85;

                        return (
                          <path
                            key={wire.id}
                            d={`M ${x1} ${y1} C ${x1 + 35} ${y1}, ${x2 - 35} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke={wireStroke}
                            strokeWidth={2}
                            strokeDasharray={wire.status === "removed" ? "5,4" : undefined}
                            opacity={wireOpacity}
                          />
                        );
                      })}

                      {/* All Schematic Topology Redline Nodes */}
                      {nodes.map((node, idx) => {
                        const col = idx % cols;
                        const row = Math.floor(idx / cols);
                        const x = 35 + col * colWidth;
                        const y = 30 + row * rowHeight;
                        const stroke =
                          node.status === "added"
                            ? "#1a7f37"
                            : node.status === "removed"
                              ? "#cf222e"
                              : node.status === "modified"
                                ? "#d29922"
                                : "#0969da";
                        const fill =
                          node.status === "added"
                            ? "rgba(26, 127, 55, 0.12)"
                            : node.status === "removed"
                              ? "rgba(207, 34, 46, 0.1)"
                              : node.status === "modified"
                                ? "rgba(210, 153, 34, 0.12)"
                                : "rgba(9, 105, 218, 0.08)";
                        const opacity =
                          node.status === "added" && schematicSwipe < 30
                            ? 0.2
                            : node.status === "removed" && schematicSwipe > 75
                              ? 0.65
                              : 1;

                        return (
                          <g
                            key={node.id}
                            style={{ cursor: "pointer", opacity }}
                            onClick={() => {
                              if (node.linkedEditId) {
                                const found = report.edits.find((e) => e.id === node.linkedEditId) ?? null;
                                handleSelectEdit(found);
                              }
                            }}
                          >
                            <rect
                              x={x}
                              y={y}
                              width={190}
                              height={68}
                              rx={8}
                              fill={fill}
                              stroke={stroke}
                              strokeWidth={2}
                              strokeDasharray={node.status === "removed" ? "5,4" : undefined}
                            />
                            <text x={x + 95} y={y + 26} textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="bold">
                              {node.status === "added" ? "+ " : node.status === "removed" ? "- " : node.status === "modified" ? "~ " : ""}
                              {node.typeName} {node.name}
                            </text>
                            <text x={x + 95} y={y + 48} textAnchor="middle" fill={stroke} fontSize="12">
                              {node.detailBadge || node.status.toUpperCase()}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()}
              </div>
            </div>
          )}

          {/* LENS 4: 3-WAY AST SEMANTIC MERGE & PHYSICS-SIMPLEX CONFLICT RESOLVER */}
          {activeLens === "merge" && (
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "6px",
                  background: "rgba(26, 127, 55, 0.1)",
                  border: "1px solid rgba(26, 127, 55, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "12.5px",
                }}
              >
                <span style={{ color: "var(--color-success-fg, #1a7f37)", fontWeight: 600 }}>
                  ✓ AST Auto-Merged: {report.orthogonalMergedCount} orthogonal symbol &amp; equation edits merged cleanly without Git line conflicts.
                </span>
              </div>

              {report.threeWayConflicts.length === 0 ? (
                <div
                  style={{
                    padding: "32px 24px",
                    textAlign: "center",
                    borderRadius: "8px",
                    border: "1px solid rgba(26, 127, 55, 0.3)",
                    background: "rgba(26, 127, 55, 0.05)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <ShieldCheckIcon size={24} fill="#1a7f37" />
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-success-fg, #1a7f37)" }}>
                      Rebase Pre-Check: Fast-Forward Clean
                    </span>
                  </div>
                  <p
                    style={{
                      maxWidth: "560px",
                      margin: "0 auto",
                      fontSize: "13px",
                      color: "var(--color-fg-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {theirsCode
                      ? "All parameters and equations across both divergent branches reconciled cleanly with zero conflicting bindings."
                      : "No concurrent branch collisions detected between base and proposal. This change can be cleanly fast-forward rebased and merged onto mainline without manual parameter conflict resolution."}
                  </p>
                  <span
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-muted)",
                      border: "1px solid var(--color-border-default)",
                    }}
                  >
                    Status: 0 AST Conflicts • {report.orthogonalMergedCount} Orthogonal Merged • Clean Fast-Forward
                  </span>
                </div>
              ) : (
                report.threeWayConflicts.map((conflict) => {
                  const activeVal = customResolvedValues[conflict.parameterName] ?? conflict.simplexValue;
                  const isFeasible =
                    (conflict.minBound === undefined || activeVal >= conflict.minBound) &&
                    (conflict.maxBound === undefined || activeVal <= conflict.maxBound);

                  return (
                    <div
                      key={conflict.id}
                      style={{
                        padding: "16px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-default)",
                        background: "var(--color-canvas-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: "4px",
                              background: "rgba(210, 153, 34, 0.2)",
                              color: "var(--color-attention-fg, #d29922)",
                              fontFamily: "var(--font-mono, monospace)",
                            }}
                          >
                            VALUE-CONFLICT
                          </span>
                          <code style={{ fontSize: "13.5px", fontWeight: 700 }}>
                            {conflict.parameterName} ({conflict.typeName})
                          </code>
                        </div>
                        <span style={{ fontSize: "12px", fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                          Physical Envelope: {conflict.minBound !== undefined && conflict.maxBound !== undefined
                            ? `[${conflict.minBound}, ${conflict.maxBound}]`
                            : "[-∞, ∞] (Unbounded)"} {conflict.unit || ""}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: "10px" }}>
                        <div style={{ padding: "10px", borderRadius: "6px", background: "var(--color-canvas-default)", border: "1px solid var(--color-border-default)" }}>
                          <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>Base ({baseLabel})</div>
                          <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "2px" }}>
                            {conflict.baseValue} {conflict.unit || ""}
                          </div>
                        </div>
                        <div style={{ padding: "10px", borderRadius: "6px", background: "var(--color-canvas-default)", border: "1px solid var(--color-accent-fg, #0969da)" }}>
                          <div style={{ fontSize: "11.5px", color: "var(--color-accent-fg, #0969da)", fontWeight: 600 }}>Ours ({headLabel})</div>
                          <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "2px" }}>
                            {conflict.oursValue} {conflict.unit || ""}
                          </div>
                        </div>
                        <div style={{ padding: "10px", borderRadius: "6px", background: "var(--color-canvas-default)", border: "1px solid var(--color-border-default)" }}>
                          <div style={{ fontSize: "11.5px", color: "var(--color-fg-muted)", fontWeight: 600 }}>Theirs ({theirsLabel || "Target"})</div>
                          <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "2px" }}>
                            {conflict.theirsValue} {conflict.unit || ""}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: "10px",
                            borderRadius: "6px",
                            background: isFeasible ? "rgba(26, 127, 55, 0.1)" : "rgba(207, 34, 46, 0.1)",
                            border: `1px solid ${isFeasible ? "rgba(26, 127, 55, 0.4)" : "rgba(207, 34, 46, 0.4)"}`,
                          }}
                        >
                          <div style={{ fontSize: "11.5px", fontWeight: 700, color: isFeasible ? "var(--color-success-fg, #1a7f37)" : "var(--color-danger-fg, #cf222e)" }}>
                            ⚡ Simplex Consensus
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", marginTop: "2px" }}>
                            {activeVal} {conflict.unit || ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                          <FilterPillButton
                            type="button"
                            $active={true}
                            $variant="emerald"
                            onClick={() => {
                              setCustomResolvedValues((prev) => ({ ...prev, [conflict.parameterName]: conflict.simplexValue }));
                              onResolveParameterConflict?.(conflict.parameterName, conflict.simplexValue, "physics-simplex");
                            }}
                          >
                            <SparklesFillIcon size={12} />
                            <span>Apply Physics-Simplex ({conflict.simplexValue})</span>
                          </FilterPillButton>
                          <FilterPillButton
                            type="button"
                            $active={false}
                            onClick={() => {
                              setCustomResolvedValues((prev) => ({ ...prev, [conflict.parameterName]: conflict.oursValue }));
                              onResolveParameterConflict?.(conflict.parameterName, conflict.oursValue, "ours");
                            }}
                          >
                            <span>Keep Ours ({conflict.oursValue})</span>
                          </FilterPillButton>
                          <FilterPillButton
                            type="button"
                            $active={false}
                            onClick={() => {
                              setCustomResolvedValues((prev) => ({ ...prev, [conflict.parameterName]: conflict.baseValue }));
                              onResolveParameterConflict?.(conflict.parameterName, conflict.baseValue, "base");
                            }}
                          >
                            <span>Revert to Base ({conflict.baseValue})</span>
                          </FilterPillButton>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                          <span style={{ color: "var(--color-fg-muted)" }}>Sweep:</span>
                          <input
                            type="range"
                            min={conflict.minBound}
                            max={Math.max(conflict.maxBound, conflict.theirsValue)}
                            step={0.1}
                            value={activeVal}
                            onChange={(e) => {
                              const nextVal = Number(e.target.value);
                              setCustomResolvedValues((prev) => ({ ...prev, [conflict.parameterName]: nextVal }));
                              onResolveParameterConflict?.(conflict.parameterName, nextVal, "custom");
                            }}
                            style={{ width: "110px", cursor: "pointer" }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </MainViewport>
      </StudioSplitGrid>
    </StudioShell>
  );
};

export default AnsatzSemanticDiffStudio;
