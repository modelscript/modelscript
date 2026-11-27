// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Language Server Protocol (LSP) Services.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { lookupIsotopeCrossSection } from "./catalog/library-package-adapter.js";
import { lowerMcnpToDae } from "./dae/mcnp-to-dae.js";
import { lintMcnpDeck } from "./lints/index.js";
import { parseMcnpDeck } from "./parser/deck-parser.js";
import { mcnpToModelica, mcnpToOpenScad } from "./projections/index.js";
import { solveMcnpDeck } from "./solver/monte-carlo.js";

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

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface McnpCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildMcnpCstIndex(content: string): McnpCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("mcnp", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      byRow.set(row, { row, text: lineText, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }
  return { byRow, lastRow, lastEndCol };
}

function lineRange(cstIndex: McnpCstIndex, lineOneBased: number): LspRange {
  const ln = Math.max(0, lineOneBased - 1);
  const entry = cstIndex.byRow.get(ln);
  const startChar = entry?.startCol ?? 0;
  const endChar = Math.max(startChar + 1, entry?.endCol ?? 1);
  return {
    start: { line: ln, character: startChar },
    end: { line: ln, character: endChar },
  };
}

/**
 * Validates an MCNP deck and returns LSP diagnostics.
 */
export function validateMcnp(content: string, _uri: string = "deck.mcnp"): LspDiagnostic[] {
  try {
    const deck = parseMcnpDeck(content);
    const diags = lintMcnpDeck(deck);
    const cstIndex = buildMcnpCstIndex(content);

    return diags.map((d) => ({
      range: d.line ? lineRange(cstIndex, d.line) : DEFAULT_RANGE,
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-mcnp",
      message: d.message,
    }));
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "MCNP1001",
        source: "modelscript-mcnp",
        message: `Failed to parse MCNP deck: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols (Cells, Surfaces, Materials, Tallies) from an MCNP deck.
 */
export function getMcnpDocumentSymbols(content: string, _uri: string = "deck.mcnp"): LspDocumentSymbol[] {
  try {
    const deck = parseMcnpDeck(content);
    const cstIndex = buildMcnpCstIndex(content);
    const children: LspDocumentSymbol[] = [];

    for (const cell of deck.cells.values()) {
      const r = lineRange(cstIndex, cell.line);
      const matLabel = cell.materialId === 0 ? "VOID" : `M${cell.materialId} (rho=${cell.density ?? 0})`;
      children.push({
        name: `Cell ${cell.id}`,
        detail: `${matLabel} | CSG: ${cell.csgRaw}`,
        kind: LspSymbolKind.Class,
        range: r,
        selectionRange: r,
      });
    }

    for (const surf of deck.surfaces.values()) {
      const r = lineRange(cstIndex, surf.line);
      children.push({
        name: `Surface ${surf.id} (${surf.type})`,
        detail: `Params: ${surf.params.join(" ")}`,
        kind: LspSymbolKind.Interface,
        range: r,
        selectionRange: r,
      });
    }

    for (const mat of deck.materials.values()) {
      const r = lineRange(cstIndex, mat.line);
      children.push({
        name: `M${mat.id}`,
        detail: `${mat.isotopes.length} isotope(s)${mat.thermalLaw ? ` | MT: ${mat.thermalLaw}` : ""}`,
        kind: LspSymbolKind.Constant,
        range: r,
        selectionRange: r,
      });
    }

    for (const tally of deck.tallies.values()) {
      const r = lineRange(cstIndex, tally.line);
      children.push({
        name: `F${tally.id}:${tally.particle}`,
        detail: `Type F${tally.type} | Targets: ${tally.targets.join(", ")}`,
        kind: LspSymbolKind.Function,
        range: r,
        selectionRange: r,
      });
    }

    return [
      {
        name: deck.title || "MCNP Transport Deck",
        detail: `Cells: ${deck.cells.size} | Surfaces: ${deck.surfaces.size} | Materials: ${deck.materials.size} | Tallies: ${deck.tallies.size}`,
        kind: LspSymbolKind.Package,
        range: {
          start: { line: 0, character: cstIndex.byRow.get(0)?.startCol ?? 0 },
          end: { line: cstIndex.lastRow, character: cstIndex.lastEndCol },
        },
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Provides contextual Markdown hover documentation for MCNP cards, surfaces, ZAIDs, and tallies.
 */
export function getMcnpHover(content: string, position: LspPosition, _uri: string = "deck.mcnp"): LspHover | undefined {
  try {
    const deck = parseMcnpDeck(content);
    const cstIndex = buildMcnpCstIndex(content);
    const line = cstIndex.byRow.get(position.line)?.text ?? "";
    const lineNum = position.line + 1;

    // Hover on ZAID isotope (e.g. 92235.80c)
    const zaidMatch = /\b(\d{4,6})(?:\.\d{2}[a-zA-Z])?\b/.exec(line);
    if (zaidMatch) {
      const iso = lookupIsotopeCrossSection(Number(zaidMatch[1]));
      if (iso) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### Isotope \`${iso.zaid}\` (${iso.symbol} — ${iso.name})\n` +
              `- **Atomic Mass**: ${iso.atomicMass} amu\n` +
              `- **Fast XS (b)**: σ_t=${iso.fast.sigmaT}, σ_s=${iso.fast.sigmaS}, σ_c=${iso.fast.sigmaC}, σ_f=${iso.fast.sigmaF}, ν=${iso.fast.nu}\n` +
              `- **Thermal XS (b)**: σ_t=${iso.thermal.sigmaT}, σ_c=${iso.thermal.sigmaC}, σ_f=${iso.thermal.sigmaF}`,
          },
        };
      }
    }

    for (const cell of deck.cells.values()) {
      if (cell.line === lineNum) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### MCNP Cell \`${cell.id}\`\n` +
              `- **Material**: ${cell.materialId === 0 ? "Void (0)" : `\`M${cell.materialId}\` (density=${cell.density})`}\n` +
              `- **CSG**: \`${cell.csgRaw}\`\n` +
              `- **Importance**: ${
                Object.entries(cell.imp)
                  .map(([k, v]) => `IMP:${k}=${v}`)
                  .join(", ") || "unspecified"
              }`,
          },
        };
      }
    }

    for (const surf of deck.surfaces.values()) {
      if (surf.line === lineNum) {
        return {
          contents: {
            kind: "markdown",
            value:
              `### MCNP Surface \`${surf.id}\` (\`${surf.type}\`)\n` +
              `- **Parameters**: \`${surf.params.join(" ")}\`\n` +
              (surf.boundary
                ? `- **Boundary**: \`${surf.boundary}\` (${surf.boundary === "*" ? "Reflective" : "White"})\n`
                : ""),
          },
        };
      }
    }

    if (/\bKCODE\b/i.test(line) && deck.source.kcode) {
      const kc = deck.source.kcode;
      return {
        contents: {
          kind: "markdown",
          value: `### MCNP Criticality Source (\`KCODE\`)\n- **Histories/Cycle**: ${kc.nsrck}\n- **Initial k_eff**: ${kc.rkk}\n- **Inactive Cycles**: ${kc.ikz}\n- **Total Cycles**: ${kc.kct}`,
        },
      };
    }

    if (/\bSDEF\b/i.test(line) && deck.source.sdef) {
      return {
        contents: {
          kind: "markdown",
          value: `### MCNP Fixed Source (\`SDEF\`)\n- **Definition**: \`${deck.source.sdef.raw}\``,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on an MCNP transport deck (`lint`, `solve`, `to_dae`, `to_modelica`, `to_scad`).
 */
export async function executeMcnpAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const deck = parseMcnpDeck(content);

  switch (action) {
    case "lint":
      return lintMcnpDeck(deck);

    case "solve": {
      const seed = typeof args["seed"] === "number" ? args["seed"] : undefined;
      const nps = typeof args["nps"] === "number" ? args["nps"] : undefined;
      const groups = args["groups"] === 2 ? 2 : 1;
      const res = solveMcnpDeck(deck, { seed, nps, groups });
      return {
        ...res,
        tallies: Object.fromEntries(res.tallies.entries()),
      };
    }

    case "to_dae": {
      const dae = lowerMcnpToDae(deck);
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }

    case "to_modelica":
      return mcnpToModelica(deck);

    case "to_scad":
      return mcnpToOpenScad(deck);

    default:
      throw new Error(`Unknown MCNP action: ${action}`);
  }
}
