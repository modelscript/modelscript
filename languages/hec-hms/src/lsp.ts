// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for USACE HEC-HMS.
 */

import { lintHmsBasin } from "./lints/index.js";
import { parseHmsBasin } from "./parser/hms-parser.js";

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

export interface LspDiagnosticItem {
  range: LspRange;
  severity: 1 | 2 | 3;
  code: string;
  message: string;
  source: string;
}

/**
 * Generates document outline symbols for HEC-HMS models.
 */
export function getDocumentSymbols(text: string): LspDocumentSymbol[] {
  const basin = parseHmsBasin(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(1, text.split("\n").length), character: 0 },
  };

  // Subbasins
  const subbasinChildren: LspDocumentSymbol[] = Array.from(basin.subbasins.values()).map((sb, idx) => ({
    name: sb.name,
    detail: `Area: ${sb.area} ${basin.unitSystem === "Metric" ? "km²" : "mi²"}, CN=${sb.curveNumber ?? 75}`,
    kind: LspSymbolKind.Struct,
    range: { start: { line: idx + 5, character: 0 }, end: { line: idx + 5, character: 40 } },
    selectionRange: { start: { line: idx + 5, character: 0 }, end: { line: idx + 5, character: 20 } },
  }));

  symbols.push({
    name: "Subbasins",
    detail: `${basin.subbasins.size} subbasins`,
    kind: LspSymbolKind.Namespace,
    range: rootRange,
    selectionRange: rootRange,
    children: subbasinChildren,
  });

  // Reaches
  const reachChildren: LspDocumentSymbol[] = Array.from(basin.reaches.values()).map((r, idx) => ({
    name: r.name,
    detail: `To: ${r.downstream}, Muskingum K=${r.muskingumK ?? 1} hr`,
    kind: LspSymbolKind.Property,
    range: { start: { line: idx + 15, character: 0 }, end: { line: idx + 15, character: 40 } },
    selectionRange: { start: { line: idx + 15, character: 0 }, end: { line: idx + 15, character: 20 } },
  }));

  symbols.push({
    name: "Reaches",
    detail: `${basin.reaches.size} reaches`,
    kind: LspSymbolKind.Namespace,
    range: rootRange,
    selectionRange: rootRange,
    children: reachChildren,
  });

  return symbols;
}

/**
 * Computes linter diagnostics formatted for LSP.
 */
export function getDiagnostics(text: string): LspDiagnosticItem[] {
  const basin = parseHmsBasin(text);
  const diags = lintHmsBasin(basin);

  return diags.map((d) => ({
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 80 },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    message: d.message,
    source: "hec-hms-linter",
  }));
}
