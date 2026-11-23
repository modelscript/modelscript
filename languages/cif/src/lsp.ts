// SPDX-License-Identifier: AGPL-3.0-or-later

import { flattenCifLayout } from "./cad/geometry.js";
import { lookupMosisLayerRule } from "./catalog/cif-std-schemas.js";
import { cifToDae } from "./dae/cif-to-dae.js";
import { lintCif, type CifLintOptions } from "./lints/index.js";
import { parseCif } from "./parser/cif-parser.js";
import { cifToGdt, cifToSvg } from "./projections/index.js";

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
 * Validates a CIF 2.0 IC layout file and returns LSP diagnostics.
 */
export function validateCif(content: string, _uri: string = "layout.cif", options?: CifLintOptions): LspDiagnostic[] {
  try {
    const doc = parseCif(content);
    const diags = lintCif(doc, options);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = Math.max(0, d.line - 1);
      const lineText = lines[lineNum] ?? "";
      const startChar = Math.max(0, d.column - 1);
      const endChar = Math.max(startChar + 1, Math.min(lineText.length, startChar + 16));
      return {
        range: {
          start: { line: lineNum, character: startChar },
          end: { line: lineNum, character: endChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code,
        source: "modelscript-cif",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "CIF1001",
        source: "modelscript-cif",
        message: `Failed to parse CIF layout: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for CIF symbol definitions (`DS ... DF`) and mask layers.
 */
export function getCifDocumentSymbols(content: string, _uri: string = "layout.cif"): LspDocumentSymbol[] {
  try {
    const doc = parseCif(content);
    const children: LspDocumentSymbol[] = [];

    for (const symId of doc.symbolOrder) {
      const sym = doc.symbols.get(symId);
      if (!sym) continue;
      const startLine = Math.max(0, sym.startLine - 1);
      const endLine = Math.max(startLine, sym.endLine - 1);
      const range: LspRange = {
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: 3 },
      };

      const layerNames = Array.from(new Set(sym.commands.filter((c) => c.kind === "L").map((c) => c.layer)));
      const scaleText = sym.scaleA === 1 && sym.scaleB === 1 ? "1/1" : `${sym.scaleA}/${sym.scaleB}`;
      children.push({
        name: sym.name ? `DS ${sym.id} (${sym.name})` : `DS ${sym.id}`,
        detail: `Scale ${scaleText} | ${sym.commands.length} cmds${layerNames.length > 0 ? ` | Layers: ${layerNames.join(", ")}` : ""}`,
        kind: LspSymbolKind.Class,
        range,
        selectionRange: range,
      });
    }

    return [
      {
        name: "CIF 2.0 IC Layout",
        detail: `Symbols: ${doc.symbols.size} | Top-level commands: ${doc.topLevelCommands.length}`,
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
 * Provides contextual hover documentation for CIF 2.0 commands, MOSIS SCMOS layers, and symbol calls.
 */
export function getCifHover(content: string, position: LspPosition, _uri: string = "layout.cif"): LspHover | undefined {
  try {
    const doc = parseCif(content);
    const lines = content.split(/\r?\n/);
    const line = (lines[position.line] ?? "").trim();
    if (!line) return undefined;

    // Layer hover: `L CAA;`
    const layerMatch = line.match(/\bL\s+([A-Za-z0-9]+)/i);
    if (layerMatch) {
      const layerName = layerMatch[1]!.toUpperCase();
      const rule = lookupMosisLayerRule(layerName);
      if (rule) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### CIF Layer \`${rule.layer}\` — ${rule.label}\n` +
              `- **Category**: ${rule.category}\n` +
              `- **GDSII Layer**: \`${rule.gdsLayer}\`\n` +
              `- **Min Width / Spacing**: \`${rule.minWidthLambda}λ\` / \`${rule.minSpacingLambda}λ\`\n` +
              `- **Sheet Resistance**: \`${rule.sheetResistanceOhmPerSq} Ω/□\`\n` +
              `- **Area / Fringe Cap**: \`${rule.areaCapAfPerUm2} aF/µm²\` / \`${rule.fringeCapAfPerUm} aF/µm\`\n`,
          },
        };
      }
      return {
        contents: {
          kind: "markdown",
          value: `### CIF Mask Layer \`${layerName}\`\nCustom CIF 2.0 mask layer.`,
        },
      };
    }

    // Call hover: `C 1 ...;`
    const callMatch = line.match(/\bC\s+(\d+)/);
    if (callMatch) {
      const symId = Number.parseInt(callMatch[1]!, 10);
      const sym = doc.symbols.get(symId);
      if (sym) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### CIF Symbol Call \`C ${symId}\`${sym.name ? ` (\`${sym.name}\`)` : ""}\n` +
              `- **Scale Factor**: \`${sym.scaleA}/${sym.scaleB}\` (${(sym.scaleA / sym.scaleB).toFixed(4)})\n` +
              `- **Body Commands**: ${sym.commands.length}\n`,
          },
        };
      }
    }

    // Definition Start hover: `DS 1 100/2;`
    const dsMatch = line.match(/\bDS\s+(\d+)/);
    if (dsMatch) {
      const symId = Number.parseInt(dsMatch[1]!, 10);
      const sym = doc.symbols.get(symId);
      if (sym) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### CIF Symbol Definition \`DS ${symId}\`${sym.name ? ` (\`${sym.name}\`)` : ""}\n` +
              `- **Scale Factor**: \`${sym.scaleA}/${sym.scaleB}\`\n` +
              `- **Commands**: ${sym.commands.length}\n`,
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
 * Executes domain actions on a CIF 2.0 layout document.
 */
export async function executeCifAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const doc = parseCif(content);

  switch (action) {
    case "lint":
      return lintCif(doc);

    case "flatten":
      return flattenCifLayout(doc);

    case "to_dae": {
      const res = cifToDae(doc);
      return {
        varCount: res.varCount,
        eqCount: res.eqCount,
        totalCapacitanceFf: res.totalCapacitanceFf,
        totalResistanceOhm: res.totalResistanceOhm,
        parasitics: res.parasitics,
      };
    }

    case "to_gdt":
      return cifToGdt(doc);

    case "to_svg":
      return cifToSvg(doc);

    default:
      throw new Error(`Unknown CIF action: ${action}`);
  }
}
