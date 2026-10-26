// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerTouchstoneToDae } from "./dae/touchstone-to-dae.js";
import { lintTouchstone } from "./lints/index.js";
import { parseTouchstone } from "./parser/touchstone-parser.js";
import { touchstoneToModelica } from "./projections/touchstone-to-modelica.js";
import { computeMaxSingularValue, fitStateSpaceModel, verifyPassivity } from "./solvers/vector-fitting.js";

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
  code?: string | number | undefined;
  source?: string | undefined;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export function validateTouchstone(text: string): LspDiagnostic[] {
  try {
    const deck = parseTouchstone(text);
    const diags = lintTouchstone(deck);

    return diags.map((d) => {
      const severity = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startCol - 1) },
          end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endCol - 1) },
        },
        severity,
        code: `M${d.code}`,
        source: "modelscript-touchstone",
        message: `[M${d.code}] ${d.message}`,
      };
    });
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8300",
        source: "modelscript-touchstone",
        message: `Parse Error: ${err.message}`,
      },
    ];
  }
}

export function getTouchstoneDocumentSymbols(text: string): LspDocumentSymbol[] {
  try {
    const deck = parseTouchstone(text);
    const symbols: LspDocumentSymbol[] = [];

    const rootSymbol: LspDocumentSymbol = {
      name: `Touchstone (${deck.numPorts}-Port)`,
      detail: `Type: ${deck.options.parameterType}, Format: ${deck.options.format}, Z0: ${deck.options.referenceResistance}Ω, Points: ${deck.points.length}`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, (deck.points[deck.points.length - 1]?.line ?? 1) - 1), character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 15 },
      },
      children: [],
    };

    // Option line
    if (deck.options.line) {
      rootSymbol.children!.push({
        name: "OptionLine",
        detail: `# ${deck.options.frequencyUnit} ${deck.options.parameterType} ${deck.options.format} R ${deck.options.referenceResistance}`,
        kind: LspSymbolKind.Interface,
        range: {
          start: { line: deck.options.line - 1, character: 0 },
          end: { line: deck.options.line - 1, character: 40 },
        },
        selectionRange: {
          start: { line: deck.options.line - 1, character: 0 },
          end: { line: deck.options.line - 1, character: 10 },
        },
      });
    }

    // Ports
    for (let p = 1; p <= deck.numPorts; p++) {
      rootSymbol.children!.push({
        name: `Port ${p}`,
        detail: `Impedance: ${deck.options.referenceResistance} Ω`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
      });
    }

    // First and last frequency point samples
    if (deck.points.length > 0) {
      const pFirst = deck.points[0]!;
      const pLast = deck.points[deck.points.length - 1]!;
      rootSymbol.children!.push({
        name: "FrequencySweep",
        detail: `${pFirst.frequency} ${deck.options.frequencyUnit} to ${pLast.frequency} ${deck.options.frequencyUnit} (${deck.points.length} points)`,
        kind: LspSymbolKind.Constant,
        range: {
          start: { line: pFirst.line - 1, character: 0 },
          end: { line: pLast.line - 1, character: 40 },
        },
        selectionRange: {
          start: { line: pFirst.line - 1, character: 0 },
          end: { line: pFirst.line - 1, character: 14 },
        },
      });
    }

    symbols.push(rootSymbol);
    return symbols;
  } catch {
    return [];
  }
}

export function getTouchstoneHover(text: string, pos: LspPosition): LspHover | undefined {
  try {
    const deck = parseTouchstone(text);
    const line = pos.line + 1;

    // Check option line
    if (deck.options.line === line) {
      return {
        contents: {
          kind: "markdown",
          value: `**Touchstone Options**\n- **Parameter:** ${deck.options.parameterType} (Scattering / N-Port)\n- **Format:** ${deck.options.format}\n- **Frequency Unit:** ${deck.options.frequencyUnit}\n- **Ref Impedance:** ${deck.options.referenceResistance} Ω`,
        },
      };
    }

    // Check data points
    for (const pt of deck.points) {
      if (pt.line === line) {
        const norm = computeMaxSingularValue(pt.matrix, deck.numPorts);
        const s11 = pt.matrix[0]?.[0];
        const s11_mag = s11 ? Math.sqrt(s11.re * s11.re + s11.im * s11.im) : 0;
        const s11_db = s11_mag > 1e-12 ? (20 * Math.log10(s11_mag)).toFixed(2) : "-inf";

        return {
          contents: {
            kind: "markdown",
            value: `**Frequency Sample: ${pt.frequency} ${deck.options.frequencyUnit}** (${(pt.frequencyHz / 1e9).toFixed(3)} GHz)\n- **Ports:** ${deck.numPorts}\n- **Spectral Norm ||S||:** ${norm.toFixed(4)} (${norm <= 1.0001 ? "✓ Passive" : "⚠ Non-passive"})\n- **|S11|:** ${s11_mag.toFixed(4)} (${s11_db} dB)`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function executeTouchstoneAction(actionId: string, text: string): Promise<any> {
  const deck = parseTouchstone(text);

  switch (actionId) {
    case "touchstone_lint":
      return lintTouchstone(deck);
    case "touchstone_passivity":
      return verifyPassivity(deck);
    case "touchstone_to_dae": {
      const dae = lowerTouchstoneToDae(deck);
      return {
        modelName: "NPortMacromodel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "touchstone_to_modelica":
      return touchstoneToModelica(deck);
    case "touchstone_fit_macromodel":
      return fitStateSpaceModel(deck);
    default:
      throw new Error(`Unknown Touchstone action: ${actionId}`);
  }
}
