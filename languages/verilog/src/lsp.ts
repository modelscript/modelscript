// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookupVerilogModelSchema } from "./catalog/library-package-adapter.js";
import { verilogToDae } from "./dae/verilog-to-dae.js";
import { lintVerilog } from "./lints/index.js";
import { parseVerilog } from "./parser/index.js";
import { verilogToModelica, verilogToVhdl } from "./projections/index.js";
import { simulateVerilog, type SimulationStepStimulus } from "./solver/index.js";
import type { BitRange, VerilogDesign } from "./types.js";

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

function formatRange(range?: BitRange): string {
  return range ? `[${range.msb}:${range.lsb}]` : "[0:0]";
}

/**
 * Validates IEEE 1364 Verilog source text and returns LSP diagnostics (`VLOG1001`–`VLOG5006`).
 */
export function validateVerilog(content: string, _uri: string = "design.v"): LspDiagnostic[] {
  try {
    const design = parseVerilog(content);
    const diags = lintVerilog(design);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = Math.max(0, d.line - 1);
      const lt = lines[lineNum] ?? "";
      const startChar = Math.max(0, d.column - 1);
      const tokLen = d.symbolName ? d.symbolName.length : 1;
      const endChar = Math.min(Math.max(startChar + tokLen, startChar + 1), Math.max(lt.length, startChar + 1));

      return {
        range: {
          start: { line: lineNum, character: startChar },
          end: { line: lineNum, character: endChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code,
        source: "modelscript-verilog",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "VLOG1001",
        source: "modelscript-verilog",
        message: `Failed to parse Verilog source: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols (modules, ports, nets/regs, parameters, instances).
 */
export function getVerilogDocumentSymbols(content: string, _uri: string = "design.v"): LspDocumentSymbol[] {
  try {
    const design = parseVerilog(content);
    return design.modules.map((mod) => {
      const children: LspDocumentSymbol[] = [];

      for (const [pName, param] of mod.parameters) {
        const line = Math.max(0, param.span.line - 1);
        const col = Math.max(0, param.span.column - 1);
        const rng: LspRange = {
          start: { line, character: col },
          end: { line, character: col + pName.length },
        };
        children.push({
          name: pName,
          detail: param.isLocal ? "localparam" : "parameter",
          kind: LspSymbolKind.Constant,
          range: rng,
          selectionRange: rng,
        });
      }

      for (const [pName, port] of mod.ports) {
        const line = Math.max(0, port.span.line - 1);
        const col = Math.max(0, port.span.column - 1);
        const rng: LspRange = {
          start: { line, character: col },
          end: { line, character: col + pName.length },
        };
        children.push({
          name: pName,
          detail: `${port.direction} ${port.netKind ?? "wire"} ${formatRange(port.range)}`,
          kind: LspSymbolKind.Interface,
          range: rng,
          selectionRange: rng,
        });
      }

      for (const [nName, net] of mod.nets) {
        if (mod.ports.has(nName)) continue;
        const line = Math.max(0, net.span.line - 1);
        const col = Math.max(0, net.span.column - 1);
        const rng: LspRange = {
          start: { line, character: col },
          end: { line, character: col + nName.length },
        };
        children.push({
          name: nName,
          detail: `${net.kind} ${formatRange(net.range)}`,
          kind: LspSymbolKind.Variable,
          range: rng,
          selectionRange: rng,
        });
      }

      for (const item of mod.items) {
        if (item.kind === "instantiation") {
          const line = Math.max(0, item.span.line - 1);
          const col = Math.max(0, item.span.column - 1);
          const rng: LspRange = {
            start: { line, character: col },
            end: { line, character: col + item.instanceName.length },
          };
          children.push({
            name: item.instanceName,
            detail: `instance of ${item.moduleType}`,
            kind: LspSymbolKind.Object,
            range: rng,
            selectionRange: rng,
          });
        }
      }

      const modLine = Math.max(0, mod.span.line - 1);
      const modCol = Math.max(0, mod.span.column - 1);
      const modRange: LspRange = {
        start: { line: modLine, character: modCol },
        end: { line: modLine, character: modCol + mod.name.length },
      };

      return {
        name: mod.name,
        detail: `module (${mod.ports.size} ports, ${mod.nets.size} nets/regs)`,
        kind: LspSymbolKind.Module,
        range: modRange,
        selectionRange: modRange,
        children: children.length > 0 ? children : undefined,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Contextual hover documentation for Verilog ports, nets, registers, parameters, and IEEE 1364 primitives.
 */
export function getVerilogHover(
  content: string,
  position: LspPosition,
  _uri: string = "design.v",
): LspHover | undefined {
  try {
    const design = parseVerilog(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";
    if (!line) return undefined;

    // Extract word under cursor
    let start = Math.min(position.character, line.length);
    let end = start;
    while (start > 0 && /[A-Za-z0-9_$]/.test(line[start - 1]!)) start--;
    while (end < line.length && /[A-Za-z0-9_$]/.test(line[end]!)) end++;
    const word = line.slice(start, end);
    if (!word) return undefined;

    // 1. Check declared symbols in parsed modules
    for (const mod of design.modules) {
      if (mod.name === word) {
        return {
          contents: {
            kind: "markdown",
            value: `### Verilog Module \`${mod.name}\`\n- **Ports**: ${mod.portOrder.join(", ") || "(none)"}\n- **Parameters**: ${Array.from(mod.parameters.keys()).join(", ") || "(none)"}`,
          },
        };
      }
      const port = mod.ports.get(word);
      if (port) {
        return {
          contents: {
            kind: "markdown",
            value: `### Port \`${port.name}\` (\`${mod.name}\`)\n- **Direction**: \`${port.direction}\`\n- **Kind**: \`${port.netKind ?? "wire"}\`\n- **Range**: \`${formatRange(port.range)}\``,
          },
        };
      }
      const net = mod.nets.get(word);
      if (net) {
        return {
          contents: {
            kind: "markdown",
            value: `### Signal \`${net.name}\` (\`${mod.name}\`)\n- **Kind**: \`${net.kind}\`\n- **Range**: \`${formatRange(net.range)}\``,
          },
        };
      }
      const param = mod.parameters.get(word);
      if (param) {
        return {
          contents: {
            kind: "markdown",
            value: `### ${param.isLocal ? "Localparam" : "Parameter"} \`${param.name}\` (\`${mod.name}\`)`,
          },
        };
      }
    }

    // 2. Check IEEE 1364 built-in gate primitives & standard library schemas
    const schema = lookupVerilogModelSchema(word);
    if (schema) {
      return {
        contents: {
          kind: "markdown",
          value: `### IEEE 1364 Primitive \`${schema.name}\`\n- **Category**: ${schema.category}\n- **Description**: ${schema.description}\n- **Standard**: ${schema.provenance}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on an IEEE 1364 Verilog source document.
 */
export async function executeVerilogAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const design: VerilogDesign = parseVerilog(content);

  switch (action) {
    case "lint":
      return lintVerilog(design);

    case "to_modelica":
      return verilogToModelica(design);

    case "to_vhdl":
      return verilogToVhdl(design);

    case "to_dae": {
      const dae = verilogToDae(design);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate": {
      const steps = Array.isArray(args["steps"]) ? (args["steps"] as SimulationStepStimulus[]) : [];
      const topModule = typeof args["topModule"] === "string" ? args["topModule"] : undefined;
      return simulateVerilog(design, steps, { topModule });
    }

    default:
      throw new Error(`Unknown Verilog action: ${action}`);
  }
}
