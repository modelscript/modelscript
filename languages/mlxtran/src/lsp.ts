// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Language Server Protocol (LSP) Services.
 *
 * Provides diagnostics, document symbols, hover, completions, and code actions.
 */

import { lowerMlxtranToDae } from "./dae/mlxtran-to-dae.js";
import { lintMlxtran } from "./lints/mlxtran-linter.js";
import { parseMlxtran } from "./parser/mlxtran-parser.js";
import { mlxtranToModelica } from "./projections/mlxtran-to-modelica.js";
import { solveMlxtranPk } from "./solvers/mlxtran-solver.js";
import type { MlxtranSimOptions } from "./types.js";

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

export function validateMlxtran(source: string, _filename = "model.mlxtran"): LspDiagnostic[] {
  const doc = parseMlxtran(source);
  const items = lintMlxtran(doc);

  return items.map((item) => {
    const r = item.range;
    const start: LspPosition = r ? { line: r.startLine - 1, character: r.startColumn - 1 } : { line: 0, character: 0 };
    const end: LspPosition = r ? { line: r.endLine - 1, character: r.endColumn - 1 } : { line: 0, character: 10 };
    const sev: 1 | 2 | 3 = item.severity === "error" ? 1 : item.severity === "warning" ? 2 : 3;

    return {
      range: { start, end },
      severity: sev,
      code: `M${item.code}`,
      source: "mlxtran",
      message: item.message,
    };
  });
}

export function getMlxtranDocumentSymbols(source: string): LspDocumentSymbol[] {
  const doc = parseMlxtran(source);
  const m = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const wholeRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: source.split(/\r?\n/).length, character: 0 },
  };

  const modelSymbol: LspDocumentSymbol = {
    name: m.name,
    detail: "Monolix MLXTRAN Model",
    kind: LspSymbolKind.Class,
    range: wholeRange,
    selectionRange: wholeRange,
    children: [],
  };

  for (const inp of m.inputs) {
    const line = inp.range ? inp.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: inp.name.length },
    };
    modelSymbol.children!.push({
      name: inp.name,
      detail: `Parameter (init=${inp.init ?? "auto"})`,
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  for (const eq of m.equations) {
    const line = eq.range ? eq.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: eq.lhs.length },
    };
    modelSymbol.children!.push({
      name: eq.lhs,
      detail: eq.isDerivative ? `Differential State (der)` : `Algebraic Equation`,
      kind: eq.isDerivative ? LspSymbolKind.Variable : LspSymbolKind.Field,
      range,
      selectionRange: range,
    });
  }

  for (const mac of m.macros) {
    const line = mac.range ? mac.range.startLine - 1 : 0;
    const range: LspRange = {
      start: { line, character: 0 },
      end: { line, character: mac.raw.length },
    };
    modelSymbol.children!.push({
      name: mac.kind,
      detail: mac.raw,
      kind: LspSymbolKind.Function,
      range,
      selectionRange: range,
    });
  }

  symbols.push(modelSymbol);
  return symbols;
}

export function getMlxtranHover(source: string, pos: LspPosition): LspHover | undefined {
  const doc = parseMlxtran(source);
  const lines = source.split(/\r?\n/);
  const targetLine = lines[pos.line] ?? "";

  // Check section keywords
  if (targetLine.includes("[LONGITUDINAL]")) {
    return {
      contents:
        "**[LONGITUDINAL]**\n\nDeclares the longitudinal pharmacokinetic/pharmacodynamic time-course model structure.",
    };
  }
  if (targetLine.includes("EQUATION:")) {
    return {
      contents: "**EQUATION:**\n\nDifferential (`ddt_X`) and algebraic (`Y = ...`) state transition equations.",
    };
  }
  if (targetLine.includes("PK:")) {
    return {
      contents:
        "**PK:**\n\nHigh-level pharmacokinetic structural macros (`compartment`, `depot`, `absorption`, `transfer`).",
    };
  }

  // Check parameter hover
  for (const inp of doc.model.inputs) {
    if (targetLine.includes(inp.name)) {
      return {
        contents: `**Parameter** \`${inp.name}\`\n\n- Type: ${inp.type ?? "real"}\n- Initial estimate: ${inp.init ?? "unspecified"}`,
      };
    }
  }

  // Check equation hover
  for (const eq of doc.model.equations) {
    if (targetLine.includes(eq.lhs)) {
      return {
        contents: eq.isDerivative
          ? `**Differential Equation**\n\n$$\\frac{d${eq.stateName}}{dt} = ${eq.rhs}$$`
          : `**Algebraic Output**\n\n$$${eq.lhs} = ${eq.rhs}$$`,
      };
    }
  }

  return undefined;
}

export function provideMlxtranCompletions(_source: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "[LONGITUDINAL]",
      kind: 14,
      detail: "Section header for longitudinal model",
      insertText: "[LONGITUDINAL]\n",
    },
    {
      label: "EQUATION:",
      kind: 14,
      detail: "Sub-block for differential and algebraic equations",
      insertText: "EQUATION:\n",
    },
    {
      label: "PK:",
      kind: 14,
      detail: "Sub-block for pharmacokinetic macros",
      insertText: "PK:\n",
    },
    {
      label: "OUTPUT:",
      kind: 14,
      detail: "Sub-block for model predictions and observed outputs",
      insertText: "OUTPUT:\noutput = {Cc}\n",
    },
    {
      label: "compartment",
      kind: 3,
      detail: "PK macro declaring a distribution volume",
      insertText: "compartment(cmt=${1:1}, amount=${2:Ac}, volume=${3:V})\n",
    },
    {
      label: "absorption",
      kind: 3,
      detail: "PK macro declaring first-order absorption",
      insertText: "absorption(target=${1:Ac}, ka=${2:ka})\n",
    },
    {
      label: "elimination",
      kind: 3,
      detail: "PK macro declaring linear clearance",
      insertText: "elimination(cmt=${1:1}, Cl=${2:Cl}, V=${3:V})\n",
    },
    {
      label: "transfer",
      kind: 3,
      detail: "PK macro declaring inter-compartmental transfer",
      insertText: "transfer(from=${1:1}, to=${2:2}, kt=${3:Q/V})\n",
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

export function provideMlxtranCodeActions(
  source: string,
  uri: string,
  _range: LspRange,
  diagnostics: LspDiagnostic[],
): LspCodeAction[] {
  const actions: LspCodeAction[] = [];

  for (const diag of diagnostics) {
    const code = String(diag.code);
    if (code === "M9421") {
      // Unassigned derivative
      const stateMatch = diag.message.match(/'([^']+)'/);
      const state = stateMatch?.[1] ?? "State";
      actions.push({
        title: `Declare derivative: ddt_${state} = -ka * ${state}`,
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: source.split("\n").length, character: 0 },
                  end: { line: source.split("\n").length, character: 0 },
                },
                newText: `\nddt_${state} = -0.1 * ${state}\n`,
              },
            ],
          },
        },
      });
    } else if (code === "M9422") {
      // Unbound input parameter
      const paramMatch = diag.message.match(/'([^']+)'/);
      const param = paramMatch?.[1] ?? "param";
      actions.push({
        title: `Add parameter '${param}' to input declaration`,
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
        edit: {
          changes: {
            [uri]: [
              {
                range: diag.range,
                newText: param,
              },
            ],
          },
        },
      });
    } else if (code === "M9423") {
      // Negative volume or clearance
      actions.push({
        title: "Clamp volume/clearance parameter to positive lower bound (min = 0.001)",
        kind: "quickfix",
        isPreferred: true,
        diagnostics: [diag],
      });
    }
  }

  return actions;
}

export function executeMlxtranAction(source: string, action: string, options?: Record<string, unknown>): unknown {
  const doc = parseMlxtran(source);
  switch (action) {
    case "lint_mlxtran":
      return validateMlxtran(source);
    case "mlxtran_simulate":
      return solveMlxtranPk(doc, options as MlxtranSimOptions | undefined);
    case "mlxtran_to_dae": {
      const dae = lowerMlxtranToDae(doc);
      return {
        modelName: dae.name,
        variableCount: dae.varCount,
        equationCount: dae.eqCount,
        isSquare: dae.varCount === dae.eqCount,
      };
    }
    case "mlxtran_to_modelica":
      return mlxtranToModelica(doc);
    default:
      throw new Error(`Unsupported MLXTRAN action '${action}'.`);
  }
}
