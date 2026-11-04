// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerNmtranToDae } from "./dae/nmtran-to-dae.js";
import { lintNmtran } from "./lints/index.js";
import { parseNmtran } from "./parser/nmtran-parser.js";
import { nmtranToModelica } from "./projections/nmtran-to-modelica.js";
import { solveNmtranPkPd, type PkPdSolverOptions } from "./solvers/pkpd-solver.js";

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
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export function validateNmtran(text: string): LspDiagnostic[] {
  try {
    const doc = parseNmtran(text);
    const diags = lintNmtran(doc);

    return diags.map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 12;

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
        source: "nmtran-linter",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M9400",
        source: "nmtran-parser",
        message: `NMTRAN parse error: ${errMsg}`,
      },
    ];
  }
}

export function getNmtranDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseNmtran(text);
  const cs = doc.controlStream;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, text.split("\n").length - 1), character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const c of cs.compartments) {
    const startLine = c.range ? Math.max(0, c.range.startLine - 1) : 0;
    const endLine = c.range ? Math.max(0, c.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: c.name,
      detail: `Compartment ${c.index}${c.defDose ? " (DEFDOSE)" : ""}${c.defObs ? " (DEFOBS)" : ""}`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const st of cs.pkStatements) {
    const startLine = st.range ? Math.max(0, st.range.startLine - 1) : 0;
    const endLine = st.range ? Math.max(0, st.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: st.lhs,
      detail: st.rhs,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  for (const th of cs.thetas) {
    const startLine = th.range ? Math.max(0, th.range.startLine - 1) : 0;
    const endLine = th.range ? Math.max(0, th.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    children.push({
      name: `THETA(${th.index})`,
      detail: `init=${th.init}${th.name ? ` (${th.name})` : ""}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: cs.problem || "NmtranControlStream",
    detail: `NMTRAN (${cs.subroutines.advan || "CUSTOM"} / ${cs.subroutines.trans}, ${cs.thetas.length} THETAs)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

export function getNmtranHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseNmtran(text);
  const cs = doc.controlStream;
  const lines = text.split("\n");
  const lineText = (lines[position.line] ?? "").toUpperCase();

  // Check THETA(i) hover
  for (const th of cs.thetas) {
    if (lineText.includes(`THETA(${th.index})`) || (th.range && th.range.startLine - 1 === position.line)) {
      const boundsStr =
        th.lower !== undefined || th.upper !== undefined
          ? `[${th.lower ?? "-INF"}, ${th.upper ?? "+INF"}]`
          : "Unbounded";
      return {
        contents: {
          kind: "markdown",
          value: [
            `### NMTRAN Fixed Effect: **THETA(${th.index})** ${th.name ? `(${th.name})` : ""}`,
            `- **Initial Estimate:** \`${th.init}\``,
            `- **Bounds:** \`${boundsStr}\``,
            `- **Fixed:** \`${th.fixed}\``,
            th.units ? `- **Units:** \`${th.units}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  // Check ETA(i) hover
  for (const om of cs.omegas) {
    if (lineText.includes(`ETA(${om.index})`) || (om.range && om.range.startLine - 1 === position.line)) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### NMTRAN Random Effect: **ETA(${om.index})** ${om.name ? `(${om.name})` : ""}`,
            `- **Variance ($\\omega^2$):** \`${om.variance}\``,
            `- **Fixed:** \`${om.fixed}\``,
          ].join("\n"),
        },
      };
    }
  }

  // Check PK parameter hover
  for (const st of cs.pkStatements) {
    if (lineText.includes(st.lhs.toUpperCase())) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### NMTRAN PK Parameter: **${st.lhs}**`,
            `- **Definition:** \`${st.lhs} = ${st.rhs}\``,
            st.thetaRefs.length > 0
              ? `- **Referenced THETAs:** ${st.thetaRefs.map((i) => `\`THETA(${i})\``).join(", ")}`
              : "",
            st.etaRefs.length > 0 ? `- **Referenced ETAs:** ${st.etaRefs.map((i) => `\`ETA(${i})\``).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  return null;
}

export function provideNmtranCompletions(_text: string, _position?: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "$PROBLEM",
      kind: 14,
      detail: "NMTRAN Problem Record",
      documentation: "Defines the title and identification of the NONMEM analysis.",
      insertText: "$PROBLEM ",
    },
    {
      label: "$SUBROUTINES",
      kind: 14,
      detail: "PREDPP Subroutine Specification",
      documentation: "Specifies the PREDPP ADVAN model and TRANS parameterization.",
      insertText: "$SUBROUTINES ADVAN2 TRANS2",
    },
    {
      label: "$MODEL",
      kind: 14,
      detail: "Compartment Topology Record",
      documentation: "Defines compartments for general linear/nonlinear ADVAN models.",
      insertText: "$MODEL NCOMPARTMENTS=2 COMP=(DEPOT DEFDOSE) COMP=(CENTRAL DEFOBS)",
    },
    {
      label: "$PK",
      kind: 14,
      detail: "Pharmacokinetic Parameter Block",
      documentation: "Defines typical values, covariate relationships, and inter-individual variability.",
      insertText: "$PK\n  CL = THETA(1) * EXP(ETA(1))\n  V  = THETA(2) * EXP(ETA(2))",
    },
    {
      label: "$DES",
      kind: 14,
      detail: "Differential Equation System Block",
      documentation: "Defines DADT(i) differential equations for ADVAN6/8/9/13.",
      insertText: "$DES\n  DADT(1) = -KA * A(1)",
    },
    {
      label: "$ERROR",
      kind: 14,
      detail: "Residual Error Model Block",
      documentation: "Defines the dependent prediction Y from central prediction F and EPS(n).",
      insertText: "$ERROR\n  IPRED = F\n  Y = IPRED * (1 + EPS(1))",
    },
    {
      label: "$THETA",
      kind: 14,
      detail: "Fixed-Effect Parameter Bounds",
      documentation: "Specifies (lower, init, upper) bounds for fixed-effect parameters.",
      insertText: "$THETA (0, 5.0, 50.0)",
    },
    {
      label: "$OMEGA",
      kind: 14,
      detail: "Inter-Individual Variance Matrix",
      documentation: "Specifies variance/covariance initial estimates for ETA(n).",
      insertText: "$OMEGA 0.04",
    },
    {
      label: "$SIGMA",
      kind: 14,
      detail: "Residual Error Variance Matrix",
      documentation: "Specifies variance initial estimates for EPS(n).",
      insertText: "$SIGMA 0.01",
    },
    {
      label: "$ESTIMATION",
      kind: 14,
      detail: "Parameter Estimation Method Record",
      documentation: "Configures FOCE/SAEM/IMP estimation options.",
      insertText: "$ESTIMATION METHOD=1 INTERACTION MAXEVAL=9999",
    },
  ];
}

export interface NmtranActionParams {
  options?: PkPdSolverOptions | undefined;
  modelName?: string | undefined;
}

export type NmtranActionResult =
  | ReturnType<typeof lintNmtran>
  | ReturnType<typeof solveNmtranPkPd>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeNmtranAction(
  action: "lint_nmtran",
  text: string,
  params?: NmtranActionParams,
): Promise<ReturnType<typeof lintNmtran>>;
export async function executeNmtranAction(
  action: "nmtran_simulate",
  text: string,
  params?: NmtranActionParams,
): Promise<ReturnType<typeof solveNmtranPkPd>>;
export async function executeNmtranAction(
  action: "nmtran_to_dae",
  text: string,
  params?: NmtranActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeNmtranAction(
  action: "nmtran_to_modelica",
  text: string,
  params?: NmtranActionParams,
): Promise<string>;
export async function executeNmtranAction(
  action: string,
  text: string,
  params?: NmtranActionParams,
): Promise<NmtranActionResult>;
export async function executeNmtranAction(
  action: string,
  text: string,
  params?: NmtranActionParams,
): Promise<NmtranActionResult> {
  const doc = parseNmtran(text);

  switch (action) {
    case "lint_nmtran":
      return lintNmtran(doc);

    case "nmtran_simulate":
      return solveNmtranPkPd(doc, params?.options);

    case "nmtran_to_dae": {
      const dae = lowerNmtranToDae(doc);
      return {
        modelName: doc.controlStream.problem || "NmtranPkPdModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "nmtran_to_modelica":
      return nmtranToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown NMTRAN action: ${action}`);
  }
}
