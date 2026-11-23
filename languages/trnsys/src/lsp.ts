// SPDX-License-Identifier: AGPL-3.0-or-later

import { TRNSYS_MODEL_SPECS, getTrnsysTypeSpec } from "./catalog/index.js";
import { lintTrnsysDeck } from "./lints/index.js";
import { parseTrnsysDeck } from "./parser/deck-parser.js";

export interface TrnsysLspPosition {
  line: number;
  character: number;
}

export interface TrnsysLspRange {
  start: TrnsysLspPosition;
  end: TrnsysLspPosition;
}

export enum TrnsysLspSymbolKind {
  Package = 4,
  Class = 5,
  Variable = 13,
  Constant = 14,
}

export interface TrnsysLspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: TrnsysLspSymbolKind;
  range: TrnsysLspRange;
  selectionRange: TrnsysLspRange;
  children?: TrnsysLspDocumentSymbol[] | undefined;
}

export interface TrnsysLspDiagnostic {
  range: TrnsysLspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface TrnsysLspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: TrnsysLspRange | undefined;
}

export interface TrnsysLspCompletionItem {
  label: string;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const CONTROL_CARDS: Array<{ label: string; detail: string; insertText: string }> = [
  { label: "VERSION", detail: "TRNSYS deck version header", insertText: "VERSION 18" },
  { label: "SIMULATION", detail: "Simulation start, stop, and timestep (hours)", insertText: "SIMULATION 0 24 0.25" },
  { label: "TOLERANCES", detail: "Integration and convergence tolerances", insertText: "TOLERANCES 0.001 0.001" },
  { label: "LIMITS", detail: "Max iterations, warnings, and trace limit", insertText: "LIMITS 30 30 30" },
  { label: "DFQ", detail: "Differential equation solver method (1=Modified Euler)", insertText: "DFQ 1" },
  { label: "WIDTH", detail: "Output line width", insertText: "WIDTH 80" },
  { label: "LIST", detail: "Enable listing output", insertText: "LIST" },
  { label: "NOLIST", detail: "Suppress listing output", insertText: "NOLIST" },
  { label: "MAP", detail: "Print component connection map", insertText: "MAP" },
  { label: "CONSTANTS", detail: "Declare constant parameters", insertText: "CONSTANTS 1\n" },
  { label: "EQUATIONS", detail: "Declare algebraic equations", insertText: "EQUATIONS 1\n" },
  { label: "UNIT", detail: "Declare a TRNSYS component instance", insertText: "UNIT 1 TYPE 1" },
  { label: "PARAMETERS", detail: "Component parameter block", insertText: "PARAMETERS 4\n" },
  { label: "INPUTS", detail: "Component input connection block", insertText: "INPUTS 4\n" },
  { label: "DERIVATIVES", detail: "Initial values of differential states", insertText: "DERIVATIVES 1\n" },
  { label: "ASSIGN", detail: "Assign external file to logical unit", insertText: 'ASSIGN "output.out" 30' },
  { label: "END", detail: "Terminate TRNSYS simulation deck", insertText: "END" },
];

/**
 * Validates a TRNSYS `.dck` file and returns LSP-compatible diagnostics.
 */
export function validateTrnsys(content: string, uri: string = "deck.dck"): TrnsysLspDiagnostic[] {
  const deckName =
    uri
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "TrnsysDeck";
  const deck = parseTrnsysDeck(content, deckName);
  const diags = lintTrnsysDeck(deck);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, Math.min(lines.length - 1, d.line - 1));
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, d.column - 1);
    const endChar = Math.max(startChar + 1, lineText.length);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-trnsys",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (constants, equations, UNIT blocks) from a TRNSYS deck.
 */
export function getTrnsysDocumentSymbols(content: string): TrnsysLspDocumentSymbol[] {
  const deck = parseTrnsysDeck(content);
  const symbols: TrnsysLspDocumentSymbol[] = [];

  for (const c of deck.constants) {
    const ln = Math.max(0, c.line - 1);
    const range: TrnsysLspRange = { start: { line: ln, character: 0 }, end: { line: ln, character: c.name.length } };
    symbols.push({
      name: c.name,
      detail: c.value !== undefined ? `= ${c.value}` : `= ${c.expression}`,
      kind: TrnsysLspSymbolKind.Constant,
      range,
      selectionRange: range,
    });
  }

  for (const block of deck.equationBlocks) {
    for (const eq of block.equations) {
      const ln = Math.max(0, eq.line - 1);
      const range: TrnsysLspRange = { start: { line: ln, character: 0 }, end: { line: ln, character: eq.name.length } };
      symbols.push({
        name: eq.name,
        detail: `= ${eq.expression}`,
        kind: TrnsysLspSymbolKind.Variable,
        range,
        selectionRange: range,
      });
    }
  }

  for (const u of deck.units) {
    const ln = Math.max(0, u.line - 1);
    const spec = getTrnsysTypeSpec(u.typeNumber);
    const range: TrnsysLspRange = { start: { line: ln, character: 0 }, end: { line: ln, character: 20 } };
    symbols.push({
      name: `UNIT ${u.unitNumber} TYPE ${u.typeNumber}`,
      detail: u.label ?? spec?.label,
      kind: TrnsysLspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

/**
 * Provides hover documentation for TRNSYS control cards, `UNIT n TYPE m` declarations, and `unit,output` connections.
 */
export function getTrnsysHover(content: string, position: TrnsysLspPosition): TrnsysLspHover | null {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line];
  if (!line) return null;

  const unitTypeMatch = line.match(/\bUNIT\s+(\d+)\s+TYPE\s+(\d+)/i);
  if (unitTypeMatch) {
    const unitNum = Number(unitTypeMatch[1]!);
    const typeNum = Number(unitTypeMatch[2]!);
    const spec = getTrnsysTypeSpec(typeNum);
    if (spec) {
      const paramDocs = spec.params.map(([k, v, u]) => `- \`${k}\` = ${v}${u ? ` (${u})` : ""}`).join("\n");
      return {
        contents: {
          kind: "markdown",
          value: `### UNIT ${unitNum} — ${spec.label}\n\n${spec.description}\n\n**Inputs:** ${spec.numInputs} | **Outputs:** ${spec.numOutputs}\n\n**Parameters:**\n${paramDocs}`,
        },
      };
    }
    return {
      contents: {
        kind: "markdown",
        value: `### UNIT ${unitNum} TYPE ${typeNum}\n\nTRNSYS component instance.`,
      },
    };
  }

  // Check control card keyword at start of line
  const kwMatch = line.trim().match(/^([A-Z]+)/i);
  if (kwMatch) {
    const kw = kwMatch[1]!.toUpperCase();
    const card = CONTROL_CARDS.find((c) => c.label === kw);
    if (card) {
      return {
        contents: {
          kind: "markdown",
          value: `**${card.label}** — ${card.detail}`,
        },
      };
    }
  }

  return null;
}

/**
 * Returns TRNSYS control card and standard Type completion items.
 */
export function getTrnsysCompletions(prefix: string = ""): TrnsysLspCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  const items: TrnsysLspCompletionItem[] = [
    ...CONTROL_CARDS.map((c) => ({
      label: c.label,
      detail: c.detail,
      insertText: c.insertText,
    })),
    ...TRNSYS_MODEL_SPECS.map((s) => ({
      label: `TYPE ${s.typeNumber}`,
      detail: s.label,
      documentation: s.description,
      insertText: `TYPE ${s.typeNumber}`,
    })),
  ];

  if (!upper) return items;
  return items.filter((item) => item.label.toUpperCase().startsWith(upper));
}
