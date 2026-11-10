// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for ATP-EMTP decks.
 */

import { lintAtpCase } from "./lints/index.js";
import { parseAtp } from "./parser/atp-parser.js";
import type { AtpCase } from "./types.js";

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

export function getAtpDocumentSymbols(content: string, _uri?: string): LspDocumentSymbol[] {
  let atpCase: AtpCase;
  try {
    atpCase = parseAtp(content);
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
    name: atpCase.title,
    detail: `ATP-EMTP Deck (dt=${atpCase.control.deltaTSec}s, Tmax=${atpCase.control.tMaxSec}s)`,
    kind: LspSymbolKind.Package,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: atpCase.title.length } },
    children: [],
  };

  if (atpCase.branches.length > 0) {
    rootSymbol.children?.push({
      name: `Branches (${atpCase.branches.length})`,
      detail: "RLC and Transmission Line Branches",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: atpCase.branches.map((b) => ({
        name: `${b.node1} -> ${b.node2}`,
        detail: `R: ${b.rOhms}Ω, L: ${b.lMh}mH, C: ${b.cUf}μF`,
        kind: LspSymbolKind.Field,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (atpCase.switches.length > 0) {
    rootSymbol.children?.push({
      name: `Switches (${atpCase.switches.length})`,
      detail: "Time-Controlled Breakers",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: atpCase.switches.map((s) => ({
        name: `${s.node1} -> ${s.node2}`,
        detail: `Close: ${s.tCloseSec}s, Open: ${s.tOpenSec}s`,
        kind: LspSymbolKind.Event,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (atpCase.sources.length > 0) {
    rootSymbol.children?.push({
      name: `Sources (${atpCase.sources.length})`,
      detail: "AC/DC Injections",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: atpCase.sources.map((s) => ({
        name: `Node ${s.node}`,
        detail: `Type ${s.typeCode}: ${s.amplitude}V @ ${s.frequencyHz}Hz`,
        kind: LspSymbolKind.Variable,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  return [rootSymbol];
}

export function getAtpDiagnostics(content: string, _uri?: string): LspDiagnosticItem[] {
  let atpCase: AtpCase;
  try {
    atpCase = parseAtp(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "ATP1001",
        source: "atp-lint",
        message: `ATP parse error: ${msg}`,
      },
    ];
  }

  const lints = lintAtpCase(atpCase);
  return lints.map((l) => ({
    range: {
      start: { line: l.elementIndex !== undefined ? Math.min(l.elementIndex, 500) : 0, character: 0 },
      end: { line: l.elementIndex !== undefined ? Math.min(l.elementIndex, 500) : 0, character: 80 },
    },
    severity: l.severity === "error" ? 1 : l.severity === "warning" ? 2 : 3,
    code: l.code,
    source: "atp-lint",
    message: l.message,
  }));
}
