// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/ihex`:
 * - `validateIhex`
 * - `getIhexDocumentSymbols`
 * - `getIhexHover`
 * - `getIhexCompletions`
 */

import { lintIhex } from "./lints/index.js";
import { hexByte, hexDword, hexWord, parseIhex } from "./parser/index.js";
import { coalesceIhexMemoryMap } from "./solver/index.js";
import { IhexRecordType } from "./types.js";

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
  Struct = 23,
  Constant = 14,
  Variable = 13,
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
  insertText: string;
  documentation?: string | undefined;
}

const RECORD_TYPE_NAMES: Record<number, string> = {
  [IhexRecordType.Data]: "00 — Data Record",
  [IhexRecordType.Eof]: "01 — End Of File (EOF)",
  [IhexRecordType.ExtendedSegmentAddress]: "02 — Extended Segment Address (I16HEX)",
  [IhexRecordType.StartSegmentAddress]: "03 — Start Segment Address (CS:IP)",
  [IhexRecordType.ExtendedLinearAddress]: "04 — Extended Linear Address (I32HEX)",
  [IhexRecordType.StartLinearAddress]: "05 — Start Linear Address (EIP)",
};

/**
 * Validates an Intel HEX document and returns LSP diagnostics.
 */
export function validateIhex(content: string, uri: string = "firmware.hex"): LspDiagnostic[] {
  const model = parseIhex(content, uri);
  const diags = lintIhex(model);

  return diags.map((d) => {
    const line = Math.max(0, d.line - 1);
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, (d.endColumn ?? d.column + 1) - 1);
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;

    return {
      range: {
        start: { line, character: startChar },
        end: { line, character: endChar },
      },
      severity,
      code: d.code,
      source: "ihex",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for coalesced memory segments and entry points.
 */
export function getIhexDocumentSymbols(content: string, uri: string = "firmware.hex"): LspDocumentSymbol[] {
  const model = parseIhex(content, uri);
  const map = coalesceIhexMemoryMap(model);
  const lines = content.split(/\r?\n/);

  const children: LspDocumentSymbol[] = [];

  for (const seg of map.segments) {
    const startLine = Math.max(0, seg.startLine - 1);
    const endLine = Math.max(startLine, seg.endLine - 1);
    const endCol = (lines[endLine] ?? "").length;
    const range: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: endCol },
    };

    children.push({
      name: `Segment #${seg.index} (0x${hexDword(seg.startAddress)}..0x${hexDword(seg.endAddress)})`,
      detail: `${seg.length} B · CRC32 0x${hexDword(seg.crc32)}`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: {
        start: { line: startLine, character: 0 },
        end: { line: startLine, character: (lines[startLine] ?? "").length },
      },
    });
  }

  if (model.startLinearAddress !== undefined) {
    const rec = model.records.find((r) => r.recordType === IhexRecordType.StartLinearAddress);
    const ln = Math.max(0, (rec?.lineNumber ?? 1) - 1);
    const range: LspRange = {
      start: { line: ln, character: 0 },
      end: { line: ln, character: (lines[ln] ?? "").length },
    };
    children.push({
      name: `Start Linear Address (0x${hexDword(model.startLinearAddress)})`,
      detail: "Record 05 (EIP)",
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  if (model.hasEof && model.eofLine !== undefined) {
    const ln = Math.max(0, model.eofLine - 1);
    const range: LspRange = {
      start: { line: ln, character: 0 },
      end: { line: ln, character: (lines[ln] ?? "").length },
    };
    children.push({
      name: "End Of File (EOF)",
      detail: "Record 01",
      kind: LspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  const lastLine = Math.max(0, lines.length - 1);
  return [
    {
      name: `${model.name} (${model.format})`,
      detail: `${map.totalDataBytes} bytes in ${map.segments.length} segment(s)`,
      kind: LspSymbolKind.File,
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: (lines[lastLine] ?? "").length },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: (lines[0] ?? "").length },
      },
      children,
    },
  ];
}

/**
 * Returns rich field-level hover documentation for the Intel HEX record at `position`.
 */
export function getIhexHover(content: string, position: LspPosition): LspHover | null {
  const model = parseIhex(content);
  const lineNum = position.line + 1;
  const rec = model.records.find((r) => r.lineNumber === lineNum);
  if (!rec) return null;

  const ch = position.character;
  const typeLabel = RECORD_TYPE_NAMES[rec.recordType] ?? `0x${hexByte(rec.recordType)} — Unknown Record Type`;

  let fieldNote = "";
  if (ch === 0) {
    fieldNote = "**Field:** Start Code (`:`)";
  } else if (ch >= 1 && ch < 3) {
    fieldNote = `**Field:** Byte Count \`LL = 0x${hexByte(rec.byteCount)}\` (${rec.byteCount} bytes)`;
  } else if (ch >= 3 && ch < 7) {
    fieldNote = `**Field:** 16-bit Address \`AAAA = 0x${hexWord(rec.address)}\` (Linear: \`0x${hexDword(rec.linearAddress)}\`)`;
  } else if (ch >= 7 && ch < 9) {
    fieldNote = `**Field:** Record Type \`TT = ${typeLabel}\``;
  } else if (ch >= rec.raw.length - 2) {
    fieldNote = `**Field:** 2's-Complement Checksum \`CC = 0x${hexByte(rec.checksum)}\` (${rec.checksumValid ? "valid" : `INVALID, expected 0x${hexByte(rec.expectedChecksum)}`})`;
  } else {
    const byteIdx = Math.floor((ch - 9) / 2);
    const val = rec.data[byteIdx];
    fieldNote =
      val !== undefined
        ? `**Field:** Data Byte [${byteIdx}] at \`0x${hexDword((rec.linearAddress + byteIdx) >>> 0)}\` = \`0x${hexByte(val)}\` (${val})`
        : "**Field:** Data Payload";
  }

  const md = [
    `### Intel HEX Record (Line ${rec.lineNumber})`,
    fieldNote,
    "",
    `- **Type:** ${typeLabel}`,
    `- **Linear Address:** \`0x${hexDword(rec.linearAddress)}\` (base \`0x${hexDword(rec.baseAddress)}\` + \`0x${hexWord(rec.address)}\`)`,
    `- **Payload Length:** ${rec.data.length} byte(s) (declared ${rec.byteCount})`,
    `- **Checksum:** \`0x${hexByte(rec.checksum)}\` (${rec.checksumValid ? "OK" : `expected 0x${hexByte(rec.expectedChecksum)}`})`,
  ].join("\n");

  return {
    contents: { kind: "markdown", value: md },
    range: {
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: rec.raw.length },
    },
  };
}

/**
 * Returns Intel HEX record templates for code completion.
 */
export function getIhexCompletions(): LspCompletionItem[] {
  return [
    {
      label: ":00000001FF",
      detail: "01 — End Of File (EOF) record",
      insertText: ":00000001FF",
      documentation: "Terminates an Intel HEX image (byte count 00, address 0000, type 01, checksum FF).",
    },
    {
      label: ":020000040800F2",
      detail: "04 — Extended Linear Address (0x08000000, STM32 Flash)",
      insertText: ":020000040800F2",
      documentation: "Sets upper 16 bits of 32-bit linear address to 0x0800 (ARM Cortex-M STM32 flash base).",
    },
    {
      label: ":020000040000FA",
      detail: "04 — Extended Linear Address (0x00000000)",
      insertText: ":020000040000FA",
      documentation: "Sets upper 16 bits of 32-bit linear address to 0x0000.",
    },
    {
      label: ":020000021000EC",
      detail: "02 — Extended Segment Address (0x10000, I16HEX)",
      insertText: ":020000021000EC",
      documentation: "Sets 20-bit segment base address to 0x1000 << 4 = 0x10000.",
    },
    {
      label: ":0400000508000000EF",
      detail: "05 — Start Linear Address (0x08000000)",
      insertText: ":0400000508000000EF",
      documentation: "Sets 32-bit entry point (EIP / Reset_Handler) to 0x08000000.",
    },
    {
      label: ":0400000300000000F9",
      detail: "03 — Start Segment Address (CS:IP = 0000:0000)",
      insertText: ":0400000300000000F9",
      documentation: "Sets 80x86 CS:IP start segment address to 0000:0000.",
    },
  ];
}
