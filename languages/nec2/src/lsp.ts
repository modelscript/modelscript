// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for LLNL NEC-2 wire antenna decks:
 * diagnostics, document symbols, hover documentation, and card completions.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintNec2 } from "./lints/index.js";
import { parseNec2Deck } from "./parser/deck-parser.js";

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

const CARD_DOCS: Record<string, { title: string; syntax: string; description: string }> = {
  CM: {
    title: "CM — Comment Card",
    syntax: "CM <text>",
    description: "Header comment line describing the antenna model. Terminate comment block with `CE`.",
  },
  CE: {
    title: "CE — Comment End Card",
    syntax: "CE [text]",
    description: "Terminates the comment section and begins the structure geometry section.",
  },
  SY: {
    title: "SY — Symbolic Variable Definition (4NEC2)",
    syntax: "SY <name>=<expr> [, <name2>=<expr2> ...]",
    description: "Defines a parametric variable evaluated by subsequent geometry and control cards.",
  },
  GW: {
    title: "GW — Wire Specification",
    syntax: "GW tag segs x1 y1 z1 x2 y2 z2 radius",
    description:
      "Generates a straight thin wire of `segs` equal segments from `(x1,y1,z1)` to `(x2,y2,z2)` with radius `radius` (m).",
  },
  GA: {
    title: "GA — Wire Arc Specification",
    syntax: "GA tag segs arcRadius angle1Deg angle2Deg wireRadius",
    description: "Generates a circular wire arc in the X-Z plane centered at the origin.",
  },
  GH: {
    title: "GH — Helix / Spiral Specification",
    syntax: "GH tag segs spacing length rx1 ry1 rx2 ry2 wireRadius",
    description: "Generates a helical or spiral wire structure along the Z-axis.",
  },
  GM: {
    title: "GM — Coordinate Transformation",
    syntax: "GM tagInc nrpt roX roY roZ dx dy dz startTag",
    description: "Translates, rotates, or replicates previously defined wire geometry.",
  },
  GR: {
    title: "GR — Cylindrical Symmetry",
    syntax: "GR tagInc copies",
    description: "Replicates structure rotationally around the Z-axis into `copies` equal angular sectors.",
  },
  GS: {
    title: "GS — Scale Structure Dimensions",
    syntax: "GS 0 0 factor",
    description: "Scales all structure coordinates and wire radii by `factor`.",
  },
  SP: {
    title: "SP — Surface Patch",
    syntax: "SP 0 ns x1 y1 z1 x2 y2 z2",
    description: "Defines a single conducting surface patch element.",
  },
  SM: {
    title: "SM — Multiple Surface Patch",
    syntax: "SM nx ny x1 y1 z1 x2 y2 z2",
    description: "Generates a rectangular grid of `nx × ny` conducting surface patches.",
  },
  GE: {
    title: "GE — Geometry End",
    syntax: "GE gpflag",
    description:
      "Terminates geometry input. `gpflag = 0`: free space; `1`: ground plane with current expansion; `-1`: ground plane without expansion.",
  },
  FR: {
    title: "FR — Frequency Specification",
    syntax: "FR ifrq nfrq 0 0 fmhz delFreq",
    description: "Specifies operating frequency sweep in MHz (`ifrq = 0`: linear step, `1`: multiplicative).",
  },
  EX: {
    title: "EX — Excitation",
    syntax: "EX type tag segment admit vReal vImag",
    description:
      "Specifies feedpoint excitation (`type = 0`: voltage source, `1`: plane wave, `4`: current source, `5`: current-slope-discontinuity voltage source).",
  },
  LD: {
    title: "LD — Impedance Loading",
    syntax: "LD ldtyp tag segStart segEnd z1 z2 z3",
    description: "Applies lumped or distributed RLC, fixed impedance, or finite wire conductivity loading.",
  },
  GN: {
    title: "GN — Ground Parameters",
    syntax: "GN iperf nradl 0 0 epsr sigma",
    description:
      "Specifies ground plane parameters (`iperf = -1`: free space, `1`: PEC ground, `0`/`2`: finite ground with `epsr`, `sigma`).",
  },
  NT: {
    title: "NT — Two-Port Network",
    syntax: "NT tag1 seg1 tag2 seg2 y11Re y11Im y12Re y12Im y22Re y22Im",
    description: "Connects a linear two-port admittance network between two wire segments.",
  },
  TL: {
    title: "TL — Transmission Line",
    syntax: "TL tag1 seg1 tag2 seg2 z0 length y1Re y1Im y2Re y2Im",
    description: "Connects a transmission line of characteristic impedance `z0` (Ω) between two segments.",
  },
  RP: {
    title: "RP — Radiation Pattern",
    syntax: "RP mode nth nph xn theta0 phi0 dTheta dPhi",
    description: "Triggers MoM solution and computes far-field radiation pattern and gain (dBi).",
  },
  XQ: {
    title: "XQ — Execute",
    syntax: "XQ [option]",
    description: "Executes the MoM matrix fill and solve for the configured frequency and excitation.",
  },
  EN: {
    title: "EN — End of Run",
    syntax: "EN",
    description: "Terminates the NEC-2 input deck.",
  },
};

interface Nec2CstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface Nec2CstIndex {
  byRow: Map<number, Nec2CstLine>;
  lastRow: number;
  lastEndCol: number;
}

function buildNec2CstIndex(content: string): Nec2CstIndex {
  const byRow = new Map<number, Nec2CstLine>();
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("nec2", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      byRow.set(row, { row, text: lineText, colLine, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, colLine: raw, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  return { byRow, lastRow, lastEndCol };
}

/**
 * Validates a NEC-2 wire antenna deck and returns LSP diagnostics.
 */
export function validateNec2(content: string, _uri: string = "antenna.nec"): LspDiagnostic[] {
  const deck = parseNec2Deck(content);
  const diags = lintNec2(deck);
  const cstIndex = buildNec2CstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-nec2",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols from a NEC-2 deck.
 */
export function getNec2DocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseNec2Deck(content);
  const cstIndex = buildNec2CstIndex(content);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };
  const mkLineRange = (l: number): LspRange => {
    const entry = cstIndex.byRow.get(l);
    return {
      start: { line: l, character: entry?.startCol ?? 0 },
      end: { line: l, character: entry?.endCol ?? 0 },
    };
  };

  const children: LspDocumentSymbol[] = [];

  for (const sym of deck.symbolDefs) {
    const l = Math.max(0, sym.line - 1);
    const range = mkLineRange(l);
    children.push({
      name: sym.name,
      detail: `= ${sym.value} (${sym.expression})`,
      kind: LspSymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  for (const w of deck.wires) {
    const l = Math.max(0, w.line - 1);
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1, w.z2 - w.z1);
    const range = mkLineRange(l);
    children.push({
      name: `GW Tag ${w.tag}`,
      detail: `${w.segments} segs, L=${len.toFixed(4)}m, a=${w.radius}m`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  for (const fr of deck.frequencies) {
    const l = Math.max(0, fr.line - 1);
    const range = mkLineRange(l);
    children.push({
      name: `FR ${fr.fmhz} MHz`,
      detail: fr.nfrq > 1 ? `${fr.nfrq} steps (Δ=${fr.delFreq} MHz)` : "single frequency",
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  for (const ex of deck.excitations) {
    const l = Math.max(0, ex.line - 1);
    const range = mkLineRange(l);
    children.push({
      name: `EX Tag ${ex.tag} Seg ${ex.segment}`,
      detail: `V = ${ex.vReal} + j${ex.vImag} V`,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  return [
    {
      name: deck.title,
      detail: `${deck.wires.length} wire(s), ${deck.frequencies.length} FR card(s)`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: mkLineRange(0),
      children,
    },
  ];
}

/**
 * Provides markdown hover documentation for NEC-2 card mnemonics and symbolic variables.
 */
export function getNec2Hover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildNec2CstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const line = entry.colLine;

  // Find word under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end] ?? "")) end++;
  const word = line.slice(start, end);
  if (!word) return null;

  const upper = word.toUpperCase();
  const doc = CARD_DOCS[upper];
  if (doc) {
    return {
      contents: {
        kind: "markdown",
        value: `**${doc.title}**\n\n\`\`\`nec2\n${doc.syntax}\n\`\`\`\n\n${doc.description}`,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  // Check SY symbolic variable
  const deck = parseNec2Deck(content);
  const symVal = deck.symbols.get(word.toLowerCase());
  if (symVal !== undefined) {
    return {
      contents: {
        kind: "markdown",
        value: `**SY Variable** \`${word}\` = \`${symVal}\``,
      },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  return null;
}

/**
 * Returns LSP completion items for standard NEC-2 cards.
 */
export function getNec2Completions(): LspCompletionItem[] {
  return Object.entries(CARD_DOCS).map(([mnemonic, doc]) => ({
    label: mnemonic,
    detail: doc.title,
    documentation: doc.description,
    insertText: doc.syntax,
  }));
}
