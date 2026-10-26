// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Language Server Protocol (LSP) Service Integration.
 *
 * Implements real-time diagnostic reporting, document symbol hierarchy,
 * and hover documentation for SPICE analog netlists (.cir, .sp, .net, .lib).
 */

import { lintSpiceCircuit } from "./lints/rules.js";
import { parseSpice } from "./parser/spice-parser.js";
import type { SpiceCircuit } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code?: string | number | undefined;
  source: string;
  message: string;
  data?: unknown;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

/**
 * Validates a SPICE document and returns LSP diagnostics.
 */
export function validateSpice(content: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  let circuit: SpiceCircuit;

  try {
    circuit = parseSpice(content);
  } catch (err: any) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      source: "spice-parser",
      message: `Fatal SPICE parse error: ${err.message}`,
    });
    return diagnostics;
  }

  const spiceDiags = lintSpiceCircuit(circuit);
  for (const d of spiceDiags) {
    const startLine = Math.max(0, (d.span?.startLine ?? 1) - 1);
    const endLine = Math.max(0, (d.span?.endLine ?? 1) - 1);
    const startCol = Math.max(0, (d.span?.startCol ?? 1) - 1);
    const endCol = Math.max(startCol, (d.span?.endCol ?? 10) - 1);

    diagnostics.push({
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: `M${d.code}`,
      source: "modelscript-spice",
      message: d.message,
      data: d.quickFix,
    });
  }

  return diagnostics;
}

/**
 * Computes the hierarchical document symbol tree for outline and breadcrumb views.
 */
export function getSpiceDocumentSymbols(content: string): LspDocumentSymbol[] {
  let circuit: SpiceCircuit;
  try {
    circuit = parseSpice(content);
  } catch {
    return [];
  }

  const rawLines = content.split("\n");
  const lastLine = Math.max(0, rawLines.length - 1);
  const lastCol = rawLines[lastLine]?.length ?? 0;

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lastCol },
  };

  const children: LspDocumentSymbol[] = [];

  // 1. Subcircuits
  for (const sub of circuit.subcircuits.values()) {
    const sLine = Math.max(0, (sub.span?.startLine ?? 1) - 1);
    const eLine = Math.max(sLine, (sub.span?.endLine ?? 1) - 1);
    const range: LspRange = {
      start: { line: sLine, character: 0 },
      end: { line: eLine, character: sub.span?.endCol ?? 20 },
    };

    const subChildren: LspDocumentSymbol[] = [];
    for (const comp of sub.components) {
      const cLine = Math.max(0, (comp.span?.startLine ?? sLine + 1) - 1);
      subChildren.push({
        name: comp.name,
        detail: `${comp.kind} [${comp.nodes.join(", ")}]`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: cLine, character: 0 },
          end: { line: cLine, character: comp.rawLine?.length ?? 20 },
        },
        selectionRange: {
          start: { line: cLine, character: 0 },
          end: { line: cLine, character: comp.name.length },
        },
      });
    }

    children.push({
      name: `.SUBCKT ${sub.name}`,
      detail: `(${sub.ports.join(", ")})`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
      children: subChildren,
    });
  }

  // 2. Models
  for (const model of circuit.models.values()) {
    const sLine = Math.max(0, (model.span?.startLine ?? 1) - 1);
    const range: LspRange = {
      start: { line: sLine, character: 0 },
      end: { line: sLine, character: model.span?.endCol ?? 30 },
    };
    children.push({
      name: `.MODEL ${model.name}`,
      detail: model.type,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  // 3. Components
  for (const comp of circuit.components) {
    const sLine = Math.max(0, (comp.span?.startLine ?? 1) - 1);
    const range: LspRange = {
      start: { line: sLine, character: 0 },
      end: { line: sLine, character: comp.rawLine?.length ?? 30 },
    };
    children.push({
      name: comp.name,
      detail: `${comp.kind} [${comp.nodes.join(", ")}] ${comp.value !== undefined ? comp.value : (comp.model ?? "")}`,
      kind: comp.kind === "X" ? LspSymbolKind.Interface : LspSymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  return [
    {
      name: circuit.title || "SPICE Netlist",
      detail: `${circuit.components.length} components`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

/**
 * Computes hover information at cursor offset.
 */
export function getSpiceHover(content: string, line: number, _character: number): LspHover | null {
  let circuit: SpiceCircuit;
  try {
    circuit = parseSpice(content);
  } catch {
    return null;
  }

  const targetLine = line + 1; // 1-based

  // Check components
  for (const comp of circuit.components) {
    if (comp.span && targetLine >= comp.span.startLine && targetLine <= comp.span.endLine) {
      let doc = `### SPICE Component \`${comp.name}\` (${comp.kind})\n\n`;
      doc += `- **Nodes**: \`${comp.nodes.join(", ")}\`\n`;
      if (comp.value !== undefined) {
        doc += `- **Nominal Value**: \`${comp.value}\`\n`;
      }
      if (comp.model) {
        doc += `- **Model**: \`${comp.model}\`\n`;
      }
      if (comp.subcktName) {
        doc += `- **Subcircuit**: \`${comp.subcktName}\`\n`;
      }
      if (comp.sourceSpec) {
        if (comp.sourceSpec.dc !== undefined) doc += `- **DC Value**: \`${comp.sourceSpec.dc} V/A\`\n`;
        if (comp.sourceSpec.acMag !== undefined) doc += `- **AC Mag**: \`${comp.sourceSpec.acMag}\`\n`;
        if (comp.sourceSpec.waveform) doc += `- **Waveform**: \`${comp.sourceSpec.waveform.kind}\`\n`;
      }
      return {
        contents: {
          kind: "markdown",
          value: doc,
        },
      };
    }
  }

  // Check subcircuits
  for (const sub of circuit.subcircuits.values()) {
    if (sub.span && targetLine >= sub.span.startLine && targetLine <= sub.span.endLine) {
      const doc = `### SPICE Subcircuit \`${sub.name}\`\n\n- **Ports**: \`${sub.ports.join(", ")}\`\n- **Components**: ${sub.components.length}\n`;
      return {
        contents: {
          kind: "markdown",
          value: doc,
        },
      };
    }
  }

  return null;
}
