// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintOpenAdr } from "./lints/rules.js";
import { parseOpenAdr } from "./parser/openadr-parser.js";

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
  const deck = parseOpenAdr(text);
  const symbols: LspDocumentSymbol[] = [];

  for (const prog of deck.programs) {
    const l = Math.max(0, prog.line - 1);
    const evtChildren: LspDocumentSymbol[] = [];

    for (const evt of prog.events) {
      const el = Math.max(0, evt.line - 1);
      const itChildren: LspDocumentSymbol[] = [];

      for (const it of evt.intervals) {
        const il = Math.max(0, it.line - 1);
        itChildren.push({
          name: `Interval (${it.durationSeconds}s)`,
          detail: `Payload: ${it.payload} (${evt.signalType})`,
          kind: LspSymbolKind.Event,
          range: { start: { line: il, character: 0 }, end: { line: il + 3, character: 80 } },
          selectionRange: { start: { line: il, character: 0 }, end: { line: il, character: 30 } },
        });
      }

      evtChildren.push({
        name: `Event ${evt.id}`,
        detail: `Status: ${evt.status}, Target: ${evt.targetVenId || "All"}`,
        kind: LspSymbolKind.Module,
        range: { start: { line: el, character: 0 }, end: { line: el + 5, character: 80 } },
        selectionRange: { start: { line: el, character: 0 }, end: { line: el, character: 20 } },
        children: itChildren,
      });
    }

    symbols.push({
      name: `Program ${prog.name || prog.id}`,
      detail: `${prog.events.length} DR Events`,
      kind: LspSymbolKind.Namespace,
      range: { start: { line: l, character: 0 }, end: { line: l + 15, character: 80 } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 30 } },
      children: evtChildren,
    });
  }

  return symbols;
}

export function getDiagnostics(text: string): LspDiagnostic[] {
  const deck = parseOpenAdr(text);
  const raw = lintOpenAdr(deck);

  return raw.map((d) => {
    const l = Math.max(0, d.line - 1);
    const sev = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
    return {
      range: {
        start: { line: l, character: 0 },
        end: { line: l, character: 80 },
      },
      severity: sev,
      code: d.code,
      source: "openadr",
      message: `[M${d.code}] ${d.message}`,
    };
  });
}

export const getOpenAdrDocumentSymbols = getDocumentSymbols;
export const validateOpenAdr = getDiagnostics;

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export function getOpenAdrHover(text: string, pos: LspPosition): LspHover | null {
  const symbols = getDocumentSymbols(text);
  for (const s of symbols) {
    if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
      return {
        contents: {
          kind: "markdown",
          value: `**OpenADR ${s.name}**\n\n${s.detail ?? ""}`,
        },
        range: s.range,
      };
    }
  }
  return null;
}
