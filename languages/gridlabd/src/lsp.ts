// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for GridLAB-D (.glm) Models.
 */

import { lintGridlabd } from "./lints/index.js";
import { parseGridlabd } from "./parser/gridlabd-parser.js";
import type { GlmObject } from "./types.js";

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
  Variable = 13,
  Constant = 14,
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

function objToSymbol(obj: GlmObject): LspDocumentSymbol {
  const range: LspRange = {
    start: { line: Math.max(0, obj.span.line - 1), character: Math.max(0, obj.span.column - 1) },
    end: { line: Math.max(0, obj.span.endLine - 1), character: Math.max(0, obj.span.endColumn - 1) },
  };
  const label = obj.name ?? (obj.id ? `${obj.className}:${obj.id}` : obj.className);
  return {
    name: label,
    detail: obj.className,
    kind: LspSymbolKind.Object,
    range,
    selectionRange: range,
    children: obj.children.map(objToSymbol),
  };
}

export function getGridlabdDocumentSymbols(content: string): LspDocumentSymbol[] {
  const model = parseGridlabd(content);
  const symbols: LspDocumentSymbol[] = [];

  if (model.clock) {
    const r: LspRange = {
      start: { line: Math.max(0, model.clock.span.line - 1), character: Math.max(0, model.clock.span.column - 1) },
      end: { line: Math.max(0, model.clock.span.endLine - 1), character: Math.max(0, model.clock.span.endColumn - 1) },
    };
    symbols.push({
      name: "clock",
      detail: model.clock.timezone ?? "simulation clock",
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const mod of model.modules) {
    const r: LspRange = {
      start: { line: Math.max(0, mod.span.line - 1), character: Math.max(0, mod.span.column - 1) },
      end: { line: Math.max(0, mod.span.endLine - 1), character: Math.max(0, mod.span.endColumn - 1) },
    };
    symbols.push({
      name: `module ${mod.name}`,
      detail: mod.properties["solver_method"] ? `solver: ${mod.properties["solver_method"]}` : "module",
      kind: LspSymbolKind.Module,
      range: r,
      selectionRange: r,
    });
  }

  for (const obj of model.objects) {
    symbols.push(objToSymbol(obj));
  }

  return symbols;
}

export function getGridlabdDiagnostics(content: string): LspDiagnosticItem[] {
  const model = parseGridlabd(content);
  const diags = lintGridlabd(model);
  return diags.map((d) => ({
    range: {
      start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) },
      end: { line: Math.max(0, d.endLine - 1), character: Math.max(0, d.endColumn - 1) },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "gridlabd",
    message: d.message,
  }));
}

export function getGridlabdCompletions(): LspCompletionItem[] {
  return [
    {
      label: "clock",
      kind: 14,
      detail: "Simulation clock block",
      insertText:
        "clock {\n\ttimezone PST+8PDT;\n\tstarttime '2000-01-01 00:00:00';\n\tstoptime '2000-01-02 00:00:00';\n}",
    },
    {
      label: "module powerflow",
      kind: 9,
      detail: "GridLAB-D powerflow solver module",
      insertText: "module powerflow {\n\tsolver_method NR;\n}",
    },
    {
      label: "object node",
      kind: 7,
      detail: "Powerflow bus/node",
      insertText: "object node {\n\tname ${1:bus1};\n\tphases ABCN;\n\tnominal_voltage 7200;\n}",
    },
    {
      label: "object overhead_line",
      kind: 7,
      detail: "Overhead distribution line",
      insertText:
        "object overhead_line {\n\tname ${1:line1};\n\tphases ABCN;\n\tfrom ${2:bus1};\n\tto ${3:bus2};\n\tlength 1000 ft;\n\tconfiguration ${4:line_cfg};\n}",
    },
    {
      label: "object transformer",
      kind: 7,
      detail: "Distribution transformer",
      insertText:
        "object transformer {\n\tname ${1:xfmr1};\n\tphases ABCN;\n\tfrom ${2:bus1};\n\tto ${3:bus2};\n\tconfiguration ${4:xfmr_cfg};\n}",
    },
    {
      label: "object load",
      kind: 7,
      detail: "ZIP / constant-power load",
      insertText:
        "object load {\n\tname ${1:load1};\n\tphases ABCN;\n\tnominal_voltage 7200;\n\tconstant_power_A 100+50j kVA;\n}",
    },
    {
      label: "object solar",
      kind: 7,
      detail: "Solar PV array",
      insertText: "object solar {\n\tname ${1:pv1};\n\tparent ${2:inv1};\n\tarea 500 sf;\n\tefficiency 0.18;\n}",
    },
  ];
}

export function getGridlabdHover(content: string, line: number): string | null {
  const model = parseGridlabd(content);
  const oneBasedLine = line + 1;
  for (const obj of model.allObjects) {
    if (oneBasedLine >= obj.span.line && oneBasedLine <= obj.span.endLine) {
      const title = obj.name ? `**${obj.className}** \`${obj.name}\`` : `**${obj.className}**`;
      const props = Object.entries(obj.properties)
        .slice(0, 8)
        .map(([k, v]) => `- \`${k}\`: \`${v}\``)
        .join("\n");
      return props ? `${title}\n\n${props}` : title;
    }
  }
  return null;
}
