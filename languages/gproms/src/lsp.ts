// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { lowerGpromsToDae } from "./dae/gproms-to-dae.js";
import { lintGproms } from "./lints/index.js";
import { parseGproms } from "./parser/gproms-parser.js";
import { getGpromsWasmParser } from "./parser/wasm-loader.js";
import { gpromsToModelica } from "./projections/gproms-to-modelica.js";
import { solveGpromsProcess, type GpromsSolverOptions } from "./solvers/gproms-solver.js";

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
  contents: {
    kind: "markdown";
    value: string;
  };
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail: string;
  insertText: string;
}

interface ErrNode {
  hasError?: boolean;
  isError?: boolean;
  text?: string;
  startPosition?: { row?: number; column?: number };
  endPosition?: { row?: number; column?: number };
  children?: unknown[];
}

function collectAllWasmErrors(rootNode: unknown) {
  const errs = collectWasmSyntaxErrors(rootNode);
  if (errs.length > 0 || !rootNode || typeof rootNode !== "object") return errs;
  const root = rootNode as ErrNode;
  if (!root.hasError) return errs;
  let target: ErrNode = root;
  let cur: ErrNode | undefined = root;
  while (cur && Array.isArray(cur.children)) {
    const next: ErrNode | undefined = cur.children.find((c): c is ErrNode =>
      Boolean(c && typeof c === "object" && ((c as ErrNode).isError || (c as ErrNode).hasError)),
    );
    if (!next) break;
    target = next;
    cur = next;
  }
  const sp = target.startPosition ?? { row: 0, column: 0 };
  const ep = target.endPosition ?? sp;
  const snippet = (target.text ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  return [
    {
      message: snippet ? `Unexpected or unclosed syntax near '${snippet}'.` : "Syntax error in input.",
      startLine: (sp.row ?? 0) + 1,
      startColumn: (sp.column ?? 0) + 1,
      endLine: (ep.row ?? sp.row ?? 0) + 1,
      endColumn: Math.max((sp.column ?? 0) + 2, (ep.column ?? 0) + 1),
      startOffset: 0,
      endOffset: 0,
    },
  ];
}

export function validateGproms(text: string): LspDiagnostic[] {
  try {
    const cstTree = getGpromsWasmParser().parse(text);
    const syntaxDiags: LspDiagnostic[] = collectAllWasmErrors(cstTree?.rootNode).map((err) => ({
      range: {
        start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
        end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
      },
      severity: 1,
      code: "M9450",
      source: "gproms-parser",
      message: err.message,
    }));

    const doc = parseGproms(text, undefined, cstTree);
    const diags = lintGproms(doc);

    const lintDiags: LspDiagnostic[] = diags.map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 10;

      let sev: 1 | 2 | 3 = 1;
      if (d.severity === "warning") sev = 2;
      if (d.severity === "info") sev = 3;

      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: `M${d.code}`,
        source: "gproms-linter",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...lintDiags];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M9450",
        source: "gproms-parser",
        message: `gPROMS parse error: ${errMsg}`,
      },
    ];
  }
}

export function getGpromsDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseGproms(text);
  const symbols: LspDocumentSymbol[] = [];

  const lines = text.split(/\r?\n/);

  for (const vt of doc.variableTypes.values()) {
    const startLine = vt.range ? Math.max(0, vt.range.startLine - 1) : 0;
    const endLine = vt.range ? Math.max(0, vt.range.endLine - 1) : startLine;
    const leadMatch = /\S/.exec(lines[startLine] ?? "");
    const startChar = leadMatch ? leadMatch.index : 0;
    const endChar = Math.max(startChar, (lines[endLine] ?? "").trimEnd().length);
    const r: LspRange = {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    };
    symbols.push({
      name: vt.name,
      detail: `TYPE [${vt.lowerBound} : ${vt.upperBound}] (${vt.unit ?? "dimensionless"})`,
      kind: LspSymbolKind.TypeParameter,
      range: r,
      selectionRange: r,
    });
  }

  for (const model of doc.models.values()) {
    const mStart = model.range ? Math.max(0, model.range.startLine - 1) : 0;
    const mEnd = model.range ? Math.max(0, model.range.endLine - 1) : mStart + 10;
    const mRange: LspRange = {
      start: { line: mStart, character: 0 },
      end: { line: mEnd, character: 20 },
    };

    const children: LspDocumentSymbol[] = [];
    for (const p of model.parameters.values()) {
      const sLine = p.range ? Math.max(0, p.range.startLine - 1) : mStart;
      const r: LspRange = {
        start: { line: sLine, character: 0 },
        end: { line: sLine, character: 30 },
      };
      children.push({
        name: p.name,
        detail: `PARAMETER (${p.dataType})`,
        kind: LspSymbolKind.Constant,
        range: r,
        selectionRange: r,
      });
    }

    for (const v of model.variables.values()) {
      const sLine = v.range ? Math.max(0, v.range.startLine - 1) : mStart;
      const r: LspRange = {
        start: { line: sLine, character: 0 },
        end: { line: sLine, character: 30 },
      };
      const domSuffix = v.domains.length > 0 ? `(${v.domains.join(", ")})` : "";
      children.push({
        name: v.name,
        detail: `VARIABLE${domSuffix} : ${v.typeName}`,
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }

    symbols.push({
      name: model.name,
      detail: `MODEL (${model.variables.size} variables, ${model.equations.length} equations)`,
      kind: LspSymbolKind.Class,
      range: mRange,
      selectionRange: mRange,
      children,
    });
  }

  for (const proc of doc.processes.values()) {
    const pStart = proc.range ? Math.max(0, proc.range.startLine - 1) : 0;
    const pEnd = proc.range ? Math.max(0, proc.range.endLine - 1) : pStart + 10;
    const pRange: LspRange = {
      start: { line: pStart, character: 0 },
      end: { line: pEnd, character: 20 },
    };
    symbols.push({
      name: proc.name,
      detail: `PROCESS (${proc.units.size} units)`,
      kind: LspSymbolKind.Module,
      range: pRange,
      selectionRange: pRange,
    });
  }

  return symbols;
}

export function getGpromsHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseGproms(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  for (const vt of doc.variableTypes.values()) {
    if (lineText.includes(vt.name)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### gPROMS Variable Type: **${vt.name}**`,
            `- **Default:** \`${vt.defaultValue}\``,
            `- **Bounds:** \`[${vt.lowerBound}, ${vt.upperBound}]\``,
            `- **Unit:** \`${vt.unit ?? "dimensionless"}\``,
          ].join("\n"),
        },
      };
    }
  }

  for (const model of doc.models.values()) {
    for (const v of model.variables.values()) {
      if (lineText.includes(v.name)) {
        const domStr = v.domains.length > 0 ? `DISTRIBUTION(${v.domains.join(", ")})` : "Lumped";
        return {
          contents: {
            kind: "markdown",
            value: [
              `### gPROMS Variable: **${v.name}** (in \`${model.name}\`)`,
              `- **Type:** \`${v.typeName}\``,
              `- **Distribution:** \`${domStr}\``,
            ].join("\n"),
          },
        };
      }
    }
  }

  return null;
}

export const provideGpromsHover = getGpromsHover;

export function provideGpromsCompletions(): LspCompletionItem[] {
  return [
    {
      label: "DECLARE TYPE",
      kind: 14,
      detail: "gPROMS physical variable type declaration block",
      insertText: 'DECLARE\n  TYPE\n    Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"\n  END\nEND',
    },
    {
      label: "MODEL",
      kind: 7,
      detail: "gPROMS equation-oriented model definition",
      insertText: "MODEL ReactorModel\n  PARAMETER\n  VARIABLE\n  EQUATION\nEND",
    },
    {
      label: "DISTRIBUTION_DOMAIN",
      kind: 14,
      detail: "Spatial discretization domain for PDEs",
      insertText: "DISTRIBUTION_DOMAIN\n  Axial AS [ 0.0 : 1.0 ] N = 10",
    },
    {
      label: "PARTIAL",
      kind: 3,
      detail: "Spatial partial derivative operator PARTIAL(u, domain)",
      insertText: "PARTIAL(C, Axial)",
    },
    {
      label: "PROCESS",
      kind: 9,
      detail: "gPROMS simulation process specification",
      insertText: "PROCESS Simulation\n  UNIT\n  SET\n  ASSIGN\n  INITIAL\nEND",
    },
  ];
}

export interface GpromsActionParams {
  options?: GpromsSolverOptions | undefined;
  modelName?: string | undefined;
}

export type GpromsActionResult =
  | ReturnType<typeof lintGproms>
  | ReturnType<typeof solveGpromsProcess>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeGpromsAction(
  action: "lint_gproms",
  text: string,
  params?: GpromsActionParams,
): Promise<ReturnType<typeof lintGproms>>;
export async function executeGpromsAction(
  action: "gproms_simulate",
  text: string,
  params?: GpromsActionParams,
): Promise<ReturnType<typeof solveGpromsProcess>>;
export async function executeGpromsAction(
  action: "gproms_to_dae",
  text: string,
  params?: GpromsActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeGpromsAction(
  action: "gproms_to_modelica",
  text: string,
  params?: GpromsActionParams,
): Promise<string>;
export async function executeGpromsAction(
  action: string,
  text: string,
  params?: GpromsActionParams,
): Promise<GpromsActionResult>;
export async function executeGpromsAction(
  action: string,
  text: string,
  params?: GpromsActionParams,
): Promise<GpromsActionResult> {
  const doc = parseGproms(text);

  switch (action) {
    case "lint_gproms":
      return lintGproms(doc);

    case "gproms_simulate":
      return solveGpromsProcess(doc, params?.options);

    case "gproms_to_dae": {
      const dae = lowerGpromsToDae(doc, { modelName: params?.modelName });
      const firstModel = doc.models.values().next().value;
      return {
        modelName: params?.modelName ?? firstModel?.name ?? "GpromsModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "gproms_to_modelica":
      return gpromsToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown gPROMS action: ${action}`);
  }
}
