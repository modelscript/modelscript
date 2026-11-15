// SPDX-License-Identifier: AGPL-3.0-or-later

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

export function getDocumentSymbols(text: string): LspDocumentSymbol[] {
  const { geometry, flow } = parseHecRas(text);
  const symbols: LspDocumentSymbol[] = [];

  if (geometry) {
    for (const r of geometry.reaches) {
      const reachKey = `${r.river},${r.reach}`;
      const csChildren: LspDocumentSymbol[] = [];

      const lines = text.split(/\r?\n/);
      const clampedEnd = (lineIdx: number, fallback: number): number => {
        const lt = lines[Math.min(Math.max(0, lineIdx), Math.max(0, lines.length - 1))] ?? "";
        return lt.length > 0 ? Math.max(1, lt.trimEnd().length) : fallback;
      };

      for (const cs of geometry.crossSections) {
        if (cs.river === r.river && cs.reach === r.reach) {
          const l = Math.max(0, cs.line - 1);
          const endLine = Math.min(l + 5, Math.max(l, lines.length - 1));
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
          const endLine = Math.min(l + 3, Math.max(l, lines.length - 1));
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
      const reachEndLine = Math.min(l + csChildren.length * 5, Math.max(l, lines.length - 1));
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
    const lines = text.split(/\r?\n/);
    for (const bc of flow.boundaryConditions) {
      const l = Math.max(0, bc.line - 1);
      const endLine = Math.min(l + 2, Math.max(l, lines.length - 1));
      const endLineChar = Math.max(1, (lines[endLine] ?? "").trimEnd().length);
      const selChar = Math.max(1, (lines[l] ?? "").trimEnd().length);
      symbols.push({
        name: `BC: ${bc.river} ${bc.reach} Sta ${bc.station}`,
        detail: `${bc.type}${bc.frictionSlope ? ` (S=${bc.frictionSlope})` : ""}`,
        kind: LspSymbolKind.Event,
        range: { start: { line: l, character: 0 }, end: { line: endLine, character: endLineChar } },
        selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: selChar } },
      });
    }
  }

  return symbols;
}

export function getDiagnostics(text: string): LspDiagnostic[] {
  const { geometry, flow } = parseHecRas(text);
  if (!geometry) return [];

  const lines = text.split(/\r?\n/);
  const rawDiags = lintHecRas(geometry, flow);
  return rawDiags.map((d) => {
    const l = Math.min(Math.max(0, d.line - 1), Math.max(0, lines.length - 1));
    const lt = lines[l] ?? "";
    let sChar = 0;
    while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
    const tok = lt.slice(sChar).match(/^[^\s=,;]+/);
    const eChar = Math.min(lt.length, sChar + (tok ? tok[0].length : 1));
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

export function getHecRasHover(text: string, pos: LspPosition): LspHover | null {
  const symbols = getDocumentSymbols(text);
  for (const s of symbols) {
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
