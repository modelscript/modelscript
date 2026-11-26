// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Monaco visual overlay for the 4-Column Typed Relational Hypergraph.
 *
 * Highlights tokens by their perturbation generator `group_id` (ε_k) with distinct translucent
 * badges, dims/locks syntax-critical `group_id = 0` tokens subtly, and renders rich hover
 * tooltips displaying `group_id`, `rel_type_id`, `rel_sign`, and ontology/symbol bindings.
 */

import * as monaco from "monaco-editor";
import type { AnsatzRelationalHypergraphRecord } from "./lsp-bridge";

export const REL_TYPE_LABELS: Record<number, string> = {
  0: "NONE (Locked)",
  1: "IDENTITY_SYNC",
  2: "INVERSE_COUPLE",
  3: "ONTOLOGY_ISA",
  4: "FLOW_CONSERVATION",
  5: "UNIT_SCALE",
  6: "GDT_TOLERANCE_CONE",
};

export const GENERATOR_PALETTE = [
  { bg: "rgba(56, 189, 248, 0.18)", border: "rgba(56, 189, 248, 0.65)" }, // sky
  { bg: "rgba(167, 139, 250, 0.18)", border: "rgba(167, 139, 250, 0.65)" }, // violet
  { bg: "rgba(52, 211, 153, 0.18)", border: "rgba(52, 211, 153, 0.65)" }, // emerald
  { bg: "rgba(251, 191, 36, 0.18)", border: "rgba(251, 191, 36, 0.65)" }, // amber
  { bg: "rgba(244, 114, 182, 0.18)", border: "rgba(244, 114, 182, 0.65)" }, // pink
  { bg: "rgba(96, 165, 250, 0.18)", border: "rgba(96, 165, 250, 0.65)" }, // blue
  { bg: "rgba(45, 212, 191, 0.18)", border: "rgba(45, 212, 191, 0.65)" }, // teal
  { bg: "rgba(251, 146, 60, 0.18)", border: "rgba(251, 146, 60, 0.65)" }, // orange
  { bg: "rgba(192, 132, 252, 0.18)", border: "rgba(192, 132, 252, 0.65)" }, // purple
  { bg: "rgba(163, 230, 53, 0.18)", border: "rgba(163, 230, 53, 0.65)" }, // lime
  { bg: "rgba(248, 113, 113, 0.18)", border: "rgba(248, 113, 113, 0.65)" }, // red
  { bg: "rgba(34, 211, 238, 0.18)", border: "rgba(34, 211, 238, 0.65)" }, // cyan
];

const STYLE_ELEMENT_ID = "ms-relational-hypergraph-overlay-styles";

export function ensureHypergraphOverlayStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const rules: string[] = [
    `.ms-rhg-locked { border-bottom: 1px dotted rgba(148, 163, 184, 0.35); }`,
    `.ms-rhg-neg { border-bottom: 2px dashed rgba(248, 113, 113, 0.85) !important; }`,
    `.ms-rhg-gutter-low, .ms-rhg-gutter-med, .ms-rhg-gutter-high { display: flex; align-items: center; justify-content: center; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; font-weight: 700; line-height: 1; margin: 2px 1px; box-sizing: border-box; }`,
    `.ms-rhg-gutter-low { background-color: rgba(34, 211, 238, 0.2); border: 1px solid rgba(34, 211, 238, 0.72); color: #67e8f9; }`,
    `.ms-rhg-gutter-med { background-color: rgba(251, 191, 36, 0.24); border: 1px solid rgba(251, 191, 36, 0.85); color: #fcd34d; }`,
    `.ms-rhg-gutter-high { background-color: rgba(244, 63, 94, 0.28); border: 1px solid rgba(244, 63, 94, 0.95); color: #fda4af; }`,
    `.ms-rhg-gutter-active { box-shadow: 0 0 0 1.5px rgba(56, 189, 248, 0.95), 0 0 6px rgba(56, 189, 248, 0.55); }`,
    `.ms-rhg-line-highlight { background-color: rgba(56, 189, 248, 0.1); border-left: 2px solid rgba(56, 189, 248, 0.85); }`,
  ];

  for (let m = 1; m <= 9; m++) {
    rules.push(`.ms-rhg-m${m}::after { content: "m=${m}"; }`);
  }
  rules.push(`.ms-rhg-m-many::after { content: "m+"; }`);

  for (let i = 0; i < GENERATOR_PALETTE.length; i++) {
    const c = GENERATOR_PALETTE[i]!;
    rules.push(
      `.ms-rhg-g${i} { background-color: ${c.bg}; border-bottom: 2px solid ${c.border}; border-radius: 3px; }`,
    );
  }

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
}

/**
 * Converts a compiled `AnsatzRelationalHypergraphRecord` into Monaco editor delta decorations
 * highlighting each generator group ε_k (and optionally emphasizing a selected `activeGroupId`).
 */
export function buildHypergraphMonacoDecorations(
  record: AnsatzRelationalHypergraphRecord,
  activeGroupId?: number | null,
): monaco.editor.IModelDeltaDecoration[] {
  ensureHypergraphOverlayStyles();
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  for (const span of record.spans) {
    const isLocked = span.groupId === 0;
    if (isLocked && activeGroupId != null && activeGroupId > 0) {
      continue;
    }
    if (!isLocked && activeGroupId != null && activeGroupId > 0 && span.groupId !== activeGroupId) {
      continue;
    }

    const colorIdx = isLocked ? -1 : (span.groupId - 1) % GENERATOR_PALETTE.length;
    const relLabel = REL_TYPE_LABELS[span.relTypeId] ?? `REL_${span.relTypeId}`;
    const signStr = span.relSign > 0 ? "+1.0" : span.relSign < 0 ? "-1.0" : "0.0";

    const hoverLines = [
      `**Zonotope Generator:** ${isLocked ? "`group_id = 0` (Locked)" : `\`ε_${span.groupId}\` (\`group_id = ${span.groupId}\`)`}`,
      `- **Relation:** \`${relLabel}\` · **Sign:** \`${signStr}\``,
      `- **Token ID:** \`${span.tokenId}\` · **Example \`m_init\`:** \`${record.mInit}\``,
    ];
    if (span.symbolName) {
      hoverLines.push(`- **Symbol:** \`${span.symbolName}\`${span.symbolKind ? ` (${span.symbolKind})` : ""}`);
    }
    if (span.ontologyIri) {
      hoverLines.push(`- **Ontology Cone:** \`${span.ontologyIri}\``);
    }

    const classes = isLocked ? "ms-rhg-locked" : `ms-rhg-g${colorIdx}${span.relSign < 0 ? " ms-rhg-neg" : ""}`;

    decorations.push({
      range: new monaco.Range(span.startLine, span.startColumn, span.endLine, span.endColumn),
      options: {
        inlineClassName: classes,
        hoverMessage: { value: hoverLines.join("\n") },
      },
    });
  }

  return decorations;
}

/**
 * Per-token X-Ray diagnostic payload emitted by the Dynamic-m Single-Example X-Ray pass
 * (`POST /api/v1/recipes/xray`), mapping each token span to its zonotope spread `Δ_t`,
 * worst-case logit cross-entropy loss, normalized heat intensity `[0, 1]`, and `Δ_t > τ` trigger flag.
 */
export interface AnsatzXRayTokenHeat {
  index: number;
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  groupId: number;
  spreadDeltaT: number;
  worstCaseLoss: number;
  intensity: number;
  exceedsRetrievalTau: boolean;
}

const XRAY_STYLE_ELEMENT_ID = "ms-xray-heatmap-overlay-styles";

export function ensureXRayHeatmapStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(XRAY_STYLE_ELEMENT_ID)) return;

  const rules: string[] = [
    `.ms-xray-low { background-color: rgba(34, 211, 238, 0.16); border-bottom: 2px solid rgba(34, 211, 238, 0.55); border-radius: 3px; }`,
    `.ms-xray-med { background-color: rgba(251, 191, 36, 0.22); border-bottom: 2px solid rgba(251, 191, 36, 0.8); border-radius: 3px; }`,
    `.ms-xray-high { background-color: rgba(244, 63, 94, 0.26); border-bottom: 2px solid rgba(244, 63, 94, 0.92); border-radius: 3px; }`,
    `.ms-xray-tau-breach { outline: 1px solid rgba(244, 63, 94, 0.95); background-color: rgba(225, 29, 72, 0.28); border-bottom: 2px wavy rgba(244, 63, 94, 1); border-radius: 3px; }`,
  ];

  const style = document.createElement("style");
  style.id = XRAY_STYLE_ELEMENT_ID;
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
}

/**
 * Converts token-level X-Ray heat telemetry (`AnsatzXRayTokenHeat[]`) into Monaco editor
 * delta decorations rendering a cool cyan -> amber -> crimson heatmap with `Δ_t > τ` breach
 * outlines and rich Markdown hover tooltips.
 */
export function buildXRayHeatmapMonacoDecorations(
  tokenHeat: AnsatzXRayTokenHeat[],
): monaco.editor.IModelDeltaDecoration[] {
  if (!tokenHeat || tokenHeat.length === 0) return [];
  ensureXRayHeatmapStyles();

  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  for (const tok of tokenHeat) {
    const startLine = Math.max(1, Math.floor(tok.startLine));
    const startColumn = Math.max(1, Math.floor(tok.startColumn));
    const endLine = Math.max(startLine, Math.floor(tok.endLine));
    const endColumn =
      endLine === startLine
        ? Math.max(startColumn + 1, Math.floor(tok.endColumn))
        : Math.max(1, Math.floor(tok.endColumn));

    const clampedIntensity = Number.isFinite(tok.intensity) ? Math.min(1, Math.max(0, tok.intensity)) : 0;
    const bandClass =
      clampedIntensity >= 0.7 ? "ms-xray-high" : clampedIntensity >= 0.35 ? "ms-xray-med" : "ms-xray-low";
    const inlineClassName = tok.exceedsRetrievalTau ? `${bandClass} ms-xray-tau-breach` : bandClass;

    const escapedText = tok.text.replace(/`/g, "\\`");
    const isLocked = tok.groupId === 0;
    const groupLabel = isLocked ? "`group_id = 0` (Locked)" : `\`ε_${tok.groupId}\` (\`group_id = ${tok.groupId}\`)`;
    const tauStatus = tok.exceedsRetrievalTau
      ? "**FIRED (`Δ_t > τ`)** — Retrieval / escalation triggered"
      : "Within budget (`Δ_t ≤ τ`)";

    const hoverLines = [
      `**X-Ray Token Heatmap:** \`${escapedText}\` _(token #${tok.index})_`,
      `- **Spread \`Δ_t\`:** \`${tok.spreadDeltaT.toFixed(5)}\` · **Heat:** \`${Math.round(clampedIntensity * 100)}%\``,
      `- **Worst-Case Loss:** \`${tok.worstCaseLoss.toFixed(4)}\``,
      `- **Generator Group:** ${groupLabel}`,
      `- **Retrieval Gate (\`Δ_t > τ\`):** ${tauStatus}`,
    ];

    decorations.push({
      range: new monaco.Range(startLine, startColumn, endLine, endColumn),
      options: {
        inlineClassName,
        hoverMessage: { value: hoverLines.join("\n") },
      },
    });
  }

  return decorations;
}

/**
 * Builds per-line Monaco glyph-margin perturbation gutter decorations showing
 * each active line's generator count (`m=k`), uncertainty tier (cyan/amber/crimson
 * driven by max `Δ_t` heat when available), concise hover tooltip, and active
 * generator line highlight.
 */
export function buildPerturbationGutterDecorations(
  record: AnsatzRelationalHypergraphRecord,
  tokenHeat?: AnsatzXRayTokenHeat[],
  activeGroupId?: number | null,
): monaco.editor.IModelDeltaDecoration[] {
  ensureHypergraphOverlayStyles();

  interface LineStats {
    groupIds: Set<number>;
    spanCount: number;
    hasHeat: boolean;
    maxSpreadDeltaT: number;
    maxIntensity: number;
    hasTauBreach: boolean;
  }

  const byLine = new Map<number, LineStats>();

  const getOrCreateLine = (rawLine: number): LineStats => {
    const line = Math.max(1, Math.floor(rawLine));
    let entry = byLine.get(line);
    if (!entry) {
      entry = {
        groupIds: new Set<number>(),
        spanCount: 0,
        hasHeat: false,
        maxSpreadDeltaT: 0,
        maxIntensity: 0,
        hasTauBreach: false,
      };
      byLine.set(line, entry);
    }
    return entry;
  };

  for (const span of record.spans) {
    if (span.groupId <= 0) continue;
    const entry = getOrCreateLine(span.startLine);
    entry.groupIds.add(span.groupId);
    entry.spanCount += 1;
  }

  if (tokenHeat && tokenHeat.length > 0) {
    for (const tok of tokenHeat) {
      const entry = getOrCreateLine(tok.startLine);
      entry.hasHeat = true;
      const spread = Number.isFinite(tok.spreadDeltaT) ? tok.spreadDeltaT : 0;
      const intensity = Number.isFinite(tok.intensity) ? Math.min(1, Math.max(0, tok.intensity)) : 0;
      if (spread > entry.maxSpreadDeltaT) entry.maxSpreadDeltaT = spread;
      if (intensity > entry.maxIntensity) entry.maxIntensity = intensity;
      if (tok.exceedsRetrievalTau) entry.hasTauBreach = true;
      if (tok.groupId > 0) {
        entry.groupIds.add(tok.groupId);
      }
    }
  }

  const sortedLines = Array.from(byLine.keys()).sort((a, b) => a - b);
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  for (const line of sortedLines) {
    const stats = byLine.get(line)!;
    const genCount = stats.groupIds.size;
    if (genCount === 0 && !stats.hasHeat) continue;

    let tier: "low" | "med" | "high";
    if (stats.hasHeat) {
      tier = stats.hasTauBreach || stats.maxIntensity >= 0.7 ? "high" : stats.maxIntensity >= 0.35 ? "med" : "low";
    } else {
      tier = genCount >= 4 ? "high" : genCount >= 2 ? "med" : "low";
    }

    const isActiveLine = activeGroupId != null && activeGroupId > 0 && stats.groupIds.has(activeGroupId);

    const countClass = genCount <= 0 ? "" : genCount <= 9 ? ` ms-rhg-m${genCount}` : " ms-rhg-m-many";
    const activeClass = isActiveLine ? " ms-rhg-gutter-active" : "";
    const glyphMarginClassName = `ms-rhg-gutter-${tier}${countClass}${activeClass}`;

    const sortedGroups = Array.from(stats.groupIds).sort((a, b) => a - b);
    const groupText = sortedGroups.length > 0 ? sortedGroups.map((gid) => `\`ε_${gid}\``).join(", ") : "none";

    const hoverLines = [`**Line ${line} Perturbation Gutter** · \`m=${genCount}\``, `- **Generators:** ${groupText}`];
    if (stats.hasHeat) {
      hoverLines.push(
        `- **Max \`Δ_t\`:** \`${stats.maxSpreadDeltaT.toFixed(4)}\` · **Heat:** \`${Math.round(stats.maxIntensity * 100)}%\`${stats.hasTauBreach ? " · **τ breach**" : ""}`,
      );
    } else {
      hoverLines.push(
        `- **Uncertainty Level:** \`${tier}\` (${stats.spanCount} active span${stats.spanCount === 1 ? "" : "s"})`,
      );
    }

    const options: monaco.editor.IModelDecorationOptions = {
      isWholeLine: true,
      glyphMarginClassName,
      glyphMarginHoverMessage: { value: hoverLines.join("\n") },
    };
    if (isActiveLine) {
      options.className = "ms-rhg-line-highlight";
    }

    decorations.push({
      range: new monaco.Range(line, 1, line, 1),
      options,
    });
  }

  return decorations;
}
