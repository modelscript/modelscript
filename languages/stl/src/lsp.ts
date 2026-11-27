// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintStl } from "./lints/index.js";
import { parseAsciiStl } from "./parser/ascii-parser.js";
import { analyzeStlTopology, computeStlMassProperties } from "./solver/index.js";

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
  insertText?: string | undefined;
}

const STL_KEYWORDS: ReadonlyArray<{ keyword: string; detail: string; doc: string; snippet?: string }> = [
  {
    keyword: "solid",
    detail: "Begin ASCII STL solid block",
    doc: "**`solid <name>`** — Begins an ASCII STL solid mesh block.",
    snippet: "solid ${1:model}\n  $0\nendsolid ${1:model}",
  },
  {
    keyword: "facet normal",
    detail: "Triangular facet with unit outward normal (nx ny nz)",
    doc: "**`facet normal <nx> <ny> <nz>`** — Declares a triangular facet and its outward unit normal vector.",
    snippet:
      "facet normal ${1:0} ${2:0} ${3:1}\n  outer loop\n    vertex ${4:0} ${5:0} ${6:0}\n    vertex ${7:1} ${8:0} ${9:0}\n    vertex ${10:0} ${11:1} ${12:0}\n  endloop\nendfacet",
  },
  {
    keyword: "outer loop",
    detail: "Begin 3-vertex triangle loop",
    doc: "**`outer loop`** — Opens the 3-vertex counter-clockwise right-hand-rule loop of a facet.",
  },
  {
    keyword: "vertex",
    detail: "3D vertex coordinate (x y z)",
    doc: "**`vertex <x> <y> <z>`** — Defines one 3D corner vertex of a triangular facet.",
  },
  {
    keyword: "endloop",
    detail: "Close outer loop",
    doc: "**`endloop`** — Closes the current `outer loop` vertex list.",
  },
  {
    keyword: "endfacet",
    detail: "Close facet block",
    doc: "**`endfacet`** — Closes the current `facet normal` block.",
  },
  {
    keyword: "endsolid",
    detail: "Close ASCII STL solid block",
    doc: "**`endsolid [name]`** — Terminates the current `solid` mesh block.",
  },
];

interface StlCstLine {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  tokens: CstNodeLike[];
}

interface StlCstIndex {
  byRow: Map<number, StlCstLine>;
  maxRow: number;
}

function buildStlCstIndex(content: string, cstTree?: { rootNode?: unknown } | null): StlCstIndex {
  const byRow = new Map<number, StlCstLine>();
  let maxRow = 0;
  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("stl", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }
  if (!rootNode) return { byRow, maxRow };

  for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
    const lineText = cstLineText(content, tokens);
    const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const startCol = first?.startPosition?.column ?? 0;
    const endCol = last?.endPosition?.column ?? startCol + lineText.length;
    byRow.set(row, { row, text: lineText, startCol, endCol, tokens });
    if (row > maxRow) maxRow = row;
  }
  return { byRow, maxRow };
}

/**
 * Validates ASCII STL source text and returns LSP diagnostics.
 */
export function validateStl(
  content: string,
  _uri = "model.stl",
  cstTree?: { rootNode?: unknown } | null,
): LspDiagnostic[] {
  const doc = parseAsciiStl(content);
  const diags = lintStl(doc);
  const cstIndex = buildStlCstIndex(content, cstTree);

  return diags.map((d) => {
    const lineIdx = Math.max(0, Math.min(cstIndex.maxRow, (d.line || 1) - 1));
    const lineEntry = cstIndex.byRow.get(lineIdx);
    const startChar = Math.max(0, (d.column || 1) - 1);
    const endChar = Math.max(startChar + 1, lineEntry?.endCol ?? startChar + 1);
    const severity: 1 | 2 | 3 = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity,
      code: d.code,
      source: "modelscript-stl",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols for solids and facets in an ASCII STL document.
 */
export function getStlDocumentSymbols(content: string, cstTree?: { rootNode?: unknown } | null): LspDocumentSymbol[] {
  const doc = parseAsciiStl(content);
  const cstIndex = buildStlCstIndex(content, cstTree);
  const symbols: LspDocumentSymbol[] = [];

  for (let sIdx = 0; sIdx < doc.solids.length; sIdx++) {
    const solid = doc.solids[sIdx]!;
    const startLine = Math.max(0, (solid.line ?? 1) - 1);
    const endLine = Math.max(startLine, (solid.endLine ?? cstIndex.maxRow + 1) - 1);
    const endChar = cstIndex.byRow.get(endLine)?.endCol ?? 0;
    const solidRange: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: endChar },
    };

    const children: LspDocumentSymbol[] = solid.facets.slice(0, 256).map((f, fIdx) => {
      const fLine = Math.max(0, (f.line ?? startLine + 1) - 1);
      const fEnd = cstIndex.byRow.get(fLine)?.endCol ?? 0;
      const fRange: LspRange = {
        start: { line: fLine, character: 0 },
        end: { line: fLine, character: fEnd },
      };
      return {
        name: `facet #${fIdx}`,
        detail: `n=(${f.normal[0].toFixed(3)}, ${f.normal[1].toFixed(3)}, ${f.normal[2].toFixed(3)})`,
        kind: LspSymbolKind.Struct,
        range: fRange,
        selectionRange: fRange,
      };
    });

    symbols.push({
      name: solid.name || `solid_${sIdx}`,
      detail: `${solid.facets.length} facets`,
      kind: LspSymbolKind.Class,
      range: solidRange,
      selectionRange: {
        start: { line: startLine, character: 0 },
        end: { line: startLine, character: cstIndex.byRow.get(startLine)?.endCol ?? 0 },
      },
      children,
    });
  }

  return symbols;
}

/**
 * Provides contextual Markdown hover documentation for STL keywords and solid mass properties.
 */
export function getStlHover(
  content: string,
  position: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | null {
  const cstIndex = buildStlCstIndex(content, cstTree);
  const lineEntry = cstIndex.byRow.get(position.line);
  if (!lineEntry) return null;

  const lower = lineEntry.text.trim().toLowerCase();

  if (lower.startsWith("solid ") || lower === "solid") {
    const doc = parseAsciiStl(content);
    const props = computeStlMassProperties(doc);
    const topo = analyzeStlTopology(doc);
    return {
      contents: {
        kind: "markdown",
        value: [
          `**STL Solid** \`${doc.solids[0]?.name || "(unnamed)"}\``,
          `- Facets: **${doc.facets.length}** · Vertices: **${topo.vertexCount}** · Edges: **${topo.edgeCount}**`,
          `- Signed Volume: \`${props.signedVolume.toPrecision(6)}\` · Surface Area: \`${props.surfaceArea.toPrecision(6)}\``,
          `- Euler $\\chi$: \`${topo.eulerCharacteristic}\` · Watertight: **${topo.isWatertight ? "Yes" : "No"}**`,
        ].join("\n"),
      },
    };
  }

  for (const item of STL_KEYWORDS) {
    if (lower.startsWith(item.keyword)) {
      return {
        contents: {
          kind: "markdown",
          value: item.doc,
        },
      };
    }
  }

  return null;
}

/**
 * Provides context-aware STL keyword & snippet completions.
 */
export function getStlCompletions(
  content: string,
  position: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspCompletionItem[] {
  const cstIndex = buildStlCstIndex(content, cstTree);
  const lineEntry = cstIndex.byRow.get(position.line);
  let linePrefix = "";
  if (lineEntry) {
    const prefixTokens = lineEntry.tokens
      .filter((t) => (t.startPosition?.column ?? 0) < position.character)
      .map((t) => {
        const col = t.startPosition?.column ?? 0;
        const text = t.text ?? "";
        return text.slice(0, Math.max(0, position.character - col));
      });
    linePrefix = prefixTokens.join(" ").trim().toLowerCase();
  }

  return STL_KEYWORDS.filter((k) => !linePrefix || k.keyword.startsWith(linePrefix)).map((k) => ({
    label: k.keyword,
    kind: 14, // CompletionItemKind.Keyword
    detail: k.detail,
    insertText: k.snippet ?? k.keyword,
  }));
}
