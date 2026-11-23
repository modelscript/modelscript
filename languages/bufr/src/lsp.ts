// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WMO_TABLE_B_ENTRIES,
  WMO_TABLE_D_ENTRIES,
  lookupTableB,
  lookupTableD,
  parseBufrDescriptor,
} from "./catalog/wmo-tables.js";
import type { BufrDiagnostic } from "./errors.js";
import { lintBufr } from "./lints/index.js";
import { parseBufrText } from "./parser/text-parser.js";

export interface BufrLspDocumentSymbol {
  name: string;
  detail?: string;
  kind: "Package" | "Section" | "Descriptor" | "Subset";
  line: number;
  endLine: number;
  children?: BufrLspDocumentSymbol[];
}

export interface BufrLspHover {
  contents: string;
  range?: { startLine: number; startCol: number; endLine: number; endCol: number };
}

export interface BufrLspCompletionItem {
  label: string;
  kind: "Keyword" | "Descriptor" | "Sequence";
  detail: string;
  documentation?: string;
  insertText?: string;
}

/**
 * Validates BUFR source text and returns LSP-compatible diagnostics.
 */
export function validateBufr(source: string): BufrDiagnostic[] {
  return lintBufr(source);
}

/**
 * Builds a hierarchical document symbol outline for a BUFR message.
 */
export function getBufrDocumentSymbols(source: string): BufrLspDocumentSymbol[] {
  const msg = parseBufrText(source);
  const totalLines = source.split(/\r?\n/).length;

  const children: BufrLspDocumentSymbol[] = [];

  if (msg.section0.line) {
    children.push({
      name: `SECTION 0 (Edition ${msg.section0.edition})`,
      detail: msg.section0.magic,
      kind: "Section",
      line: msg.section0.line,
      endLine: msg.section0.line,
    });
  }

  if (msg.section1.line) {
    children.push({
      name: "SECTION 1 (Identification)",
      detail: `Centre ${msg.section1.originatingCentre}, ${msg.section1.year}-${String(msg.section1.month).padStart(2, "0")}-${String(msg.section1.day).padStart(2, "0")}`,
      kind: "Section",
      line: msg.section1.line,
      endLine: msg.section1.line,
    });
  }

  if (msg.section3.descriptors.length > 0) {
    children.push({
      name: `SECTION 3 (${msg.section3.descriptors.length} Descriptors)`,
      detail: `${msg.section3.subsetCount} subset(s)`,
      kind: "Section",
      line: msg.section3.line ?? 1,
      endLine: msg.section3.descriptors[msg.section3.descriptors.length - 1]?.line ?? msg.section3.line ?? 1,
      children: msg.section3.descriptors.map((d) => ({
        name: d.code,
        detail:
          lookupTableB(d.code, msg.customTableB)?.name ?? lookupTableD(d.code, msg.customTableD)?.name ?? `F=${d.f}`,
        kind: "Descriptor",
        line: d.line ?? msg.section3.line ?? 1,
        endLine: d.line ?? msg.section3.line ?? 1,
      })),
    });
  }

  for (const subset of msg.subsets) {
    const startLine = subset.line ?? 1;
    const endLine = subset.values[subset.values.length - 1]?.line ?? startLine;
    children.push({
      name: subset.label ?? `SUBSET ${subset.index}`,
      detail: `${subset.values.length} observation(s)`,
      kind: "Subset",
      line: startLine,
      endLine,
    });
  }

  return [
    {
      name: msg.name,
      detail: `WMO BUFR Ed.${msg.section0.edition}`,
      kind: "Package",
      line: 1,
      endLine: totalLines,
      children,
    },
  ];
}

/**
 * Provides hover documentation for F-X-Y descriptors, BUFR sections, and keywords at a 1-based line/column.
 */
export function getBufrHover(source: string, line: number, column: number): BufrLspHover | null {
  const lines = source.split(/\r?\n/);
  const textLine = lines[line - 1];
  if (!textLine) return null;

  const colIdx = Math.max(0, Math.min(textLine.length - 1, column - 1));
  // Expand token around cursor (digits, hyphens, letters, underscores)
  let start = colIdx;
  while (start > 0 && /[A-Za-z0-9_-]/.test(textLine[start - 1]!)) start--;
  let end = colIdx;
  while (end < textLine.length && /[A-Za-z0-9_-]/.test(textLine[end]!)) end++;

  const token = textLine.slice(start, end);
  if (!token) return null;

  const msg = parseBufrText(source);
  const desc = parseBufrDescriptor(token);
  if (desc) {
    if (desc.f === 0) {
      const entry = lookupTableB(desc.code, msg.customTableB);
      if (entry) {
        return {
          contents: [
            `**BUFR Table B \`${entry.code}\` — ${entry.name}**`,
            `- Unit: \`${entry.unit}\``,
            `- Scale: \`${entry.scale}\` · Reference: \`${entry.referenceValue}\` · Bit Width: \`${entry.bitWidth}\``,
          ].join("\n"),
          range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
        };
      }
    } else if (desc.f === 1) {
      return {
        contents:
          desc.y === 0
            ? `**BUFR Delayed Replication \`${desc.code}\`**\nReplicates the next \`${desc.x}\` descriptor(s) using the following delayed replication factor (\`0-31-001\` / \`0-31-002\`).`
            : `**BUFR Fixed Replication \`${desc.code}\`**\nReplicates the next \`${desc.x}\` descriptor(s) \`${desc.y}\` time(s).`,
        range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
      };
    } else if (desc.f === 2) {
      return {
        contents: `**BUFR Table C Operator \`${desc.code}\`**\nOperator class \`X=${desc.x}\`, operand \`Y=${desc.y}\` (e.g. \`2-01-YYY\` width change, \`2-02-YYY\` scale change).`,
        range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
      };
    } else if (desc.f === 3) {
      const entry = lookupTableD(desc.code, msg.customTableD);
      if (entry) {
        return {
          contents: [
            `**BUFR Table D Sequence \`${entry.code}\` — ${entry.name}**`,
            `Expands to: \`${entry.descriptors.join(", ")}\``,
          ].join("\n"),
          range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
        };
      }
    }
  }

  const upper = token.toUpperCase();
  if (upper === "BUFR") {
    return {
      contents:
        "**WMO FM 94 BUFR Indicator Header (Section 0)**\nBegins a Binary Universal Form for Meteorological Data message (Edition 3 or 4).",
      range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
    };
  }
  if (upper === "7777") {
    return {
      contents:
        "**BUFR Section 5 End-of-Message Marker (`7777`)**\nMandatory 4-octet ASCII sentinel terminating every WMO BUFR message.",
      range: { startLine: line, startCol: start + 1, endLine: line, endCol: end + 1 },
    };
  }

  return null;
}

/**
 * Provides completions for BUFR keywords, WMO Table B elements, and Table D sequences.
 */
export function getBufrCompletions(prefix = ""): BufrLspCompletionItem[] {
  const q = prefix.trim().toLowerCase();
  const items: BufrLspCompletionItem[] = [
    { label: "BUFR", kind: "Keyword", detail: "Section 0 magic header", insertText: "BUFR EDITION 4" },
    { label: "SECTION 1", kind: "Keyword", detail: "Identification section" },
    { label: "SECTION 3", kind: "Keyword", detail: "Data description section" },
    { label: "SECTION 4", kind: "Keyword", detail: "Data payload section" },
    { label: "SECTION 5", kind: "Keyword", detail: "End section" },
    { label: "SUBSET", kind: "Keyword", detail: "Data subset block", insertText: "SUBSET 1:" },
    { label: "TABLE_B", kind: "Keyword", detail: "Local Table B element definitions" },
    { label: "TABLE_D", kind: "Keyword", detail: "Local Table D sequence definitions" },
    { label: "7777", kind: "Keyword", detail: "End-of-message sentinel" },
  ];

  for (const b of WMO_TABLE_B_ENTRIES) {
    items.push({
      label: b.code,
      kind: "Descriptor",
      detail: `${b.name} (${b.unit})`,
      documentation: `Scale ${b.scale}, Ref ${b.referenceValue}, ${b.bitWidth} bits`,
    });
  }

  for (const d of WMO_TABLE_D_ENTRIES) {
    items.push({
      label: d.code,
      kind: "Sequence",
      detail: d.name,
      documentation: `Sequence: ${d.descriptors.join(", ")}`,
    });
  }

  if (!q) return items;
  return items.filter((it) => it.label.toLowerCase().includes(q) || it.detail.toLowerCase().includes(q));
}
