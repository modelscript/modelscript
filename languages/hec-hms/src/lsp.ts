// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for USACE HEC-HMS.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
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

interface HmsCstBlockLoc {
  range: LspRange;
  selectionRange: LspRange;
}

interface HmsCstIndex {
  rootRange: LspRange;
  firstToken: LspRange;
  elements: Map<string, HmsCstBlockLoc>;
}

function buildHmsCstIndex(text: string, cstTree?: { rootNode?: unknown } | null): HmsCstIndex {
  const elements = new Map<string, HmsCstBlockLoc>();
  let lineEntries: Array<{ row: number; text: string; startCol: number; endCol: number; firstTokEnd: number }> = [];

  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("hec-hms", import.meta.url, createWasmParserSync).parse(text)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }

  if (rootNode) {
    const grouped = groupAllCstTokensByLine(rootNode as CstNodeLike);
    lineEntries = grouped.map(({ row, tokens }) => {
      const lineText = cstLineText(text, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const firstTokEnd = first?.endPosition?.column ?? startCol + Math.max(1, first?.text?.length ?? 1);
      return { row, text: lineText, startCol, endCol, firstTokEnd };
    });
  } else {
    const rawLines = text.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = raw.search(/\S/);
      const firstTok = trimmed.match(/^[^\s;:,]+/)?.[0] ?? "";
      lineEntries.push({
        row: i,
        text: trimmed,
        startCol: Math.max(0, startCol),
        endCol: Math.max(0, startCol) + trimmed.length,
        firstTokEnd: Math.max(0, startCol) + Math.max(1, firstTok.length),
      });
    }
  }

  const firstEntry = lineEntries[0];
  const lastEntry = lineEntries[lineEntries.length - 1];
  const firstToken: LspRange = firstEntry
    ? {
        start: { line: firstEntry.row, character: firstEntry.startCol },
        end: { line: firstEntry.row, character: Math.max(firstEntry.startCol + 1, firstEntry.firstTokEnd) },
      }
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(1, (lastEntry?.row ?? 0) + 1), character: 0 },
  };

  let activeBlock: { name: string; startRow: number; startCol: number; selRange: LspRange } | null = null;
  for (const entry of lineEntries) {
    const trimmed = entry.text.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    if (trimmed === "End:" || trimmed === "End") {
      if (activeBlock) {
        const blockRange: LspRange = {
          start: { line: activeBlock.startRow, character: activeBlock.startCol },
          end: { line: entry.row, character: entry.endCol },
        };
        if (!elements.has(activeBlock.name)) {
          elements.set(activeBlock.name, { range: blockRange, selectionRange: activeBlock.selRange });
        }
        activeBlock = null;
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0 && !activeBlock) {
      const blockType = trimmed.slice(0, colonIdx).trim();
      const blockName = trimmed.slice(colonIdx + 1).trim();
      if (
        blockName &&
        (blockType === "Basin" ||
          blockType === "Subbasin" ||
          blockType === "Reach" ||
          blockType === "Junction" ||
          blockType === "Reservoir" ||
          blockType === "Sink")
      ) {
        const selRange: LspRange = {
          start: { line: entry.row, character: entry.startCol },
          end: { line: entry.row, character: entry.endCol },
        };
        activeBlock = { name: blockName, startRow: entry.row, startCol: entry.startCol, selRange };
      }
    }
  }

  if (activeBlock && !elements.has(activeBlock.name)) {
    elements.set(activeBlock.name, { range: activeBlock.selRange, selectionRange: activeBlock.selRange });
  }

  return { rootRange, firstToken, elements };
}

/**
 * Generates document outline symbols for HEC-HMS models.
 */
export function getDocumentSymbols(text: string, cstTree?: { rootNode?: unknown } | null): LspDocumentSymbol[] {
  const basin = parseHmsBasin(text);
  const cstIndex = buildHmsCstIndex(text, cstTree);
  const symbols: LspDocumentSymbol[] = [];

  // Subbasins
  const subbasinChildren: LspDocumentSymbol[] = Array.from(basin.subbasins.values()).map((sb) => {
    const loc = cstIndex.elements.get(sb.name);
    const range = loc?.range ?? cstIndex.firstToken;
    const selectionRange = loc?.selectionRange ?? range;
    return {
      name: sb.name,
      detail: `Area: ${sb.area} ${basin.unitSystem === "Metric" ? "km²" : "mi²"}, CN=${sb.curveNumber ?? 75}`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange,
    };
  });

  symbols.push({
    name: "Subbasins",
    detail: `${basin.subbasins.size} subbasins`,
    kind: LspSymbolKind.Namespace,
    range: cstIndex.rootRange,
    selectionRange: cstIndex.rootRange,
    children: subbasinChildren,
  });

  // Reaches
  const reachChildren: LspDocumentSymbol[] = Array.from(basin.reaches.values()).map((rc) => {
    const loc = cstIndex.elements.get(rc.name);
    const range = loc?.range ?? cstIndex.firstToken;
    const selectionRange = loc?.selectionRange ?? range;
    return {
      name: rc.name,
      detail: `To: ${rc.downstream}, Muskingum K=${rc.muskingumK ?? 1} hr`,
      kind: LspSymbolKind.Property,
      range,
      selectionRange,
    };
  });

  symbols.push({
    name: "Reaches",
    detail: `${basin.reaches.size} reaches`,
    kind: LspSymbolKind.Namespace,
    range: cstIndex.rootRange,
    selectionRange: cstIndex.rootRange,
    children: reachChildren,
  });

  return symbols;
}

/**
 * Computes linter diagnostics formatted for LSP.
 */
export function getDiagnostics(text: string, cstTree?: { rootNode?: unknown } | null): LspDiagnosticItem[] {
  const basin = parseHmsBasin(text);
  const cstIndex = buildHmsCstIndex(text, cstTree);
  const diags = lintHmsBasin(basin);

  return diags.map((d) => {
    const loc = d.elementName ? cstIndex.elements.get(d.elementName) : undefined;
    return {
      range: loc?.selectionRange ?? cstIndex.firstToken,
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      message: d.message,
      source: "hec-hms-linter",
    };
  });
}
