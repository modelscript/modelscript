// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for SEL Relay Settings.
 */

import { lintSELSettings } from "./lints/index.js";
import { parseSELSettings } from "./parser/sel-parser.js";
import { writeSELAscii } from "./parser/sel-writer.js";
import type { SELRelaySettings } from "./types.js";

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

export function getSELDocumentSymbols(content: string): LspDocumentSymbol[] {
  let settings: SELRelaySettings;
  try {
    settings = parseSELSettings(content);
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
    name: `${settings.relayId} (${settings.relayType})`,
    detail: `Terminal: ${settings.terminalId} (Active Group: ${settings.activeGroup})`,
    kind: LspSymbolKind.Package,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: settings.relayId.length } },
    children: [],
  };

  // Groups
  for (const [gNum, group] of settings.groups.entries()) {
    const groupSymbol: LspDocumentSymbol = {
      name: `Settings Group ${gNum}`,
      detail: `Equations: ${Object.keys(group.equations).length}`,
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: [],
    };

    if (group.phaseOvercurrent) {
      const po = group.phaseOvercurrent;
      groupSymbol.children?.push({
        name: "Phase Overcurrent (50P/51P)",
        detail: `50P1P: ${po.inst50P1P ?? "OFF"}A, 51P1P: ${po.time51P1P ?? "OFF"}A (${po.curve51P1C ?? "U3"} TD=${po.timeDial51P1TD ?? 1})`,
        kind: LspSymbolKind.Property,
        range: defaultRange,
        selectionRange: defaultRange,
      });
    }

    if (group.distance) {
      const dist = group.distance;
      groupSymbol.children?.push({
        name: "Distance Elements (Z1P/Z2P/Z3P)",
        detail: `Z1P: ${dist.zone1Reach ?? "OFF"}Ω, Z2P: ${dist.zone2Reach ?? "OFF"}Ω, Z3P: ${dist.zone3Reach ?? "OFF"}Ω`,
        kind: LspSymbolKind.Property,
        range: defaultRange,
        selectionRange: defaultRange,
      });
    }

    if (Object.keys(group.equations).length > 0) {
      const eqFolder: LspDocumentSymbol = {
        name: `SELogic Equations (${Object.keys(group.equations).length})`,
        detail: "Control and Protection Logic",
        kind: LspSymbolKind.Class,
        range: defaultRange,
        selectionRange: defaultRange,
        children: Object.entries(group.equations).map(([tgt, expr]) => ({
          name: `${tgt} = ${expr}`,
          detail: "SELogic Equation",
          kind: LspSymbolKind.Function,
          range: defaultRange,
          selectionRange: defaultRange,
        })),
      };
      groupSymbol.children?.push(eqFolder);
    }

    rootSymbol.children?.push(groupSymbol);
  }

  return [rootSymbol];
}

export function getSELDiagnostics(content: string): LspDiagnosticItem[] {
  let settings: SELRelaySettings;
  try {
    settings = parseSELSettings(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "SEL1001",
        source: "sel-lsp",
        message: `Parse error: ${msg}`,
      },
    ];
  }

  const lints = lintSELSettings(settings);
  const lines = content.split(/\r?\n/);

  return lints.map((lint) => {
    let lineIdx = 0;
    if (lint.field) {
      for (let i = 0; i < lines.length; i++) {
        if ((lines[i] ?? "").toUpperCase().includes(lint.field.toUpperCase())) {
          lineIdx = i;
          break;
        }
      }
    }

    const currentLine = lines[lineIdx] ?? "";
    const severityMap: Record<string, 1 | 2 | 3> = {
      error: 1,
      warning: 2,
      info: 3,
    };

    return {
      range: {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: currentLine.length },
      },
      severity: severityMap[lint.severity] ?? 1,
      code: lint.code,
      source: "sel-lint",
      message: lint.message,
    };
  });
}

export function formatSELDocument(content: string): string {
  const settings = parseSELSettings(content);
  return writeSELAscii(settings);
}
