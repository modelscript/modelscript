// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerPsseToDae } from "./dae/psse-to-dae.js";
import { lintPsse } from "./lints/index.js";
import { parseRaw } from "./parser/raw-parser.js";
import { psseToModelica } from "./projections/psse-to-modelica.js";
import { psseToEmtNetlist } from "./projections/psse-to-pscad.js";
import { solvePowerFlow } from "./solver/ac-powerflow.js";
import type { PsseCase } from "./types.js";

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
 * Validates a PSS/E RAW power flow deck and returns diagnostics.
 */
export function validatePsse(content: string, _uri: string = "model.raw"): LspDiagnostic[] {
  try {
    const psseCase = parseRaw(content);
    const diags = lintPsse(psseCase);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = Math.max(0, (d.line ?? 1) - 1);
      const colNum = Math.max(0, (d.column ?? 1) - 1);
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code,
        source: "modelscript-psse",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "P1001",
        source: "modelscript-psse",
        message: `Failed to parse PSS/E RAW base case: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for buses, generators, branches, and transformers.
 */
export function getPsseDocumentSymbols(content: string, _uri: string = "model.raw"): LspDocumentSymbol[] {
  try {
    const psseCase = parseRaw(content);
    const children: LspDocumentSymbol[] = [];

    // Buses
    for (const [busNum, bus] of psseCase.buses) {
      children.push({
        name: `Bus ${busNum} (${bus.name})`,
        detail: `Type: ${bus.ide === 3 ? "Slack" : bus.ide === 2 ? "PV" : "PQ"} | Base: ${bus.baseKv} kV | V: ${bus.vm.toFixed(3)} p.u.`,
        kind: LspSymbolKind.Interface,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Generators
    for (const gen of psseCase.generators) {
      children.push({
        name: `Gen Bus ${gen.i} [${gen.id.trim()}]`,
        detail: `Pg: ${gen.pg.toFixed(1)} MW | Qg: ${gen.qg.toFixed(1)} Mvar | Vset: ${gen.vs.toFixed(3)} p.u.`,
        kind: LspSymbolKind.Class,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Branches / Lines
    for (const br of psseCase.branches) {
      children.push({
        name: `Line ${br.i} -> ${br.j} [${br.ckt.trim()}]`,
        detail: `R: ${br.r.toFixed(4)} | X: ${br.x.toFixed(4)} | RateA: ${br.rateA} MVA`,
        kind: LspSymbolKind.Property,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Transformers
    for (const xf of psseCase.transformers) {
      children.push({
        name: `Xfmr ${xf.i} -> ${xf.j} [${xf.ckt.trim()}]`,
        detail: `Ratio: ${xf.windv1.toFixed(3)} / ${xf.windv2.toFixed(3)} | Sbase: ${xf.sbase12} MVA`,
        kind: LspSymbolKind.Constructor,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: psseCase.title1 || `PSS/E Grid (Rev ${psseCase.header.rev})`,
        detail: `Base MVA: ${psseCase.header.sbase} | Buses: ${psseCase.buses.size} | Gens: ${psseCase.generators.length} | Lines: ${psseCase.branches.length}`,
        kind: LspSymbolKind.Package,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Contextual hover documentation for power grid elements.
 */
export function getPsseHover(content: string, position: LspPosition, _uri: string = "model.raw"): LspHover | undefined {
  try {
    const psseCase = parseRaw(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    // Match bus by name or number
    for (const [busNum, bus] of psseCase.buses) {
      if (line.includes(bus.name) || line.includes(String(busNum))) {
        const typeStr = bus.ide === 3 ? "Swing / Slack" : bus.ide === 2 ? "PV Generator" : "PQ Load";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Bus \`${busNum}\` (${bus.name})\n- **Type**: \`${typeStr}\`\n- **Base Voltage**: ${bus.baseKv} kV\n- **Voltage Mag**: ${bus.vm.toFixed(4)} p.u.\n- **Voltage Angle**: ${bus.va.toFixed(2)}°`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a PSS/E model.
 */
export async function executePsseAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const psseCase: PsseCase = parseRaw(content);

  switch (action) {
    case "lint":
      return lintPsse(psseCase);

    case "to_modelica":
      return psseToModelica(psseCase);

    case "to_pscad":
      return psseToEmtNetlist(psseCase);

    case "to_dae": {
      const dae = lowerPsseToDae(psseCase);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "solve_powerflow":
      return solvePowerFlow(psseCase);

    default:
      throw new Error(`Unknown PSS/E action: ${action}`);
  }
}
