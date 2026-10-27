// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Language Server Protocol (LSP) Service Integration.
 */

import { lowerVerilogAToDae } from "./dae/verilog-a-to-dae.js";
import { lintVerilogA } from "./lints/rules.js";
import { parseVerilogA } from "./parser/verilog-a-parser.js";
import { verilogAToModelica } from "./projections/verilog-a-to-modelica.js";
import { verilogAToSpice } from "./projections/verilog-a-to-spice.js";
import type { VerilogADocument } from "./types.js";

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

export function validateVerilogA(content: string): LspDiagnostic[] {
  let doc: VerilogADocument;
  try {
    doc = parseVerilogA(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7600",
        source: "verilog-a-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintVerilogA(doc);
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
      source: "verilog-a-linter",
      message: d.message,
    };
  });
}

export function getVerilogADocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: VerilogADocument;
  try {
    doc = parseVerilogA(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const mod of doc.modules) {
    const modRange: LspRange = {
      start: {
        line: Math.max(0, mod.sourceRange.startLine - 1),
        character: Math.max(0, mod.sourceRange.startColumn - 1),
      },
      end: {
        line: Math.max(0, mod.sourceRange.endLine - 1),
        character: Math.max(0, mod.sourceRange.endColumn - 1),
      },
    };

    const children: LspDocumentSymbol[] = [];

    // Ports
    for (const port of mod.ports) {
      children.push({
        name: port.name,
        detail: `${port.direction} (${port.discipline ?? "electrical"})`,
        kind: LspSymbolKind.Interface,
        range: {
          start: {
            line: Math.max(0, port.sourceRange.startLine - 1),
            character: Math.max(0, port.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, port.sourceRange.endLine - 1),
            character: Math.max(0, port.sourceRange.endColumn - 1),
          },
        },
        selectionRange: {
          start: {
            line: Math.max(0, port.sourceRange.startLine - 1),
            character: Math.max(0, port.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, port.sourceRange.endLine - 1),
            character: Math.max(0, port.sourceRange.endColumn - 1),
          },
        },
      });
    }

    // Parameters
    for (const param of mod.parameters) {
      children.push({
        name: param.name,
        detail: `parameter ${param.type} = ${param.defaultValue}`,
        kind: LspSymbolKind.Constant,
        range: {
          start: {
            line: Math.max(0, param.sourceRange.startLine - 1),
            character: Math.max(0, param.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, param.sourceRange.endLine - 1),
            character: Math.max(0, param.sourceRange.endColumn - 1),
          },
        },
        selectionRange: {
          start: {
            line: Math.max(0, param.sourceRange.startLine - 1),
            character: Math.max(0, param.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, param.sourceRange.endLine - 1),
            character: Math.max(0, param.sourceRange.endColumn - 1),
          },
        },
      });
    }

    // Variables
    for (const v of mod.variables) {
      children.push({
        name: v.name,
        detail: `${v.type}`,
        kind: LspSymbolKind.Variable,
        range: {
          start: {
            line: Math.max(0, v.sourceRange.startLine - 1),
            character: Math.max(0, v.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, v.sourceRange.endLine - 1),
            character: Math.max(0, v.sourceRange.endColumn - 1),
          },
        },
        selectionRange: {
          start: {
            line: Math.max(0, v.sourceRange.startLine - 1),
            character: Math.max(0, v.sourceRange.startColumn - 1),
          },
          end: {
            line: Math.max(0, v.sourceRange.endLine - 1),
            character: Math.max(0, v.sourceRange.endColumn - 1),
          },
        },
      });
    }

    symbols.push({
      name: mod.name,
      detail: `module (${mod.ports.length} ports, ${mod.parameters.length} params)`,
      kind: LspSymbolKind.Module,
      range: modRange,
      selectionRange: modRange,
      children,
    });
  }

  return symbols;
}

export function getVerilogAHover(content: string, offset: number): LspHover | undefined {
  let doc: VerilogADocument;
  try {
    doc = parseVerilogA(content);
  } catch {
    return undefined;
  }

  for (const mod of doc.modules) {
    if (offset >= mod.sourceRange.startOffset && offset <= mod.sourceRange.endOffset) {
      // Check ports
      for (const port of mod.ports) {
        if (offset >= port.sourceRange.startOffset && offset <= port.sourceRange.endOffset) {
          return {
            contents: {
              kind: "markdown",
              value: `**Verilog-A Port:** \`${port.name}\`\n\n- **Direction:** \`${port.direction}\`\n- **Discipline:** \`${port.discipline ?? "electrical"}\``,
            },
          };
        }
      }

      // Check parameters
      for (const param of mod.parameters) {
        if (offset >= param.sourceRange.startOffset && offset <= param.sourceRange.endOffset) {
          let rangeText = "";
          if (param.rangeSpec) {
            const min = param.rangeSpec.min !== undefined ? String(param.rangeSpec.min) : "-inf";
            const max = param.rangeSpec.max !== undefined ? String(param.rangeSpec.max) : "inf";
            rangeText = `\n- **Range:** \`${param.rangeSpec.minInclusive ? "[" : "("}${min}:${max}${param.rangeSpec.maxInclusive ? "]" : ")"}\``;
          }
          return {
            contents: {
              kind: "markdown",
              value: `**Verilog-A Parameter:** \`${param.name}\`\n\n- **Type:** \`${param.type}\`\n- **Default:** \`${param.defaultValue}\`${rangeText}`,
            },
          };
        }
      }

      // Module-level hover
      return {
        contents: {
          kind: "markdown",
          value: `**Verilog-A Module:** \`${mod.name}\`\n\n- **Ports:** ${mod.ports.map((p) => p.name).join(", ") || "none"}\n- **Parameters:** ${mod.parameters.length}\n- **Internal Nodes:** ${mod.internalNodes.join(", ") || "none"}`,
        },
      };
    }
  }

  return undefined;
}

export async function executeVerilogAAction(actionId: string, content: string, _params?: unknown): Promise<unknown> {
  const doc = parseVerilogA(content);

  switch (actionId) {
    case "lint_verilog_a":
      return lintVerilogA(doc);

    case "export_verilog_a_modelica": {
      const mod = doc.modules[0];
      if (!mod) return "";
      return verilogAToModelica(mod);
    }

    case "export_verilog_a_spice": {
      const mod = doc.modules[0];
      if (!mod) return "";
      return verilogAToSpice(mod);
    }

    case "export_verilog_a_dae": {
      const mod = doc.modules[0];
      if (!mod) return { error: "No module found" };
      const arena = lowerVerilogAToDae(mod);
      return {
        moduleName: mod.name,
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    default:
      throw new Error(`Unknown Verilog-A action '${actionId}'`);
  }
}
