// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintIeeeCdf } from "./lints/index.js";
import { parseIeeeCdf } from "./parser/ieee-cdf-parser.js";

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
  Property = 7,
  Field = 8,
  Variable = 13,
  Constant = 14,
  Struct = 23,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail: string;
  documentation?: string;
  insertText?: string;
}

const BUS_TYPE_LABELS: Record<number, string> = {
  0: "Type 0 — PQ Unregulated Load Bus",
  1: "Type 1 — PQ Hold MVAR Limits Bus",
  2: "Type 2 — PV Voltage-Controlled Generator Bus",
  3: "Type 3 — Slack / Swing Reference Bus",
};

const BRANCH_TYPE_LABELS: Record<number, string> = {
  0: "Type 0 — Transmission Line",
  1: "Type 1 — Fixed Tap Transformer",
  2: "Type 2 — Variable Tap Transformer (Voltage Control)",
  3: "Type 3 — Variable Tap Transformer (MVAR Control)",
  4: "Type 4 — Phase-Shifting Transformer",
};

/**
 * Validates an IEEE CDF / BPA IPF document and returns LSP diagnostics.
 */
export function validateIeeeCdf(content: string, _uri = "network.cdf"): LspDiagnostic[] {
  const network = parseIeeeCdf(content);
  const diags = lintIeeeCdf(network);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = d.line ? Math.max(0, Math.min(lines.length - 1, d.line - 1)) : 0;
    const lineText = lines[lineIdx] ?? "";
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endChar = Math.max(startChar + 1, lineText.length);

    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-ieee-cdf",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols (Network -> Buses & Branches) for an IEEE CDF / BPA IPF file.
 */
export function getIeeeCdfDocumentSymbols(content: string): LspDocumentSymbol[] {
  const network = parseIeeeCdf(content);
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: (lines[lastLine] ?? "").length },
  };

  const busChildren: LspDocumentSymbol[] = network.buses.map((b) => {
    const lineIdx = Math.max(0, (b.line ?? 1) - 1);
    const len = (lines[lineIdx] ?? "").length;
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: Math.max(1, len) },
    };
    return {
      name: `Bus ${b.busNumber} (${b.name})`,
      detail: `${BUS_TYPE_LABELS[b.type] ?? `Type ${b.type}`}, V=${b.finalVoltagePu.toFixed(3)} pu`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    };
  });

  const branchChildren: LspDocumentSymbol[] = network.branches.map((br) => {
    const lineIdx = Math.max(0, (br.line ?? 1) - 1);
    const len = (lines[lineIdx] ?? "").length;
    const range: LspRange = {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: Math.max(1, len) },
    };
    return {
      name: `Branch ${br.fromBus}-${br.toBus} (ckt ${br.circuit})`,
      detail: `R=${br.r.toFixed(4)}, X=${br.x.toFixed(4)}, B=${br.b.toFixed(4)}`,
      kind: LspSymbolKind.Field,
      range,
      selectionRange: range,
    };
  });

  return [
    {
      name: network.title.caseId || "IEEE CDF Network",
      detail: `${network.format.toUpperCase()} | Base ${network.title.mvaBase} MVA | ${network.buses.length} buses, ${network.branches.length} branches`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.max(1, (lines[0] ?? "").length) },
      },
      children: [...busChildren, ...branchChildren],
    },
  ];
}

/**
 * Returns Markdown hover information for the line/position in an IEEE CDF / BPA IPF document.
 */
export function getIeeeCdfHover(content: string, position: LspPosition): LspHover | null {
  const network = parseIeeeCdf(content);
  const targetLine = position.line + 1;
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line] ?? "";

  if (/^\s*BUS\s+DATA\s+FOLLOWS/i.test(lineText)) {
    return {
      contents: {
        kind: "markdown",
        value: `**BUS DATA FOLLOWS** (IEEE CDF 1973)\n\nBegins nodal bus records terminated by \`-999\`. Bus types: \`0\`/\`1\` PQ, \`2\` PV, \`3\` Slack.`,
      },
    };
  }
  if (/^\s*BRANCH\s+DATA\s+FOLLOWS/i.test(lineText)) {
    return {
      contents: {
        kind: "markdown",
        value: `**BRANCH DATA FOLLOWS** (IEEE CDF 1973)\n\nBegins transmission line and transformer records terminated by \`-999\`.`,
      },
    };
  }

  const bus = network.buses.find((b) => b.line === targetLine);
  if (bus) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### Bus ${bus.busNumber}: \`${bus.name}\``,
          `- **Classification**: ${BUS_TYPE_LABELS[bus.type] ?? bus.type}`,
          `- **Voltage**: \`${bus.finalVoltagePu.toFixed(4)} pu ∠ ${bus.finalAngleDeg.toFixed(2)}°\` (Base: \`${bus.baseKv} kV\`)`,
          `- **Load**: \`${bus.loadMw.toFixed(2)} MW\`, \`${bus.loadMvar.toFixed(2)} MVAR\``,
          `- **Generation**: \`${bus.genMw.toFixed(2)} MW\`, \`${bus.genMvar.toFixed(2)} MVAR\` (Q limits: \`[${bus.minMvarOrVolt}, ${bus.maxMvarOrVolt}] MVAR\`)`,
          `- **Shunt**: \`G=${bus.shuntG} pu\`, \`B=${bus.shuntB} pu\``,
        ].join("\n"),
      },
    };
  }

  const branch = network.branches.find((br) => br.line === targetLine);
  if (branch) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### Branch ${branch.fromBus} → ${branch.toBus} (Circuit \`${branch.circuit}\`)`,
          `- **Type**: ${BRANCH_TYPE_LABELS[branch.type] ?? branch.type}`,
          `- **Impedance**: \`R = ${branch.r.toFixed(6)} pu\`, \`X = ${branch.x.toFixed(6)} pu\`, \`B = ${branch.b.toFixed(6)} pu\``,
          `- **Tap / Phase Shift**: \`a = ${branch.tapRatio > 0 ? branch.tapRatio.toFixed(4) : "1.0000"}\`, \`φ = ${branch.phaseShiftDeg.toFixed(2)}°\``,
        ].join("\n"),
      },
    };
  }

  return null;
}

/**
 * Returns completion items for IEEE CDF section headers and BPA IPF card types.
 */
export function getIeeeCdfCompletions(): LspCompletionItem[] {
  return [
    { label: "BUS DATA FOLLOWS", kind: 14, detail: "IEEE CDF bus data section header" },
    { label: "BRANCH DATA FOLLOWS", kind: 14, detail: "IEEE CDF branch data section header" },
    { label: "LOSS ZONES FOLLOWS", kind: 14, detail: "IEEE CDF loss zones section header" },
    { label: "INTERCHANGE DATA FOLLOWS", kind: 14, detail: "IEEE CDF area interchange section header" },
    { label: "TIE LINES FOLLOWS", kind: 14, detail: "IEEE CDF tie lines section header" },
    { label: "END OF DATA", kind: 14, detail: "IEEE CDF end-of-deck terminator" },
    { label: "BS", kind: 14, detail: "BPA IPF Slack / Swing bus card" },
    { label: "BQ", kind: 14, detail: "BPA IPF PV generator bus card" },
    { label: "BE", kind: 14, detail: "BPA IPF voltage-controlled bus card" },
    { label: "B ", kind: 14, detail: "BPA IPF PQ load bus card" },
    { label: "L ", kind: 14, detail: "BPA IPF transmission line card" },
    { label: "T ", kind: 14, detail: "BPA IPF transformer card" },
    { label: "E ", kind: 14, detail: "BPA IPF equivalent pi branch card" },
    { label: "R ", kind: 14, detail: "BPA IPF LTC regulator card" },
  ];
}
