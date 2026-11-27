// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lintHecRas } from "./lints/rules.js";
import { parseHecRas } from "./parser/hec-ras-parser.js";

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
  severity: 1 | 2 | 3 | 4;
  code: number;
  source: string;
  message: string;
}

interface HecRasCstLineSpan {
  startChar: number;
  endChar: number;
  firstTokenEnd: number;
}

function buildHecRasCstLineMap(
  text: string,
  cstTree?: { rootNode?: unknown } | null,
): { spans: Map<number, HecRasCstLineSpan>; maxRow: number } {
  const spans = new Map<number, HecRasCstLineSpan>();
  let maxRow = 0;

  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("hec-ras", import.meta.url, createWasmParserSync).parse(text)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startChar = first?.startPosition?.column ?? 0;
      const lastEnd =
        last?.endPosition?.column ?? (last?.startPosition?.column ?? startChar) + Math.max(1, last?.text?.length ?? 1);
      const firstEnd = first?.endPosition?.column ?? startChar + Math.max(1, first?.text?.length ?? 1);
      const endChar = Math.max(startChar + 1, lastEnd);
      const firstTokenEnd = Math.max(startChar + 1, firstEnd);
      spans.set(row, { startChar, endChar, firstTokenEnd });
      if (row > maxRow) maxRow = row;
    }
    return { spans, maxRow };
  }

  const lines = text.split(/\r?\n/);
  maxRow = Math.max(0, lines.length - 1);
  for (let i = 0; i < lines.length; i++) {
    const lt = lines[i] ?? "";
    let sChar = 0;
    while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
    const tok = lt.slice(sChar).match(/^[^\s=,;]+/);
    const firstTokenEnd = Math.min(lt.length, sChar + (tok ? tok[0].length : 1));
    spans.set(i, {
      startChar: sChar,
      endChar: Math.max(1, lt.trimEnd().length),
      firstTokenEnd: Math.max(sChar + 1, firstTokenEnd),
    });
  }
  return { spans, maxRow };
}

export function getDocumentSymbols(text: string, cstTree?: { rootNode?: unknown } | null): LspDocumentSymbol[] {
  const { geometry, flow } = parseHecRas(text);
  const { spans, maxRow } = buildHecRasCstLineMap(text, cstTree);
  const clampedEnd = (lineIdx: number, fallback: number): number => {
    const clamped = Math.min(Math.max(0, lineIdx), maxRow);
    return spans.get(clamped)?.endChar ?? fallback;
  };
  const symbols: LspDocumentSymbol[] = [];

  if (geometry) {
    for (const r of geometry.reaches) {
      const reachKey = `${r.river},${r.reach}`;
      const csChildren: LspDocumentSymbol[] = [];

      for (const cs of geometry.crossSections) {
        if (cs.river === r.river && cs.reach === r.reach) {
          const l = Math.max(0, cs.line - 1);
          const endLine = Math.min(l + 5, Math.max(l, maxRow));
          csChildren.push({
            name: `CS ${cs.station}`,
            detail: cs.description ?? `${cs.stationElevations.length} points, n=${cs.manning.channel}`,
            kind: LspSymbolKind.Struct,
            range: { start: { line: l, character: 0 }, end: { line: endLine, character: clampedEnd(endLine, 20) } },
            selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: clampedEnd(l, 20) } },
          });
        }
      }

      for (const st of geometry.inlineStructures) {
        if (st.river === r.river && st.reach === r.reach) {
          const l = Math.max(0, st.line - 1);
          const endLine = Math.min(l + 3, Math.max(l, maxRow));
          csChildren.push({
            name: `Weir ${st.station}`,
            detail: `Crest: ${st.weirCrestElevation} m, L: ${st.weirLength} m`,
            kind: LspSymbolKind.Interface,
            range: { start: { line: l, character: 0 }, end: { line: endLine, character: clampedEnd(endLine, 20) } },
            selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: clampedEnd(l, 20) } },
          });
        }
      }

      const l = Math.max(0, r.line - 1);
      const reachEndLine = Math.min(l + csChildren.length * 5, Math.max(l, maxRow));
      symbols.push({
        name: `Reach ${reachKey}`,
        detail: `${r.coords.length} centerline coordinates`,
        kind: LspSymbolKind.Namespace,
        range: {
          start: { line: l, character: 0 },
          end: { line: reachEndLine, character: clampedEnd(reachEndLine, 20) },
        },
        selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: clampedEnd(l, 20) } },
        children: csChildren,
      });
    }
  }

  if (flow) {
    for (const bc of flow.boundaryConditions) {
      const l = Math.max(0, bc.line - 1);
      const endLine = Math.min(l + 2, Math.max(l, maxRow));
      symbols.push({
        name: `BC: ${bc.river} ${bc.reach} Sta ${bc.station}`,
        detail: `${bc.type}${bc.frictionSlope ? ` (S=${bc.frictionSlope})` : ""}`,
        kind: LspSymbolKind.Event,
        range: { start: { line: l, character: 0 }, end: { line: endLine, character: clampedEnd(endLine, 20) } },
        selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: clampedEnd(l, 20) } },
      });
    }
  }

  return symbols;
}

export function getDiagnostics(text: string, cstTree?: { rootNode?: unknown } | null): LspDiagnostic[] {
  const { geometry, flow } = parseHecRas(text);
  if (!geometry) return [];

  const { spans, maxRow } = buildHecRasCstLineMap(text, cstTree);
  const rawDiags = lintHecRas(geometry, flow);
  return rawDiags.map((d) => {
    const l = Math.min(Math.max(0, d.line - 1), maxRow);
    const span = spans.get(l);
    const sChar = span?.startChar ?? 0;
    const eChar = span?.firstTokenEnd ?? Math.max(1, sChar + 1);
    const sev = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: {
        start: { line: l, character: sChar },
        end: { line: l, character: eChar },
      },
      severity: sev,
      code: d.code,
      source: "hec-ras",
      message: `[M${d.code}] ${d.message}`,
    };
  });
}

export const getHecRasDocumentSymbols = getDocumentSymbols;
export const validateHecRas = getDiagnostics;

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export function getHecRasHover(
  text: string,
  pos: LspPosition,
  cstTree?: { rootNode?: unknown } | null,
): LspHover | null {
  const symbols = getDocumentSymbols(text, cstTree);
  for (const s of symbols) {
    if (s.children) {
      for (const child of s.children) {
        if (pos.line >= child.range.start.line && pos.line <= child.range.end.line) {
          return {
            contents: {
              kind: "markdown",
              value: `**HEC-RAS ${child.name}**\n\n${child.detail ?? ""}`,
            },
            range: child.range,
          };
        }
      }
    }
    if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
      return {
        contents: {
          kind: "markdown",
          value: `**HEC-RAS ${s.name}**\n\n${s.detail ?? ""}`,
        },
        range: s.range,
      };
    }
  }
  return null;
}
