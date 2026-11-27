// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintHdf4 } from "./lints/index.js";
import { parseHdf4Ddl } from "./parser/ddl-parser.js";
import { computeSdsStatistics } from "./solver/index.js";
import { HDF4_DATA_TYPE_NAMES } from "./types.js";

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
  Array = 18,
  Object = 19,
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
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface Hdf4CstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildHdf4CstIndex(content: string): Hdf4CstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("hdf4", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      byRow.set(row, { row, text: lineText, startCol, endCol });
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
      byRow.set(i, { row: i, text: trimmed, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }
  return { byRow, lastRow, lastEndCol };
}

function lineRange(cstIndex: Hdf4CstIndex, lineIndex: number): LspRange {
  const safeLine = Math.max(0, lineIndex);
  const entry = cstIndex.byRow.get(safeLine);
  const startChar = entry?.startCol ?? 0;
  const endChar = Math.max(startChar + 1, entry?.endCol ?? 1);
  return {
    start: { line: safeLine, character: startChar },
    end: { line: safeLine, character: endChar },
  };
}

/**
 * Validates an HDF4 DDL document and returns LSP diagnostics.
 */
export function validateHdf4(content: string, _uri: string = "dataset.hdf4"): LspDiagnostic[] {
  const doc = parseHdf4Ddl(content);
  const diags = lintHdf4(doc);
  const cstIndex = buildHdf4CstIndex(content);

  return diags.map((d) => {
    const lineIdx = d.line ? Math.max(0, d.line - 1) : 0;
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: lineRange(cstIndex, lineIdx),
      severity,
      code: d.code,
      source: "hdf4",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for an HDF4 DDL document.
 */
export function getHdf4DocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseHdf4Ddl(content);
  const cstIndex = buildHdf4CstIndex(content);
  const children: LspDocumentSymbol[] = [];

  for (const sds of doc.sdsList) {
    const ln = (sds.location?.line ?? 1) - 1;
    const rng = lineRange(cstIndex, ln);
    const shape = sds.dims.map((d) => d.size).join("x") || "scalar";
    const dtype = HDF4_DATA_TYPE_NAMES[sds.dataType] ?? String(sds.dataType);
    children.push({
      name: sds.name,
      detail: `SDS ${dtype} [${shape}]`,
      kind: LspSymbolKind.Array,
      range: rng,
      selectionRange: rng,
      children: sds.dims.map((d) => {
        const dln = (d.location?.line ?? sds.location?.line ?? 1) - 1;
        const drng = lineRange(cstIndex, dln);
        return {
          name: d.name,
          detail: `DIM = ${d.size}`,
          kind: LspSymbolKind.Field,
          range: drng,
          selectionRange: drng,
        };
      }),
    });
  }

  for (const vg of doc.vgroups) {
    const ln = (vg.location?.line ?? 1) - 1;
    const rng = lineRange(cstIndex, ln);
    children.push({
      name: vg.name,
      detail: vg.vgroupClass ? `VGROUP (${vg.vgroupClass})` : "VGROUP",
      kind: LspSymbolKind.Package,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const vd of doc.vdatas) {
    const ln = (vd.location?.line ?? 1) - 1;
    const rng = lineRange(cstIndex, ln);
    children.push({
      name: vd.name,
      detail: `VDATA (${vd.fields.length} fields, ${vd.records.length} records)`,
      kind: LspSymbolKind.Struct,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const r of doc.rasters) {
    const ln = (r.location?.line ?? 1) - 1;
    const rng = lineRange(cstIndex, ln);
    children.push({
      name: r.name,
      detail: `RASTER8 ${r.width}x${r.height}`,
      kind: LspSymbolKind.Object,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const p of doc.palettes) {
    const ln = (p.location?.line ?? 1) - 1;
    const rng = lineRange(cstIndex, ln);
    children.push({
      name: p.name,
      detail: `PALETTE (${p.entries.length} bytes)`,
      kind: LspSymbolKind.Constant,
      range: rng,
      selectionRange: rng,
    });
  }

  const fullRange: LspRange = {
    start: { line: 0, character: cstIndex.byRow.get(0)?.startCol ?? 0 },
    end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
  };

  return [
    {
      name: doc.name,
      detail: `HDF4 v${doc.version}`,
      kind: LspSymbolKind.File,
      range: fullRange,
      selectionRange: lineRange(cstIndex, 0),
      children,
    },
  ];
}

const KEYWORD_DOCS: Record<string, string> = {
  HDF4: "**HDF4** — Root NCSA HDF4 container declaration (magic `0x0e031301`).",
  SDS: "**SDS** — Scientific Data Set (`DFTAG_NDG=720`, `DFTAG_SD=702`, `DFTAG_SDD=701`).",
  VGROUP: "**VGROUP** — Hierarchical container grouping HDF4 tag/ref objects (`DFTAG_VG=1965`).",
  VDATA: "**VDATA** — Heterogeneous record table (`DFTAG_VH=1962`, `DFTAG_VS=1963`).",
  RASTER8: "**RASTER8** — 8-bit indexed raster image (`DFTAG_ID8=200`, `DFTAG_RI8=202`).",
  PALETTE: "**PALETTE** — 256-entry RGB color lookup table (`DFTAG_IP8=201`, 768 bytes).",
  DIM: "**DIM** — Declares a named dimension size inside an `SDS` block.",
  ATTR: "**ATTR** — Declares a metadata attribute (`units`, `_FillValue`, `scale_factor`, etc.).",
  DATA: "**DATA** — Inline numeric array or Vdata record payload.",
  MEMBER: "**MEMBER** — Links an `SDS`, `VGROUP`, `VDATA`, `RASTER8`, or `PALETTE` inside a `VGROUP`.",
  END: "**END** — Closes the current HDF4 block.",
};

/**
 * Returns hover documentation for keywords or declared HDF4 objects at a cursor position.
 */
export function getHdf4Hover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildHdf4CstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const line = entry.text;
  const relChar = position.character - entry.startCol;
  if (relChar < 0 || relChar > line.length) return null;

  let start = relChar;
  let end = start;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(line[start - 1] ?? "")) start--;
  while (end < line.length && /[A-Za-z0-9_.-]/.test(line[end] ?? "")) end++;
  const word = line.slice(start, end);
  if (!word) return null;

  const hoverRange: LspRange = {
    start: { line: position.line, character: entry.startCol + start },
    end: { line: position.line, character: entry.startCol + end },
  };

  const kwDoc = KEYWORD_DOCS[word.toUpperCase()];
  if (kwDoc) {
    return {
      contents: { kind: "markdown", value: kwDoc },
      range: hoverRange,
    };
  }

  const doc = parseHdf4Ddl(content);
  const sds = doc.sdsList.find((s) => s.name === word);
  if (sds) {
    const stats = computeSdsStatistics(sds.data);
    const dtype = HDF4_DATA_TYPE_NAMES[sds.dataType] ?? String(sds.dataType);
    const shape = sds.dims.map((d) => `${d.name}=${d.size}`).join(", ");
    return {
      contents: {
        kind: "markdown",
        value: [
          `**SDS \`${sds.name}\`** (ref=${sds.ref}, type=\`${dtype}\`)`,
          `- Dimensions: \`[${shape}]\``,
          `- Elements: ${stats.validCount} | Min: ${stats.min.toFixed(4)} | Max: ${stats.max.toFixed(4)} | Mean: ${stats.mean.toFixed(4)}`,
          sds.unit ? `- Units: \`${sds.unit}\`` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      range: hoverRange,
    };
  }

  const vg = doc.vgroups.find((v) => v.name === word);
  if (vg) {
    return {
      contents: {
        kind: "markdown",
        value: `**VGROUP \`${vg.name}\`** (ref=${vg.ref}${vg.vgroupClass ? `, class=\`${vg.vgroupClass}\`` : ""})\n- Members (${vg.members.length}): ${vg.members.map((m) => `\`${m.name}\``).join(", ") || "none"}`,
      },
      range: hoverRange,
    };
  }

  return null;
}

/**
 * Returns context-aware LSP completion items for HDF4 DDL keywords, DFNT data types, and declared objects.
 */
export function getHdf4Completions(content: string, _position?: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = Object.entries(KEYWORD_DOCS).map(([kw, doc]) => ({
    label: kw,
    kind: 14, // Keyword
    detail: "HDF4 DDL keyword",
    documentation: doc,
  }));

  for (const [code, name] of Object.entries(HDF4_DATA_TYPE_NAMES)) {
    items.push({
      label: name,
      kind: 25, // TypeParameter
      detail: `DFNT_${name} (${code})`,
      documentation: `NCSA HDF4 numeric type DFNT_${name} (code ${code}).`,
    });
  }

  const doc = parseHdf4Ddl(content);
  for (const sds of doc.sdsList) {
    items.push({
      label: sds.name,
      kind: 6, // Variable
      detail: `SDS (ref=${sds.ref})`,
    });
  }
  for (const vg of doc.vgroups) {
    items.push({
      label: vg.name,
      kind: 9, // Module
      detail: `VGROUP (ref=${vg.ref})`,
    });
  }

  return items;
}
