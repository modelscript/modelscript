// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Language Server Protocol (LSP) Services.
 *
 * Provides diagnostics, document symbols, hover, completions, and code actions.
 */

import { lowerNmodlToDae } from "./dae/nmodl-to-dae.js";
import { lintNmodl } from "./lints/nmodl-linter.js";
import { parseNmodl } from "./parser/nmodl-parser.js";
import { nmodlToModelica } from "./projections/nmodl-to-modelica.js";
import { solveNmodlActionPotential } from "./solvers/nmodl-solver.js";
import type { NmodlSimOptions } from "./types.js";

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
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: string;
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export function validateNmodl(source: string, _filename = "channel.mod"): LspDiagnostic[] {
  const doc = parseNmodl(source);
  const items = lintNmodl(doc);

  return items.map((item) => {
    const r = item.range;
    const start: LspPosition = r ? { line: r.startLine - 1, character: r.startColumn - 1 } : { line: 0, character: 0 };
    const end: LspPosition = r ? { line: r.endLine - 1, character: r.endColumn - 1 } : { line: 0, character: 10 };
    const sev: 1 | 2 | 3 = item.severity === "error" ? 1 : item.severity === "warning" ? 2 : 3;

    return {
      range: { start, end },
      severity: sev,
      code: `M${item.code}`,
      source: "nmodl",
      message: item.message,
    };
  });
}

export function getNmodlDocumentSymbols(source: string): LspDocumentSymbol[] {
  const doc = parseNmodl(source);
  const m = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const wholeRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: source.split(/\r?\n/).length, character: 0 },
  };

  const modelSymbol: LspDocumentSymbol = {
    name: m.suffix ? `Mechanism (${m.suffix})` : "NMODL Mechanism",
    detail: m.title ?? "NEURON Channel Model",
    kind: LspSymbolKind.Class,
    range: wholeRange,
    selectionRange: wholeRange,
    children: [],
  };

  for (const p of m.parameters) {
    const line = p.range ? p.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: p.name.length },
    };
    modelSymbol.children!.push({
      name: p.name,
      detail: `Parameter (${p.val} ${p.units ?? ""})`,
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  for (const s of m.states) {
    const line = s.range ? s.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: s.name.length },
    };
    modelSymbol.children!.push({
      name: s.name,
      detail: "State Variable (Gating Probability)",
      kind: LspSymbolKind.Variable,
      range,
      selectionRange: range,
    });
  }

  for (const ion of m.ions) {
    const line = ion.range ? ion.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: ion.ion.length },
    };
    modelSymbol.children!.push({
      name: `USEION ${ion.ion}`,
      detail: `Read: ${ion.read.join(", ") || "none"} | Write: ${ion.write.join(", ") || "none"}`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  symbols.push(modelSymbol);
  return symbols;
}

export function getNmodlHover(source: string, pos: LspPosition): LspHover | undefined {
  const doc = parseNmodl(source);
  const lines = source.split(/\r?\n/);
  const targetLine = lines[pos.line] ?? "";

  if (targetLine.includes("NEURON")) {
    return {
      contents:
        "**NEURON { ... }**\n\nDeclares mechanism suffix, ionic current interfaces (`USEION`), and scope boundaries.",
    };
  }
  if (targetLine.includes("BREAKPOINT")) {
    return {
      contents:
        "**BREAKPOINT { ... }**\n\nSolves state integration and evaluates instantaneous ionic currents at each simulation time step.",
    };
  }
  if (targetLine.includes("DERIVATIVE")) {
    return {
      contents:
        "**DERIVATIVE { ... }**\n\nDeclares time-evolution equations (`m' = ...`) for continuous gating state variables.",
    };
  }

  for (const p of doc.model.parameters) {
    if (targetLine.includes(p.name)) {
      return {
        contents: `**Parameter** \`${p.name}\`\n\n- Value: ${p.val}\n- Units: ${p.units ?? "dimensionless"}\n- Bounds: <${p.min ?? "-inf"}, ${p.max ?? "+inf"}>`,
      };
    }
  }

  for (const s of doc.model.states) {
    if (targetLine.includes(s.name)) {
      return {
        contents: `**Gating State** \`${s.name}\`\n\nContinuous state variable representing channel open probability $0 \\le ${s.name} \\le 1$.`,
      };
    }
  }

  return undefined;
}

export function provideNmodlCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "NEURON",
      kind: 14,
      detail: "NEURON mechanism interface block",
      insertText: "NEURON {\n  SUFFIX ${1:channel}\n  USEION ${2:na} READ ${3:ena} WRITE ${4:ina}\n}\n",
    },
    {
      label: "PARAMETER",
      kind: 14,
      detail: "Model parameters and conductances block",
      insertText: "PARAMETER {\n  gnabar = 0.12 (mho/cm2)\n  ena = 50 (mV)\n}\n",
    },
    {
      label: "STATE",
      kind: 14,
      detail: "Gating state variables block",
      insertText: "STATE {\n  m\n  h\n}\n",
    },
    {
      label: "BREAKPOINT",
      kind: 14,
      detail: "Current calculation breakpoint block",
      insertText: "BREAKPOINT {\n  SOLVE states METHOD cnexp\n  ina = gnabar*m*m*m*h*(v - ena)\n}\n",
    },
    {
      label: "DERIVATIVE",
      kind: 14,
      detail: "State ODE derivative evolution block",
      insertText: "DERIVATIVE states {\n  m' = (minf - m)/mtau\n  h' = (hinf - h)/htau\n}\n",
    },
  ];
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspCodeAction {
  title: string;
  kind: "quickfix" | "refactor" | "source";
  isPreferred?: boolean | undefined;
  diagnostics?: LspDiagnostic[] | undefined;
  edit?:
    | {
        changes?: Record<string, LspTextEdit[]> | undefined;
      }
    | undefined;
}

export function provideNmodlCodeActions(
  _source: string,
  uri: string,
  _range: LspRange,
  diagnostics: LspDiagnostic[],
): LspCodeAction[] {
  const actions: LspCodeAction[] = [];

  for (const diag of diagnostics) {
    const code = String(diag.code);
    if (code === "M9441") {
      // Missing title
      actions.push({
        title: "Insert mechanism TITLE block",
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
        edit: {
          changes: {
            [uri]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: "TITLE Ion channel electrophysiology mechanism\n\n",
              },
            ],
          },
        },
      });
    } else if (code === "M9442") {
      // Unassigned state
      const stateMatch = diag.message.match(/'([^']+)'/);
      const state = stateMatch ? stateMatch[1] : "state";
      actions.push({
        title: `Declare '${state}' in STATE block`,
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
      });
    } else if (code === "M9443") {
      // Missing ion declaration
      const ionMatch = diag.message.match(/ion '([^']+)'/);
      const ion = ionMatch ? ionMatch[1] : "na";
      actions.push({
        title: `Add 'USEION ${ion} READ e${ion} WRITE i${ion}' to NEURON block`,
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
      });
    }
  }

  return actions;
}

export function executeNmodlAction(source: string, action: string, options?: Record<string, unknown>): unknown {
  const doc = parseNmodl(source);
  switch (action) {
    case "lint_nmodl":
      return validateNmodl(source);
    case "nmodl_simulate":
      return solveNmodlActionPotential(doc, options as NmodlSimOptions | undefined);
    case "nmodl_to_dae": {
      const dae = lowerNmodlToDae(doc);
      return {
        modelName: dae.name,
        variableCount: dae.varCount,
        equationCount: dae.eqCount,
        isSquare: dae.varCount === dae.eqCount,
      };
    }
    case "nmodl_to_modelica":
      return nmodlToModelica(doc);
    default:
      throw new Error(`Unsupported NMODL action '${action}'.`);
  }
}
