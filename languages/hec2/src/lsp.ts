// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintHec2Deck } from "./lints/index.js";
import { parseHec2Deck } from "./parser/hec2-parser.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Struct = 23,
  Event = 24,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}

const CARD_DOCS: Record<string, { detail: string; doc: string; snippet: string }> = {
  T1: { detail: "Title Card 1", doc: "Primary job title line (cols 3-80).", snippet: "T1  " },
  T2: { detail: "Title Card 2", doc: "Secondary job title line (cols 3-80).", snippet: "T2  " },
  T3: { detail: "Title Card 3", doc: "Tertiary job title line (cols 3-80).", snippet: "T3  " },
  J1: {
    detail: "Job Control Card 1",
    doc: "Controls profile direction (IDIR), starting slope (STRT), metric flag (METRIC), discharge (Q), and starting WSEL.",
    snippet: "J1,0,0,0,0,0.001,0,0,1000,105.0",
  },
  J2: {
    detail: "Job Control Card 2",
    doc: "Multi-profile control, plotting, and critical depth options.",
    snippet: "J2,1",
  },
  J3: { detail: "Job Control Card 3", doc: "Variable codes for summary output tables.", snippet: "J3," },
  NC: {
    detail: "Manning's n & Loss Coefficients",
    doc: "Sets left overbank (XNL), right overbank (XNR), channel (XNCH) Manning's n, contraction (CCHV), and expansion (CEHV) coefficients.",
    snippet: "NC,0.04,0.04,0.03,0.1,0.3",
  },
  NH: {
    detail: "Horizontal Manning's n Variation",
    doc: "Specifies horizontally varying Manning's n pairs (NUMNH, N1, STA1, ...).",
    snippet: "NH,3,0.04,20,0.03,80,0.04,100",
  },
  NV: {
    detail: "Vertical Manning's n Variation",
    doc: "Specifies elevation-dependent Manning's n values.",
    snippet: "NV,",
  },
  QT: {
    detail: "Discharge Table Card",
    doc: "Multi-profile discharge table (NUMQ, Q1, Q2, ...).",
    snippet: "QT,2,500,1000",
  },
  X1: {
    detail: "Cross-Section Geometry Header",
    doc: "Defines SECNO, NUMST, STCHL, STCHR, XLOBL, XLOBR, XLCH, PXSECR, PXSECE.",
    snippet: "X1,1000,4,0,100,500,500,500",
  },
  X2: {
    detail: "Cross-Section Options / Bridge",
    doc: "Bridge indicator (IBRIDG), low chord (ELLC), top of road (ELTRD).",
    snippet: "X2,",
  },
  X3: { detail: "Effective Flow / Encroachment", doc: "Ineffective flow limits and levee elevations.", snippet: "X3," },
  X4: { detail: "Additional Ground Points", doc: "Supplemental elevation-station points.", snippet: "X4," },
  X5: { detail: "Cross-Section Comments / Notes", doc: "Cross-section annotation card.", snippet: "X5," },
  GR: {
    detail: "Ground Profile (EL, STA) Pairs",
    doc: "Elevation-station coordinate pairs `(EL(i), STA(i))` for the preceding X1 cross-section.",
    snippet: "GR,110,0,100,0,100,50,110,50",
  },
  SB: {
    detail: "Special Bridge Card",
    doc: "Special bridge method pier, orifice, and weir coefficients.",
    snippet: "SB,",
  },
  BT: { detail: "Bridge Table Card", doc: "Bridge roadway and low-chord station/elevation table.", snippet: "BT," },
  CI: { detail: "Culvert Input Card", doc: "Culvert geometry and entrance loss parameters.", snippet: "CI," },
  EJ: { detail: "End of Job Card", doc: "Terminates the current HEC-2 job data set.", snippet: "EJ" },
  ER: { detail: "End of Run Card", doc: "Terminates the entire HEC-2 execution run.", snippet: "ER" },
};

/**
 * Returns LSP document symbols (titles, job card, cross-sections) for a HEC-2 card deck.
 */
export function getHec2DocumentSymbols(text: string): LspDocumentSymbol[] {
  const deck = parseHec2Deck(text);
  const lines = text.split(/\r?\n/);
  const lineLen = (lineIdx: number): number =>
    Math.max(1, (lines[Math.min(Math.max(0, lineIdx), Math.max(0, lines.length - 1))] ?? "").trimEnd().length);

  const children: LspDocumentSymbol[] = [];

  if (deck.jobCard) {
    const l = Math.max(0, deck.jobCard.line - 1);
    children.push({
      name: "J1 Job Control",
      detail: `Q=${deck.jobCard.q ?? "—"}, WSEL=${deck.jobCard.wsel ?? "—"}, units=${deck.units}`,
      kind: LspSymbolKind.Event,
      range: { start: { line: l, character: 0 }, end: { line: l, character: lineLen(l) } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 2 } },
    });
  }

  for (const xs of deck.crossSections) {
    const l = Math.max(0, xs.line - 1);
    const endL = Math.min(l + Math.max(1, Math.ceil(xs.grPoints.length / 5)), Math.max(l, lines.length - 1));
    children.push({
      name: `XS ${xs.secno}`,
      detail: `${xs.grPoints.length} GR pts, n=${xs.manning.channel}, L=${xs.xlch}`,
      kind: LspSymbolKind.Struct,
      range: { start: { line: l, character: 0 }, end: { line: endL, character: lineLen(endL) } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: lineLen(l) } },
    });
  }

  const rootTitle = deck.titles[0] || "HEC-2 Deck";
  const lastIdx = Math.max(0, lines.length - 1);
  return [
    {
      name: rootTitle,
      detail: `${deck.crossSections.length} cross-sections (${deck.units})`,
      kind: LspSymbolKind.Package,
      range: { start: { line: 0, character: 0 }, end: { line: lastIdx, character: lineLen(lastIdx) } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: lineLen(0) } },
      children,
    },
  ];
}

/**
 * Computes LSP diagnostics for a HEC-2 card deck.
 */
export function getHec2Diagnostics(text: string): LspDiagnostic[] {
  const deck = parseHec2Deck(text);
  const lines = text.split(/\r?\n/);
  const diags = lintHec2Deck(deck);

  return diags.map((d) => {
    const l = Math.min(Math.max(0, d.line - 1), Math.max(0, lines.length - 1));
    const lt = lines[l] ?? "";
    const endChar = Math.max(1, lt.trimEnd().length);
    const sev: 1 | 2 | 3 | 4 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: {
        start: { line: l, character: 0 },
        end: { line: l, character: endChar },
      },
      severity: sev,
      code: d.codeId,
      source: "hec2",
      message: `[${d.codeId}] ${d.message}`,
    };
  });
}

/**
 * Returns hover documentation for the HEC-2 card at `pos`.
 */
export function getHec2Hover(text: string, pos: LspPosition): LspHover | null {
  const lines = text.split(/\r?\n/);
  const lineText = lines[pos.line];
  if (!lineText) return null;

  const code = lineText.slice(0, 2).toUpperCase();
  const info = CARD_DOCS[code];
  if (!info) return null;

  return {
    contents: {
      kind: "markdown",
      value: `**HEC-2 \`${code}\` — ${info.detail}**\n\n${info.doc}`,
    },
    range: {
      start: { line: pos.line, character: 0 },
      end: { line: pos.line, character: Math.min(2, lineText.length) },
    },
  };
}

/**
 * Returns card-code completion items for HEC-2 authoring.
 */
export function getHec2Completions(prefix = ""): LspCompletionItem[] {
  const p = prefix.trim().toUpperCase();
  const items: LspCompletionItem[] = [];
  for (const [code, info] of Object.entries(CARD_DOCS)) {
    if (!p || code.startsWith(p)) {
      items.push({
        label: code,
        detail: info.detail,
        documentation: info.doc,
        insertText: info.snippet,
      });
    }
  }
  return items;
}

export const getDocumentSymbols = getHec2DocumentSymbols;
export const getDiagnostics = getHec2Diagnostics;
export const validateHec2 = getHec2Diagnostics;
