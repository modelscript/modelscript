// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Language Server Protocol (LSP) Services.
 */

import { CLEANROOM_ENDF6_NUCLIDES, ENDF6_MT_DESCRIPTORS } from "./catalog/endf6-std-schemas.js";
import { lintEndf6Tape } from "./lints/index.js";
import { parseEndf6Card, parseEndf6Tape } from "./parser/tape-parser.js";

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
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function lineRange(lines: string[], lineOneBased: number, endLineOneBased?: number): LspRange {
  const startLn = Math.max(0, Math.min(lines.length - 1, lineOneBased - 1));
  const endLn =
    endLineOneBased !== undefined ? Math.max(startLn, Math.min(lines.length - 1, endLineOneBased - 1)) : startLn;
  const endText = lines[endLn] ?? "";
  return {
    start: { line: startLn, character: 0 },
    end: { line: endLn, character: Math.max(1, endText.length) },
  };
}

/**
 * Validates an ENDF-6 tape and returns LSP diagnostics (`ENDF1001`–`ENDF5006`).
 */
export function validateEndf6(content: string, _uri: string = "tape.endf"): LspDiagnostic[] {
  try {
    const tape = parseEndf6Tape(content);
    const diags = lintEndf6Tape(tape);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => ({
      range: lineRange(lines, d.line),
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-endf6",
      message: d.message,
    }));
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "ENDF1001",
        source: "modelscript-endf6",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP DocumentSymbols (Materials -> MF/MT Sections) from an ENDF-6 tape.
 */
export function getEndf6DocumentSymbols(content: string): LspDocumentSymbol[] {
  const tape = parseEndf6Tape(content);
  const lines = content.split(/\r?\n/);
  const symbols: LspDocumentSymbol[] = [];

  for (const mat of tape.materials.values()) {
    const children: LspDocumentSymbol[] = [];
    for (const sec of mat.sections) {
      const desc = ENDF6_MT_DESCRIPTORS.get(sec.mt);
      const secRange = lineRange(lines, sec.startLine, sec.endLine);
      children.push({
        name: desc ? `MF=${sec.mf} MT=${sec.mt} (${desc.name})` : `MF=${sec.mf} MT=${sec.mt}`,
        detail: `${sec.cards.length} cards`,
        kind: sec.mf === 3 ? LspSymbolKind.Function : LspSymbolKind.Interface,
        range: secRange,
        selectionRange: lineRange(lines, sec.startLine),
      });
    }

    const matRange = lineRange(lines, mat.startLine, mat.endLine);
    symbols.push({
      name: `${mat.name} (MAT=${mat.mat})`,
      detail: `ZA=${Math.round(mat.za)}, AWR=${mat.awr.toFixed(4)}`,
      kind: LspSymbolKind.Class,
      range: matRange,
      selectionRange: lineRange(lines, mat.startLine),
      children,
    });
  }

  return symbols;
}

/**
 * Provides contextual Markdown hover information for an ENDF-6 card position.
 */
export function getEndf6Hover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const rawLine = lines[position.line];
  if (!rawLine || rawLine.trim().length === 0) return null;

  const card = parseEndf6Card(rawLine, position.line + 1);
  const col = position.character;

  if (card.terminator) {
    const descriptions: Record<string, string> = {
      SEND: "**SEND** — Section End terminator (`MT=0`, `MF>0`).",
      FEND: "**FEND** — File End terminator (`MF=0`, `MT=0`, `MAT>0`).",
      MEND: "**MEND** — Material End terminator (`MAT=0`, `MF=0`, `MT=0`).",
      TEND: "**TEND** — Tape End terminator (`MAT=-1`, `MF=0`, `MT=0`).",
    };
    return {
      contents: { kind: "markdown", value: descriptions[card.terminator] ?? card.terminator },
      range: lineRange(lines, position.line + 1),
    };
  }

  if (col >= 66 && col < 70) {
    return {
      contents: {
        kind: "markdown",
        value: `**MAT = ${card.mat}** — ENDF-6 Material identifier (columns 67–70).`,
      },
      range: { start: { line: position.line, character: 66 }, end: { line: position.line, character: 70 } },
    };
  }

  if (col >= 70 && col < 72) {
    const mfNames: Record<number, string> = {
      1: "General Information (Descriptive Data)",
      2: "Resonance Parameters",
      3: "Reaction Cross-Sections",
      4: "Angular Distributions",
      5: "Energy Distributions",
      8: "Radioactive Decay and Fission Product Yield Data",
    };
    return {
      contents: {
        kind: "markdown",
        value: `**MF = ${card.mf}** — ${mfNames[card.mf] ?? "ENDF-6 File"} (columns 71–72).`,
      },
      range: { start: { line: position.line, character: 70 }, end: { line: position.line, character: 72 } },
    };
  }

  if (col >= 72 && col < 75) {
    const desc = ENDF6_MT_DESCRIPTORS.get(card.mt);
    return {
      contents: {
        kind: "markdown",
        value: desc
          ? `**MT = ${card.mt} (${desc.name})** — ${desc.description}`
          : `**MT = ${card.mt}** — ENDF-6 Reaction/Section identifier (columns 73–75).`,
      },
      range: { start: { line: position.line, character: 72 }, end: { line: position.line, character: 75 } },
    };
  }

  // Hovering over one of the six 11-char data fields
  const fieldIdx = Math.min(5, Math.floor(col / 11));
  const fieldText = card.fields[fieldIdx]?.trim() ?? "";
  const desc = ENDF6_MT_DESCRIPTORS.get(card.mt);
  return {
    contents: {
      kind: "markdown",
      value: `**Field ${fieldIdx + 1}** (cols ${fieldIdx * 11 + 1}–${(fieldIdx + 1) * 11}): \`${fieldText || "(blank)"}\`\n\nCard: \`MAT=${card.mat}\`, \`MF=${card.mf}\`, \`MT=${card.mt}\`${desc ? ` (${desc.name})` : ""}`,
    },
    range: {
      start: { line: position.line, character: fieldIdx * 11 },
      end: { line: position.line, character: (fieldIdx + 1) * 11 },
    },
  };
}

/**
 * Returns ENDF-6 LSP completion items for standard MF/MT sections, terminators, and reference nuclides.
 */
export function getEndf6Completions(_content?: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  for (const desc of ENDF6_MT_DESCRIPTORS.values()) {
    items.push({
      label: `MF=${desc.mf} MT=${desc.mt} (${desc.name})`,
      detail: `ENDF-6 ${desc.symbol}`,
      documentation: desc.description,
    });
  }

  for (const nuc of CLEANROOM_ENDF6_NUCLIDES.values()) {
    items.push({
      label: `${nuc.symbol} (MAT=${nuc.mat})`,
      detail: `ZA=${nuc.za}, AWR=${nuc.awr}`,
      documentation: nuc.provenance,
    });
  }

  items.push(
    { label: "SEND", detail: "Section End terminator (MT=0)", documentation: "Terminates an MF/MT section." },
    { label: "FEND", detail: "File End terminator (MF=0, MT=0)", documentation: "Terminates an MF file." },
    { label: "MEND", detail: "Material End terminator (MAT=0)", documentation: "Terminates a MAT material." },
    { label: "TEND", detail: "Tape End terminator (MAT=-1)", documentation: "Terminates an ENDF-6 tape." },
  );

  return items;
}
