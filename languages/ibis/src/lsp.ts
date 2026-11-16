// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { lowerIbisToDae } from "./dae/ibis-to-dae.js";
import { lintIbis } from "./lints/index.js";
import { getIbisWasmParser, parseIbis } from "./parser/ibis-parser.js";
import { ibisToModelica } from "./projections/ibis-to-modelica.js";
import { calculateOutputResistance, evaluateBufferCurrent } from "./solvers/buffer-solver.js";

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

export function validateIbis(text: string): LspDiagnostic[] {
  try {
    const cstTree = getIbisWasmParser().parse(text);
    const syntaxDiags: LspDiagnostic[] = collectAllWasmErrors(cstTree?.rootNode).map((err) => ({
      range: {
        start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
        end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
      },
      severity: 1,
      code: "M8300",
      source: "modelscript-ibis",
      message: `[M8300] ${err.message}`,
    }));

    const deck = parseIbis(text, undefined, cstTree);
    const diags = lintIbis(deck);

    const lintDiags: LspDiagnostic[] = diags.map((d) => {
      const severity = d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3;
      return {
        range: {
          start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startCol - 1) },
          end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endCol - 1) },
        },
        severity,
        code: `M${d.code}`,
        source: "modelscript-ibis",
        message: `[M${d.code}] ${d.message}`,
      };
    });

    return [...syntaxDiags, ...lintDiags];
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8300",
        source: "modelscript-ibis",
        message: `Parse Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

export function getIbisDocumentSymbols(text: string): LspDocumentSymbol[] {
  try {
    const deck = parseIbis(text);
    const symbols: LspDocumentSymbol[] = [];

    const rootSymbol: LspDocumentSymbol = {
      name: deck.fileName || "IBIS Document",
      detail: `IBIS v${deck.ibisVer}, Components: ${deck.components.size}, Models: ${deck.models.size}`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 100, character: 0 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 15 },
      },
      children: [],
    };

    // Components
    for (const [compName, comp] of deck.components) {
      const compSym: LspDocumentSymbol = {
        name: compName,
        detail: `Component (${comp.pins.size} pins)`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: Math.max(0, comp.line - 1), character: 0 },
          end: { line: Math.max(0, comp.line - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, comp.line - 1), character: 0 },
          end: { line: Math.max(0, comp.line - 1), character: compName.length },
        },
        children: [],
      };

      for (const [pinName, pin] of comp.pins) {
        compSym.children!.push({
          name: `${pinName} (${pin.signalName})`,
          detail: `Model: ${pin.modelName}`,
          kind: LspSymbolKind.Field,
          range: {
            start: { line: Math.max(0, pin.line - 1), character: 0 },
            end: { line: Math.max(0, pin.line - 1), character: 20 },
          },
          selectionRange: {
            start: { line: Math.max(0, pin.line - 1), character: 0 },
            end: { line: Math.max(0, pin.line - 1), character: pinName.length },
          },
        });
      }

      rootSymbol.children!.push(compSym);
    }

    // Models
    for (const [modName, mod] of deck.models) {
      rootSymbol.children!.push({
        name: modName,
        detail: `Model [${mod.modelType}] (Vcc=${mod.voltageRange.typ}V, Ccomp=${(mod.cComp.typ * 1e12).toFixed(1)}pF)`,
        kind: LspSymbolKind.Interface,
        range: {
          start: { line: Math.max(0, mod.line - 1), character: 0 },
          end: { line: Math.max(0, mod.line - 1), character: 30 },
        },
        selectionRange: {
          start: { line: Math.max(0, mod.line - 1), character: 0 },
          end: { line: Math.max(0, mod.line - 1), character: modName.length },
        },
      });
    }

    symbols.push(rootSymbol);
    return symbols;
  } catch {
    return [];
  }
}

export function getIbisHover(text: string, pos: LspPosition): LspHover | undefined {
  try {
    const deck = parseIbis(text);
    const line = pos.line + 1;

    // Check components
    for (const [compName, comp] of deck.components) {
      if (comp.line === line) {
        return {
          contents: {
            kind: "markdown",
            value: `**IBIS Component: \`${compName}\`**\n- **Pins:** ${comp.pins.size}\n- **R_pkg:** ${comp.package.rPkg.typ} Ω\n- **L_pkg:** ${(comp.package.lPkg.typ * 1e9).toFixed(2)} nH\n- **C_pkg:** ${(comp.package.cPkg.typ * 1e12).toFixed(2)} pF`,
          },
        };
      }

      for (const [pinName, pin] of comp.pins) {
        if (pin.line === line) {
          const mod = deck.models.get(pin.modelName);
          return {
            contents: {
              kind: "markdown",
              value: `**Pin: \`${pinName}\`**\n- **Signal:** ${pin.signalName}\n- **Model:** ${pin.modelName} (${mod?.modelType ?? "Unknown"})\n${mod ? `- **Supply Voltage:** ${mod.voltageRange.typ} V\n- **C_comp:** ${(mod.cComp.typ * 1e12).toFixed(2)} pF` : ""}`,
            },
          };
        }
      }
    }

    // Check models
    for (const [modName, mod] of deck.models) {
      if (mod.line === line) {
        const { rOnLow, rOnHigh } = calculateOutputResistance(mod);
        return {
          contents: {
            kind: "markdown",
            value: `**IBIS Buffer Model: \`${modName}\`**\n- **Type:** ${mod.modelType}\n- **Supply Voltage:** ${mod.voltageRange.typ} V (range: ${mod.voltageRange.min}V - ${mod.voltageRange.max}V)\n- **Die Capacitance C_comp:** ${(mod.cComp.typ * 1e12).toFixed(2)} pF\n- **Est. Output Resistance (R_on):** ${rOnLow.toFixed(1)} Ω (Low) / ${rOnHigh.toFixed(1)} Ω (High)`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function executeIbisAction(actionId: string, text: string): Promise<unknown> {
  const deck = parseIbis(text);

  switch (actionId) {
    case "ibis_lint":
      return lintIbis(deck);
    case "ibis_to_dae": {
      const dae = lowerIbisToDae(deck);
      return {
        modelName: "IbisBufferModule",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }
    case "ibis_to_modelica":
      return ibisToModelica(deck);
    case "ibis_eval_buffer": {
      const firstMod = deck.models.values().next().value;
      if (!firstMod) return null;
      return {
        modelName: firstMod.name,
        resistance: calculateOutputResistance(firstMod),
        currentSample: evaluateBufferCurrent(firstMod, 1.5, 1),
      };
    }
    default:
      throw new Error(`Unknown IBIS action: ${actionId}`);
  }
}
