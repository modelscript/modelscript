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

      for (const cs of geometry.crossSections) {
        if (cs.river === r.river && cs.reach === r.reach) {
          const l = Math.max(0, cs.line - 1);
          csChildren.push({
            name: `CS ${cs.station}`,
            detail: cs.description ?? `${cs.stationElevations.length} points, n=${cs.manning.channel}`,
            kind: LspSymbolKind.Struct,
            range: { start: { line: l, character: 0 }, end: { line: l + 5, character: 80 } },
            selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 30 } },
          });
        }
      }

      for (const st of geometry.inlineStructures) {
        if (st.river === r.river && st.reach === r.reach) {
          const l = Math.max(0, st.line - 1);
          csChildren.push({
            name: `Weir ${st.station}`,
            detail: `Crest: ${st.weirCrestElevation} m, L: ${st.weirLength} m`,
            kind: LspSymbolKind.Interface,
            range: { start: { line: l, character: 0 }, end: { line: l + 3, character: 80 } },
            selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 30 } },
          });
        }
      }

      const l = Math.max(0, r.line - 1);
      symbols.push({
        name: `Reach ${reachKey}`,
        detail: `${r.coords.length} centerline coordinates`,
        kind: LspSymbolKind.Namespace,
        range: { start: { line: l, character: 0 }, end: { line: l + csChildren.length * 5, character: 80 } },
        selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 30 } },
        children: csChildren,
      });
    }
  }

  if (flow) {
    for (const bc of flow.boundaryConditions) {
      const l = Math.max(0, bc.line - 1);
      symbols.push({
        name: `BC: ${bc.river} ${bc.reach} Sta ${bc.station}`,
        detail: `${bc.type}${bc.frictionSlope ? ` (S=${bc.frictionSlope})` : ""}`,
        kind: LspSymbolKind.Event,
        range: { start: { line: l, character: 0 }, end: { line: l + 2, character: 80 } },
        selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 40 } },
      });
    }
  }

  return symbols;
}

export function getDiagnostics(text: string): LspDiagnostic[] {
  const { geometry, flow } = parseHecRas(text);
  if (!geometry) return [];

  const rawDiags = lintHecRas(geometry, flow);
  return rawDiags.map((d) => {
    const l = Math.max(0, d.line - 1);
    const sev = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: {
        start: { line: l, character: 0 },
        end: { line: l, character: 80 },
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
