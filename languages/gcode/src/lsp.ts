// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/gcode`.
 *
 * Provides diagnostics (`validateGCode`), document symbols (`getGCodeDocumentSymbols`),
 * hover documentation (`getGCodeHover`), and completions (`getGCodeCompletions`).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { getGCodeSchemasFromLibraries, lookupGCodeSchema } from "./catalog/library-package-adapter.js";
import { lintGCode } from "./lints/index.js";
import { normalizeGMCode, parseGCode } from "./parser/gcode-parser.js";

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
  kind: number;
}

const MODAL_HOVER_DOCS: Record<string, string> = {
  G17: "**G17 — XY Plane Selection**: Sets circular interpolation (`G02`/`G03`) and cutter compensation to the XY plane.",
  G18: "**G18 — ZX Plane Selection**: Sets circular interpolation (`G02`/`G03`) to the ZX plane.",
  G19: "**G19 — YZ Plane Selection**: Sets circular interpolation (`G02`/`G03`) to the YZ plane.",
  G20: "**G20 — Inch Units**: Interprets axis coordinates and feedrates in inches (1 in = 25.4 mm).",
  G21: "**G21 — Millimeter Units**: Interprets axis coordinates and feedrates in millimeters.",
  G28: "**G28 — Return to Machine Home**: Rapids specified axes to machine reference zero.",
  G40: "**G40 — Cancel Cutter Radius Compensation**: Cancels `G41`/`G42` tool radius offset.",
  G41: "**G41 — Cutter Radius Compensation Left**: Offsets cutter left of programmed path.",
  G42: "**G42 — Cutter Radius Compensation Right**: Offsets cutter right of programmed path.",
  G54: "**G54 — Work Coordinate System 1**: Selects work offset fixture 1.",
  G55: "**G55 — Work Coordinate System 2**: Selects work offset fixture 2.",
  G56: "**G56 — Work Coordinate System 3**: Selects work offset fixture 3.",
  G57: "**G57 — Work Coordinate System 4**: Selects work offset fixture 4.",
  G58: "**G58 — Work Coordinate System 5**: Selects work offset fixture 5.",
  G59: "**G59 — Work Coordinate System 6**: Selects work offset fixture 6.",
  G90: "**G90 — Absolute Distance Mode**: Coordinates are absolute relative to active work zero.",
  G91: "**G91 — Incremental Distance Mode**: Coordinates are relative displacements from current position.",
  G94: "**G94 — Feed Per Minute**: `F` specifies feedrate in units/minute.",
  G95: "**G95 — Feed Per Revolution**: `F` specifies feedrate in units/spindle revolution.",
  G98: "**G98 — Canned Cycle Initial-Z Retract**: Retracts drill to initial Z height between holes.",
  G99: "**G99 — Canned Cycle R-Plane Retract**: Retracts drill to R-plane height between holes.",
  M00: "**M00 — Program Stop**: Unconditionally halts machine execution until cycle start.",
  M98: "**M98 — Subprogram Call**: Invokes subprogram `Pxxxx` (optionally repeated `L` times).",
  M99: "**M99 — Subprogram Return**: Returns control from subprogram to caller.",
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface GCodeCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildGCodeCstIndex(content: string): GCodeCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("gcode", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
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

/**
 * Validates an RS-274 / ISO 6983 G-code document and returns LSP diagnostics.
 */
export function validateGCode(content: string, _uri = "program.nc"): LspDiagnostic[] {
  const diags = lintGCode(content);
  const cstIndex = buildGCodeCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = Math.max(0, d.column - 1);
    const maxEnd = entry?.endCol ?? startChar + Math.max(1, d.endOffset - d.startOffset);
    const endChar = Math.max(startChar + 1, Math.min(maxEnd, startChar + Math.max(1, d.endOffset - d.startOffset)));
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-gcode",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (main program, tool changes, subprograms).
 */
export function getGCodeDocumentSymbols(content: string): LspDocumentSymbol[] {
  const program = parseGCode(content);
  const cstIndex = buildGCodeCstIndex(content);
  const lastLine = cstIndex.lastRow;
  const lastCol = cstIndex.lastEndCol;

  const children: LspDocumentSymbol[] = [];

  for (const block of program.blocks) {
    const tWord = block.words.find((w) => w.letter === "T");
    if (tWord && Number.isFinite(tWord.value)) {
      const l = Math.max(0, block.line - 1);
      const r: LspRange = {
        start: { line: l, character: Math.max(0, tWord.column - 1) },
        end: { line: l, character: Math.max(0, tWord.column - 1) + tWord.raw.length },
      };
      children.push({
        name: `T${Math.round(tWord.value)}`,
        detail: block.mCodes.includes("M06") ? "Tool Change" : "Tool Select",
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }
  }

  for (const sub of program.subprograms.values()) {
    const startL = Math.max(0, sub.startLine - 1);
    const endL = Math.max(startL, sub.endLine - 1);
    const startEntry = cstIndex.byRow.get(startL);
    const endEntry = cstIndex.byRow.get(endL);
    const startCol = startEntry?.startCol ?? 0;
    children.push({
      name: sub.name,
      detail: `Subprogram (${sub.blocks.length} blocks)`,
      kind: LspSymbolKind.Function,
      range: {
        start: { line: startL, character: startCol },
        end: { line: endL, character: endEntry?.endCol ?? 0 },
      },
      selectionRange: {
        start: { line: startL, character: startCol },
        end: {
          line: startL,
          character: Math.min(startCol + sub.name.length, startEntry?.endCol ?? startCol + sub.name.length),
        },
      },
    });
  }

  const firstEntry = cstIndex.byRow.get(0);
  const firstStart = firstEntry?.startCol ?? 0;
  return [
    {
      name: program.name,
      detail: `CNC G-code Program (${program.blocks.length} blocks)`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: firstStart },
        end: { line: lastLine, character: lastCol },
      },
      selectionRange: {
        start: { line: 0, character: firstStart },
        end: {
          line: 0,
          character: Math.min(firstEntry?.endCol ?? program.name.length, firstStart + program.name.length),
        },
      },
      children,
    },
  ];
}

/**
 * Provides hover documentation for G/M words and `#` parameters at the given cursor position.
 */
export function getGCodeHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildGCodeCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const lineText = entry.text;
  const relChar = position.character - entry.startCol;
  if (relChar < 0 || relChar > lineText.length) return null;

  // Find token under cursor within the CST line slice
  let start = relChar;
  let end = relChar;
  while (start > 0 && /[A-Za-z0-9.#]/.test(lineText[start - 1] ?? "")) start--;
  while (end < lineText.length && /[A-Za-z0-9.#]/.test(lineText[end] ?? "")) end++;
  const token = lineText.slice(start, end).trim();
  if (!token) return null;

  const absStart = entry.startCol + start;
  const absEnd = entry.startCol + end;
  const range: LspRange = {
    start: { line: position.line, character: absStart },
    end: { line: position.line, character: absEnd },
  };

  // G/M code lookup
  const gmMatch = token.match(/^([GgMm])(\d+(?:\.\d+)?)$/);
  if (gmMatch) {
    const canonical = normalizeGMCode(gmMatch[1]!, Number.parseFloat(gmMatch[2]!));
    const schema = lookupGCodeSchema(canonical);
    if (schema) {
      return {
        contents: {
          kind: "markdown",
          value: `**${schema.name} — ${schema.label}**\n\n${schema.description}\n\n*Standard:* ${schema.provenance}`,
        },
        range,
      };
    }
    const modalDoc = MODAL_HOVER_DOCS[canonical];
    if (modalDoc) {
      return {
        contents: { kind: "markdown", value: modalDoc },
        range,
      };
    }
  }

  // Parameter hover (#n, standalone or attached to an address word such as X#100)
  const paramMatch = token.match(/#(\d+)$/);
  if (paramMatch) {
    const paramId = Number.parseInt(paramMatch[1]!, 10);
    const hashIdx = token.lastIndexOf("#");
    const paramRange: LspRange = {
      start: { line: position.line, character: absStart + hashIdx },
      end: { line: position.line, character: absEnd },
    };
    const prog = parseGCode(content);
    const val = prog.parameters.get(paramId);
    return {
      contents: {
        kind: "markdown",
        value:
          val !== undefined
            ? `**Parameter \`#${paramId}\`** = \`${val}\``
            : `**Parameter \`#${paramId}\`** (unset, defaults to \`0\`)`,
      },
      range: paramRange,
    };
  }

  return null;
}

/**
 * Returns ISO 6983 G-code and M-code completion items from the cleanroom standard library.
 */
export function getGCodeCompletions(): LspCompletionItem[] {
  const schemas = getGCodeSchemasFromLibraries();
  const items: LspCompletionItem[] = schemas
    .filter((s) => /^[GM]\d+/.test(s.name))
    .map((s) => ({
      label: s.name,
      detail: s.label,
      documentation: s.description,
      kind: 14,
    }));

  for (const [code, doc] of Object.entries(MODAL_HOVER_DOCS)) {
    if (!items.some((it) => it.label === code)) {
      items.push({
        label: code,
        detail: "ISO 6983 Modal Code",
        documentation: doc,
        kind: 14,
      });
    }
  }

  return items;
}
