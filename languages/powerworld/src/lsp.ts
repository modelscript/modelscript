// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for PowerWorld (.aux) Files.
 */

import { lintPowerWorldAux } from "./lints/index.js";
import { parsePowerWorldAux } from "./parser/powerworld-parser.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  Package = 4,
  Namespace = 3,
  Function = 12,
  Object = 19,
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
  code?: string | undefined;
  source: string;
  message: string;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail: string;
  insertText?: string | undefined;
}

export function getPowerWorldDocumentSymbols(content: string): LspDocumentSymbol[] {
  const model = parsePowerWorldAux(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const sec of model.dataSections) {
    const r: LspRange = {
      start: { line: Math.max(0, sec.span.line - 1), character: Math.max(0, sec.span.column - 1) },
      end: { line: Math.max(0, sec.span.endLine - 1), character: Math.max(0, sec.span.endColumn - 1) },
    };
    symbols.push({
      name: `DATA (${sec.objectType})`,
      detail: `${sec.rows.length} rows`,
      kind: LspSymbolKind.Namespace,
      range: r,
      selectionRange: r,
    });
  }

  for (const script of model.scriptBlocks) {
    const r: LspRange = {
      start: { line: Math.max(0, script.span.line - 1), character: Math.max(0, script.span.column - 1) },
      end: { line: Math.max(0, script.span.endLine - 1), character: Math.max(0, script.span.endColumn - 1) },
    };
    symbols.push({
      name: "SCRIPT",
      detail: `${script.commands.length} commands`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getPowerWorldDiagnostics(content: string): LspDiagnosticItem[] {
  const model = parsePowerWorldAux(content);
  return lintPowerWorldAux(model).map((d) => ({
    range: {
      start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) },
      end: { line: Math.max(0, d.endLine - 1), character: Math.max(0, d.endColumn - 1) },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "powerworld",
    message: d.message,
  }));
}

export function getPowerWorldCompletions(): LspCompletionItem[] {
  return [
    {
      label: "DATA (Bus, [...])",
      kind: 14,
      detail: "PowerWorld Bus data section",
      insertText:
        'DATA (Bus, [BusNum, BusName, BusNomVolt, BusPUVolt, BusAngle, BusSlack])\n{\n  1 "SlackBus" 138.0 1.0 0.0 YES\n}',
    },
    {
      label: "DATA (Branch, [...])",
      kind: 14,
      detail: "PowerWorld Branch data section",
      insertText:
        'DATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineR, LineX, LineC, LineAMVA])\n{\n  1 2 "1" 0.01 0.05 0.0 100.0\n}',
    },
    {
      label: "SCRIPT",
      kind: 3,
      detail: "PowerWorld automation script block",
      insertText: "SCRIPT\n{\n  EnterMode(RUN);\n  SolvePowerFlow(RECTNEWT);\n}",
    },
  ];
}
