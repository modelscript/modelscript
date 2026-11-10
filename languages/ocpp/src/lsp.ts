// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintOcpp } from "./lints/rules.js";
import { parseOcpp } from "./parser/ocpp-parser.js";

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
  const net = parseOcpp(text);
  const symbols: LspDocumentSymbol[] = [];

  for (const st of net.stations) {
    const l = Math.max(0, st.line - 1);
    const evseChildren: LspDocumentSymbol[] = [];

    for (const e of st.evses) {
      const el = Math.max(0, e.line - 1);
      const connChildren: LspDocumentSymbol[] = [];

      for (const c of e.connectors) {
        const cl = Math.max(0, c.line - 1);
        const sessionDetail = c.currentSession
          ? `Tx ${c.currentSession.transactionId} [${Math.round(c.currentSession.currentSoC * 100)}% -> ${Math.round(c.currentSession.targetSoC * 100)}%]`
          : c.status;

        connChildren.push({
          name: `Connector ${c.id} (${c.type})`,
          detail: `${c.maxPowerKW} kW — ${sessionDetail}`,
          kind: LspSymbolKind.Struct,
          range: { start: { line: cl, character: 0 }, end: { line: cl + 3, character: 80 } },
          selectionRange: { start: { line: cl, character: 0 }, end: { line: cl, character: 30 } },
        });
      }

      evseChildren.push({
        name: `EVSE ${e.id}`,
        detail: `${e.connectors.length} connectors`,
        kind: LspSymbolKind.Module,
        range: { start: { line: el, character: 0 }, end: { line: el + 5, character: 80 } },
        selectionRange: { start: { line: el, character: 0 }, end: { line: el, character: 20 } },
        children: connChildren,
      });
    }

    symbols.push({
      name: `Station ${st.id}`,
      detail: `${st.gridLimitKW} kW Grid Limit, ${st.evses.length} EVSEs`,
      kind: LspSymbolKind.Namespace,
      range: { start: { line: l, character: 0 }, end: { line: l + 15, character: 80 } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 30 } },
      children: evseChildren,
    });
  }

  return symbols;
}

export function getDiagnostics(text: string): LspDiagnostic[] {
  const net = parseOcpp(text);
  const raw = lintOcpp(net);

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
      source: "ocpp",
      message: `[M${d.code}] ${d.message}`,
    };
  });
}

export const getOcppDocumentSymbols = getDocumentSymbols;
export const validateOcpp = getDiagnostics;

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export function getOcppHover(text: string, pos: LspPosition): LspHover | null {
  const symbols = getDocumentSymbols(text);
  for (const s of symbols) {
    if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
      return {
        contents: {
          kind: "markdown",
          value: `**OCPP ${s.name}**\n\n${s.detail ?? ""}`,
        },
        range: s.range,
      };
    }
  }
  return null;
}
