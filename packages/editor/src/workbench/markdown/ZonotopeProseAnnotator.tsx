// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct-manipulation Text/Prose Zonotope Labeling Surface.
 *
 * Highlights active perturbation generator symbols (`ε_k`), auto-locks
 * safety-critical phrases (`group_id = 0`), supports click and text-selection
 * locking / positive-or-negative phrase coupling, and exposes a per-sentence
 * `~ε` Paraphrase Neighborhood Peek popover inside the `ε_text` ball.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge.js";
import { computeParaphraseNeighborhood, type ParaphraseVariant } from "../util/zonotope-feasibility.js";
import { segmentProseForZonotope, splitIntoSentences, type ProseTokenSegment } from "../util/zonotope-prose-helpers.js";
import {
  getGeneratorColor,
  REL_TYPE_SHORT_LABELS,
  type ZonotopeBrushMode,
  type ZonotopePendingOverride,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state.js";

export interface ZonotopeProseAnnotatorProps {
  content: string;
  colorMode?: "light" | "dark" | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  workbenchState: ZonotopeWorkbenchState;
  onAddOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onSelectGroup?: ((groupId: number | null) => void) | undefined;
}

interface ProseVisualBlock {
  id: string;
  kind: "heading" | "list" | "paragraph";
  headingLevel?: number | undefined;
  sentences: string[];
}

interface CouplingAnchor {
  text: string;
  symbolName?: string | undefined;
  groupId?: number | undefined;
}

function makeOverrideId(prefix: string, snippet: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < snippet.length; i++) {
    hash ^= snippet.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}_${Date.now().toString(36)}`;
}

function parseProseBlocks(markdown: string): ProseVisualBlock[] {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ProseVisualBlock[] = [];
  let paragraphLines: string[] = [];
  let inCodeFence = false;

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const raw = paragraphLines.join("\n");
    paragraphLines = [];
    const sentences = splitIntoSentences(raw);
    if (sentences.length > 0) {
      blocks.push({
        id: `p_${blocks.length}`,
        kind: "paragraph",
        sentences,
      });
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```|^~~~/.test(trimmed)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed) || /^\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const sentences = splitIntoSentences(trimmed);
      if (sentences.length > 0) {
        blocks.push({
          id: `h_${blocks.length}`,
          kind: "heading",
          headingLevel: headingMatch[1]!.length,
          sentences,
        });
      }
      continue;
    }

    if (/^(?:[-*+]|\d+[.)])\s+/.test(trimmed)) {
      flushParagraph();
      const sentences = splitIntoSentences(trimmed);
      if (sentences.length > 0) {
        blocks.push({
          id: `li_${blocks.length}`,
          kind: "list",
          sentences,
        });
      }
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

function computeNextGroupId(
  record: AnsatzRelationalHypergraphRecord | null | undefined,
  overrides: ZonotopePendingOverride[],
): number {
  let maxId = 0;
  if (record) {
    for (const span of record.spans) {
      if (span.groupId > maxId) maxId = span.groupId;
    }
  }
  for (const ov of overrides) {
    if (ov.groupId > maxId) maxId = ov.groupId;
  }
  return maxId + 1;
}

const BRUSH_DESCRIPTIONS: Record<ZonotopeBrushMode, string> = {
  select: "Click any chip to inspect & isolate its generator ε_k",
  "lock-zero": "Click a chip or drag-select any phrase to lock (group_id = 0)",
  "couple-pos": "Click or select phrase A, then phrase B to bind (+1 SYNC)",
  "couple-neg": "Click or select phrase A, then phrase B to bind (-1 INV)",
  "tolerance-handle": "Click chips to inspect tolerance-coupled parameters",
};

const VARIANT_KIND_TAG: Record<ParaphraseVariant["kind"], string> = {
  unit_equiv: "SI Unit",
  bound_reformulation: "Bound",
  synonym: "Synonym",
};

export function ZonotopeProseAnnotator({
  content,
  colorMode = "dark",
  hypergraphRecord,
  workbenchState,
  onAddOverride,
  onSelectGroup,
}: ZonotopeProseAnnotatorProps) {
  const isDark = colorMode !== "light";
  const [couplingAnchor, setCouplingAnchor] = useState<CouplingAnchor | null>(null);
  const [openPeekKey, setOpenPeekKey] = useState<string | null>(null);

  const activeBrush = workbenchState.activeBrush;
  const activeGroupId = workbenchState.activeGroupId;
  const textRadius = workbenchState.budgets.textParaphraseRadius;

  // Clear pending coupling anchor if user switches away from coupling brushes
  useEffect(() => {
    if (activeBrush !== "couple-pos" && activeBrush !== "couple-neg") {
      setCouplingAnchor(null);
    }
  }, [activeBrush]);

  const blocks = useMemo(() => parseProseBlocks(content), [content]);

  const textOverrideCount = useMemo(
    () => workbenchState.pendingOverrides.filter((o) => o.modality === "text").length,
    [workbenchState.pendingOverrides],
  );

  const emitLockOverride = useCallback(
    (snippet: string, symbolName?: string | undefined) => {
      const cleaned = snippet.trim();
      if (!cleaned || !onAddOverride) return;
      const override: ZonotopePendingOverride = {
        id: makeOverrideId("txt_lock", cleaned),
        textSnippet: cleaned,
        groupId: 0,
        relTypeId: 0,
        relSign: 0,
        modality: "text",
        note: "Locked in prose annotator (group_id = 0)",
      };
      if (symbolName) {
        override.symbolName = symbolName;
      }
      onAddOverride(override);
    },
    [onAddOverride],
  );

  const handleCouplePhrase = useCallback(
    (phraseText: string, phraseSymbolName?: string | undefined, phraseGroupId?: number | undefined) => {
      const cleaned = phraseText.trim();
      if (!cleaned) return;

      if (!couplingAnchor) {
        setCouplingAnchor({
          text: cleaned,
          symbolName: phraseSymbolName,
          groupId: phraseGroupId,
        });
        return;
      }

      if (couplingAnchor.text === cleaned) {
        setCouplingAnchor(null);
        return;
      }

      const isNeg = activeBrush === "couple-neg";
      const relTypeId = isNeg ? 2 : 1;
      const relSign = isNeg ? -1 : 1;
      const sharedGroupId =
        couplingAnchor.groupId !== undefined && couplingAnchor.groupId > 0
          ? couplingAnchor.groupId
          : phraseGroupId !== undefined && phraseGroupId > 0
            ? phraseGroupId
            : computeNextGroupId(hypergraphRecord, workbenchState.pendingOverrides);

      if (onAddOverride) {
        const overrideA: ZonotopePendingOverride = {
          id: makeOverrideId("txt_cpl_a", `${couplingAnchor.text}:${sharedGroupId}`),
          textSnippet: couplingAnchor.text,
          groupId: sharedGroupId,
          relTypeId,
          relSign,
          modality: "text",
          note: `Coupled (${isNeg ? "-1 INV" : "+1 SYNC"}) with "${cleaned}"`,
        };
        if (couplingAnchor.symbolName) {
          overrideA.symbolName = couplingAnchor.symbolName;
        }

        const overrideB: ZonotopePendingOverride = {
          id: makeOverrideId("txt_cpl_b", `${cleaned}:${sharedGroupId}`),
          textSnippet: cleaned,
          groupId: sharedGroupId,
          relTypeId,
          relSign,
          modality: "text",
          note: `Coupled (${isNeg ? "-1 INV" : "+1 SYNC"}) with "${couplingAnchor.text}"`,
        };
        if (phraseSymbolName) {
          overrideB.symbolName = phraseSymbolName;
        }

        onAddOverride(overrideA);
        onAddOverride(overrideB);
      }

      onSelectGroup?.(sharedGroupId);
      setCouplingAnchor(null);
    },
    [activeBrush, couplingAnchor, hypergraphRecord, onAddOverride, onSelectGroup, workbenchState.pendingOverrides],
  );

  const handleSegmentClick = useCallback(
    (seg: ProseTokenSegment) => {
      if (activeBrush === "select" || activeBrush === "tolerance-handle") {
        const gid = seg.groupId ?? null;
        if (gid === null) return;
        onSelectGroup?.(activeGroupId === gid ? null : gid);
        return;
      }

      if (activeBrush === "lock-zero") {
        emitLockOverride(seg.text, seg.symbolName);
        return;
      }

      if (activeBrush === "couple-pos" || activeBrush === "couple-neg") {
        handleCouplePhrase(seg.text, seg.symbolName, seg.groupId);
      }
    },
    [activeBrush, activeGroupId, emitLockOverride, handleCouplePhrase, onSelectGroup],
  );

  const handleSurfaceMouseUp = useCallback(() => {
    if (activeBrush !== "lock-zero" && activeBrush !== "couple-pos" && activeBrush !== "couple-neg") {
      return;
    }
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const selectedText = sel.toString().replace(/\s+/g, " ").trim();
    if (selectedText.length < 2 || selectedText.length > 160) return;

    if (activeBrush === "lock-zero") {
      emitLockOverride(selectedText);
      sel.removeAllRanges();
    } else {
      handleCouplePhrase(selectedText);
      sel.removeAllRanges();
    }
  }, [activeBrush, emitLockOverride, handleCouplePhrase]);

  const surfaceBg = isDark ? "rgba(15, 23, 42, 0.72)" : "#ffffff";
  const surfaceBorder = isDark ? "rgba(148, 163, 184, 0.22)" : "rgba(15, 23, 42, 0.14)";
  const textPrimary = isDark ? "#e2e8f0" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#475569";
  const popoverBg = isDark ? "rgba(15, 23, 42, 0.96)" : "#f8fafc";
  const popoverBorder = isDark ? "rgba(56, 189, 248, 0.42)" : "rgba(2, 132, 199, 0.35)";

  return (
    <div
      className="ms-zonotope-prose-annotator"
      onMouseUp={handleSurfaceMouseUp}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 10,
        background: surfaceBg,
        border: `1px solid ${surfaceBorder}`,
        color: textPrimary,
        fontSize: 14,
        lineHeight: 1.75,
        cursor:
          activeBrush === "lock-zero" || activeBrush === "couple-pos" || activeBrush === "couple-neg"
            ? "crosshair"
            : "default",
      }}
    >
      {/* Compact brush & ε_text status bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingBottom: 8,
          borderBottom: `1px solid ${surfaceBorder}`,
          fontSize: 12,
          color: textMuted,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 600,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              background: isDark ? "rgba(56, 189, 248, 0.16)" : "rgba(2, 132, 199, 0.12)",
              color: isDark ? "#7dd3fc" : "#0369a1",
              border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.38)" : "rgba(2, 132, 199, 0.28)"}`,
            }}
          >
            brush: {activeBrush}
          </span>
          <span>{BRUSH_DESCRIPTIONS[activeBrush]}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <span>ε_text = {textRadius.toFixed(2)}</span>
          {textOverrideCount > 0 && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 999,
                background: isDark ? "rgba(52, 211, 153, 0.16)" : "rgba(5, 150, 105, 0.12)",
                color: isDark ? "#6ee7b7" : "#047857",
              }}
            >
              {textOverrideCount} override{textOverrideCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Interactive phrase-coupling banner */}
      {couplingAnchor && (activeBrush === "couple-pos" || activeBrush === "couple-neg") && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "7px 10px",
            borderRadius: 8,
            fontSize: 12,
            background:
              activeBrush === "couple-neg"
                ? isDark
                  ? "rgba(248, 113, 113, 0.14)"
                  : "rgba(220, 38, 38, 0.08)"
                : isDark
                  ? "rgba(52, 211, 153, 0.14)"
                  : "rgba(5, 150, 105, 0.08)",
            border: `1px solid ${
              activeBrush === "couple-neg" ? "rgba(248, 113, 113, 0.45)" : "rgba(52, 211, 153, 0.45)"
            }`,
            color: textPrimary,
          }}
        >
          <span>
            Coupling from{" "}
            <strong
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                padding: "1px 5px",
                borderRadius: 4,
                background: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.07)",
              }}
            >
              {couplingAnchor.text}
            </strong>{" "}
            → click or select target phrase to bind ({activeBrush === "couple-neg" ? "-1 INV" : "+1 SYNC"})…
          </span>
          <button
            type="button"
            onClick={() => setCouplingAnchor(null)}
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              border: `1px solid ${surfaceBorder}`,
              background: "transparent",
              color: textMuted,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Segmented prose blocks */}
      {blocks.length === 0 ? (
        <div style={{ color: textMuted, fontStyle: "italic", fontSize: 13 }}>
          No prose content available for zonotope annotation.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {blocks.map((block) => {
            const isHeading = block.kind === "heading";
            const isList = block.kind === "list";
            const fontSize = isHeading ? (block.headingLevel === 1 ? 20 : block.headingLevel === 2 ? 17 : 15) : 14;

            return (
              <div
                key={block.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingLeft: isList ? 14 : 0,
                  fontWeight: isHeading ? 700 : 400,
                  fontSize,
                }}
              >
                <div>
                  {isList && <span style={{ color: textMuted, marginRight: 6, userSelect: "none" }}>•</span>}
                  {block.sentences.map((sentence, sIdx) => {
                    const sentenceKey = `${block.id}_s_${sIdx}`;
                    const segments = segmentProseForZonotope(
                      sentence,
                      hypergraphRecord ?? null,
                      workbenchState.pendingOverrides,
                    );
                    const isPeekOpen = openPeekKey === sentenceKey;
                    const peekVariants = isPeekOpen ? computeParaphraseNeighborhood(sentence, textRadius) : [];

                    return (
                      <React.Fragment key={sentenceKey}>
                        <span style={{ marginRight: 4 }}>
                          {segments.map((seg, segIdx) => {
                            if (seg.kind === "plain") {
                              return <React.Fragment key={segIdx}>{seg.text}</React.Fragment>;
                            }

                            const gid = seg.groupId ?? 0;
                            const swatch = getGeneratorColor(gid);
                            const isSelected = activeGroupId !== null && activeGroupId === gid;
                            const isAnchor = couplingAnchor?.text === seg.text;
                            const isNeg = (seg.relSign ?? 0) < 0;
                            const relName =
                              seg.relTypeId !== undefined
                                ? (REL_TYPE_SHORT_LABELS[seg.relTypeId] ?? `REL_${seg.relTypeId}`)
                                : "LOCK";
                            const tooltipParts = [
                              gid === 0 ? "Locked (group_id = 0)" : `Generator ε_${gid}`,
                              `Relation: ${relName} (sign ${seg.relSign ?? 0})`,
                            ];
                            if (seg.ontologyIri) {
                              tooltipParts.push(`Ontology: ${seg.ontologyIri}`);
                            }

                            return (
                              <button
                                key={segIdx}
                                type="button"
                                title={tooltipParts.join(" · ")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSegmentClick(seg);
                                }}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "1px 6px",
                                  margin: "0 2px",
                                  borderRadius: 5,
                                  background: swatch.bg,
                                  border: `1px solid ${swatch.border}`,
                                  borderBottom: isNeg
                                    ? "2px dashed rgba(248, 113, 113, 0.9)"
                                    : `2px solid ${swatch.border}`,
                                  color: isDark ? swatch.text : "#0f172a",
                                  fontFamily: "inherit",
                                  fontSize: "0.94em",
                                  fontWeight: 600,
                                  lineHeight: 1.35,
                                  cursor: "pointer",
                                  verticalAlign: "baseline",
                                  boxShadow: isSelected
                                    ? `0 0 0 2px ${swatch.solid}`
                                    : isAnchor
                                      ? "0 0 0 2px #34d399"
                                      : "none",
                                  transition: "box-shadow 0.12s ease, transform 0.1s ease",
                                }}
                              >
                                <span>{seg.text}</span>
                                {seg.badge && (
                                  <span
                                    style={{
                                      fontSize: "0.72em",
                                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                      fontWeight: 700,
                                      padding: "0 4px",
                                      borderRadius: 4,
                                      background: isDark ? "rgba(15, 23, 42, 0.55)" : "rgba(255, 255, 255, 0.78)",
                                      color: isDark ? swatch.text : "#1e293b",
                                      border: `1px solid ${swatch.border}`,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {seg.badge}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </span>

                        {/* Paraphrase Neighborhood Peek (~ε) pill */}
                        <button
                          type="button"
                          aria-expanded={isPeekOpen}
                          title={`Peek ε_text = ${textRadius.toFixed(2)} paraphrase neighborhood`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenPeekKey(isPeekOpen ? null : sentenceKey);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "0 5px",
                            marginRight: 8,
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            background: isPeekOpen
                              ? isDark
                                ? "rgba(56, 189, 248, 0.28)"
                                : "rgba(2, 132, 199, 0.2)"
                              : isDark
                                ? "rgba(148, 163, 184, 0.14)"
                                : "rgba(15, 23, 42, 0.06)",
                            color: isPeekOpen ? (isDark ? "#7dd3fc" : "#0369a1") : textMuted,
                            border: `1px solid ${isPeekOpen ? popoverBorder : surfaceBorder}`,
                            cursor: "pointer",
                            verticalAlign: "middle",
                          }}
                        >
                          ~ε
                        </button>

                        {isPeekOpen && (
                          <div
                            role="dialog"
                            aria-label="Paraphrase neighborhood peek"
                            style={{
                              marginTop: 6,
                              marginBottom: 8,
                              padding: "10px 12px",
                              borderRadius: 8,
                              background: popoverBg,
                              border: `1px solid ${popoverBorder}`,
                              fontSize: 12,
                              fontWeight: 400,
                              lineHeight: 1.55,
                              color: textPrimary,
                              boxShadow: isDark
                                ? "0 8px 24px rgba(2, 6, 23, 0.55)"
                                : "0 8px 20px rgba(15, 23, 42, 0.08)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 6,
                                paddingBottom: 4,
                                borderBottom: `1px solid ${surfaceBorder}`,
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                  color: isDark ? "#7dd3fc" : "#0369a1",
                                }}
                              >
                                Paraphrase Neighborhood (B_ε, ε_text = {textRadius.toFixed(2)})
                              </span>
                              <button
                                type="button"
                                aria-label="Close neighborhood peek"
                                onClick={() => setOpenPeekKey(null)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: textMuted,
                                  cursor: "pointer",
                                  fontSize: 13,
                                  padding: "0 4px",
                                }}
                              >
                                ×
                              </button>
                            </div>

                            {peekVariants.length === 0 ? (
                              <div style={{ color: textMuted, fontStyle: "italic" }}>
                                No deterministic unit, bound, or synonym perturbations triggered within ε_text ={" "}
                                {textRadius.toFixed(2)}.
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {peekVariants.map((variant, vIdx) => (
                                  <div
                                    key={vIdx}
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 2,
                                      padding: "6px 8px",
                                      borderRadius: 6,
                                      background: isDark ? "rgba(30, 41, 59, 0.72)" : "rgba(241, 245, 249, 0.9)",
                                      border: `1px solid ${surfaceBorder}`,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        fontSize: 11,
                                      }}
                                    >
                                      <span style={{ fontWeight: 600, color: textMuted }}>
                                        [{VARIANT_KIND_TAG[variant.kind]}] {variant.label}
                                      </span>
                                      <span
                                        style={{
                                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                          padding: "1px 6px",
                                          borderRadius: 999,
                                          background: isDark ? "rgba(52, 211, 153, 0.16)" : "rgba(5, 150, 105, 0.12)",
                                          color: isDark ? "#6ee7b7" : "#047857",
                                          fontWeight: 700,
                                        }}
                                      >
                                        Δε = {variant.epsilonDistance.toFixed(4)}
                                      </span>
                                    </div>
                                    <div style={{ color: textPrimary }}>{variant.text}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
