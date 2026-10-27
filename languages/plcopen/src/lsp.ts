// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Language Server Protocol (LSP) Service Integration.
 */

import { lowerPlcopenToDae } from "./dae/plcopen-to-dae.js";
import { lintPlcProject } from "./lints/rules.js";
import { parsePlcopen } from "./parser/index.js";
import { plcopenToModelica } from "./projections/plcopen-to-modelica.js";
import { plcopenToSysML } from "./projections/plcopen-to-sysml.js";
import { VirtualPlc } from "./solver/virtual-plc.js";
import type { PlcProject } from "./types.js";

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
  code: string | number;
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

export function validatePlcopen(content: string): LspDiagnostic[] {
  let project: PlcProject;
  try {
    project = parsePlcopen(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7700",
        source: "plcopen-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintPlcProject(project);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: {
        start: {
          line: Math.max(0, d.range.startLine - 1),
          character: Math.max(0, d.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, d.range.endLine - 1),
          character: Math.max(0, d.range.endColumn - 1),
        },
      },
      severity: sev,
      code: d.code,
      source: "plcopen-linter",
      message: d.message,
    };
  });
}

export function getPlcopenDocumentSymbols(content: string): LspDocumentSymbol[] {
  let project: PlcProject;
  try {
    project = parsePlcopen(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const pou of project.pous) {
    const startLine = Math.max(0, pou.range.startLine - 1);
    const startCol = Math.max(0, pou.range.startColumn - 1);
    const endLine = Math.max(0, pou.range.endLine - 1);
    const endCol = Math.max(0, pou.range.endColumn - 1);

    const pouRange: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const varChildren: LspDocumentSymbol[] = pou.variables.map((v) => ({
      name: v.name,
      detail: `${v.scope} ${v.dataType}${v.address ? ` at ${v.address}` : ""}`,
      kind: v.scope === "input" || v.scope === "output" ? LspSymbolKind.Field : LspSymbolKind.Variable,
      range: {
        start: {
          line: Math.max(0, v.range.startLine - 1),
          character: Math.max(0, v.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, v.range.endLine - 1),
          character: Math.max(0, v.range.endColumn - 1),
        },
      },
      selectionRange: {
        start: {
          line: Math.max(0, v.range.startLine - 1),
          character: Math.max(0, v.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, v.range.endLine - 1),
          character: Math.max(0, v.range.endColumn - 1),
        },
      },
    }));

    symbols.push({
      name: pou.name,
      detail: `${pou.pouType}${pou.returnType ? `: ${pou.returnType}` : ""}`,
      kind: pou.pouType === "function" ? LspSymbolKind.Function : LspSymbolKind.Class,
      range: pouRange,
      selectionRange: pouRange,
      children: varChildren,
    });
  }

  return symbols;
}

export function getPlcopenHover(content: string, offset: number): LspHover | null {
  let project: PlcProject;
  try {
    project = parsePlcopen(content);
  } catch {
    return null;
  }

  for (const pou of project.pous) {
    if (offset >= pou.range.startOffset && offset <= pou.range.endOffset) {
      // Check variables within POU
      for (const v of pou.variables) {
        if (offset >= v.range.startOffset && offset <= v.range.endOffset) {
          const lines = [`**${v.name}** (\`${v.scope}\`)`, `* Type: \`${v.dataType}\``];
          if (v.address) lines.push(`* Address: \`${v.address}\``);
          if (v.initialValue !== undefined) lines.push(`* Initial Value: \`${v.initialValue}\``);
          return {
            contents: {
              kind: "markdown",
              value: lines.join("\n"),
            },
          };
        }
      }

      // Hover on POU header
      return {
        contents: {
          kind: "markdown",
          value: [
            `### PLC POU: **${pou.name}**`,
            `* **Kind:** \`${pou.pouType}\``,
            pou.returnType ? `* **Return Type:** \`${pou.returnType}\`` : "",
            `* **Variables:** ${pou.variables.length}`,
            `* **Body Kind:** \`${pou.body.kind}\``,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }
  }

  return null;
}

export async function executePlcopenAction(
  actionId: "plcopen_to_dae",
  content: string,
  params?: { cycles?: number; dtMs?: number },
): Promise<{ variableCount: number; equationCount: number }>;
export async function executePlcopenAction(
  actionId: "plcopen_to_modelica" | "plcopen_to_sysml",
  content: string,
  params?: { cycles?: number; dtMs?: number },
): Promise<string>;
export async function executePlcopenAction(
  actionId: "plcopen_run_scan",
  content: string,
  params?: { cycles?: number; dtMs?: number },
): Promise<{
  cycles: number;
  dtMs: number;
  finalVariables: Record<string, string | number | boolean>;
  history: Record<string, string | number | boolean>[];
}>;
export async function executePlcopenAction(
  actionId: string,
  content: string,
  params?: { cycles?: number; dtMs?: number },
): Promise<unknown>;
export async function executePlcopenAction(
  actionId: string,
  content: string,
  params?: { cycles?: number; dtMs?: number },
): Promise<unknown> {
  const project = parsePlcopen(content);

  switch (actionId) {
    case "plcopen_lint":
      return lintPlcProject(project);

    case "plcopen_to_dae": {
      const arena = lowerPlcopenToDae(project);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "plcopen_to_modelica":
      return plcopenToModelica(project);

    case "plcopen_to_sysml":
      return plcopenToSysML(project);

    case "plcopen_run_scan": {
      const plc = new VirtualPlc(project);
      const cycles = params?.cycles ?? 10;
      const dtMs = params?.dtMs ?? 10;
      const history = plc.runCycles(cycles, dtMs);
      return { cycles, dtMs, finalVariables: plc.getAllVariables(), history };
    }

    default:
      throw new Error(`Unknown PLCopen action: ${actionId}`);
  }
}
