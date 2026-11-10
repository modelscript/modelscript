// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ASPEN OneLiner / CAPE Models.
 */

import { lintOneLinerCase } from "./lints/index.js";
import { parseOneLiner } from "./parser/oneliner-parser.js";
import type { OneLinerCase } from "./types.js";

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
  code?: string | number | undefined;
  source: string;
  message: string;
}

export function getOneLinerDocumentSymbols(content: string): LspDocumentSymbol[] {
  let c: OneLinerCase;
  try {
    c = parseOneLiner(content);
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  const defaultRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, totalLines - 1), character: (lines[totalLines - 1] ?? "").length },
  };

  const rootSymbol: LspDocumentSymbol = {
    name: c.title,
    detail: `ASPEN OneLiner Case (${c.baseMva} MVA, ${c.frequencyHz} Hz)`,
    kind: LspSymbolKind.Package,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: c.title.length } },
    children: [],
  };

  if (c.busses.length > 0) {
    rootSymbol.children?.push({
      name: `Busses (${c.busses.length})`,
      detail: "Substation Nodes",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: c.busses.map((b) => ({
        name: `Bus ${b.id}: ${b.name}`,
        detail: `${b.baseKv} kV`,
        kind: LspSymbolKind.Class,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (c.branches.length > 0) {
    rootSymbol.children?.push({
      name: `Transmission Lines & Branches (${c.branches.length})`,
      detail: "Positive & Zero Sequence Impedances",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: c.branches.map((br) => ({
        name: `${br.id} (${br.bus1} -> ${br.bus2})`,
        detail: `Z1: ${br.z1.r} + j${br.z1.x} | Z0: ${br.z0.r} + j${br.z0.x}`,
        kind: LspSymbolKind.Field,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (c.generators.length > 0) {
    rootSymbol.children?.push({
      name: `Generators (${c.generators.length})`,
      detail: "Subtransient Impedances",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: c.generators.map((g) => ({
        name: `${g.id} @ Bus ${g.busId}`,
        detail: `${g.mvaRating} MVA | X"d: ${g.z1Subtransient.x}`,
        kind: LspSymbolKind.Module,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (c.overcurrentRelays.length > 0) {
    rootSymbol.children?.push({
      name: `Time-Overcurrent Relays (${c.overcurrentRelays.length})`,
      detail: "ANSI 50/51 Curves",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: c.overcurrentRelays.map((oc) => ({
        name: `${oc.id}: ${oc.name}`,
        detail: `Pickup: ${oc.pickupA}A | TD: ${oc.timeDial} | ${oc.curve}`,
        kind: LspSymbolKind.Event,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  return [rootSymbol];
}

export function getOneLinerDiagnostics(content: string): LspDiagnosticItem[] {
  let c: OneLinerCase;
  try {
    c = parseOneLiner(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "OLX1001",
        source: "oneliner-lint",
        message: `OneLiner parse error: ${msg}`,
      },
    ];
  }

  const lints = lintOneLinerCase(c);
  return lints.map((l) => ({
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 80 },
    },
    severity: l.severity === "error" ? 1 : l.severity === "warning" ? 2 : 3,
    code: l.code,
    source: "oneliner-lint",
    message: l.message,
  }));
}
