// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for Motorola S-Record (`.srec`, `.s19`, `.s28`, `.s37`, `.mot`).
 */

import { lintSrec } from "./lints/index.js";
import { decodeHeaderAscii, parseSrec } from "./parser/index.js";
import { solveSrecMemory } from "./solver/index.js";
import type { SrecRecordType } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
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
  documentation: string;
  insertText: string;
}

const RECORD_DOCS: Record<SrecRecordType, { title: string; desc: string; snippet: string }> = {
  S0: {
    title: "S0 — Header Record (16-bit)",
    desc: "Vendor-specific ASCII header metadata at address `0x0000`.",
    snippet: "S00600004844521B",
  },
  S1: {
    title: "S1 — 16-bit Data Record",
    desc: "Binary payload with 16-bit (2-byte) load address (Motorola 6800/6809).",
    snippet: "S10500000000FA",
  },
  S2: {
    title: "S2 — 24-bit Data Record",
    desc: "Binary payload with 24-bit (3-byte) load address (Motorola 68000).",
    snippet: "S2060000000000F9",
  },
  S3: {
    title: "S3 — 32-bit Data Record",
    desc: "Binary payload with 32-bit (4-byte) load address (68020/ColdFire/PowerPC).",
    snippet: "S307000000000000F8",
  },
  S4: {
    title: "S4 — Reserved Record",
    desc: "Reserved by Motorola S-Record specification; invalid in firmware images (`SREC3001`).",
    snippet: "S4030000FC",
  },
  S5: {
    title: "S5 — 16-bit Record Count",
    desc: "Count of preceding `S1`/`S2`/`S3` data records (up to 65,535).",
    snippet: "S5030001FB",
  },
  S6: {
    title: "S6 — 24-bit Record Count",
    desc: "Count of preceding `S1`/`S2`/`S3` data records (up to 16,777,215).",
    snippet: "S604000001FA",
  },
  S7: {
    title: "S7 — 32-bit Start Address Termination",
    desc: "Execution entry point and end-of-file terminator for `S3` images.",
    snippet: "S70500000000FA",
  },
  S8: {
    title: "S8 — 24-bit Start Address Termination",
    desc: "Execution entry point and end-of-file terminator for `S2` images.",
    snippet: "S804000000FB",
  },
  S9: {
    title: "S9 — 16-bit Start Address Termination",
    desc: "Execution entry point and end-of-file terminator for `S1` images.",
    snippet: "S9030000FC",
  },
};

function hex(value: number, width: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

/**
 * Validates a Motorola S-Record document and returns LSP diagnostics.
 */
export function validateSrec(content: string, uri: string = "firmware.srec"): LspDiagnostic[] {
  const file = parseSrec(content, uri);
  const diags = lintSrec(file);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, d.column - 1);
    const endChar =
      d.endColumn !== undefined ? Math.max(startChar + 1, d.endColumn - 1) : Math.max(startChar + 1, lineText.length);
    const severity: 1 | 2 | 3 | 4 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity,
      code: d.code,
      source: "srec",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP DocumentSymbols for an S-Record file:
 * Header (`S0`), coalesced Memory Regions, Record Count (`S5`/`S6`), and Entry Point (`S7`/`S8`/`S9`).
 */
export function getSrecDocumentSymbols(content: string, uri: string = "firmware.srec"): LspDocumentSymbol[] {
  const file = parseSrec(content, uri);
  const solved = solveSrecMemory(file);
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: (lines[lastLine] ?? "").length },
  };

  const children: LspDocumentSymbol[] = [];

  const headerRec = file.records.find((r) => r.type === "S0");
  if (headerRec) {
    const lineIdx = Math.max(0, headerRec.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: headerRec.raw.length },
    };
    children.push({
      name: `S0 Header`,
      detail: decodeHeaderAscii(headerRec.data) || "(empty)",
      kind: LspSymbolKind.String,
      range,
      selectionRange: range,
    });
  }

  for (const reg of solved.regions) {
    const lineIdx = Math.max(0, reg.firstLine - 1);
    const lineLen = (lines[lineIdx] ?? "").length;
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: lineLen },
    };
    children.push({
      name: `Region ${reg.index} (${hex(reg.startAddress, 8)})`,
      detail: `${reg.size} bytes · CRC32 ${hex(reg.crc32, 8)}`,
      kind: LspSymbolKind.Array,
      range,
      selectionRange: range,
    });
  }

  const termRec = file.records.find((r) => r.type === "S7" || r.type === "S8" || r.type === "S9");
  if (termRec) {
    const lineIdx = Math.max(0, termRec.line - 1);
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: termRec.raw.length },
    };
    children.push({
      name: `${termRec.type} Entry Point`,
      detail: hex(termRec.address, termRec.addressBytes * 2),
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  return [
    {
      name: file.name,
      detail: `${solved.regions.length} region(s), ${solved.totalDataBytes} B`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: fullRange,
      children,
    },
  ];
}

/**
 * Provides contextual Markdown hover information for any line/character in an S-Record file.
 */
export function getSrecHover(content: string, position: LspPosition): LspHover | null {
  const file = parseSrec(content);
  const targetLine = position.line + 1;
  const rec = file.records.find((r) => r.line === targetLine);
  if (!rec) return null;

  const doc = RECORD_DOCS[rec.type];
  const addrHex = hex(rec.address, rec.addressBytes * 2);
  const chkHex = hex(rec.checksum, 2);
  const expChkHex = hex(rec.computedChecksum, 2);

  const lines: string[] = [
    `### ${doc.title}`,
    doc.desc,
    ``,
    `- **Byte Count**: \`${rec.byteCount}\` (${rec.byteCountValid ? "valid" : "MISMATCH"})`,
    `- **Address / Value**: \`${addrHex}\` (${rec.addressBytes * 8}-bit)`,
    `- **Payload Length**: \`${rec.data.length}\` byte(s)`,
    `- **Checksum**: \`${chkHex}\` (${rec.checksumValid ? "valid 1's-complement" : `INVALID, expected ${expChkHex}`})`,
  ];

  if (rec.type === "S0") {
    lines.push(`- **ASCII Header**: \`${decodeHeaderAscii(rec.data)}\``);
  }

  return {
    contents: {
      kind: "markdown",
      value: lines.join("\n"),
    },
    range: {
      start: { line: position.line, character: 0 },
      end: { line: position.line, character: rec.raw.length },
    },
  };
}

/**
 * Provides S-Record type completion items (`S0`–`S9`).
 */
export function getSrecCompletions(_content?: string, _position?: LspPosition): LspCompletionItem[] {
  const types: SrecRecordType[] = ["S0", "S1", "S2", "S3", "S5", "S6", "S7", "S8", "S9"];
  return types.map((t) => {
    const info = RECORD_DOCS[t];
    return {
      label: t,
      kind: 14, // Keyword
      detail: info.title,
      documentation: info.desc,
      insertText: info.snippet,
    };
  });
}
