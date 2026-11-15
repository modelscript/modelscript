// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for MATPOWER (.m).
 */

import { lintMatpowerCase } from "./lints/index.js";
import { parseMatpowerCase } from "./parser/matpower-parser.js";

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
 * Generates document symbols for outline navigation in IDEs.
 */
export function getDocumentSymbols(text: string): LspDocumentSymbol[] {
  const mpc = parseMatpowerCase(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(1, text.split("\n").length), character: 0 },
  };

  const lines = text.split(/\r?\n/);
  const clampedRange = (idx: number, labelLen: number): LspRange => {
    const line = Math.min(idx, Math.max(0, lines.length - 1));
    const endChar = Math.max(1, (lines[line] ?? "").trimEnd().length || labelLen);
    return { start: { line, character: 0 }, end: { line, character: endChar } };
  };

  // Bus section
  const busChildren: LspDocumentSymbol[] = mpc.bus.map((b, idx) => {
    const label = b.name ?? `Bus ${b.bus_i}`;
    const r = clampedRange(idx + 5, label.length);
    return {
      name: label,
      detail: `Type ${b.type}, V=${b.vm.toFixed(3)} p.u., P=${b.pd} MW, Q=${b.qd} MVAr`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: {
        start: r.start,
        end: { line: r.start.line, character: Math.min(r.end.character, label.length) },
      },
    };
  });

  symbols.push({
    name: "Buses",
    detail: `${mpc.bus.length} buses`,
    kind: LspSymbolKind.Namespace,
    range: rootRange,
    selectionRange: rootRange,
    children: busChildren,
  });

  // Generator section
  const genChildren: LspDocumentSymbol[] = mpc.gen.map((g, idx) => {
    const label = `Gen @ Bus ${g.bus}`;
    const r = clampedRange(idx + 10, label.length);
    return {
      name: label,
      detail: `Pg=${g.pg} MW, Qg=${g.qg} MVAr, Vg=${g.vg} p.u., Stat=${g.status}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: {
        start: r.start,
        end: { line: r.start.line, character: Math.min(r.end.character, label.length) },
      },
    };
  });

  symbols.push({
    name: "Generators",
    detail: `${mpc.gen.length} generators`,
    kind: LspSymbolKind.Namespace,
    range: rootRange,
    selectionRange: rootRange,
    children: genChildren,
  });

  // Branch section
  const branchChildren: LspDocumentSymbol[] = mpc.branch.map((br, idx) => {
    const label = `Branch ${br.fbus} -> ${br.tbus}`;
    const r = clampedRange(idx + 15, label.length);
    return {
      name: label,
      detail: `R=${br.r.toFixed(4)}, X=${br.x.toFixed(4)}, RateA=${br.rateA} MVA, Stat=${br.status}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: {
        start: r.start,
        end: { line: r.start.line, character: Math.min(r.end.character, label.length) },
      },
    };
  });

  symbols.push({
    name: "Branches",
    detail: `${mpc.branch.length} branches`,
    kind: LspSymbolKind.Namespace,
    range: rootRange,
    selectionRange: rootRange,
    children: branchChildren,
  });

  return symbols;
}

/**
 * Computes linter diagnostics formatted for LSP.
 */
export function getDiagnostics(text: string): LspDiagnosticItem[] {
  const mpc = parseMatpowerCase(text);
  const lines = text.split(/\r?\n/);
  const lt = lines[0] ?? "";
  let sChar = 0;
  while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
  const tok = lt.slice(sChar).match(/^[^\s;:,]+/);
  const eChar = Math.min(lt.length, sChar + (tok ? tok[0].length : 1));
  const diags = lintMatpowerCase(mpc);

  return diags.map((d) => ({
    range: {
      start: { line: 0, character: sChar },
      end: { line: 0, character: eChar },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    message: d.message,
    source: "matpower-linter",
  }));
}
