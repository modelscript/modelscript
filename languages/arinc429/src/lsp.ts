// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/arinc429`:
 *  - `validateArinc429`
 *  - `getArinc429DocumentSymbols`
 *  - `getArinc429Hover`
 *  - `getArinc429Completions`
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { ARINC429_STANDARD_LABELS, lookupStandardArinc429Label } from "./catalog/arinc429-std-schemas.js";
import { lintArinc429 } from "./lints/index.js";
import { decodeArinc429Word } from "./parser/codec.js";
import { parseArinc429 } from "./parser/schema-parser.js";
import { findLabelDef } from "./solver/index.js";

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
  Field = 8,
  Variable = 13,
  Constant = 14,
  Struct = 23,
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
  kind: number;
  detail: string;
  insertText?: string | undefined;
}

interface Arinc429CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface Arinc429CstLineIndex {
  byRow: Map<number, Arinc429CstLineEntry>;
  lastRow: number;
  lastCol: number;
}

function buildArinc429CstLineIndex(content: string): Arinc429CstLineIndex {
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("arinc429", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  const byRow = new Map<number, Arinc429CstLineEntry>();
  if (rootNode) {
    let maxRow = 0;
    let maxCol = 0;
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const text = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + text.length;
      byRow.set(row, { row, text, startCol, endCol });
      if (row >= maxRow) {
        maxRow = row;
        maxCol = endCol;
      }
    }
    const rootEnd = (rootNode as { endPosition?: { row?: number; column?: number } }).endPosition;
    const lastRow = Math.max(maxRow, rootEnd?.row ?? 0);
    const lastCol = lastRow === maxRow ? maxCol : (rootEnd?.column ?? 0);
    return { byRow, lastRow, lastCol };
  }

  const rawLines = content.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const startCol = Math.max(0, raw.search(/\S/));
    byRow.set(i, { row: i, text: trimmed, startCol, endCol: startCol + trimmed.length });
  }
  const lastRow = Math.max(0, rawLines.length - 1);
  return { byRow, lastRow, lastCol: (rawLines[lastRow] ?? "").length };
}

/**
 * Validates an ARINC 429 bus schema / trace document and returns LSP diagnostics.
 */
export function validateArinc429(content: string, _uri: string = "bus.a429"): LspDiagnostic[] {
  const doc = parseArinc429(content);
  const diags = lintArinc429(doc);
  const cstIndex = buildArinc429CstLineIndex(content);

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
      code: d.code,
      source: "modelscript-arinc429",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for the ARINC 429 bus, labels, and trace frames.
 */
export function getArinc429DocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseArinc429(content);
  const cstIndex = buildArinc429CstLineIndex(content);

  const children: LspDocumentSymbol[] = [];

  for (const label of doc.labels) {
    const lineIdx = Math.max(0, (label.line ?? 1) - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const range: LspRange = {
      start: { line: lineIdx, character: entry?.startCol ?? 0 },
      end: { line: lineIdx, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
    };
    children.push({
      name: `LABEL ${label.labelOctal} ${label.name}`,
      detail: `${label.encoding}${label.units ? ` (${label.units})` : ""}`,
      kind: LspSymbolKind.Field,
      range,
      selectionRange: range,
    });
  }

  for (let i = 0; i < doc.frames.length; i++) {
    const frame = doc.frames[i]!;
    const lineIdx = Math.max(0, (frame.line ?? 1) - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const range: LspRange = {
      start: { line: lineIdx, character: entry?.startCol ?? 0 },
      end: { line: lineIdx, character: Math.max((entry?.startCol ?? 0) + 1, entry?.endCol ?? 1) },
    };
    const decoded = decodeArinc429Word(frame.rawWord);
    children.push({
      name: `FRAME #${i + 1} ${frame.rawHex}`,
      detail: `L${decoded.labelOctal} @ ${frame.timestampSec.toFixed(3)}s`,
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: cstIndex.lastRow, character: Math.max(1, cstIndex.lastCol) },
  };
  const firstEnd = cstIndex.byRow.get(0)?.endCol ?? 1;

  return [
    {
      name: doc.busName,
      detail: `ARINC 429 Bus (${doc.rate})`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.max(1, firstEnd) },
      },
      children,
    },
  ];
}

/**
 * Provides rich Markdown hover info for 32-bit hex words, octal labels, and ARINC 429 keywords.
 */
export function getArinc429Hover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildArinc429CstLineIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;
  const line = " ".repeat(entry.startCol) + entry.text;

  // Extract token under cursor
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_xX.]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_xX.]/.test(line[end] ?? "")) end++;
  const token = line.slice(start, end);
  if (!token) return null;

  const range: LspRange = {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };

  // 1. Hex 32-bit ARINC 429 word
  if (/^0[xX][0-9a-fA-F]{1,8}$/.test(token)) {
    const rawWord = Number.parseInt(token, 16) >>> 0;
    const doc = parseArinc429(content);
    const prelim = decodeArinc429Word(rawWord);
    const labelDef = findLabelDef(doc, prelim.labelOctal, prelim.sdi);
    const d = labelDef ? decodeArinc429Word(rawWord, labelDef) : prelim;
    return {
      range,
      contents: {
        kind: "markdown",
        value: [
          `**ARINC 429 Word \`${d.rawHex}\`**`,
          `- **Label**: \`${d.labelOctal}\` octal (\`${d.labelName}\`, wire byte \`0x${d.wireLabelByte.toString(16).toUpperCase().padStart(2, "0")}\`)`,
          `- **SDI**: \`${d.sdi}\` (\`${d.sdi.toString(2).padStart(2, "0")}\`)`,
          `- **Encoding**: \`${d.encoding}\` — **Value**: \`${d.engineeringValue.toFixed(4)} ${d.units}\``,
          `- **SSM**: \`${d.ssm.toString(2).padStart(2, "0")}\` (\`${d.ssmMeaning}\`)`,
          `- **Parity (Bit 32)**: \`${d.parityBit}\` (${d.parityValid ? "Odd Parity OK" : "**PARITY ERROR**"})`,
        ].join("\n"),
      },
    };
  }

  // 2. Standard octal label
  if (/^[0-7]{3}$/.test(token)) {
    const std = lookupStandardArinc429Label(token);
    if (std) {
      return {
        range,
        contents: {
          kind: "markdown",
          value: [
            `**ARINC 429 Label \`${std.labelOctal}\` — ${std.name}** (${std.equipment})`,
            `${std.description}`,
            `- **Encoding**: \`${std.encoding}\` | **Range**: \`±${std.range} ${std.units}\` | **Resolution**: \`${std.resolution} ${std.units}\` | **Nominal Rate**: \`${std.defaultRateHz} Hz\``,
          ].join("\n"),
        },
      };
    }
  }

  // 3. Keywords
  const kwDocs: Record<string, string> = {
    BUS: "**BUS `<name>`** — Declares an ARINC 429 unidirectional twisted-pair data bus.",
    RATE: "**RATE `HIGH | LOW`** — Sets bus bit rate: `HIGH` = 100 kbps (0.36 ms/word), `LOW` = 12.5 kbps (2.88 ms/word).",
    LABEL:
      "**LABEL `<octal> <name>`** — Declares a 3-digit octal label (`001`–`377`) schema with `ENCODING`, `SDI`, `RANGE`, `RESOLUTION`, `UNITS`, and `RATE`.",
    ENCODING:
      "**ENCODING `BNR | BCD | DISCRETE`** — Selects 19-bit two's-complement Binary, 5-digit Binary-Coded Decimal, or Discrete bitfield decoding.",
    SDI: "**SDI `<0..3>`** — 2-bit Source/Destination Identifier (bits 9–10).",
    FRAME: "**FRAME `<timestamp_s> WORD <0xXXXXXXXX>`** — Timestamped 32-bit ARINC 429 bus trace word.",
    WORD: "**WORD `<0xXXXXXXXX>`** — Raw 32-bit ARINC 429 hexadecimal word.",
  };
  const kw = kwDocs[token.toUpperCase()];
  if (kw) {
    return {
      range,
      contents: { kind: "markdown", value: kw },
    };
  }

  return null;
}

/**
 * Provides keyword and standard equipment label completions for ARINC 429 files.
 */
export function getArinc429Completions(): LspCompletionItem[] {
  const keywords: LspCompletionItem[] = [
    { label: "BUS", kind: 14, detail: "Declare ARINC 429 bus", insertText: "BUS ADC_BUS_1" },
    { label: "RATE HIGH", kind: 14, detail: "100 kbps high-speed ARINC 429 bus" },
    { label: "RATE LOW", kind: 14, detail: "12.5 kbps low-speed ARINC 429 bus" },
    { label: "LABEL", kind: 14, detail: "Declare octal label schema (001-377)" },
    { label: "ENCODING BNR", kind: 14, detail: "19-bit two's-complement Binary encoding" },
    { label: "ENCODING BCD", kind: 14, detail: "5-digit Binary-Coded Decimal encoding" },
    { label: "ENCODING DISCRETE", kind: 14, detail: "19-bit Discrete bitfield encoding" },
    { label: "SDI", kind: 14, detail: "2-bit Source/Destination Identifier (0..3)" },
    { label: "RANGE", kind: 14, detail: "Full-scale engineering range" },
    { label: "RESOLUTION", kind: 14, detail: "Engineering value per LSB" },
    { label: "UNITS", kind: 14, detail: "Engineering units (ft, kt, deg, Mach)" },
    { label: "FRAME", kind: 14, detail: "Timestamped 32-bit word trace entry", insertText: "FRAME 0.000 WORD 0x" },
    { label: "WORD", kind: 14, detail: "Raw 32-bit hex word", insertText: "WORD 0x" },
  ];

  const stdLabels: LspCompletionItem[] = ARINC429_STANDARD_LABELS.map((s) => ({
    label: `LABEL ${s.labelOctal} ${s.name}`,
    kind: 5,
    detail: `${s.equipment} (${s.encoding}, ±${s.range} ${s.units})`,
    insertText: `LABEL ${s.labelOctal} ${s.name} ENCODING ${s.encoding} SDI 0 RANGE ${s.range} RESOLUTION ${s.resolution} UNITS ${s.units} RATE ${s.defaultRateHz}`,
  }));

  return [...keywords, ...stdLabels];
}
