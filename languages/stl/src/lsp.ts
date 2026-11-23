// SPDX-License-Identifier: AGPL-3.0-or-later

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

/**
 * Validates ASCII STL source text and returns LSP diagnostics.
 */
export function validateStl(content: string, _uri = "model.stl"): LspDiagnostic[] {
  const doc = parseAsciiStl(content);
  const diags = lintStl(doc);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, Math.min(lines.length - 1, (d.line || 1) - 1));
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, (d.column || 1) - 1);
    const endChar = Math.max(startChar + 1, lineText.length);
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
export function getStlDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseAsciiStl(content);
  const lines = content.split(/\r?\n/);
  const symbols: LspDocumentSymbol[] = [];

  for (let sIdx = 0; sIdx < doc.solids.length; sIdx++) {
    const solid = doc.solids[sIdx]!;
    const startLine = Math.max(0, (solid.line ?? 1) - 1);
    const endLine = Math.max(startLine, (solid.endLine ?? lines.length) - 1);
    const endChar = (lines[endLine] ?? "").length;
    const solidRange: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: endChar },
    };

    const children: LspDocumentSymbol[] = solid.facets.slice(0, 256).map((f, fIdx) => {
      const fLine = Math.max(0, (f.line ?? startLine + 1) - 1);
      const fLen = (lines[fLine] ?? "").length;
      const fRange: LspRange = {
        start: { line: fLine, character: 0 },
        end: { line: fLine, character: fLen },
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
        end: { line: startLine, character: (lines[startLine] ?? "").length },
      },
      children,
    });
  }

  return symbols;
}

/**
 * Provides contextual Markdown hover documentation for STL keywords and solid mass properties.
 */
export function getStlHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (lineText === undefined) return null;

  const trimmed = lineText.trim();
  const lower = trimmed.toLowerCase();

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
export function getStlCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const lines = content.split(/\r?\n/);
  const linePrefix = (lines[position.line] ?? "").slice(0, position.character).trim().toLowerCase();

  return STL_KEYWORDS.filter((k) => !linePrefix || k.keyword.startsWith(linePrefix)).map((k) => ({
    label: k.keyword,
    kind: 14, // CompletionItemKind.Keyword
    detail: k.detail,
    insertText: k.snippet ?? k.keyword,
  }));
}
