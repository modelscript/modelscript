// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for NASA TRASYS decks:
 *   - Diagnostics (TRA1001–TRA5006)
 *   - Document symbols (surfaces, orbit, operations)
 *   - Contextual hover documentation
 *   - Domain actions (lint, solve, to_dae, to_sinda, to_modelica, to_cad)
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
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

interface TrasysCstLine {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  tokens: CstNodeLike[];
}

const ORBIT_KEYWORDS = new Set(["ORBIT", "PLANET", "ALTITUDE", "BETA", "SOLAR", "ALBEDO", "PLANETIR"]);
const OPERATION_KEYWORDS = new Set(["FFCAL", "RKCAL", "QCAL"]);

function buildTrasysCstLineMap(content: string, cstTree?: { rootNode?: unknown } | null): Map<number, TrasysCstLine> {
  const byRow = new Map<number, TrasysCstLine>();
  let rootNode: unknown = cstTree?.rootNode ?? null;
  if (!rootNode) {
    try {
      rootNode =
        getOrLoadLanguageWasmParser("trasys", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
    } catch {
      rootNode = null;
    }
  }
  if (!rootNode) return byRow;

  for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
    const lineText = cstLineText(content, tokens);
    const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
    const startCol = first?.startPosition?.column ?? 0;
    const endCol = last?.endPosition?.column ?? startCol + lineText.length;
    byRow.set(row, { row, text: lineText, startCol, endCol, tokens });
  }
  return byRow;
}

/**
 * Validates a TRASYS deck and returns LSP diagnostics.
 */
export function validateTrasys(
  content: string,
  _uri: string = "model.tra",
  cstTree?: { rootNode?: unknown } | null,
): LspDiagnostic[] {
  try {
    const deck = parseTrasysDeck(content);
    const diags = lintTrasys(deck);
    const lineMap = buildTrasysCstLineMap(content, cstTree);

    return diags.map((d) => {
      const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const lineEntry = lineMap.get(lineNum);
      let startChar = d.column ? Math.max(0, d.column - 1) : (lineEntry?.startCol ?? 0);
      let endChar = Math.max(startChar + 1, lineEntry?.endCol ?? startChar + 1);
      if (!d.column && d.surfaceId && lineEntry) {
        const matchedTok = lineEntry.tokens.find((t) => (t.text ?? "") === d.surfaceId) as
          (CstNodeLike & { endPosition?: { column: number } }) | undefined;
        if (matchedTok) {
          startChar = matchedTok.startPosition?.column ?? startChar;
          endChar = matchedTok.endPosition?.column ?? startChar + d.surfaceId.length;
        } else {
          const idx = lineEntry.text.indexOf(d.surfaceId);
          if (idx >= 0) {
            startChar = lineEntry.startCol + idx;
            endChar = startChar + d.surfaceId.length;
          }
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
  cstTree?: { rootNode?: unknown } | null,
): LspHover | undefined {
  try {
    const deck = parseTrasysDeck(content);
    const lineMap = buildTrasysCstLineMap(content, cstTree);
    const lineEntry = lineMap.get(position.line);
    if (!lineEntry) return undefined;

    const upperTokens = lineEntry.tokens.map((t) => (t.text ?? "").trim().toUpperCase());

    for (const surf of deck.surfaces) {
      if (lineEntry.tokens.some((t) => (t.text ?? "") === surf.id) || lineEntry.text.includes(surf.id)) {
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

    if (deck.orbit && upperTokens.some((tok) => ORBIT_KEYWORDS.has(tok))) {
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

    const op = upperTokens.find((tok) => OPERATION_KEYWORDS.has(tok));
    if (op) {
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
