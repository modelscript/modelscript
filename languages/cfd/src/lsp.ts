// SPDX-License-Identifier: AGPL-3.0-or-later

import { cfdToDae } from "./dae/cfd-to-dae.js";
import { parseCfdConfig } from "./dialects/index.js";
import { lintCfdModel } from "./lints/index.js";
import { cfdToModelica } from "./projections/index.js";
import type { CaeDiagnostic, CfdModelData } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

/**
 * Validates a CFD deck (SU2 / OpenFOAM) and returns LSP diagnostics.
 */
export function validateCfd(content: string, uri: string = "model.cfg"): LspDiagnostic[] {
  try {
    const ext = uri.split(".").pop() ?? "cfg";
    const model = parseCfdConfig(content, ext);
    const diags = lintCfdModel(model);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const colNum = d.column ? Math.max(0, d.column - 1) : 0;
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `M${d.code}`,
        source: "modelscript-cfd",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7300",
        source: "modelscript-cfd",
        message: `Failed to parse CFD configuration: ${errMsg}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for CFD configurations (domain, markers, flow parameters).
 */
export function getCfdDocumentSymbols(content: string, uri: string = "model.cfg"): LspDocumentSymbol[] {
  try {
    const ext = uri.split(".").pop() ?? "cfg";
    const model = parseCfdConfig(content, ext);
    const children: LspDocumentSymbol[] = [];

    // Surface markers
    for (const [markerName, marker] of model.markers) {
      children.push({
        name: markerName,
        detail: `Boundary: ${marker.type}`,
        kind: LspSymbolKind.Interface,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Aerodynamic / Flow parameters
    if (model.machNumber !== undefined) {
      children.push({
        name: "MACH_NUMBER",
        detail: `Mach = ${model.machNumber}`,
        kind: LspSymbolKind.Constant,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }
    if (model.aoa !== undefined) {
      children.push({
        name: "AOA",
        detail: `Angle of Attack = ${model.aoa}°`,
        kind: LspSymbolKind.Constant,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }
    if (model.reynoldsNumber !== undefined) {
      children.push({
        name: "REYNOLDS_NUMBER",
        detail: `Re = ${model.reynoldsNumber}`,
        kind: LspSymbolKind.Constant,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }
    if (model.meshFilename) {
      children.push({
        name: "MESH_FILENAME",
        detail: model.meshFilename,
        kind: LspSymbolKind.File,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    const rootName = model.mathProblem || (model.meshFilename ? `CFD (${model.meshFilename})` : "CFD Case");
    return [
      {
        name: rootName,
        detail: `Dialect: ${model.dialect.toUpperCase()}`,
        kind: LspSymbolKind.Module,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Returns contextual hover info for CFD markers or configuration directives.
 */
export function getCfdHover(content: string, _position: LspPosition, uri: string = "model.cfg"): LspHover | undefined {
  try {
    const ext = uri.split(".").pop() ?? "cfg";
    const model = parseCfdConfig(content, ext);

    const lines: string[] = [
      `### CFD Domain Specification`,
      `- **Dialect:** ${model.dialect.toUpperCase()}`,
      `- **Physical Problem:** ${model.mathProblem ?? "Euler / Navier-Stokes"}`,
    ];

    if (model.machNumber !== undefined) lines.push(`- **Mach:** ${model.machNumber}`);
    if (model.aoa !== undefined) lines.push(`- **AoA:** ${model.aoa}°`);
    if (model.reynoldsNumber !== undefined) lines.push(`- **Reynolds:** ${model.reynoldsNumber}`);
    if (model.meshFilename) lines.push(`- **Grid Mesh:** \`${model.meshFilename}\``);

    if (model.markers.size > 0) {
      lines.push(`\n**Boundary Markers (${model.markers.size}):**`);
      for (const [name, marker] of model.markers) {
        lines.push(`- \`${name}\` (${marker.type})`);
      }
    }

    return {
      contents: {
        kind: "markdown",
        value: lines.join("\n"),
      },
    };
  } catch {
    return undefined;
  }
}

export interface CfdActionResult {
  success: boolean;
  error?: string | undefined;
  diagnostics?: CaeDiagnostic[] | undefined;
  variables?: number | undefined;
  equations?: number | undefined;
  modelica?: string | undefined;
  mach?: number | undefined;
  aoa?: number | undefined;
  cL?: number | undefined;
  cD?: number | undefined;
  liftN?: number | undefined;
  dragN?: number | undefined;
  lOverD?: number | undefined;
}

/**
 * Executes domain actions on CFD models.
 */
export async function executeCfdAction(
  action: "lint_cfd_model" | "lint",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; diagnostics: CaeDiagnostic[] }>;
export async function executeCfdAction(
  action: "export_cfd_dae" | "to_dae",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; variables: number; equations: number }>;
export async function executeCfdAction(
  action: "export_cfd_modelica" | "to_modelica",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; modelica: string }>;
export async function executeCfdAction(
  action: "solve_cfd" | "evaluate_aerodynamics" | "solve",
  args: Record<string, unknown>,
): Promise<{
  success: boolean;
  error?: string;
  mach: number;
  aoa: number;
  cL: number;
  cD: number;
  liftN: number;
  dragN: number;
  lOverD: number;
}>;
export async function executeCfdAction(action: string, args: Record<string, unknown>): Promise<CfdActionResult>;
export async function executeCfdAction(action: string, args: Record<string, unknown>): Promise<CfdActionResult> {
  const content = (args["content"] as string) || "";
  const uri = (args["uri"] as string) || "model.cfg";
  const ext = uri.split(".").pop() ?? "cfg";

  let model: CfdModelData;
  try {
    model = parseCfdConfig(content, ext);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Parse error: ${errMsg}` };
  }

  switch (action) {
    case "lint_cfd_model":
    case "lint": {
      const diags = lintCfdModel(model);
      return { success: true, diagnostics: diags };
    }

    case "export_cfd_dae":
    case "to_dae": {
      const dae = cfdToDae(model);
      return {
        success: true,
        variables: dae.varCount,
        equations: dae.eqCount,
      };
    }

    case "export_cfd_modelica":
    case "to_modelica": {
      const mo = cfdToModelica(model);
      return { success: true, modelica: mo };
    }

    case "solve_cfd":
    case "evaluate_aerodynamics":
    case "solve": {
      const mach = model.machNumber ?? 0.8;
      const aoaDeg = model.aoa ?? 2.0;
      const aoaRad = (aoaDeg * Math.PI) / 180.0;
      const cl = 2 * Math.PI * aoaRad;
      const cd = 0.02 + 0.05 * cl * cl;
      const qInf = 0.5 * (model.density ?? 1.225) * Math.pow(mach * 340.29, 2);
      const refArea = parseFloat(model.directives.get("REF_AREA") ?? "1.0") || 1.0;

      return {
        success: true,
        mach,
        aoa: aoaDeg,
        cL: cl,
        cD: cd,
        liftN: qInf * refArea * cl,
        dragN: qInf * refArea * cd,
        lOverD: cl / cd,
      };
    }

    default:
      throw new Error(`Unknown CFD action: ${action}`);
  }
}
