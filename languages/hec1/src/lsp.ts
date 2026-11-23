// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for USACE HEC-1 card decks.
 */

import { lintHec1Deck } from "./lints/index.js";
import { parseHec1Deck } from "./parser/deck-parser.js";

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
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
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
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
}

const HEC1_CARD_DOCS: Record<string, { title: string; syntax: string; doc: string }> = {
  ID: { title: "Job Identification", syntax: "ID  <title text>", doc: "Specifies one or more job title header lines." },
  IT: {
    title: "Time Specification",
    syntax: "IT  NMIN  IDATE  ITIME  NQ  IDDATE  ITDATE",
    doc: "Sets computation time interval NMIN (minutes) and number of hydrograph ordinates NQ.",
  },
  IN: {
    title: "Time Series Interval",
    syntax: "IN  NMIN  IDATE  ITIME",
    doc: "Specifies input precipitation time-series interval.",
  },
  IO: {
    title: "Output Control",
    syntax: "IO  IPRINT  IPLOT",
    doc: "Controls job-level printout and printer-plot verbosity.",
  },
  KK: {
    title: "Station Identification",
    syntax: "KK  ISTAQ  [description]",
    doc: "Begins a new hydrologic station (subbasin, routing reach, or combine).",
  },
  KM: {
    title: "Station Comment",
    syntax: "KM  <comment text>",
    doc: "Attaches a descriptive comment to the current KK station.",
  },
  KO: {
    title: "Station Output Control",
    syntax: "KO  IPRINT  IPLOT",
    doc: "Overrides output verbosity for the current station.",
  },
  BA: {
    title: "Basin Area",
    syntax: "BA  TAREA",
    doc: "Specifies subbasin drainage area (mi^2 English or km^2 Metric).",
  },
  PB: {
    title: "Basin-Average Precipitation",
    syntax: "PB  PMS",
    doc: "Total storm depth over the subbasin (inches or mm).",
  },
  PI: {
    title: "Incremental Precipitation",
    syntax: "PI  p1  p2  ...  p10",
    doc: "Incremental rainfall hyetograph values per time interval.",
  },
  PC: {
    title: "Cumulative Precipitation",
    syntax: "PC  c1  c2  ...  c10",
    doc: "Cumulative rainfall mass-curve values per time interval.",
  },
  LS: {
    title: "SCS Curve Number Loss",
    syntax: "LS  STRTL  CRVNBR  RTIMP",
    doc: "SCS Curve Number loss model: Q = (P - Ia)^2 / (P - Ia + S), 0 < CN <= 100.",
  },
  LU: {
    title: "Uniform Initial/Constant Loss",
    syntax: "LU  STRTL  CNSTL  RTIMP",
    doc: "Initial abstraction STRTL followed by constant loss rate CNSTL.",
  },
  LE: {
    title: "Exponential Loss",
    syntax: "LE  STRKR  DLTKR  RTIQL  ERAIN  RTIMP",
    doc: "HEC-1 exponential rainfall loss rate function.",
  },
  UC: {
    title: "Clark Unit Hydrograph",
    syntax: "UC  TC  R",
    doc: "Clark synthetic unit hydrograph with time of concentration TC (hr) and storage coefficient R (hr).",
  },
  UD: {
    title: "SCS Dimensionless Unit Hydrograph",
    syntax: "UD  TLAG",
    doc: "SCS dimensionless unit hydrograph parameterized by lag time TLAG (hr).",
  },
  US: {
    title: "Snyder Unit Hydrograph",
    syntax: "US  TP  CP",
    doc: "Snyder synthetic unit hydrograph with lag TP (hr) and peaking coefficient CP.",
  },
  BF: {
    title: "Baseflow Recession",
    syntax: "BF  STRTQ  QRCSN  RTIOR",
    doc: "Exponential baseflow recession starting at STRTQ.",
  },
  RM: {
    title: "Muskingum Channel Routing",
    syntax: "RM  NSTPS  AMSKK  X  [TSTRA]",
    doc: "Multi-subreach Muskingum routing with travel time K (hr) and weighting X in [0, 0.5]. Stability requires dt/(2*K_sub) >= X.",
  },
  RS: {
    title: "Storage Routing (Modified Puls)",
    syntax: "RS  NSTPS  ITYP  RSVRIC  X",
    doc: "Storage-indication / Modified Puls reach or reservoir routing.",
  },
  RD: {
    title: "Kinematic Wave / Routing Data",
    syntax: "RD  ...",
    doc: "Channel cross-section or kinematic wave routing parameters.",
  },
  HC: {
    title: "Hydrograph Combine",
    syntax: "HC  ICOMP",
    doc: "Combines ICOMP (>= 2) upstream hydrographs from the HEC-1 stack.",
  },
  ZW: {
    title: "HEC-DSS Write",
    syntax: "ZW  A=... B=... C=... F=...",
    doc: "Writes computed hydrograph to HEC-DSS pathname.",
  },
  ZZ: { title: "End of Job", syntax: "ZZ", doc: "Terminates the HEC-1 card deck." },
};

/**
 * Validates a HEC-1 card deck and returns LSP diagnostics.
 */
export function validateHec1(content: string): LspDiagnostic[] {
  const deck = parseHec1Deck(content);
  const diags = lintHec1Deck(deck);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, Math.min(lines.length - 1, d.line - 1));
    const lineText = lines[lineIdx] ?? "";
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endChar = Math.max(startChar + 1, lineText.trimEnd().length);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-hec1",
      message: d.message,
    };
  });
}

/**
 * Generates LSP document outline symbols for a HEC-1 card deck.
 */
export function getDocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseHec1Deck(content);
  const lines = content.split(/\r?\n/);

  const makeLineRange = (line1Based: number): LspRange => {
    const idx = Math.max(0, Math.min(lines.length - 1, line1Based - 1));
    const text = lines[idx] ?? "";
    return {
      start: { line: idx, character: 0 },
      end: { line: idx, character: Math.max(1, text.trimEnd().length) },
    };
  };

  const stationSymbols: LspDocumentSymbol[] = deck.stationList.map((st) => {
    const r = makeLineRange(st.line);
    let detail: string = st.kind;
    if (st.kind === "subbasin") {
      const cn = st.loss?.method === "SCS" ? `, CN=${st.loss.curveNumber}` : "";
      detail = `Subbasin (Area=${st.area ?? "?"}${cn})`;
    } else if (st.kind === "route" && st.muskingum) {
      detail = `Muskingum (NSTPS=${st.muskingum.nstps}, K=${st.muskingum.amskk} hr, X=${st.muskingum.x})`;
    } else if (st.kind === "combine") {
      detail = `Combine (${st.combineCount ?? 2} hydrographs)`;
    }
    const kind =
      st.kind === "subbasin"
        ? LspSymbolKind.Struct
        : st.kind === "route"
          ? LspSymbolKind.Function
          : LspSymbolKind.Interface;
    return {
      name: st.id,
      detail,
      kind,
      range: r,
      selectionRange: r,
    };
  });

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length },
  };

  return [
    {
      name: deck.titleLines[0] ?? "HEC-1 Deck",
      detail: `${deck.stationList.length} stations`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: makeLineRange(1),
      children: stationSymbols,
    },
  ];
}

/**
 * Provides hover documentation for HEC-1 2-character card codes and station IDs.
 */
export function getHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (!lineText) return null;

  const trimmed = lineText.trimStart();
  const leadSpaces = lineText.length - trimmed.length;
  const code = trimmed.slice(0, 2).toUpperCase();

  if (position.character >= leadSpaces && position.character <= leadSpaces + 2 && HEC1_CARD_DOCS[code]) {
    const info = HEC1_CARD_DOCS[code]!;
    return {
      contents: {
        kind: "markdown",
        value: `**HEC-1 \`${code}\` — ${info.title}**\n\n\`${info.syntax}\`\n\n${info.doc}`,
      },
      range: {
        start: { line: position.line, character: leadSpaces },
        end: { line: position.line, character: leadSpaces + 2 },
      },
    };
  }

  // Hover on a station ID
  const deck = parseHec1Deck(content);
  for (const st of deck.stationList) {
    const idx = lineText.indexOf(st.id);
    if (idx >= 0 && position.character >= idx && position.character <= idx + st.id.length) {
      const parts = [`**Station \`${st.id}\`** (${st.kind})`];
      if (st.description) parts.push(st.description);
      if (st.area !== undefined) parts.push(`Drainage Area: \`${st.area}\``);
      if (st.loss?.method === "SCS") parts.push(`SCS Curve Number: \`${st.loss.curveNumber}\``);
      if (st.muskingum) {
        parts.push(
          `Muskingum Routing: \`NSTPS=${st.muskingum.nstps}, K=${st.muskingum.amskk} hr, X=${st.muskingum.x}\``,
        );
      }
      return {
        contents: {
          kind: "markdown",
          value: parts.join("\n\n"),
        },
        range: {
          start: { line: position.line, character: idx },
          end: { line: position.line, character: idx + st.id.length },
        },
      };
    }
  }

  return null;
}

/**
 * Provides code completion items for all standard USACE HEC-1 card codes.
 */
export function getCompletions(): LspCompletionItem[] {
  return Object.entries(HEC1_CARD_DOCS).map(([code, info]) => ({
    label: code,
    detail: info.title,
    documentation: `${info.syntax}\n${info.doc}`,
    insertText: `${code}  `,
  }));
}
