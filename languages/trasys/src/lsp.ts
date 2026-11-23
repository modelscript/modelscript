// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for NASA TRASYS decks:
 *   - Diagnostics (TRA1001–TRA5006)
 *   - Document symbols (surfaces, orbit, operations)
 *   - Contextual hover documentation
 *   - Domain actions (lint, solve, to_dae, to_sinda, to_modelica, to_cad)
 */

import { computeSurfaceArea, lowerTrasysToCadAssembly } from "./cad/index.js";
import { trasysToDae } from "./dae/index.js";
import { lintTrasys } from "./lints/index.js";
import { parseTrasysDeck } from "./parser/index.js";
import { trasysToModelica, trasysToSinda } from "./projections/index.js";
import { solveTrasysThermal } from "./solver/index.js";

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
  severity: 1 | 2 | 3 | 4;
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
 * Validates a TRASYS deck and returns LSP diagnostics.
 */
export function validateTrasys(content: string, _uri: string = "model.tra"): LspDiagnostic[] {
  try {
    const deck = parseTrasysDeck(content);
    const diags = lintTrasys(deck);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const lineText = lines[lineNum] ?? "";
      let startChar = d.column ? Math.max(0, d.column - 1) : 0;
      let endChar = Math.max(startChar + 1, lineText.length);
      if (!d.column && d.surfaceId) {
        const idx = lineText.indexOf(d.surfaceId);
        if (idx >= 0) {
          startChar = idx;
          endChar = idx + d.surfaceId.length;
        }
      }

      return {
        range: {
          start: { line: lineNum, character: startChar },
          end: { line: lineNum, character: Math.max(startChar + 1, endChar) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-trasys",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "TRA1001",
        source: "modelscript-trasys",
        message: `Failed to parse TRASYS deck: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for TRASYS surfaces, orbit definitions, and operations.
 */
export function getTrasysDocumentSymbols(content: string, _uri: string = "model.tra"): LspDocumentSymbol[] {
  try {
    const deck = parseTrasysDeck(content);
    const children: LspDocumentSymbol[] = [];

    for (const surf of deck.surfaces) {
      const lineIdx = surf.line ? Math.max(0, surf.line - 1) : 0;
      const range: LspRange = {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: surf.id.length + surf.kind.length + 1 },
      };
      const area = computeSurfaceArea(surf);
      children.push({
        name: `${surf.id} [${surf.kind}]`,
        detail: `Node: ${surf.nodeId ?? "unmapped"} | Area: ${area.toFixed(3)} m² | α=${surf.prop.alpha}, ε=${surf.prop.epsilon}`,
        kind: LspSymbolKind.Class,
        range,
        selectionRange: range,
      });
    }

    if (deck.orbit) {
      const lineIdx = deck.orbit.line ? Math.max(0, deck.orbit.line - 1) : 0;
      const range: LspRange = {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: 18 },
      };
      children.push({
        name: `ORBIT (${deck.orbit.planet})`,
        detail: `Alt: ${deck.orbit.altitudeKm} km | Beta: ${deck.orbit.betaDeg}° | S: ${deck.orbit.solarFlux} W/m²`,
        kind: LspSymbolKind.Property,
        range,
        selectionRange: range,
      });
    }

    for (const op of deck.operations) {
      const lineIdx = op.line ? Math.max(0, op.line - 1) : 0;
      const range: LspRange = {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: op.kind.length },
      };
      children.push({
        name: op.kind,
        detail: "TRASYS Operation",
        kind: LspSymbolKind.Function,
        range,
        selectionRange: range,
      });
    }

    return [
      {
        name: deck.name || "TRASYS Thermal Radiation Deck",
        detail: `Surfaces: ${deck.surfaces.length} | Operations: ${deck.operations.length}`,
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
 * Provides contextual hover markdown for TRASYS surfaces, orbit parameters, and operations.
 */
export function getTrasysHover(
  content: string,
  position: LspPosition,
  _uri: string = "model.tra",
): LspHover | undefined {
  try {
    const deck = parseTrasysDeck(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    for (const surf of deck.surfaces) {
      if (line.includes(surf.id)) {
        const area = computeSurfaceArea(surf);
        const value = [
          `### TRASYS Surface \`${surf.id}\``,
          `- **Primitive**: \`${surf.kind}\``,
          `- **Area**: ${area.toFixed(4)} m²`,
          `- **Thermal Node**: ${surf.nodeId !== undefined ? surf.nodeId : "unmapped"}`,
          `- **Optical Properties**: $\\alpha_s = ${surf.prop.alpha}$, $\\varepsilon_{IR} = ${surf.prop.epsilon}$${surf.prop.name ? ` (\`${surf.prop.name}\`)` : ""}`,
          `- **Active Side**: \`${surf.active}\` | **Shade**: \`${surf.shade}\``,
        ].join("\n");
        return { contents: { kind: "markdown", value } };
      }
    }

    if (deck.orbit && /\b(ORBIT|PLANET|ALTITUDE|BETA|SOLAR|ALBEDO|PLANETIR)\b/i.test(line)) {
      const o = deck.orbit;
      const value = [
        `### TRASYS Orbital Environment (\`${o.planet}\`)`,
        `- **Altitude**: ${o.altitudeKm} km`,
        `- **Solar Beta Angle**: ${o.betaDeg}°`,
        `- **Solar Constant**: ${o.solarFlux} W/m²`,
        `- **Albedo**: ${o.albedo} | **Planet IR**: ${o.planetIr} W/m²`,
      ].join("\n");
      return { contents: { kind: "markdown", value } };
    }

    if (/\b(FFCAL|RKCAL|QCAL)\b/i.test(line)) {
      const m = /\b(FFCAL|RKCAL|QCAL)\b/i.exec(line);
      const op = (m?.[1] ?? "FFCAL").toUpperCase();
      const desc: Record<string, string> = {
        FFCAL: "Computes diffuse radiative view factors ($F_{ij}$) between active surfaces.",
        RKCAL: "Computes Gebhart absorption factors ($B_{ij}$) and SINDA radiation conductors (`RADK`).",
        QCAL: "Computes orbital solar, planetary albedo, and planetary IR heating fluxes.",
      };
      return {
        contents: {
          kind: "markdown",
          value: `### TRASYS Operation \`${op}\`\n${desc[op] ?? ""}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a TRASYS deck.
 */
export async function executeTrasysAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const deck = parseTrasysDeck(content);

  switch (action) {
    case "lint":
      return lintTrasys(deck);
    case "solve":
      return solveTrasysThermal(deck);
    case "to_sinda":
      return trasysToSinda(deck);
    case "to_modelica":
      return trasysToModelica(deck);
    case "to_cad": {
      const asm = lowerTrasysToCadAssembly(deck);
      return { name: asm.name, partCount: asm.parts.length };
    }
    case "to_dae": {
      const dae = trasysToDae(deck);
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }
    default:
      throw new Error(`Unknown TRASYS action: ${action}`);
  }
}
